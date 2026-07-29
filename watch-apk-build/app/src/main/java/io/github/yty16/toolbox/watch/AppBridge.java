package io.github.yty16.toolbox.watch;

import android.content.Context;
import android.webkit.JavascriptInterface;

/**
 * 暴露给网页的桥：识别运行在原生手表 APK 内，并提供本地缓存的站点版本。
 */
public class AppBridge {

    private final Context context;

    public AppBridge(Context context) {
        this.context = context;
    }

    @JavascriptInterface
    public boolean isApp() {
        return true;
    }

    @JavascriptInterface
    public int siteVersion() {
        return context.getSharedPreferences(SiteUpdater.PREFS, Context.MODE_PRIVATE)
                .getInt(SiteUpdater.KEY_VERSION, 0);
    }
}
