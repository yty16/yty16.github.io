package io.github.yty16.toolbox;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * OTA 同步：启动后比对站点 version.json，若远端版本更新则下载 app-bundle.zip
 * 解压到应用私有目录 files/www，覆盖本地基线，实现“与网站同步更新”。
 * 离线或无网络时静默跳过，不影响已安装的离线内容。
 */
public class SiteUpdater {

    public static final String PREFS = "toolbox_prefs";
    public static final String KEY_VERSION = "site_version";

    public static final int STATUS_LATEST = 0;
    public static final int STATUS_UPDATED = 1;
    public static final int STATUS_ERROR = -1;

    public interface Callback {
        void onResult(int status, int newVersion);
    }

    public static void checkAndUpdate(Context context, Callback callback) {
        new Thread(() -> {
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            int localVersion = sp.getInt(KEY_VERSION, 0);
            int remoteVersion;
            String bundleUrl;

            try {
                String json = httpGet("https://yty16.github.io/version.json", 8000);
                JSONObject obj = new JSONObject(json);
                remoteVersion = obj.optInt("version", 0);
                bundleUrl = obj.optString("bundleUrl", "https://yty16.github.io/app-bundle.zip");
            } catch (Exception e) {
                // 离线或网络异常：保持现状
                if (callback != null) callback.onResult(STATUS_ERROR, localVersion);
                return;
            }

            if (remoteVersion <= localVersion) {
                if (callback != null) callback.onResult(STATUS_LATEST, localVersion);
                return;
            }

            try {
                File zip = new File(context.getCacheDir(), "app-bundle.zip");
                downloadFile(bundleUrl, zip, 60000);
                unzip(zip, new File(context.getFilesDir(), "www"));
                sp.edit().putInt(KEY_VERSION, remoteVersion).apply();
                if (callback != null) callback.onResult(STATUS_UPDATED, remoteVersion);
            } catch (Exception e) {
                if (callback != null) callback.onResult(STATUS_ERROR, localVersion);
            }
        }).start();
    }

    private static String httpGet(String urlStr, int timeout) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(timeout);
        conn.setReadTimeout(timeout);
        conn.setRequestMethod("GET");
        conn.setInstanceFollowRedirects(true);
        try {
            int code = conn.getResponseCode();
            InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            if (is == null) return "";
            java.util.Scanner s = new java.util.Scanner(is, "UTF-8").useDelimiter("\\A");
            String body = s.hasNext() ? s.next() : "";
            is.close();
            return body;
        } finally {
            conn.disconnect();
        }
    }

    private static void downloadFile(String urlStr, File out, int timeout) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(timeout);
        conn.setReadTimeout(timeout);
        conn.setInstanceFollowRedirects(true);
        try {
            int code = conn.getResponseCode();
            InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            if (is == null) throw new IOException("empty response");
            File tmp = new File(out.getAbsolutePath() + ".tmp");
            try (OutputStream os = new FileOutputStream(tmp)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
            }
            is.close();
            if (tmp.length() == 0) throw new IOException("empty download");
            if (out.exists()) out.delete();
            if (!tmp.renameTo(out)) {
                // 重命名失败则复制
                copyFile(tmp, out);
                tmp.delete();
            }
        } finally {
            conn.disconnect();
        }
    }

    private static void copyFile(File src, File dst) throws IOException {
        try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
    }

    private static void unzip(File zip, File destDir) throws IOException {
        if (!destDir.exists()) destDir.mkdirs();
        String destPath = destDir.getCanonicalPath() + File.separator;
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zip)))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                File out = new File(destDir, entry.getName());
                // 防止 Zip Slip 路径穿越
                String outPath = out.getCanonicalPath();
                if (!outPath.startsWith(destPath)) continue;
                File parent = out.getParentFile();
                if (parent != null) parent.mkdirs();
                try (OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = zis.read(buf)) > 0) os.write(buf, 0, n);
                }
                zis.closeEntry();
            }
        }
    }
}
