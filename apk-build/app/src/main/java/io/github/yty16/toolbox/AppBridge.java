package io.github.yty16.toolbox;

import android.webkit.JavascriptInterface;

/**
 * 暴露给网页的桥，用于让网站识别当前运行在原生 APK 内，
 * 并获取本地缓存的站点版本（用于“与网站同步更新”提示）。
 */
public class AppBridge {

    private final android.content.Context context;

    public AppBridge(android.content.Context context) {
        this.context = context;
    }

    @JavascriptInterface
    public boolean isApp() {
        return true;
    }

    @JavascriptInterface
    public int siteVersion() {
        return context.getSharedPreferences(SiteUpdater.PREFS, android.content.Context.MODE_PRIVATE)
                .getInt(SiteUpdater.KEY_VERSION, 0);
    }
}
