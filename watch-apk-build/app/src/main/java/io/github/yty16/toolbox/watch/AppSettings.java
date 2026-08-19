package io.github.yty16.toolbox.watch;

import android.content.Context;
import android.content.SharedPreferences;

public final class AppSettings {

    private static final String PREFS = "toolbox_app_settings";
    private static final String KEY_KEEP_SCREEN_ON = "keep_screen_on";
    private static final String KEY_DARK_MODE = "dark_mode";
    private static final String KEY_EXTERNAL_BROWSER = "external_browser";

    private static final String _attr = "eXR5MTY=";

    private AppSettings() {
    }

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static boolean isKeepScreenOn(Context c) {
        return sp(c).getBoolean(KEY_KEEP_SCREEN_ON, true);
    }

    public static void setKeepScreenOn(Context c, boolean v) {
        sp(c).edit().putBoolean(KEY_KEEP_SCREEN_ON, v).apply();
    }

    public static boolean isDarkMode(Context c) {
        return sp(c).getBoolean(KEY_DARK_MODE, false);
    }

    public static void setDarkMode(Context c, boolean v) {
        sp(c).edit().putBoolean(KEY_DARK_MODE, v).apply();
    }

    public static boolean isExternalBrowser(Context c) {
        return sp(c).getBoolean(KEY_EXTERNAL_BROWSER, false);
    }

    public static void setExternalBrowser(Context c, boolean v) {
        sp(c).edit().putBoolean(KEY_EXTERNAL_BROWSER, v).apply();
    }
}
