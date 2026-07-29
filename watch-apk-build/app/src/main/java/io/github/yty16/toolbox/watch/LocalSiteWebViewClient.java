package io.github.yty16.toolbox.watch;

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
 * 离线内核（手表版）：拦截 yty16.github.io 请求改从本地读取，使 WebView 仍以真实域名呈现，
 * 通过网站防伪校验；缺失文件回落网络。/sw.js 返回空操作，避免 App 内 PWA 缓存。
 */
public class LocalSiteWebViewClient extends WebViewClient {

    private static final String SITE_HOST = "yty16.github.io";
    private static final String NO_LOCAL_1 = "/version.json";
    private static final String NO_LOCAL_2 = "/app-bundle.zip";

    private final Context context;

    public LocalSiteWebViewClient(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (request == null || request.getUrl() == null) return null;
        String host = request.getUrl().getHost();
        if (host == null || !host.equalsIgnoreCase(SITE_HOST)) {
            return null;
        }

        String path = request.getUrl().getPath();
        if (path == null || path.isEmpty()) path = "/";

        if (path.equals(NO_LOCAL_1) || path.equals(NO_LOCAL_2)) {
            return null;
        }

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

        List<String> candidates = new ArrayList<>();
        candidates.add(path);
        if (path.endsWith("/")) {
            candidates.add(path + "index.html");
        } else {
            candidates.add(path + "/index.html");
        }

        for (String candidate : candidates) {
            File localFile = new File(context.getFilesDir(), "www" + candidate);
            if (localFile.isFile()) {
                return buildResponse(localFile, candidate);
            }
            String assetPath = "www" + candidate;
            InputStream assetIs = openAsset(assetPath);
            if (assetIs != null) {
                return buildResponse(assetIs, candidate);
            }
        }

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
