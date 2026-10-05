package com.mahadi.batchdownloader;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.Context;
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
import android.text.Html;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
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
    private static final String UA = "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
    private static final int ACCENT = Color.rgb(54, 220, 127);
    private static final int BG = Color.rgb(10, 12, 16);
    private static final int CARD = Color.rgb(24, 27, 34);
    private static final int MUTED = Color.rgb(154, 163, 177);

    private EditText linkInput;
    private LinearLayout queueContainer;
    private LinearLayout historyContainer;
    private Spinner qualitySpinner;
    private Spinner concurrencySpinner;
    private Switch wifiOnlySwitch;
    private TextView summaryText;

    private final List<VideoItem> items = new ArrayList<>();
    private ExecutorService resolverPool = Executors.newFixedThreadPool(2);
    private final ScheduledExecutorService poller = Executors.newSingleThreadScheduledExecutor();
    private DownloadManager downloadManager;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        downloadManager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        prefs = getSharedPreferences("mahadi_batch_downloader", MODE_PRIVATE);
        buildUi();
        loadHistory();
        requestNotificationPermission();
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
        root.setPadding(dp(18), dp(18), dp(18), dp(30));
        scroll.addView(root, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = text("MAHADI\nBATCH DOWNLOADER", 28, Color.WHITE, true);
        if (Build.VERSION.SDK_INT >= 21) title.setLetterSpacing(0.06f);
        root.addView(title);

        TextView subtitle = text("TikTok • Facebook • Instagram\n10–12 links একসাথে paste করে Download All দিন।", 14, MUTED, false);
        subtitle.setPadding(0, dp(6), 0, dp(16));
        root.addView(subtitle);

        TextView notice = text("Public / permission থাকা content-এর জন্য। Private, login-protected বা DRM video bypass করা হবে না।", 12, Color.rgb(255, 200, 95), false);
        notice.setPadding(dp(12), dp(10), dp(12), dp(10));
        notice.setBackground(roundRect(Color.rgb(44, 36, 20), 12));
        root.addView(notice, lpMatchWrap(0, dp(12)));

        linkInput = new EditText(this);
        linkInput.setHint("Links paste করুন — প্রতি লাইনে ১টা\nhttps://www.tiktok.com/...\nhttps://www.facebook.com/...\nhttps://www.instagram.com/reel/...");
        linkInput.setHintTextColor(Color.rgb(95, 105, 120));
        linkInput.setTextColor(Color.WHITE);
        linkInput.setTextSize(14);
        linkInput.setGravity(Gravity.TOP | Gravity.START);
        linkInput.setMinLines(7);
        linkInput.setMaxLines(12);
        linkInput.setPadding(dp(14), dp(14), dp(14), dp(14));
        linkInput.setBackground(roundStroke(CARD, Color.rgb(50, 56, 68), 14, 1));
        root.addView(linkInput, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(190)));

        LinearLayout smallActions = horizontal();
        Button paste = button("PASTE", Color.rgb(37, 42, 52), Color.WHITE);
        Button clear = button("CLEAR", Color.rgb(37, 42, 52), Color.WHITE);
        Button analyze = button("ANALYZE", Color.rgb(37, 42, 52), Color.WHITE);
        smallActions.addView(paste, weight(1, dp(10)));
        smallActions.addView(clear, weight(1, dp(10)));
        smallActions.addView(analyze, weight(1, 0));
        root.addView(smallActions, lpMatchWrap(dp(10), dp(12)));

        paste.setOnClickListener(v -> pasteClipboard());
        clear.setOnClickListener(v -> clearAll());
        analyze.setOnClickListener(v -> {
            String raw = linkInput.getText().toString().trim();
            List<String> links = parseLinks(raw);
            if (links.size() == 1 && looksLikeProfileUrl(links.get(0))) {
                loadProfilePosts(links.get(0));
            } else {
                analyzeLinks(false);
            }
        });

        LinearLayout settingsCard = verticalCard();
        settingsCard.addView(text("DOWNLOAD SETTINGS", 13, Color.WHITE, true));

        LinearLayout qualityRow = horizontal();
        qualityRow.addView(text("Quality", 14, MUTED, false), weight(1, 0));
        qualitySpinner = new Spinner(this);
        qualitySpinner.setAdapter(simpleSpinner(new String[]{"Best", "HD", "SD"}));
        qualityRow.addView(qualitySpinner, new LinearLayout.LayoutParams(dp(120), dp(48)));
        settingsCard.addView(qualityRow, lpMatchWrap(dp(6), 0));

        LinearLayout concRow = horizontal();
        concRow.addView(text("Parallel resolves", 14, MUTED, false), weight(1, 0));
        concurrencySpinner = new Spinner(this);
        concurrencySpinner.setAdapter(simpleSpinner(new String[]{"1", "2", "3"}));
        concurrencySpinner.setSelection(1);
        concRow.addView(concurrencySpinner, new LinearLayout.LayoutParams(dp(120), dp(48)));
        settingsCard.addView(concRow, lpMatchWrap(0, 0));

        wifiOnlySwitch = new Switch(this);
        wifiOnlySwitch.setText("Wi‑Fi only downloads");
        wifiOnlySwitch.setTextColor(MUTED);
        wifiOnlySwitch.setTextSize(14);
        settingsCard.addView(wifiOnlySwitch, lpMatchWrap(0, 0));
        root.addView(settingsCard, lpMatchWrap(0, dp(12)));

        Button downloadAll = button("DOWNLOAD ALL", ACCENT, Color.BLACK);
        downloadAll.setTextSize(16);
        downloadAll.setTypeface(Typeface.DEFAULT_BOLD);
        downloadAll.setOnClickListener(v -> {
            String raw = linkInput.getText().toString().trim();
            List<String> links = parseLinks(raw);
            if (links.size() == 1 && looksLikeProfileUrl(links.get(0))) {
                loadProfilePosts(links.get(0));
            } else {
                analyzeLinks(true);
            }
        });
        root.addView(downloadAll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));

        summaryText = text("Queue empty", 13, MUTED, false);
        summaryText.setPadding(0, dp(12), 0, dp(6));
        root.addView(summaryText);

        queueContainer = new LinearLayout(this);
        queueContainer.setOrientation(LinearLayout.VERTICAL);
        root.addView(queueContainer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView historyTitle = text("HISTORY", 16, Color.WHITE, true);
        historyTitle.setPadding(0, dp(20), 0, dp(8));
        root.addView(historyTitle);

        historyContainer = new LinearLayout(this);
        historyContainer.setOrientation(LinearLayout.VERTICAL);
        root.addView(historyContainer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button clearHistory = button("Clear history", Color.rgb(37, 42, 52), MUTED);
        clearHistory.setOnClickListener(v -> {
            prefs.edit().remove("history").apply();
            historyContainer.removeAllViews();
            loadHistory();
        });
        root.addView(clearHistory, lpMatchWrap(dp(8), 0));

        setContentView(scroll);
    }

    private ArrayAdapter<String> simpleSpinner(String[] values) {
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, values) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                TextView v = (TextView) super.getView(position, convertView, parent);
                v.setTextColor(Color.WHITE);
                v.setTextSize(14);
                v.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
                return v;
            }

            @Override
            public View getDropDownView(int position, View convertView, ViewGroup parent) {
                TextView v = (TextView) super.getDropDownView(position, convertView, parent);
                v.setTextColor(Color.WHITE);
                v.setBackgroundColor(Color.rgb(28, 31, 39));
                v.setPadding(dp(12), dp(12), dp(12), dp(12));
                return v;
            }
        };
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return adapter;
    }

    private void pasteClipboard() {
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (cm != null && cm.hasPrimaryClip()) {
            ClipData clip = cm.getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) {
                CharSequence s = clip.getItemAt(0).coerceToText(this);
                if (s != null) {
                    String old = linkInput.getText().toString().trim();
                    linkInput.setText(old.isEmpty() ? s : old + "\n" + s);
                    linkInput.setSelection(linkInput.getText().length());
                }
            }
        }
    }

    private void clearAll() {
        linkInput.setText("");
        synchronized (items) { items.clear(); }
        queueContainer.removeAllViews();
        updateSummary();
    }

    private boolean looksLikeProfileUrl(String url) {
        try {
            Uri u = Uri.parse(url);
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
            String path = u.getPath() == null ? "" : u.getPath();
            if (host.contains("tiktok.com")) {
                return path.matches("/@[^/]+/?") || (!path.contains("/video/") && path.startsWith("/@"));
            }
            if (host.contains("instagram.com")) {
                return !(path.contains("/reel/") || path.contains("/reels/") || path.contains("/p/") || path.contains("/tv/"));
            }
            if (host.contains("facebook.com") || host.contains("fb.com")) {
                return !(path.contains("/reel/") || path.contains("/watch/") || path.contains("/videos/"));
            }
        } catch (Exception ignored) {}
        return false;
    }

    private void loadProfilePosts(String profileUrl) {
        synchronized (items) { items.clear(); }
        runOnUiThread(() -> {
            queueContainer.removeAllViews();
            summaryText.setText("Profile scan হচ্ছে…");
        });

        resolverPool.submit(() -> {
            try {
                HttpURLConnection conn = open(profileUrl, "GET");
                int code = conn.getResponseCode();
                if (code == 401 || code == 403) throw new Exception("Profile login/private হতে পারে (HTTP " + code + ")");
                if (code >= 400) throw new Exception("Profile open failed (HTTP " + code + ")");
                String html = readLimited(conn.getInputStream(), 6_000_000);
                String finalUrl = conn.getURL().toString();
                conn.disconnect();

                List<String> posts = extractProfilePostUrls(finalUrl, html);
                if (posts.isEmpty()) {
                    if (containsLoginWall(html)) throw new Exception("Private/login-required profile — bypass করা হয়নি");
                    throw new Exception("Public Reels/Video list পাওয়া যায়নি। Platform page format বদলাতে পারে।");
                }

                synchronized (items) {
                    items.clear();
                    int i = 1;
                    for (String post : posts) {
                        if (i > 60) break;
                        VideoItem item = new VideoItem(post);
                        item.status = "Profile item";
                        item.profileIndex = i++;
                        items.add(item);
                    }
                }

                runOnUiThread(() -> {
                    queueContainer.removeAllViews();
                    List<VideoItem> copy;
                    synchronized (items) { copy = new ArrayList<>(items); }
                    for (VideoItem item : copy) {
                        addItemRow(item);
                        item.statusView.setText("#" + item.profileIndex);
                        item.statusView.setTextColor(ACCENT);
                        item.detailView.setText("Tap Download to resolve this Reel/Video");
                        item.downloadButton.setVisibility(View.VISIBLE);
                        item.downloadButton.setEnabled(true);
                    }
                    summaryText.setText("Profile থেকে " + items.size() + "টা public Reel/Video পাওয়া গেছে");
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    queueContainer.removeAllViews();
                    summaryText.setText("Profile scan failed");
                    TextView error = text(cleanError(e.getMessage()), 13, Color.rgb(255, 105, 105), false);
                    error.setPadding(dp(12), dp(12), dp(12), dp(12));
                    error.setBackground(roundRect(CARD, 12));
                    queueContainer.addView(error, lpMatchWrap(dp(8), 0));
                });
            }
        });
    }

    private List<String> extractProfilePostUrls(String profileUrl, String html) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        String lower = profileUrl.toLowerCase(Locale.ROOT);

        if (lower.contains("tiktok.com")) {
            Matcher m = Pattern.compile("(?is)(?:https?:\\\\?/\\\\?/[^\\\"'<> ]*tiktok\\.com)?\\\\?/(@[^/\\\"'<> ]+/video/\\d+)").matcher(html);
            while (m.find()) {
                String p = normalizeEscapedUrl(m.group(1));
                if (!p.startsWith("http")) p = "https://www.tiktok.com/" + p.replaceFirst("^/+", "");
                out.add(p);
            }
            Matcher ids = Pattern.compile("(?is)[\\\"']id[\\\"']\\s*:\\s*[\\\"'](\\d{12,24})[\\\"']").matcher(html);
            String username = null;
            Matcher um = Pattern.compile("tiktok\\.com/@([^/?#]+)", Pattern.CASE_INSENSITIVE).matcher(profileUrl);
            if (um.find()) username = um.group(1);
            if (username != null) {
                int n = 0;
                while (ids.find() && n++ < 80) out.add("https://www.tiktok.com/@" + username + "/video/" + ids.group(1));
            }
        } else if (lower.contains("instagram.com")) {
            Matcher m = Pattern.compile("(?is)(?:https?:\\\\?/\\\\?/[^\\\"'<> ]*instagram\\.com)?\\\\?/(reel|reels|p)/([A-Za-z0-9_-]{5,})").matcher(html);
            while (m.find()) {
                String type = "reels".equals(m.group(1)) ? "reel" : m.group(1);
                out.add("https://www.instagram.com/" + type + "/" + m.group(2) + "/");
            }
            Matcher href = Pattern.compile("(?is)href=[\\\"'](/(?:reel|reels|p)/[^\\\"'#?]+)").matcher(html);
            while (href.find()) out.add("https://www.instagram.com" + href.group(1));
        } else if (lower.contains("facebook.com") || lower.contains("fb.com")) {
            Matcher m = Pattern.compile("(?is)(https?:\\\\?/\\\\?/(?:www\\.)?facebook\\.com/[^\\\"'<> ]+/(?:reel|videos?)/[^\\\"'<> ]+)").matcher(html);
            while (m.find()) out.add(normalizeEscapedUrl(m.group(1)));
            Matcher rel = Pattern.compile("(?is)href=[\\\"'](/[^\\\"']*/(?:reel|videos?)/[^\\\"'#?]+)").matcher(html);
            while (rel.find()) out.add("https://www.facebook.com" + rel.group(1));
        }
        return new ArrayList<>(out);
    }

    private void analyzeLinks(boolean downloadAfterResolve) {
        List<String> urls = parseLinks(linkInput.getText().toString());
        if (urls.isEmpty()) {
            toast("কমপক্ষে ১টা valid link দিন");
            return;
        }
        if (urls.size() > MAX_LINKS) {
            urls = new ArrayList<>(urls.subList(0, MAX_LINKS));
            toast("প্রথম 12টা link নেওয়া হয়েছে");
        }

        int threads = concurrencySpinner.getSelectedItemPosition() + 1;
        resolverPool.shutdownNow();
        resolverPool = Executors.newFixedThreadPool(threads);

        synchronized (items) {
            items.clear();
            queueContainer.removeAllViews();
            for (String url : urls) {
                VideoItem item = new VideoItem(url);
                items.add(item);
                addItemRow(item);
            }
        }
        updateSummary();

        final String quality = String.valueOf(qualitySpinner.getSelectedItem());
        List<VideoItem> copy;
        synchronized (items) { copy = new ArrayList<>(items); }
        for (VideoItem item : copy) {
            resolverPool.submit(() -> resolveItem(item, quality, downloadAfterResolve));
        }
    }

    private List<String> parseLinks(String raw) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = Pattern.compile("https?://[^\\s<>]+", Pattern.CASE_INSENSITIVE).matcher(raw == null ? "" : raw);
        while (m.find()) {
            String u = m.group();
            while (u.endsWith(")") || u.endsWith("]") || u.endsWith(",") || u.endsWith(".")) {
                u = u.substring(0, u.length() - 1);
            }
            out.add(u);
        }
        return new ArrayList<>(out);
    }

    private void addItemRow(VideoItem item) {
        LinearLayout card = verticalCard();
        item.card = card;

        LinearLayout top = horizontal();
        item.platformView = text(item.platform, 12, ACCENT, true);
        item.platformView.setPadding(dp(9), dp(5), dp(9), dp(5));
        item.platformView.setBackground(roundRect(Color.rgb(28, 61, 43), 9));
        top.addView(item.platformView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        item.statusView = text("Queued", 12, MUTED, true);
        item.statusView.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        top.addView(item.statusView, weight(1, 0));
        card.addView(top);

        TextView url = text(shorten(item.pageUrl, 75), 13, Color.WHITE, false);
        url.setPadding(0, dp(9), 0, dp(8));
        card.addView(url);

        item.progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        item.progress.setMax(100);
        item.progress.setProgress(0);
        card.addView(item.progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(5)));

        item.detailView = text("Waiting…", 12, MUTED, false);
        item.detailView.setPadding(0, dp(7), 0, 0);
        card.addView(item.detailView);

        LinearLayout actions = horizontal();
        item.retryButton = button("Retry", Color.rgb(40, 45, 56), Color.WHITE);
        item.downloadButton = button("Download", ACCENT, Color.BLACK);
        Button remove = button("Remove", Color.rgb(40, 45, 56), Color.rgb(255, 145, 145));
        item.retryButton.setVisibility(View.GONE);
        item.downloadButton.setVisibility(View.GONE);
        item.retryButton.setOnClickListener(v -> {
            item.error = null;
            item.mediaUrl = null;
            item.downloadId = -1;
            setStatus(item, "Queued", "Retrying…", MUTED, 0);
            item.retryButton.setVisibility(View.GONE);
            item.downloadButton.setVisibility(View.GONE);
            String quality = String.valueOf(qualitySpinner.getSelectedItem());
            resolverPool.submit(() -> resolveItem(item, quality, true));
        });
        item.downloadButton.setOnClickListener(v -> {
            item.downloadButton.setEnabled(false);
            if (item.mediaUrl != null && !item.mediaUrl.isEmpty()) {
                enqueueDownload(item);
            } else {
                String quality = String.valueOf(qualitySpinner.getSelectedItem());
                resolverPool.submit(() -> resolveItem(item, quality, true));
            }
        });
        remove.setOnClickListener(v -> {
            synchronized (items) { items.remove(item); }
            queueContainer.removeView(item.card);
            updateSummary();
        });
        actions.addView(item.retryButton, weight(1, dp(8)));
        actions.addView(item.downloadButton, weight(1, dp(8)));
        actions.addView(remove, weight(1, 0));
        card.addView(actions, lpMatchWrap(dp(10), 0));

        queueContainer.addView(card, lpMatchWrap(dp(8), 0));
    }

    private void resolveItem(VideoItem item, String quality, boolean autoDownload) {
        setStatus(item, "Resolving", "Public page scan হচ্ছে…", Color.rgb(255, 200, 95), 12);
        try {
            ResolveResult result = resolvePublicVideo(item.pageUrl, quality);
            item.mediaUrl = result.mediaUrl;
            item.title = result.title;
            setStatus(item, "Ready", result.detail, ACCENT, 28);
            runOnUiThread(() -> {
                item.downloadButton.setVisibility(View.VISIBLE);
                item.downloadButton.setEnabled(true);
            });
            if (autoDownload) enqueueDownload(item);
        } catch (Exception e) {
            String msg = cleanError(e.getMessage());
            item.error = msg;
            setStatus(item, "Failed", msg, Color.rgb(255, 105, 105), 0);
            runOnUiThread(() -> item.retryButton.setVisibility(View.VISIBLE));
            addHistory("FAILED", item.platform + " • " + msg);
        }
        updateSummary();
    }

    private ResolveResult resolvePublicVideo(String pageUrl, String quality) throws Exception {
        String lower = pageUrl.toLowerCase(Locale.ROOT);
        if (looksDirectMedia(lower)) {
            return new ResolveResult(pageUrl, "Direct media URL ready", "video");
        }
        if (!(lower.contains("tiktok.com") || lower.contains("facebook.com") || lower.contains("fb.watch") || lower.contains("instagram.com"))) {
            throw new Exception("Unsupported link. TikTok, Facebook, Instagram বা direct video URL দিন।");
        }

        HttpURLConnection c = open(pageUrl, "GET");
        int code = c.getResponseCode();
        if (code == 401 || code == 403) throw new Exception("Site blocked public access / login required (HTTP " + code + ")");
        if (code == 404) throw new Exception("Video/page পাওয়া যায়নি (404)");
        if (code >= 400) throw new Exception("Page request failed (HTTP " + code + ")");

        String finalUrl = c.getURL().toString();
        String contentType = c.getContentType();
        if (contentType != null && contentType.toLowerCase(Locale.ROOT).startsWith("video/")) {
            c.disconnect();
            return new ResolveResult(finalUrl, "Direct video response ready", "video");
        }

        String html = readLimited(c.getInputStream(), 5_000_000);
        c.disconnect();
        if (html == null || html.length() < 50) throw new Exception("Empty page response");

        String title = firstGroup(html,
                "(?is)<meta[^>]+(?:property|name)=[\\\"']og:title[\\\"'][^>]+content=[\\\"']([^\\\"']+)",
                "(?is)<title[^>]*>(.*?)</title>");
        if (title == null) title = "video";
        if (Build.VERSION.SDK_INT >= 24) title = Html.fromHtml(title, Html.FROM_HTML_MODE_LEGACY).toString().trim();
        else title = Html.fromHtml(title).toString().trim();

        List<Candidate> candidates = new ArrayList<>();
        addMetaCandidates(html, candidates);
        addJsonCandidates(html, candidates);
        addGenericMp4Candidates(html, candidates);

        Candidate chosen = chooseCandidate(candidates, quality);
        if (chosen == null) {
            if (containsLoginWall(html)) throw new Exception("Login/private content — bypass করা হয়নি");
            throw new Exception("Direct video URL পাওয়া যায়নি। Site extraction block বা format change হতে পারে।");
        }

        String media = normalizeEscapedUrl(chosen.url);
        if (!media.startsWith("http://") && !media.startsWith("https://")) throw new Exception("Invalid media URL");
        return new ResolveResult(media, chosen.label + " • " + quality, title);
    }

    private void addMetaCandidates(String html, List<Candidate> out) {
        Pattern[] patterns = new Pattern[]{
                Pattern.compile("(?is)<meta[^>]+(?:property|name)=[\\\"'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)[\\\"'][^>]+content=[\\\"']([^\\\"']+)[\\\"']"),
                Pattern.compile("(?is)<meta[^>]+content=[\\\"']([^\\\"']+)[\\\"'][^>]+(?:property|name)=[\\\"'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)[\\\"']")
        };
        for (Pattern p : patterns) {
            Matcher m = p.matcher(html);
            while (m.find()) addCandidate(out, m.group(1), "OG video", 90);
        }
    }

    private void addJsonCandidates(String html, List<Candidate> out) {
        String[] keysHigh = {"browser_native_hd_url", "playable_url_quality_hd", "video_url", "playAddr", "downloadAddr", "contentUrl"};
        String[] keysLow = {"browser_native_sd_url", "playable_url", "src"};
        for (String key : keysHigh) {
            Pattern p = Pattern.compile("(?is)[\\\"']" + Pattern.quote(key) + "[\\\"']\\s*:\\s*[\\\"'](https?:[^\\\"']+)[\\\"']");
            Matcher m = p.matcher(html);
            int n = 0;
            while (m.find() && n++ < 10) addCandidate(out, m.group(1), key, 100);
        }
        for (String key : keysLow) {
            Pattern p = Pattern.compile("(?is)[\\\"']" + Pattern.quote(key) + "[\\\"']\\s*:\\s*[\\\"'](https?:[^\\\"']+)[\\\"']");
            Matcher m = p.matcher(html);
            int n = 0;
            while (m.find() && n++ < 10) addCandidate(out, m.group(1), key, 60);
        }
    }

    private void addGenericMp4Candidates(String html, List<Candidate> out) {
        Matcher m = Pattern.compile("(?is)https?:\\\\?/\\\\?/[^\\\"'<> ]{8,}?\\.mp4(?:[^\\\"'<> ]*)?").matcher(html);
        int n = 0;
        while (m.find() && n++ < 25) addCandidate(out, m.group(), "MP4", 70);
    }

    private void addCandidate(List<Candidate> out, String raw, String label, int score) {
        if (raw == null || raw.length() < 10) return;
        String u = normalizeEscapedUrl(raw);
        if (!u.startsWith("http")) return;
        String l = u.toLowerCase(Locale.ROOT);
        if (l.contains("thumbnail") || l.endsWith(".jpg") || l.endsWith(".png") || l.contains("image")) return;
        for (Candidate c : out) if (c.url.equals(u)) return;
        if (l.contains("hd") || l.contains("1080") || l.contains("720")) score += 15;
        if (l.contains("sd") || l.contains("480") || l.contains("360")) score -= 10;
        out.add(new Candidate(u, label, score));
    }

    private Candidate chooseCandidate(List<Candidate> list, String quality) {
        if (list.isEmpty()) return null;
        Candidate best = null;
        int bestScore = Integer.MIN_VALUE;
        for (Candidate c : list) {
            int s = c.score;
            String l = (c.label + " " + c.url).toLowerCase(Locale.ROOT);
            if ("HD".equalsIgnoreCase(quality)) {
                if (l.contains("hd") || l.contains("1080") || l.contains("720")) s += 100;
                if (l.contains("sd")) s -= 80;
            } else if ("SD".equalsIgnoreCase(quality)) {
                if (l.contains("sd") || l.contains("480") || l.contains("360")) s += 100;
                if (l.contains("hd") || l.contains("1080")) s -= 80;
            }
            if (best == null || s > bestScore) {
                bestScore = s;
                best = c;
            }
        }
        return best;
    }

    private HttpURLConnection open(String url, String method) throws Exception {
        URL u = new URL(url);
        HttpURLConnection c = (HttpURLConnection) u.openConnection();
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setRequestMethod(method);
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8");
        c.setRequestProperty("Accept-Language", "en-US,en;q=0.8");
        c.setRequestProperty("Cache-Control", "no-cache");
        return c;
    }

    private String readLimited(InputStream in, int maxChars) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder(Math.min(maxChars, 500_000));
        char[] buf = new char[8192];
        int total = 0;
        int n;
        while ((n = br.read(buf)) != -1) {
            int use = Math.min(n, maxChars - total);
            if (use > 0) sb.append(buf, 0, use);
            total += use;
            if (total >= maxChars) break;
        }
        br.close();
        return sb.toString();
    }

    private String normalizeEscapedUrl(String raw) {
        String s = raw.trim();
        s = s.replace("\\u002F", "/").replace("\\u002f", "/")
                .replace("\\u0026", "&").replace("\\u003D", "=").replace("\\u003d", "=")
                .replace("\\/", "/").replace("&amp;", "&").replace("&#38;", "&")
                .replace("&quot;", "\"");
        if (s.startsWith("//")) s = "https:" + s;
        return s;
    }

    private boolean containsLoginWall(String html) {
        String l = html.toLowerCase(Locale.ROOT);
        return l.contains("login required") || l.contains("log in to continue") || l.contains("this account is private") || l.contains("private account");
    }

    private boolean looksDirectMedia(String l) {
        return l.contains(".mp4") || l.contains(".webm") || l.contains("video/mp4");
    }

    private String firstGroup(String text, String... patterns) {
        for (String p : patterns) {
            Matcher m = Pattern.compile(p).matcher(text);
            if (m.find()) return m.group(1);
        }
        return null;
    }

    private void enqueueDownload(VideoItem item) {
        if (item.mediaUrl == null || item.mediaUrl.isEmpty()) return;
        try {
            String ext = guessExt(item.mediaUrl);
            String base = sanitizeFilename(item.title == null ? item.platform + "_video" : item.title);
            String fileName = base + "_" + System.currentTimeMillis() + ext;

            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(item.mediaUrl));
            req.setTitle(base);
            req.setDescription(item.platform + " video");
            req.setMimeType(ext.equals(".webm") ? "video/webm" : "video/mp4");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setAllowedOverMetered(!wifiOnlySwitch.isChecked());
            req.setAllowedOverRoaming(!wifiOnlySwitch.isChecked());
            req.addRequestHeader("User-Agent", UA);
            req.addRequestHeader("Referer", item.pageUrl);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "Mahadi Downloader/" + fileName);
            item.downloadId = downloadManager.enqueue(req);
            setStatus(item, "Downloading", "System DownloadManager • " + fileName, Color.rgb(92, 174, 255), 35);
        } catch (Exception e) {
            item.error = cleanError(e.getMessage());
            setStatus(item, "Failed", "Download start failed: " + item.error, Color.rgb(255, 105, 105), 0);
            runOnUiThread(() -> item.retryButton.setVisibility(View.VISIBLE));
            addHistory("FAILED", item.platform + " • download start");
        }
    }

    private void pollDownloads() {
        List<VideoItem> copy;
        synchronized (items) { copy = new ArrayList<>(items); }
        for (VideoItem item : copy) {
            if (item.downloadId <= 0) continue;
            DownloadManager.Query q = new DownloadManager.Query().setFilterById(item.downloadId);
            Cursor c = null;
            try {
                c = downloadManager.query(q);
                if (c != null && c.moveToFirst()) {
                    int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    long soFar = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                    long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                    int pct = total > 0 ? (int) Math.min(99, soFar * 100L / total) : 45;
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        item.downloadId = -2;
                        setStatus(item, "Completed", "Saved in Downloads/Mahadi Downloader", ACCENT, 100);
                        runOnUiThread(() -> {
                            item.retryButton.setVisibility(View.GONE);
                            item.downloadButton.setVisibility(View.GONE);
                        });
                        addHistory("DONE", item.platform + " • " + (item.title == null ? "video" : shorten(item.title, 45)));
                    } else if (status == DownloadManager.STATUS_FAILED) {
                        int reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                        item.downloadId = -3;
                        item.error = "Download failed (code " + reason + ")";
                        setStatus(item, "Failed", item.error + " • Retry দিন", Color.rgb(255, 105, 105), 0);
                        runOnUiThread(() -> item.retryButton.setVisibility(View.VISIBLE));
                        addHistory("FAILED", item.platform + " • code " + reason);
                    } else if (status == DownloadManager.STATUS_PAUSED) {
                        setStatus(item, "Paused", "Waiting for network/system", Color.rgb(255, 200, 95), pct);
                    } else if (status == DownloadManager.STATUS_RUNNING) {
                        String detail = total > 0 ? human(soFar) + " / " + human(total) : "Downloading…";
                        setStatus(item, "Downloading", detail, Color.rgb(92, 174, 255), pct);
                    } else {
                        setStatus(item, "Pending", wifiOnlySwitch.isChecked() ? "Waiting for Wi‑Fi…" : "Waiting…", MUTED, Math.max(35, pct));
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.close();
            }
        }
        updateSummary();
    }

    private void setStatus(VideoItem item, String status, String detail, int color, int progress) {
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
            int queued = 0, ready = 0, active = 0, done = 0, failed = 0;
            synchronized (items) {
                for (VideoItem i : items) {
                    String s = i.status == null ? "Queued" : i.status;
                    if (s.equals("Queued") || s.equals("Resolving")) queued++;
                    else if (s.equals("Ready")) ready++;
                    else if (s.equals("Downloading") || s.equals("Pending") || s.equals("Paused")) active++;
                    else if (s.equals("Completed")) done++;
                    else if (s.equals("Failed")) failed++;
                }
            }
            summaryText.setText("Total " + items.size() + "  •  Queue " + queued + "  •  Ready " + ready + "  •  Downloading " + active + "  •  Done " + done + "  •  Failed " + failed);
        });
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
            historyContainer.addView(text("No downloads yet", 13, MUTED, false));
            return;
        }
        String[] lines = history.split("\n");
        for (int i = 0; i < Math.min(12, lines.length); i++) {
            String[] p = lines[i].split("\\|", 3);
            if (p.length < 3) continue;
            int color = "DONE".equals(p[0]) ? ACCENT : Color.rgb(255, 105, 105);
            TextView row = text(("DONE".equals(p[0]) ? "✓ " : "! ") + p[1] + "  " + p[2], 12, color, false);
            row.setPadding(dp(11), dp(9), dp(11), dp(9));
            row.setBackground(roundRect(CARD, 10));
            historyContainer.addView(row, lpMatchWrap(0, dp(6)));
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 42);
        }
    }

    private String platformOf(String url) {
        String l = url.toLowerCase(Locale.ROOT);
        if (l.contains("tiktok.com")) return "TikTok";
        if (l.contains("facebook.com") || l.contains("fb.watch")) return "Facebook";
        if (l.contains("instagram.com")) return "Instagram";
        return "Direct";
    }

    private String cleanError(String msg) {
        if (msg == null || msg.trim().isEmpty()) return "Unknown error";
        return shorten(msg.replace("java.lang.", ""), 160);
    }

    private String guessExt(String url) {
        String l = url.toLowerCase(Locale.ROOT);
        if (l.contains(".webm")) return ".webm";
        return ".mp4";
    }

    private String sanitizeFilename(String s) {
        String x = s.replaceAll("[\\\\/:*?\"<>|\\n\\r]+", " ").replaceAll("\\s+", " ").trim();
        if (x.isEmpty()) x = "video";
        return shorten(x, 55);
    }

    private String shorten(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, Math.max(1, n - 1)) + "…";
    }

    private String human(long bytes) {
        if (bytes < 1024) return bytes + " B";
        double kb = bytes / 1024.0;
        if (kb < 1024) return String.format(Locale.US, "%.1f KB", kb);
        double mb = kb / 1024.0;
        if (mb < 1024) return String.format(Locale.US, "%.1f MB", mb);
        return String.format(Locale.US, "%.2f GB", mb / 1024.0);
    }

    private void toast(String s) {
        runOnUiThread(() -> Toast.makeText(this, s, Toast.LENGTH_SHORT).show());
    }

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView v = new TextView(this);
        v.setText(s);
        v.setTextSize(sp);
        v.setTextColor(color);
        if (bold) v.setTypeface(Typeface.DEFAULT_BOLD);
        return v;
    }

    private Button button(String s, int bg, int fg) {
        Button b = new Button(this);
        b.setText(s);
        b.setTextColor(fg);
        b.setTextSize(12);
        b.setAllCaps(false);
        b.setBackground(roundRect(bg, 12));
        b.setPadding(dp(8), 0, dp(8), 0);
        return b;
    }

    private LinearLayout horizontal() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    private LinearLayout verticalCard() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(13), dp(13), dp(13), dp(13));
        l.setBackground(roundStroke(CARD, Color.rgb(43, 48, 59), 14, 1));
        return l;
    }

    private LinearLayout.LayoutParams weight(float w, int rightMargin) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(44), w);
        p.rightMargin = rightMargin;
        return p;
    }

    private LinearLayout.LayoutParams lpMatchWrap(int top, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = top;
        p.bottomMargin = bottom;
        return p;
    }

    private GradientDrawable roundRect(int color, int radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radiusDp));
        return d;
    }

    private GradientDrawable roundStroke(int fill, int stroke, int radiusDp, int strokeDp) {
        GradientDrawable d = roundRect(fill, radiusDp);
        d.setStroke(dp(strokeDp), stroke);
        return d;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    private class VideoItem {
        final String pageUrl;
        final String platform;
        String status = "Queued";
        String mediaUrl;
        String title;
        String error;
        long downloadId = -1;
        int profileIndex = 0;
        LinearLayout card;
        TextView platformView;
        TextView statusView;
        TextView detailView;
        ProgressBar progress;
        Button retryButton;
        Button downloadButton;

        VideoItem(String url) {
            this.pageUrl = url;
            this.platform = platformOf(url);
        }
    }

    private static class ResolveResult {
        final String mediaUrl;
        final String detail;
        final String title;
        ResolveResult(String mediaUrl, String detail, String title) {
            this.mediaUrl = mediaUrl;
            this.detail = detail;
            this.title = title;
        }
    }

    private static class Candidate {
        final String url;
        final String label;
        final int score;
        Candidate(String url, String label, int score) {
            this.url = url;
            this.label = label;
            this.score = score;
        }
    }
}
