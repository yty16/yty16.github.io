package io.github.yty16.toolbox;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
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
    private boolean siteOriginLoaded = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 全屏沉浸模式
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

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(0xFF2563EB);
        }

        setContentView(R.layout.activity_main);

        progressBar = findViewById(R.id.progressBar);
        webView = findViewById(R.id.webView);

        setupWebView();

        // 加载地址：优先快捷方式 extra，其次深链，默认首页
        Intent intent = getIntent();
        String url = intent.getStringExtra("shortcut_url");
        if (url == null || url.isEmpty()) {
            url = intent.getDataString();
        }
        if (url == null || url.isEmpty()) {
            url = "https://yty16.github.io/";
        }
        webView.loadUrl(url);

        // 后台与网站同步（OTA）：联网时比对版本并下载更新包，离线则静默跳过
        SiteUpdater.checkAndUpdate(this, (status, newVersion) -> {
            if (status == SiteUpdater.STATUS_UPDATED) {
                runOnUiThread(() -> {
                    Toast.makeText(LauncherActivity.this, "已同步网站更新 (v" + newVersion + ")", Toast.LENGTH_LONG).show();
                    if (siteOriginLoaded && webView != null) {
                        webView.reload();
                    }
                });
            }
        });
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

        String ua = settings.getUserAgentString();
        settings.setUserAgentString(ua.replace("Version/4.0", "") + " ToolboxApp/1.0");
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);

        // 暴露原生桥，便于网页识别运行在 APK 内
        webView.addJavascriptInterface(new AppBridge(this), "AppBridge");

        // 离线内核：拦截 yty16.github.io 请求改从本地读取
        webView.setWebViewClient(new LocalSiteWebViewClient(this) {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                currentLoadingUrl = url;
                if (url != null && url.contains("yty16.github.io")) {
                    siteOriginLoaded = true;
                }
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
                return false;
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (!failingUrl.equals(currentLoadingUrl)) return;
                String errorHtml = "<html><body style='background:#1a1a2e;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;text-align:center;'><div><h2>😵 页面加载失败</h2><p style='color:#888;'>" + description + "</p><p style='color:#888;font-size:13px;'>请检查网络后重试，或重启应用使用已缓存的离线内容</p><button onclick='location.reload()' style='background:#2563eb;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:16px;margin-top:16px;'>🔄 重新加载</button></div></body></html>";
                view.loadDataWithBaseURL(null, errorHtml, "text/html", "UTF-8", null);
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
                startDownload(url, contentDisposition, mimeType));

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

        Toast.makeText(LauncherActivity.this, "正在下载: " + fileName, Toast.LENGTH_LONG).show();

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
        request.setDescription("正在下载...");
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
        webView.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (webView != null) {
            webView.destroy();
        }
    }
}
