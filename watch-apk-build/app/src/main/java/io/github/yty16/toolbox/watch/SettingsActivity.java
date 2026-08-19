package io.github.yty16.toolbox.watch;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewDatabase;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

public class SettingsActivity extends Activity {

    private Switch swKeepScreenOn;
    private Switch swDarkMode;
    private Switch swExternalBrowser;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        TextView tvVersion = findViewById(R.id.textVersion);
        try {
            String v = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            tvVersion.setText(getString(R.string.setting_version) + " " + v);
        } catch (Exception e) {
            tvVersion.setText(getString(R.string.setting_version) + " unknown");
        }

        swKeepScreenOn = findViewById(R.id.switchKeepScreenOn);
        swDarkMode = findViewById(R.id.switchDarkMode);
        swExternalBrowser = findViewById(R.id.switchExternalBrowser);

        swKeepScreenOn.setChecked(AppSettings.isKeepScreenOn(this));
        swDarkMode.setChecked(AppSettings.isDarkMode(this));
        swExternalBrowser.setChecked(AppSettings.isExternalBrowser(this));

        swKeepScreenOn.setOnCheckedChangeListener((b, c) -> AppSettings.setKeepScreenOn(this, c));
        swDarkMode.setOnCheckedChangeListener((b, c) -> AppSettings.setDarkMode(this, c));
        swExternalBrowser.setOnCheckedChangeListener((b, c) -> AppSettings.setExternalBrowser(this, c));

        findViewById(R.id.rowClearCache).setOnClickListener(v -> {
            WebView cacheView = new WebView(this);
            cacheView.clearCache(true);
            cacheView.destroy();
            Toast.makeText(this, R.string.toast_cleared, Toast.LENGTH_SHORT).show();
        });

        findViewById(R.id.rowClearData).setOnClickListener(v -> {
            WebStorage.getInstance().deleteAllData();
            CookieManager cm = CookieManager.getInstance();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                cm.removeAllCookies(null);
            }
            WebViewDatabase db = WebViewDatabase.getInstance(this);
            db.clearFormData();
            db.clearHttpAuthUsernamePassword();
            Toast.makeText(this, R.string.toast_cleared_data, Toast.LENGTH_SHORT).show();
        });
    }
}
