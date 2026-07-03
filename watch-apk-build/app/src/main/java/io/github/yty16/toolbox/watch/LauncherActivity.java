package io.github.yty16.toolbox.watch;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

public class LauncherActivity extends Activity {

    private WebView webView;
    private ProgressBar progressBar;
    private String currentLoadingUrl = "";
    private PowerManager.WakeLock wakeLock;

    public class AppBridge {
        @JavascriptInterface
        public boolean isApp() { return true; }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fullscreen immersive mode — essential for small watch screens
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Pure black for OLED watch screens (save battery)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(0xFF000000);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setNavigationBarColor(0xFF000000);
        }

        // Acquire partial wake lock to prevent CPU sleep during stopwatch/timer
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ToolboxWatch::WakeLock");
        }

        setContentView(R.layout.activity_main);

        progressBar = findViewById(R.id.progressBar);
        webView = findViewById(R.id.webView);

        setupWebView();

        // Load URL: default to watch page, with in_app marker so web app knows it's inside native APK
        Intent intent = getIntent();
        String url = intent.getStringExtra("shortcut_url");
        if (url == null || url.isEmpty()) {
            url = intent.getDataString();
        }
        if (url == null || url.isEmpty()) {
            url = "https://yty16.github.io/watch/?in_app=1";
        }
        webView.loadUrl(url);
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        // User agent: keep default Chrome UA and append a marker so the web app can detect native APK
        String ua = settings.getUserAgentString();
        settings.setUserAgentString(ua.replace("Version/4.0", "") + " ToolboxWatch/1.0");

        // Responsive viewport for watch screens
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        // Disable pinch zoom on watch — single-tap navigation only
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.addJavascriptInterface(new AppBridge(), "AppBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                currentLoadingUrl = url;
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                progressBar.setVisibility(View.GONE);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return false;

                // Let system handle special protocols
                if (url.startsWith("tel:") || url.startsWith("mailto:") ||
                    url.startsWith("sms:") || url.startsWith("geo:") ||
                    url.startsWith("intent://") || url.startsWith("market://")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(LauncherActivity.this, "无法打开此链接", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }

                // Intercept downloadable file extensions
                String lowerUrl = url.toLowerCase();
                if (lowerUrl.endsWith(".apk") || lowerUrl.endsWith(".zip") ||
                    lowerUrl.endsWith(".exe") || lowerUrl.endsWith(".mp4") ||
                    lowerUrl.endsWith(".mp3") || lowerUrl.endsWith(".pdf") ||
                    lowerUrl.endsWith(".7z") || lowerUrl.endsWith(".rar") ||
                    lowerUrl.endsWith(".tar") || lowerUrl.endsWith(".gz") ||
                    lowerUrl.endsWith(".doc") || lowerUrl.endsWith(".docx") ||
                    lowerUrl.endsWith(".xls") || lowerUrl.endsWith(".xlsx") ||
                    lowerUrl.endsWith(".ppt") || lowerUrl.endsWith(".pptx") ||
                    lowerUrl.endsWith(".png") || lowerUrl.endsWith(".jpg") ||
                    lowerUrl.endsWith(".jpeg") || lowerUrl.endsWith(".gif") ||
                    lowerUrl.endsWith(".svg") || lowerUrl.endsWith(".webp")) {
                    startDownload(url, null, null);
                    return true;
                }

                // Navigate to main site? Open in WebView too (all http/https in-app)
                return false;
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (!failingUrl.equals(currentLoadingUrl)) return;
                String errorHtml = "<html><body style='background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;text-align:center;'><div><h2>页面加载失败</h2><p style='color:#888;font-size:12px;'>" + description + "</p><button onclick='location.reload()' style='background:#2563eb;color:#fff;border:none;padding:10px 20px;border-radius:16px;font-size:14px;margin-top:12px;'>重新加载</button></div></body></html>";
                view.loadDataWithBaseURL(null, errorHtml, "text/html", "UTF-8", null);
            }
        });

        // Handle file downloads triggered by server Content-Disposition header
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                startDownload(url, contentDisposition, mimeType);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
            }
        });
    }

    private void startDownload(String url, String contentDisposition, String mimeType) {
        String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
        if (fileName == null || fileName.isEmpty()) {
            fileName = "download_" + System.currentTimeMillis();
        }

        Toast.makeText(LauncherActivity.this, "下载: " + fileName, Toast.LENGTH_LONG).show();

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        if (mimeType != null && !mimeType.isEmpty()) {
            request.setMimeType(mimeType);
        }
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null) {
            request.addRequestHeader("Cookie", cookie);
        }
        String ua = webView.getSettings().getUserAgentString();
        request.addRequestHeader("User-Agent", ua);
        request.setDescription("下载中...");
        request.setTitle(fileName);
        request.allowScanningByMediaScanner();
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);
        } else {
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
        }

        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm != null) {
            dm.enqueue(request);
        } else {
            Toast.makeText(LauncherActivity.this, "下载服务不可用", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = intent.getStringExtra("shortcut_url");
        if (url == null || url.isEmpty()) {
            url = intent.getDataString();
        }
        if (url != null && !url.isEmpty() && webView != null) {
            webView.loadUrl(url);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Re-apply immersive mode
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(30 * 60 * 1000L); // 30 min max
        }
        webView.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        webView.onPause();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
        if (webView != null) {
            webView.destroy();
        }
    }
}
