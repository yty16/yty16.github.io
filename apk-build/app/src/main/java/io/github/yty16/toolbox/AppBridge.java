package io.github.yty16.toolbox;

import android.app.Activity;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

/**
 * 暴露给网页的桥，用于让网站识别当前运行在原生 APK 内，
 * 并获取本地缓存的站点版本、应用版本，以及执行清理缓存/检查更新/退出应用等操作。
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
            Toast.makeText(activity, "缓存已清理，重启后生效", Toast.LENGTH_LONG).show();
        });
    }

    @JavascriptInterface
    public void checkUpdate() {
        SiteUpdater.checkAndUpdate(activity, (status, newVersion) -> {
            if (status == SiteUpdater.STATUS_UPDATED) {
                activity.runOnUiThread(() -> Toast.makeText(activity, "已更新到站点版本 v" + newVersion + "，重启应用生效", Toast.LENGTH_LONG).show());
            } else if (status == SiteUpdater.STATUS_LATEST) {
                activity.runOnUiThread(() -> Toast.makeText(activity, "已是最新版本", Toast.LENGTH_SHORT).show());
            } else {
                activity.runOnUiThread(() -> Toast.makeText(activity, "检查更新失败，请检查网络", Toast.LENGTH_SHORT).show());
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
