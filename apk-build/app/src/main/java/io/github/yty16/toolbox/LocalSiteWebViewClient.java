package io.github.yty16.toolbox;

import android.content.Context;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 离线内核：拦截对 yty16.github.io 的所有请求，优先从应用私有目录 files/www 读取
 * （OTA 更新后的内容），其次从打包资源 assets/www 读取（离线基线）。
 * 这样 WebView 看到的依旧是真实域名，网站的域名防伪校验可以通过；
 * 同时不依赖网络即可离线使用。缺失的本地文件回落到真实网络（联网时可用）。
 *
 * 对于 /sw.js 返回空操作脚本，避免在 App 内启用 PWA 缓存（离线由本地文件保证，
 * 否则 OTA 更新后 Service Worker 可能继续提供陈旧内容）。
 */
public class LocalSiteWebViewClient extends WebViewClient {

    private static final String SITE_HOST = "yty16.github.io";
    // 永远走网络、不读本地的文件（保证版本检测与更新包从服务器获取）
    private static final String NO_LOCAL_1 = "/version.json";
    private static final String NO_LOCAL_2 = "/app-bundle.zip";

    private final Context context;

    public LocalSiteWebViewClient(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (request == null || request.getUrl() == null) return null;
        String url = request.getUrl().toString();
        String host = request.getUrl().getHost();
        if (host == null || !host.equalsIgnoreCase(SITE_HOST)) {
            // 非本站域名（如 yty16.pages.dev 的下载链接）走真实网络
            return null;
        }

        String path = request.getUrl().getPath();
        if (path == null || path.isEmpty()) path = "/";

        // 版本检测 / 更新包永远走网络
        if (path.equals(NO_LOCAL_1) || path.equals(NO_LOCAL_2)) {
            return null;
        }

        // sw.js 返回空操作 Service Worker
        if (path.endsWith("/sw.js")) {
            return new WebResourceResponse(
                    "application/javascript",
                    "UTF-8",
                    new ByteArrayInputStream(
                            ("// in-app no-op service worker\n" +
                                    "self.addEventListener('install', function(e){ self.skipWaiting(); });\n" +
                                    "self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });\n")
                                    .getBytes()));
        }

        // 计算候选文件路径（含文件夹 URL 的 index.html 回退）
        List<String> candidates = new ArrayList<>();
        candidates.add(path);
        if (path.endsWith("/")) {
            candidates.add(path + "index.html");
        } else {
            candidates.add(path + "/index.html");
        }

        for (String candidate : candidates) {
            // 1) OTA 覆盖目录 files/www
            File localFile = new File(context.getFilesDir(), "www" + candidate);
            if (localFile.isFile()) {
                return buildResponse(localFile, candidate);
            }
            // 2) 打包基线 assets/www
            String assetPath = "www" + candidate;
            InputStream assetIs = openAsset(assetPath);
            if (assetIs != null) {
                return buildResponse(assetIs, candidate);
            }
        }

        // 本地没有该文件：回落到真实网络（联网时可用，离线则触发错误页）
        return null;
    }

    private InputStream openAsset(String assetPath) {
        try {
            return context.getAssets().open(assetPath);
        } catch (IOException e) {
            return null;
        }
    }

    private WebResourceResponse buildResponse(File file, String candidate) {
        try {
            return buildResponse(new FileInputStream(file), candidate);
        } catch (IOException e) {
            return null;
        }
    }

    private WebResourceResponse buildResponse(InputStream is, String candidate) {
        String mime = guessMime(candidate);
        boolean isText = mime.startsWith("text/")
                || mime.equals("application/javascript")
                || mime.equals("application/json")
                || mime.equals("application/xml");
        WebResourceResponse resp = new WebResourceResponse(
                mime,
                isText ? "UTF-8" : null,
                is);
        resp.setResponseHeaders(new java.util.HashMap<String, String>() {{
            put("Access-Control-Allow-Origin", "*");
            put("Cache-Control", "no-cache");
        }});
        return resp;
    }

    private static String guessMime(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot >= 0 ? path.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        switch (ext) {
            case "html": case "htm": return "text/html";
            case "js": return "application/javascript";
            case "mjs": return "application/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "xml": return "application/xml";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "bmp": return "image/bmp";
            case "ico": return "image/x-icon";
            case "woff": return "font/woff";
            case "woff2": return "font/woff2";
            case "ttf": return "font/ttf";
            case "otf": return "font/otf";
            case "mp3": return "audio/mpeg";
            case "wav": return "audio/wav";
            case "ogg": return "audio/ogg";
            case "mp4": return "video/mp4";
            case "webm": return "video/webm";
            case "pdf": return "application/pdf";
            case "txt": return "text/plain";
            case "wasm": return "application/wasm";
            default: return "application/octet-stream";
        }
    }
}
