package com.mahadi.batchdownloader;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    private static final int MAX_LINKS = 12;
    private static final int GREEN = Color.rgb(53, 225, 125);
    private static final int GREEN_DARK = Color.rgb(13, 61, 38);
    private static final int BG = Color.rgb(5, 7, 9);
    private static final int CARD = Color.rgb(16, 20, 24);
    private static final int CARD_2 = Color.rgb(20, 25, 30);
    private static final int BORDER = Color.rgb(38, 55, 47);
    private static final int MUTED = Color.rgb(142, 154, 166);
    private static final int ERROR = Color.rgb(255, 98, 110);
    private static final int WARN = Color.rgb(255, 192, 80);

    private EditText videoInput;
    private EditText profileInput;
    private LinearLayout queueContainer;
    private LinearLayout historyContainer;
    private Spinner qualitySpinner;
    private Spinner concurrencySpinner;
    private Switch wifiOnlySwitch;
    private TextView summaryText;
    private TextView engineStatus;

    private final List<VideoItem> items = new ArrayList<>();
    private ExecutorService resolverPool = Executors.newFixedThreadPool(2);
    private final ScheduledExecutorService poller = Executors.newSingleThreadScheduledExecutor();

    private DownloadManager downloadManager;
    private SharedPreferences prefs;
    private volatile PyObject resolverModule;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);

        downloadManager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        prefs = getSharedPreferences("mahadi_downloader", MODE_PRIVATE);

        buildUi();
        loadHistory();
        requestNotificationPermission();

        Executors.newSingleThreadExecutor().submit(() -> {
            try {
                resolverModule = Python.getInstance().getModule("resolver");
                runOnUiThread(() -> {
                    engineStatus.setText("● ENGINE ONLINE");
                    engineStatus.setTextColor(GREEN);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    engineStatus.setText("● ENGINE ERROR");
                    engineStatus.setTextColor(ERROR);
                });
            }
        });

        poller.scheduleAtFixedRate(this::pollDownloads, 2, 2, TimeUnit.SECONDS);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        resolverPool.shutdownNow();
        poller.shutdownNow();
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(18), dp(16), dp(36));
        scroll.addView(root, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout hero = new LinearLayout(this);
        hero.setOrientation(LinearLayout.HORIZONTAL);
        hero.setGravity(Gravity.CENTER_VERTICAL);
        hero.setPadding(dp(16), dp(16), dp(16), dp(16));
        GradientDrawable heroBg = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{Color.rgb(9, 20, 14), Color.rgb(11, 14, 17)});
        heroBg.setCornerRadius(dp(20));
        heroBg.setStroke(dp(1), Color.rgb(41, 97, 65));
        hero.setBackground(heroBg);

        ImageView logo = new ImageView(this);
        logo.setImageResource(com.mahadi.batchdownloader.R.drawable.ic_mbd_logo);
        LinearLayout.LayoutParams logoLp = new LinearLayout.LayoutParams(dp(76), dp(76));
        logoLp.rightMargin = dp(14);
        hero.addView(logo, logoLp);

        LinearLayout heroText = new LinearLayout(this);
        heroText.setOrientation(LinearLayout.VERTICAL);
        heroText.addView(text("MAHADI", 24, Color.WHITE, true));
        TextView downloader = text("DOWNLOADER", 18, GREEN, true);
        if (Build.VERSION.SDK_INT >= 21) downloader.setLetterSpacing(0.08f);
        heroText.addView(downloader);

        engineStatus = text("● ENGINE STARTING", 11, WARN, true);
        engineStatus.setPadding(0, dp(6), 0, 0);
        heroText.addView(engineStatus);

        TextView privateBadge = text("🔒 PRIVATE • ON-DEVICE", 10, MUTED, true);
        privateBadge.setPadding(0, dp(4), 0, 0);
        heroText.addView(privateBadge);
        hero.addView(heroText, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        root.addView(hero, lpMatchWrap(0, dp(14)));

        TextView subtitle = text(
                "TikTok • Facebook • Instagram\nFacebook Browser Mode + batch downloader",
                13, MUTED, false);
        subtitle.setPadding(dp(4), 0, dp(4), dp(14));
        root.addView(subtitle);

        root.addView(sectionTitle("VIDEO LINKS"));

        LinearLayout videoCard = premiumCard();
        videoInput = new EditText(this);
        videoInput.setHint("এক লাইনে ১টা video/reel link\n10–12টা link একসাথে paste করতে পারবেন");
        videoInput.setHintTextColor(Color.rgb(88, 101, 111));
        videoInput.setTextColor(Color.WHITE);
        videoInput.setTextSize(14);
        videoInput.setGravity(Gravity.TOP | Gravity.START);
        videoInput.setMinLines(5);
        videoInput.setMaxLines(10);
        videoInput.setPadding(dp(13), dp(12), dp(13), dp(12));
        videoInput.setBackground(roundStroke(Color.rgb(10, 14, 17), BORDER, 14, 1));
        videoCard.addView(videoInput, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(150)));

        LinearLayout videoActions = horizontal();
        Button paste = ghostButton("PASTE");
        Button clear = ghostButton("CLEAR");
        Button analyze = ghostButton("ANALYZE");
        videoActions.addView(paste, weight(1, dp(8), dp(44)));
        videoActions.addView(clear, weight(1, dp(8), dp(44)));
        videoActions.addView(analyze, weight(1, 0, dp(44)));
        videoCard.addView(videoActions, lpMatchWrap(dp(10), 0));
        root.addView(videoCard, lpMatchWrap(0, dp(14)));

        paste.setOnClickListener(v -> pasteInto(videoInput));
        clear.setOnClickListener(v -> {
            videoInput.setText("");
            clearQueue();
        });
        analyze.setOnClickListener(v -> analyzeBatch(false));

        root.addView(sectionTitle("PROFILE SCANNER"));

        LinearLayout profileCard = premiumCard();
        profileInput = new EditText(this);
        profileInput.setSingleLine(true);
        profileInput.setHint("Facebook / Instagram / TikTok profile link");
        profileInput.setHintTextColor(Color.rgb(88, 101, 111));
        profileInput.setTextColor(Color.WHITE);
        profileInput.setTextSize(14);
        profileInput.setPadding(dp(13), 0, dp(13), 0);
        profileInput.setBackground(roundStroke(Color.rgb(10, 14, 17), BORDER, 14, 1));
        profileCard.addView(profileInput, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));

        LinearLayout profileActions = horizontal();
        Button pasteProfile = ghostButton("PASTE PROFILE");
        Button scanProfile = greenButton("OPEN PROFILE");
        profileActions.addView(pasteProfile, weight(1, dp(8), dp(46)));
        profileActions.addView(scanProfile, weight(1, 0, dp(46)));
        profileCard.addView(profileActions, lpMatchWrap(dp(10), 0));

        TextView profileHint = text(
                "Facebook profile app-এর ভিতর browser-এ খুলবে। Reel খুলে DOWNLOAD THIS REEL চাপুন।",
                11, MUTED, false);
        profileHint.setPadding(0, dp(10), 0, 0);
        profileCard.addView(profileHint);
        root.addView(profileCard, lpMatchWrap(0, dp(14)));

        pasteProfile.setOnClickListener(v -> pasteInto(profileInput));
        scanProfile.setOnClickListener(v -> scanProfile());

        root.addView(sectionTitle("DOWNLOAD SETTINGS"));

        LinearLayout settings = premiumCard();

        LinearLayout qRow = horizontal();
        qRow.addView(text("Quality", 14, Color.WHITE, true), new LinearLayout.LayoutParams(0, dp(48), 1f));
        qualitySpinner = new Spinner(this);
        qualitySpinner.setAdapter(simpleSpinner(new String[]{"Best", "HD", "SD"}));
        qRow.addView(qualitySpinner, new LinearLayout.LayoutParams(dp(120), dp(48)));
        settings.addView(qRow);

        LinearLayout cRow = horizontal();
        cRow.addView(text("Parallel resolver", 14, Color.WHITE, true), new LinearLayout.LayoutParams(0, dp(48), 1f));
        concurrencySpinner = new Spinner(this);
        concurrencySpinner.setAdapter(simpleSpinner(new String[]{"1", "2", "3"}));
        concurrencySpinner.setSelection(1);
        cRow.addView(concurrencySpinner, new LinearLayout.LayoutParams(dp(120), dp(48)));
        settings.addView(cRow);

        wifiOnlySwitch = new Switch(this);
        wifiOnlySwitch.setText("Wi‑Fi only downloads");
        wifiOnlySwitch.setTextColor(MUTED);
        wifiOnlySwitch.setTextSize(13);
        settings.addView(wifiOnlySwitch, lpMatchWrap(dp(4), 0));
        root.addView(settings, lpMatchWrap(0, dp(12)));

        Button downloadAll = greenButton("DOWNLOAD ALL");
        downloadAll.setTextSize(16);
        downloadAll.setTypeface(Typeface.DEFAULT_BOLD);
        downloadAll.setOnClickListener(v -> analyzeBatch(true));
        root.addView(downloadAll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));

        summaryText = text("Queue empty", 12, MUTED, false);
        summaryText.setPadding(dp(2), dp(12), dp(2), dp(6));
        root.addView(summaryText);

        queueContainer = new LinearLayout(this);
        queueContainer.setOrientation(LinearLayout.VERTICAL);
        root.addView(queueContainer, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        root.addView(sectionTitle("HISTORY"));
        historyContainer = new LinearLayout(this);
        historyContainer.setOrientation(LinearLayout.VERTICAL);
        root.addView(historyContainer);

        Button clearHistory = ghostButton("CLEAR HISTORY");
        clearHistory.setOnClickListener(v -> {
            prefs.edit().remove("history").apply();
            loadHistory();
        });
        root.addView(clearHistory, lpMatchWrap(dp(8), 0));

        setContentView(scroll);
    }

    private void analyzeBatch(boolean autoDownload) {
        List<String> urls = parseLinks(videoInput.getText().toString());
        if (urls.isEmpty()) {
            toast("কমপক্ষে ১টা valid video link দিন");
            return;
        }
        if (urls.size() > MAX_LINKS) {
            urls = new ArrayList<>(urls.subList(0, MAX_LINKS));
            toast("প্রথম 12টা link নেওয়া হয়েছে");
        }

        resetResolverPool();
        synchronized (items) {
            items.clear();
        }
        runOnUiThread(() -> queueContainer.removeAllViews());

        for (String url : urls) {
            VideoItem item = new VideoItem(url, 0);
            synchronized (items) {
                items.add(item);
            }
            runOnUiThread(() -> addItemRow(item));
        }

        updateSummary();
        String quality = String.valueOf(qualitySpinner.getSelectedItem());
        List<VideoItem> copy;
        synchronized (items) {
            copy = new ArrayList<>(items);
        }
        StringBuilder facebookBatch = new StringBuilder();
        for (VideoItem item : copy) {
            if ("Facebook".equals(item.platform)) {
                if (facebookBatch.length() > 0) facebookBatch.append("\n");
                facebookBatch.append(item.pageUrl);
                resolverPool.submit(() -> resolveItem(item, quality, false));
            } else {
                resolverPool.submit(() -> resolveItem(item, quality, autoDownload));
            }
        }

        if (autoDownload && facebookBatch.length() > 0) {
            final String fbUrls = facebookBatch.toString();
            runOnUiThread(() -> openFacebookDownloader(fbUrls));
        }
    }

    private void scanProfile() {
        String url = firstLink(profileInput.getText().toString());
        if (url.isEmpty()) {
            toast("Facebook profile link দিন");
            return;
        }
        if (!platformOf(url).equals("Facebook")) {
            toast("Profile Browser এখন Facebook-এর জন্য");
            return;
        }
        Intent i = new Intent(this, BrowserActivity.class);
        i.putExtra("mode", "profile");
        i.putExtra("url", url);
        startActivity(i);
    }

    private void resolveItem(VideoItem item, String quality, boolean autoDownload) {
        if ("Facebook".equals(item.platform)) {
            item.title = "Facebook Video / Reel";
            setItemState(item, "Browser Ready", "Tap Download — Facebook Browser Mode খুলবে", GREEN, 28);
            runOnUiThread(() -> {
                item.titleView.setText(item.title);
                item.downloadButton.setText("DOWNLOAD");
                item.downloadButton.setVisibility(View.VISIBLE);
                item.downloadButton.setEnabled(true);
                item.retryButton.setVisibility(View.GONE);
            });
            updateSummary();
            return;
        }

        setItemState(item, "Resolving", "yt-dlp engine analyzing…", WARN, 12);
        try {
            PyObject module = getResolver();
            String raw = module.callAttr("resolve_video", item.pageUrl, quality).toString();
            JSONObject obj = new JSONObject(raw);

            if (!obj.optBoolean("ok")) {
                throw new Exception(obj.optString("error", "Video resolve failed"));
            }

            item.mediaUrl = obj.optString("media_url");
            item.title = obj.optString("title", "video");
            item.ext = obj.optString("ext", "mp4");
            item.height = obj.optInt("height", 0);
            item.headers = obj.optJSONObject("headers");

            String detail = item.height > 0
                    ? "Ready • " + item.height + "p • " + item.ext.toUpperCase(Locale.ROOT)
                    : "Ready • " + item.ext.toUpperCase(Locale.ROOT);

            setItemState(item, "Ready", detail, GREEN, 28);
            runOnUiThread(() -> {
                item.titleView.setText(item.title);
                item.downloadButton.setVisibility(View.VISIBLE);
                item.downloadButton.setEnabled(true);
            });

            if (autoDownload) enqueueDownload(item);
        } catch (Exception e) {
            item.error = cleanError(e.getMessage());
            setItemState(item, "Failed", item.error, ERROR, 0);
            runOnUiThread(() -> {
                item.retryButton.setVisibility(View.VISIBLE);
                item.downloadButton.setVisibility(View.VISIBLE);
                item.downloadButton.setEnabled(true);
            });
            addHistory("FAILED", item.platform + " • " + item.error);
        }
        updateSummary();
    }

    private PyObject getResolver() throws Exception {
        PyObject module = resolverModule;
        if (module != null) return module;
        module = Python.getInstance().getModule("resolver");
        resolverModule = module;
        return module;
    }

    private void enqueueDownload(VideoItem item) {
        if (item.mediaUrl == null || item.mediaUrl.isEmpty()) {
            String quality = String.valueOf(qualitySpinner.getSelectedItem());
            resolverPool.submit(() -> resolveItem(item, quality, true));
            return;
        }

        try {
            String ext = normalizeExt(item.ext);
            String base = sanitizeFilename(item.title);
            String filename = base + "_" + System.currentTimeMillis() + "." + ext;

            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(item.mediaUrl));
            req.setTitle(base);
            req.setDescription(item.platform + " • Mahadi Downloader");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setAllowedOverMetered(!wifiOnlySwitch.isChecked());
            req.setAllowedOverRoaming(!wifiOnlySwitch.isChecked());
            req.setMimeType(mimeFor(ext));

            if (item.headers != null) {
                Iterator<String> keys = item.headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    String value = item.headers.optString(key, "");
                    if (!key.isEmpty() && !value.isEmpty()) {
                        try {
                            req.addRequestHeader(key, value);
                        } catch (Exception ignored) {
                        }
                    }
                }
            }

            req.setDestinationInExternalPublicDir(
                    Environment.DIRECTORY_DOWNLOADS,
                    "Mahadi Downloader/" + filename);

            item.downloadId = downloadManager.enqueue(req);
            setItemState(item, "Downloading", filename, Color.rgb(82, 170, 255), 35);
            runOnUiThread(() -> item.downloadButton.setVisibility(View.GONE));
        } catch (Exception e) {
            item.error = cleanError(e.getMessage());
            setItemState(item, "Failed", "Download start failed: " + item.error, ERROR, 0);
            runOnUiThread(() -> item.retryButton.setVisibility(View.VISIBLE));
        }
    }

    private void pollDownloads() {
        List<VideoItem> copy;
        synchronized (items) {
            copy = new ArrayList<>(items);
        }

        for (VideoItem item : copy) {
            if (item.downloadId <= 0) continue;
            Cursor c = null;
            try {
                c = downloadManager.query(
                        new DownloadManager.Query().setFilterById(item.downloadId));
                if (c == null || !c.moveToFirst()) continue;

                int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                long current = c.getLong(c.getColumnIndexOrThrow(
                        DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = c.getLong(c.getColumnIndexOrThrow(
                        DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                int pct = total > 0 ? (int) Math.min(99, current * 100L / total) : 40;

                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                    item.downloadId = -2;
                    setItemState(item, "Completed", "Saved: Downloads/Mahadi Downloader", GREEN, 100);
                    runOnUiThread(() -> {
                        item.retryButton.setVisibility(View.GONE);
                        item.downloadButton.setVisibility(View.GONE);
                    });
                    addHistory("DONE", item.platform + " • " + shorten(item.title, 55));
                } else if (status == DownloadManager.STATUS_FAILED) {
                    int reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                    item.downloadId = -3;
                    item.mediaUrl = null;
                    setItemState(item, "Failed", "Download failed • code " + reason + " • Retry", ERROR, 0);
                    runOnUiThread(() -> {
                        item.retryButton.setVisibility(View.VISIBLE);
                        item.downloadButton.setVisibility(View.VISIBLE);
                        item.downloadButton.setEnabled(true);
                    });
                } else if (status == DownloadManager.STATUS_RUNNING) {
                    setItemState(item, "Downloading",
                            total > 0 ? human(current) + " / " + human(total) : "Downloading…",
                            Color.rgb(82, 170, 255), pct);
                } else if (status == DownloadManager.STATUS_PAUSED) {
                    setItemState(item, "Paused", "Waiting for network/system", WARN, pct);
                }
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.close();
            }
        }
        updateSummary();
    }

    private void addItemRow(VideoItem item) {
        LinearLayout card = premiumCard();
        card.setPadding(dp(13), dp(13), dp(13), dp(13));
        item.card = card;

        LinearLayout top = horizontal();

        TextView platform = text(item.platform, 11, GREEN, true);
        platform.setPadding(dp(9), dp(5), dp(9), dp(5));
        platform.setBackground(roundStroke(Color.rgb(10, 35, 22), Color.rgb(31, 89, 55), 10, 1));
        top.addView(platform);

        item.statusView = text(
                item.profileIndex > 0 ? "#" + item.profileIndex : "Queued",
                11, MUTED, true);
        item.statusView.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        top.addView(item.statusView, new LinearLayout.LayoutParams(0, dp(30), 1f));
        card.addView(top);

        item.titleView = text(
                item.title == null || item.title.isEmpty()
                        ? shorten(item.pageUrl, 72)
                        : item.title,
                13, Color.WHITE, true);
        item.titleView.setPadding(0, dp(9), 0, dp(4));
        card.addView(item.titleView);

        TextView urlView = text(shorten(item.pageUrl, 88), 10, MUTED, false);
        card.addView(urlView);

        item.progress = new ProgressBar(
                this, null, android.R.attr.progressBarStyleHorizontal);
        item.progress.setMax(100);
        item.progress.setProgress(0);
        card.addView(item.progress, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(5)));

        item.detailView = text(
                item.profileIndex > 0 ? "Tap Download to resolve" : "Waiting…",
                11, MUTED, false);
        item.detailView.setPadding(0, dp(7), 0, 0);
        card.addView(item.detailView);

        LinearLayout actions = horizontal();

        item.retryButton = ghostButton("RETRY");
        item.retryButton.setVisibility(View.GONE);

        item.downloadButton = greenButton("DOWNLOAD");
        item.downloadButton.setVisibility(item.profileIndex > 0 ? View.VISIBLE : View.GONE);

        Button remove = ghostButton("REMOVE");
        remove.setTextColor(ERROR);

        actions.addView(item.retryButton, weight(1, dp(7), dp(42)));
        actions.addView(item.downloadButton, weight(1, dp(7), dp(42)));
        actions.addView(remove, weight(1, 0, dp(42)));
        card.addView(actions, lpMatchWrap(dp(10), 0));

        item.retryButton.setOnClickListener(v -> {
            item.error = null;
            item.mediaUrl = null;
            item.downloadId = -1;
            item.retryButton.setVisibility(View.GONE);
            if ("Facebook".equals(item.platform)) {
                openFacebookDownloader(item.pageUrl);
            } else {
                String quality = String.valueOf(qualitySpinner.getSelectedItem());
                resolverPool.submit(() -> resolveItem(item, quality, true));
            }
        });

        item.downloadButton.setOnClickListener(v -> {
            if ("Facebook".equals(item.platform)) {
                openFacebookDownloader(item.pageUrl);
                return;
            }
            item.downloadButton.setEnabled(false);
            if (item.mediaUrl != null && !item.mediaUrl.isEmpty()) {
                enqueueDownload(item);
            } else {
                String quality = String.valueOf(qualitySpinner.getSelectedItem());
                resolverPool.submit(() -> resolveItem(item, quality, true));
            }
        });

        remove.setOnClickListener(v -> {
            synchronized (items) {
                items.remove(item);
            }
            queueContainer.removeView(item.card);
            updateSummary();
        });

        queueContainer.addView(card, lpMatchWrap(dp(8), 0));
    }

    private void openFacebookDownloader(String urls) {
        Intent i = new Intent(this, FacebookDownloadActivity.class);
        i.putExtra("urls", urls);
        startActivity(i);
    }

    private void setItemState(VideoItem item, String status, String detail, int color, int progress) {
        item.status = status;
        runOnUiThread(() -> {
            if (item.statusView != null) {
                item.statusView.setText(status);
                item.statusView.setTextColor(color);
            }
            if (item.detailView != null) item.detailView.setText(detail);
            if (item.progress != null) item.progress.setProgress(progress);
        });
    }

    private void updateSummary() {
        runOnUiThread(() -> {
            int queued = 0, ready = 0, downloading = 0, done = 0, failed = 0;
            synchronized (items) {
                for (VideoItem item : items) {
                    String s = item.status == null ? "Queued" : item.status;
                    if (s.equals("Queued") || s.equals("Resolving") || s.equals("Profile item")) queued++;
                    else if (s.equals("Ready") || s.equals("Browser Ready")) ready++;
                    else if (s.equals("Downloading") || s.equals("Paused")) downloading++;
                    else if (s.equals("Completed")) done++;
                    else if (s.equals("Failed")) failed++;
                }
            }
            summaryText.setText(
                    "Total " + items.size()
                            + "  •  Queue " + queued
                            + "  •  Ready " + ready
                            + "  •  Downloading " + downloading
                            + "  •  Done " + done
                            + "  •  Failed " + failed);
        });
    }

    private void resetResolverPool() {
        int threads = concurrencySpinner.getSelectedItemPosition() + 1;
        resolverPool.shutdownNow();
        resolverPool = Executors.newFixedThreadPool(threads);
    }

    private void clearQueue() {
        synchronized (items) {
            items.clear();
        }
        if (queueContainer != null) queueContainer.removeAllViews();
        updateSummary();
    }

    private List<String> parseLinks(String raw) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = Pattern.compile("https?://[^\\s<>]+", Pattern.CASE_INSENSITIVE)
                .matcher(raw == null ? "" : raw);
        while (m.find()) {
            String u = m.group();
            while (u.endsWith(")") || u.endsWith("]") || u.endsWith(",") || u.endsWith(".")) {
                u = u.substring(0, u.length() - 1);
            }
            out.add(u);
        }
        return new ArrayList<>(out);
    }

    private String firstLink(String raw) {
        List<String> links = parseLinks(raw);
        return links.isEmpty() ? "" : links.get(0);
    }

    private void pasteInto(EditText target) {
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (cm == null || !cm.hasPrimaryClip()) {
            toast("Clipboard empty");
            return;
        }
        ClipData clip = cm.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) return;
        CharSequence s = clip.getItemAt(0).coerceToText(this);
        if (s == null) return;

        String old = target.getText().toString().trim();
        target.setText(old.isEmpty() ? s : old + "\n" + s);
        target.setSelection(target.getText().length());
    }

    private String platformOf(String url) {
        String l = url.toLowerCase(Locale.ROOT);
        if (l.contains("tiktok.com")) return "TikTok";
        if (l.contains("facebook.com") || l.contains("fb.watch") || l.contains("fb.com")) return "Facebook";
        if (l.contains("instagram.com")) return "Instagram";
        return "Video";
    }

    private void addHistory(String type, String detail) {
        String time = new SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault()).format(new Date());
        String row = type + "|" + time + "|" + detail.replace("\n", " ");

        synchronized (this) {
            String old = prefs.getString("history", "");
            String merged = row + (old.isEmpty() ? "" : "\n" + old);
            String[] lines = merged.split("\n");
            StringBuilder keep = new StringBuilder();
            for (int i = 0; i < Math.min(30, lines.length); i++) {
                if (i > 0) keep.append('\n');
                keep.append(lines[i]);
            }
            prefs.edit().putString("history", keep.toString()).apply();
        }

        runOnUiThread(this::loadHistory);
    }

    private void loadHistory() {
        if (historyContainer == null) return;
        historyContainer.removeAllViews();

        String history = prefs.getString("history", "");
        if (history.isEmpty()) {
            TextView empty = text("No downloads yet", 12, MUTED, false);
            empty.setPadding(dp(4), dp(6), 0, dp(6));
            historyContainer.addView(empty);
            return;
        }

        String[] lines = history.split("\n");
        for (int i = 0; i < Math.min(12, lines.length); i++) {
            String[] p = lines[i].split("\\|", 3);
            if (p.length < 3) continue;
            int color = "DONE".equals(p[0]) ? GREEN : ERROR;
            TextView row = text(
                    ("DONE".equals(p[0]) ? "✓  " : "!  ") + p[1] + "  " + p[2],
                    11, color, false);
            row.setPadding(dp(12), dp(10), dp(12), dp(10));
            row.setBackground(roundStroke(CARD, BORDER, 12, 1));
            historyContainer.addView(row, lpMatchWrap(0, dp(6)));
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS}, 42);
        }
    }

    private ArrayAdapter<String> simpleSpinner(String[] values) {
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(
                this, android.R.layout.simple_spinner_item, values) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                TextView v = (TextView) super.getView(position, convertView, parent);
                v.setTextColor(GREEN);
                v.setTextSize(13);
                v.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
                return v;
            }

            @Override
            public View getDropDownView(int position, View convertView, ViewGroup parent) {
                TextView v = (TextView) super.getDropDownView(position, convertView, parent);
                v.setTextColor(Color.WHITE);
                v.setBackgroundColor(CARD_2);
                v.setPadding(dp(12), dp(12), dp(12), dp(12));
                return v;
            }
        };
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return adapter;
    }

    private TextView sectionTitle(String s) {
        TextView v = text(s, 12, GREEN, true);
        if (Build.VERSION.SDK_INT >= 21) v.setLetterSpacing(0.08f);
        v.setPadding(dp(3), 0, 0, dp(7));
        return v;
    }

    private LinearLayout premiumCard() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(13), dp(13), dp(13), dp(13));

        GradientDrawable bg = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{Color.rgb(19, 25, 29), Color.rgb(10, 14, 17)});
        bg.setCornerRadius(dp(18));
        bg.setStroke(dp(1), BORDER);
        l.setBackground(bg);
        return l;
    }

    private Button greenButton(String s) {
        Button b = new Button(this);
        b.setText(s);
        b.setTextColor(Color.rgb(2, 12, 7));
        b.setTextSize(12);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setAllCaps(false);
        GradientDrawable bg = new GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{Color.rgb(48, 214, 117), Color.rgb(78, 241, 148)});
        bg.setCornerRadius(dp(13));
        b.setBackground(bg);
        return b;
    }

    private Button ghostButton(String s) {
        Button b = new Button(this);
        b.setText(s);
        b.setTextColor(Color.WHITE);
        b.setTextSize(11);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setAllCaps(false);
        b.setBackground(roundStroke(Color.rgb(24, 29, 34), BORDER, 13, 1));
        return b;
    }

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView v = new TextView(this);
        v.setText(s);
        v.setTextSize(sp);
        v.setTextColor(color);
        if (bold) v.setTypeface(Typeface.DEFAULT_BOLD);
        return v;
    }

    private LinearLayout horizontal() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    private LinearLayout.LayoutParams weight(float w, int rightMargin, int height) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, height, w);
        p.rightMargin = rightMargin;
        return p;
    }

    private LinearLayout.LayoutParams lpMatchWrap(int top, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = top;
        p.bottomMargin = bottom;
        return p;
    }

    private GradientDrawable roundStroke(
            int fill, int stroke, int radiusDp, int strokeDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(radiusDp));
        d.setStroke(dp(strokeDp), stroke);
        return d;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void summary(String s) {
        runOnUiThread(() -> summaryText.setText(s));
    }

    private void toast(String s) {
        runOnUiThread(() -> Toast.makeText(this, s, Toast.LENGTH_SHORT).show());
    }

    private String cleanError(String msg) {
        if (msg == null || msg.trim().isEmpty()) return "Unknown error";
        return shorten(msg.replace("ERROR:", "").replace("java.lang.", "").trim(), 220);
    }

    private String sanitizeFilename(String s) {
        String x = s == null ? "video" : s;
        x = x.replaceAll("[\\\\/:*?\"<>|\\n\\r]+", " ")
                .replaceAll("\\s+", " ")
                .trim();
        if (x.isEmpty()) x = "video";
        return shorten(x, 55);
    }

    private String normalizeExt(String ext) {
        String x = ext == null ? "mp4" : ext.toLowerCase(Locale.ROOT);
        x = x.replace(".", "").replaceAll("[^a-z0-9]", "");
        return x.isEmpty() ? "mp4" : x;
    }

    private String mimeFor(String ext) {
        if ("webm".equals(ext)) return "video/webm";
        if ("m4a".equals(ext)) return "audio/mp4";
        if ("mp3".equals(ext)) return "audio/mpeg";
        return "video/mp4";
    }

    private String shorten(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, Math.max(1, max - 1)) + "…";
    }

    private String human(long bytes) {
        if (bytes < 1024) return bytes + " B";
        double kb = bytes / 1024.0;
        if (kb < 1024) return String.format(Locale.US, "%.1f KB", kb);
        double mb = kb / 1024.0;
        if (mb < 1024) return String.format(Locale.US, "%.1f MB", mb);
        return String.format(Locale.US, "%.2f GB", mb / 1024.0);
    }

    private class VideoItem {
        final String pageUrl;
        final String platform;
        final int profileIndex;

        String status = "Queued";
        String mediaUrl;
        String title;
        String ext = "mp4";
        String error;
        int height;
        long downloadId = -1;
        JSONObject headers;

        LinearLayout card;
        TextView statusView;
        TextView titleView;
        TextView detailView;
        ProgressBar progress;
        Button retryButton;
        Button downloadButton;

        VideoItem(String pageUrl, int profileIndex) {
            this.pageUrl = pageUrl;
            this.platform = platformOf(pageUrl);
            this.profileIndex = profileIndex;
        }
    }
}
