package io.github.yty16.toolbox.watch;

import android.app.Activity;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

/**
 * 暴露给网页的桥：识别运行在原生手表 APK 内，并提供本地缓存的站点版本、应用版本与常用操作。
 */
public class AppBridge {

    private final Activity activity;

    public AppBridge(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean isApp() {
        return true;
    }

    @JavascriptInterface
    public int siteVersion() {
        return activity.getSharedPreferences(SiteUpdater.PREFS, Activity.MODE_PRIVATE)
                .getInt(SiteUpdater.KEY_VERSION, 0);
    }

    @JavascriptInterface
    public String getAppVersion() {
        try {
            PackageInfo pi = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return pi.versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "unknown";
        }
    }

    @JavascriptInterface
    public void clearCache() {
        activity.runOnUiThread(() -> {
            WebView webView = activity.findViewById(R.id.webView);
            if (webView != null) {
                webView.clearCache(true);
            }
            activity.deleteDatabase("webviewCache.db");
            activity.deleteDatabase("webview.db");
            Toast.makeText(activity, "缓存已清理", Toast.LENGTH_SHORT).show();
        });
    }

    @JavascriptInterface
    public void checkUpdate() {
        SiteUpdater.checkAndUpdate(activity, (status, newVersion) -> {
            if (status == SiteUpdater.STATUS_UPDATED) {
                activity.runOnUiThread(() -> Toast.makeText(activity, "已更新 v" + newVersion + "，重启生效", Toast.LENGTH_LONG).show());
            } else if (status == SiteUpdater.STATUS_LATEST) {
                activity.runOnUiThread(() -> Toast.makeText(activity, "已是最新", Toast.LENGTH_SHORT).show());
            } else {
                activity.runOnUiThread(() -> Toast.makeText(activity, "检查失败", Toast.LENGTH_SHORT).show());
            }
        });
    }

    @JavascriptInterface
    public void exitApp() {
        activity.runOnUiThread(() -> {
            WebView webView = activity.findViewById(R.id.webView);
            if (webView != null) {
                webView.stopLoading();
                webView.loadUrl("about:blank");
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                activity.finishAndRemoveTask();
            } else {
                activity.finish();
            }
        });
    }
}
