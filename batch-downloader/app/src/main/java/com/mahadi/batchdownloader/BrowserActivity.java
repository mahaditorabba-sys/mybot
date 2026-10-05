package com.mahadi.batchdownloader;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
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
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

public class BrowserActivity extends Activity {

    private static final int GREEN = Color.rgb(53, 225, 125);
    private static final int BG = Color.rgb(5, 7, 9);
    private static final int CARD = Color.rgb(16, 20, 24);
    private static final int BORDER = Color.rgb(38, 55, 47);
    private static final int MUTED = Color.rgb(142, 154, 166);

    private WebView webView;
    private ProgressBar progress;
    private TextView title;
    private TextView hint;
    private Button action;
    private String mode;
    private String targetUrl;
    private boolean attemptedPrefill = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);

        mode = getIntent().getStringExtra("mode");
        targetUrl = getIntent().getStringExtra("url");
        if (mode == null) mode = "fdown";
        if (targetUrl == null) targetUrl = "";

        buildUi();
        configureWebView();

        title.setText("FACEBOOK PROFILE BROWSER");
        hint.setText("Profile খুলুন → Reel tap করুন → নিচের button চাপুন");
        action.setText("DOWNLOAD CURRENT REEL");
        webView.loadUrl(targetUrl.isEmpty() ? "https://m.facebook.com/" : targetUrl);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(10), dp(8), dp(10), dp(8));
        top.setBackgroundColor(Color.BLACK);

        Button back = button("‹", CARD, Color.WHITE);
        back.setTextSize(26);
        top.addView(back, new LinearLayout.LayoutParams(dp(48), dp(46)));

        LinearLayout labels = new LinearLayout(this);
        labels.setOrientation(LinearLayout.VERTICAL);
        labels.setPadding(dp(10), 0, dp(8), 0);

        title = text("BROWSER", 14, Color.WHITE, true);
        hint = text("", 10, MUTED, false);
        labels.addView(title);
        labels.addView(hint);
        top.addView(labels, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        root.addView(top);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        action = button("", GREEN, Color.rgb(2, 12, 7));
        action.setTypeface(Typeface.DEFAULT_BOLD);
        action.setTextSize(13);
        LinearLayout.LayoutParams actionLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(56));
        actionLp.setMargins(dp(12), dp(8), dp(12), dp(12));
        root.addView(action, actionLp);

        setContentView(root);

        back.setOnClickListener(v -> {
            if (webView.canGoBack()) webView.goBack();
            else finish();
        });

        action.setOnClickListener(v -> {
            webView.evaluateJavascript("(function(){return location.href;})()", raw -> {
                String current = decodeJsString(raw);
                if (!isFacebookVideoUrl(current)) {
                    current = webView.getUrl();
                }
                if (isFacebookVideoUrl(current)) {
                    Intent i = new Intent(this, FacebookDownloadActivity.class);
                    i.putExtra("url", current);
                    startActivity(i);
                } else {
                    toast("আগে Facebook profile থেকে একটি Reel/Video খুলুন");
                }
            });
        });
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadsImagesAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cm.setAcceptThirdPartyCookies(webView, true);
        }

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    return false;
                }
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return true;
                if (url.startsWith("http://") || url.startsWith("https://")) return false;
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript("(function(){return location.href;})()", raw -> {
                    String current = decodeJsString(raw);
                    if (isFacebookVideoUrl(current) || isFacebookVideoUrl(url)) {
                        action.setText("DOWNLOAD THIS REEL");
                        hint.setText("Reel selected ✓");
                    } else {
                        action.setText("DOWNLOAD CURRENT REEL");
                        hint.setText("Profile খুলুন → Reel tap করুন → নিচের button চাপুন");
                    }
                });
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            try {
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimetype);
                if (fileName == null || fileName.trim().isEmpty()) {
                    fileName = "facebook_video_" + System.currentTimeMillis() + ".mp4";
                }
                req.setTitle(fileName);
                req.setDescription("Mahadi Downloader");
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        "Mahadi Downloader/" + fileName);

                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null && !cookies.isEmpty()) req.addRequestHeader("Cookie", cookies);
                if (userAgent != null && !userAgent.isEmpty()) req.addRequestHeader("User-Agent", userAgent);

                DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                dm.enqueue(req);
                toast("Download শুরু হয়েছে");
            } catch (Exception e) {
                toast("Download start failed");
            }
        });
    }

    private void prefillFdown() {
        if (attemptedPrefill || targetUrl.isEmpty()) return;
        attemptedPrefill = true;

        String quoted = JSONObject.quote(targetUrl);
        String js = "(function(){" +
                "var i=document.querySelector('input[name=URLz]')||" +
                "document.querySelector('input[placeholder*=Facebook]')||" +
                "document.querySelector('input[type=text]');" +
                "if(i){i.value=" + quoted + ";" +
                "i.dispatchEvent(new Event('input',{bubbles:true}));" +
                "i.dispatchEvent(new Event('change',{bubbles:true}));" +
                "i.focus();return 'ok';}return 'no';})();";

        webView.evaluateJavascript(js, value -> {
            if (value != null && value.contains("no")) {
                hint.setText("Link clipboard-এ আছে—Paste করে Download চাপুন");
            } else {
                hint.setText("Link auto-filled ✓ এখন FDOWN-এর Download চাপুন");
            }
        });
    }

    private void copyTarget() {
        if (targetUrl == null || targetUrl.isEmpty()) return;
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        cm.setPrimaryClip(ClipData.newPlainText("Facebook video link", targetUrl));
    }

    private boolean isFacebookVideoUrl(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        return (u.contains("facebook.com") || u.contains("fb.watch"))
                && (u.contains("/reel/") || u.contains("/videos/")
                || u.contains("/watch") || u.contains("/share/r/")
                || u.contains("/share/v/"));
    }

    private String decodeJsString(String raw) {
        if (raw == null || "null".equals(raw)) return "";
        try {
            org.json.JSONArray a = new org.json.JSONArray("[" + raw + "]");
            return a.getString(0);
        } catch (Exception e) {
            return raw;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
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
        d.setCornerRadius(dp(12));
        d.setStroke(dp(1), BORDER);
        b.setBackground(d);
        return b;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }
}
