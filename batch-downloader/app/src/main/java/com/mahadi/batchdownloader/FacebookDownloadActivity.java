package com.mahadi.batchdownloader;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class FacebookDownloadActivity extends Activity {

    private static final int GREEN = Color.rgb(53, 225, 125);
    private static final int BG = Color.rgb(5, 7, 9);
    private static final int CARD = Color.rgb(16, 20, 24);
    private static final int BORDER = Color.rgb(38, 55, 47);
    private static final int MUTED = Color.rgb(142, 154, 166);
    private static final int ERROR = Color.rgb(255, 98, 110);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<String> urls = new ArrayList<>();

    private WebView webView;
    private TextView status;
    private TextView counter;
    private ProgressBar progress;
    private Button closeButton;

    private int index = 0;
    private int downloaded = 0;
    private int failed = 0;
    private int stage = 0;
    private long stageStarted = 0L;
    private boolean extracting = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);

        String raw = getIntent().getStringExtra("urls");
        if (raw == null) raw = getIntent().getStringExtra("url");
        if (raw != null) {
            Set<String> unique = new LinkedHashSet<>();
            for (String line : raw.split("\\n")) {
                String u = line.trim();
                if (u.startsWith("http://") || u.startsWith("https://")) unique.add(u);
            }
            urls.addAll(unique);
        }

        buildUi();
        configureWebView();

        if (urls.isEmpty()) {
            failAll("Facebook video link পাওয়া যায়নি");
        } else {
            processCurrent();
        }
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(20), dp(28), dp(20), dp(24));
        root.setBackgroundColor(BG);

        TextView logo = text("MBD", 28, GREEN, true);
        logo.setGravity(Gravity.CENTER);
        GradientDrawable lg = new GradientDrawable();
        lg.setColor(Color.rgb(8, 30, 18));
        lg.setStroke(dp(1), Color.rgb(38, 112, 68));
        lg.setCornerRadius(dp(22));
        logo.setBackground(lg);
        root.addView(logo, new LinearLayout.LayoutParams(dp(86), dp(64)));

        TextView title = text("FACEBOOK DOWNLOAD", 20, Color.WHITE, true);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(18), 0, dp(5));
        root.addView(title);

        TextView sub = text("Background processing • Website hidden", 12, MUTED, false);
        sub.setGravity(Gravity.CENTER);
        root.addView(sub);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(8));
        pp.setMargins(0, dp(24), 0, dp(14));
        root.addView(progress, pp);

        counter = text("", 13, GREEN, true);
        counter.setGravity(Gravity.CENTER);
        root.addView(counter);

        status = text("Starting…", 14, Color.WHITE, false);
        status.setGravity(Gravity.CENTER);
        status.setPadding(dp(14), dp(18), dp(14), dp(18));
        GradientDrawable sg = new GradientDrawable();
        sg.setColor(CARD);
        sg.setStroke(dp(1), BORDER);
        sg.setCornerRadius(dp(16));
        status.setBackground(sg);
        root.addView(status, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        closeButton = button("CLOSE", Color.rgb(24, 29, 34), Color.WHITE);
        closeButton.setVisibility(View.GONE);
        closeButton.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        cp.setMargins(0, dp(18), 0, 0);
        root.addView(closeButton, cp);

        webView = new WebView(this);
        webView.setVisibility(View.INVISIBLE);
        LinearLayout.LayoutParams hidden = new LinearLayout.LayoutParams(1, 1);
        root.addView(webView, hidden);

        setContentView(root);
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadsImagesAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new Bridge(), "MahadiBridge");
        webView.setWebChromeClient(new WebChromeClient());

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String pageUrl) {
                super.onPageFinished(view, pageUrl);
                if (isFinishing()) return;

                if (stage == 1 && pageUrl != null && pageUrl.contains("fdown.net")) {
                    handler.postDelayed(() -> submitCurrentUrl(), 500);
                } else if (stage == 2 && pageUrl != null && pageUrl.contains("fdown.net")) {
                    handler.postDelayed(() -> extractDownloadLinks(), 900);
                }
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent,
                                        String contentDisposition, String mimetype,
                                        long contentLength) {
                if (url != null && !url.isEmpty()) {
                    enqueueDownload(url, userAgent);
                }
            }
        });
    }

    private void processCurrent() {
        if (index >= urls.size()) {
            finishSummary();
            return;
        }

        extracting = false;
        stage = 1;
        stageStarted = System.currentTimeMillis();

        int pct = (int) ((index * 100.0) / Math.max(1, urls.size()));
        progress.setProgress(pct);
        counter.setText("Video " + (index + 1) + " / " + urls.size());
        status.setText("Facebook link process হচ্ছে…");

        webView.stopLoading();
        webView.loadUrl("about:blank");
        handler.postDelayed(() -> webView.loadUrl("https://fdown.net/"), 250);

        handler.postDelayed(() -> {
            if (!isFinishing() && index < urls.size()
                    && System.currentTimeMillis() - stageStarted >= 25000) {
                failCurrent("Timeout — FDOWN response পাওয়া যায়নি");
            }
        }, 26000);
    }

    private void submitCurrentUrl() {
        if (index >= urls.size() || stage != 1) return;
        final String target = JSONObject.quote(urls.get(index));

        String js = "(function(){" +
                "var i=document.querySelector('input[name=URLz]')||" +
                "document.querySelector('input[placeholder*=Facebook]')||" +
                "document.querySelector('input[type=text]');" +
                "if(!i){return 'NO_INPUT';}" +
                "i.value=" + target + ";" +
                "i.dispatchEvent(new Event('input',{bubbles:true}));" +
                "i.dispatchEvent(new Event('change',{bubbles:true}));" +
                "var f=i.form||document.querySelector('form');" +
                "var b=(f&&f.querySelector('button[type=submit],input[type=submit]'))||" +
                "document.querySelector('button[type=submit],input[type=submit]');" +
                "if(b){b.click();return 'CLICKED';}" +
                "if(f){f.submit();return 'SUBMITTED';}" +
                "return 'NO_BUTTON';" +
                "})();";

        webView.evaluateJavascript(js, result -> {
            if (result != null && (result.contains("NO_INPUT") || result.contains("NO_BUTTON"))) {
                failCurrent("FDOWN form পাওয়া যায়নি");
                return;
            }
            stage = 2;
            stageStarted = System.currentTimeMillis();
            status.setText("HD/SD download link খোঁজা হচ্ছে…");
        });
    }

    private void extractDownloadLinks() {
        if (stage != 2 || extracting || index >= urls.size()) return;
        extracting = true;

        String js = "(function(){" +
                "var A=[].slice.call(document.querySelectorAll('a[href]'));" +
                "var R=A.map(function(a){return {h:a.href||'',t:(a.innerText||a.textContent||'').trim(),id:a.id||'',c:a.className||''};})" +
                ".filter(function(x){" +
                "var s=(x.t+' '+x.id+' '+x.c+' '+x.h).toLowerCase();" +
                "return x.h&&x.h.indexOf('http')===0&&(" +
                "s.indexOf('download')>=0||s.indexOf('hd')>=0||s.indexOf('normal quality')>=0||" +
                "s.indexOf('fbcdn.net')>=0||s.indexOf('video')>=0);" +
                "});" +
                "return JSON.stringify({url:location.href,title:document.title||'',links:R.slice(0,30),text:(document.body&&document.body.innerText||'').slice(0,1200)});" +
                "})();";

        webView.evaluateJavascript(js, raw -> {
            extracting = false;
            try {
                String decoded = decodeJsString(raw);
                JSONObject page = new JSONObject(decoded);
                JSONArray links = page.optJSONArray("links");
                String body = page.optString("text", "").toLowerCase(Locale.ROOT);
                String pageUrl = page.optString("url", "");

                if (pageUrl.contains("error=robot") || body.contains("robot")) {
                    failCurrent("FDOWN anti-bot check block করেছে");
                    return;
                }

                String hd = null;
                String normal = null;
                String any = null;

                if (links != null) {
                    for (int i = 0; i < links.length(); i++) {
                        JSONObject x = links.optJSONObject(i);
                        if (x == null) continue;
                        String h = x.optString("h", "");
                        String t = (x.optString("t", "") + " " + x.optString("id", "")).toLowerCase(Locale.ROOT);
                        if (h.isEmpty()) continue;
                        if (any == null) any = h;
                        if (hd == null && (t.contains("hd") || h.toLowerCase(Locale.ROOT).contains("hd"))) hd = h;
                        if (normal == null && (t.contains("normal") || t.contains("sd"))) normal = h;
                    }
                }

                String chosen = hd != null ? hd : (normal != null ? normal : any);
                if (chosen != null && !chosen.isEmpty()) {
                    enqueueDownload(chosen, webView.getSettings().getUserAgentString());
                } else if (body.contains("download normal quality") || body.contains("download hd")) {
                    handler.postDelayed(() -> {
                        extracting = false;
                        extractDownloadLinks();
                    }, 1200);
                } else {
                    failCurrent("Download link পাওয়া যায়নি");
                }
            } catch (Exception e) {
                failCurrent("Result parse failed");
            }
        });
    }

    private void enqueueDownload(String mediaUrl, String userAgent) {
        try {
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(mediaUrl));
            String filename = "facebook_video_" + System.currentTimeMillis() + ".mp4";
            req.setTitle(filename);
            req.setDescription("Mahadi Downloader");
            req.setMimeType("video/mp4");
            req.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(
                    Environment.DIRECTORY_DOWNLOADS,
                    "Mahadi Downloader/" + filename);

            String cookies = CookieManager.getInstance().getCookie(mediaUrl);
            if (cookies != null && !cookies.isEmpty()) req.addRequestHeader("Cookie", cookies);
            if (userAgent != null && !userAgent.isEmpty()) req.addRequestHeader("User-Agent", userAgent);
            req.addRequestHeader("Referer", "https://fdown.net/");

            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            dm.enqueue(req);

            downloaded++;
            status.setText("Download শুরু হয়েছে ✓");
            handler.postDelayed(this::next, 600);
        } catch (Exception e) {
            failCurrent("DownloadManager start failed");
        }
    }

    private void failCurrent(String message) {
        failed++;
        status.setText(message);
        status.setTextColor(ERROR);
        handler.postDelayed(() -> {
            status.setTextColor(Color.WHITE);
            next();
        }, 850);
    }

    private void next() {
        index++;
        processCurrent();
    }

    private void finishSummary() {
        progress.setProgress(100);
        counter.setText("Completed");
        status.setText("Started: " + downloaded + "   •   Failed: " + failed +
                "\nFiles: Downloads/Mahadi Downloader");
        status.setTextColor(downloaded > 0 ? GREEN : ERROR);
        closeButton.setVisibility(View.VISIBLE);
    }

    private void failAll(String msg) {
        progress.setProgress(0);
        counter.setText("No link");
        status.setText(msg);
        status.setTextColor(ERROR);
        closeButton.setVisibility(View.VISIBLE);
    }

    private String decodeJsString(String raw) {
        if (raw == null || "null".equals(raw)) return "{}";
        try {
            JSONArray a = new JSONArray("[" + raw + "]");
            return a.getString(0);
        } catch (Exception e) {
            return raw;
        }
    }

    private class Bridge {
        @JavascriptInterface
        public void log(String value) {
            // Reserved for future diagnostics.
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
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
        b.setAllCaps(false);
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setCornerRadius(dp(13));
        d.setStroke(dp(1), BORDER);
        b.setBackground(d);
        return b;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }
}
