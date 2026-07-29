using System;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace YToolboxWinApp
{
    public partial class MainForm : Form
    {
        // 隐藏署名常量（与移动端一致，解码后为 yty16），用于构建标识，不在 UI 展示
        private const string _buildToken = "eXR5MTY=";

        private readonly WebView2 webView = new WebView2 { Dock = DockStyle.Fill };
        private CoreWebView2Environment _env;
        private readonly string _siteHost = "yty16.github.io";
        private readonly string _appWww;
        private readonly string _otaWww;
        private readonly HttpClient _http = new HttpClient();

        public MainForm()
        {
            Text = "元拓域 Toolbox";
            Width = 1280;
            Height = 800;
            MinimumSize = new System.Drawing.Size(400, 600);
            Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);

            Controls.Add(webView);

            // 离线基线：随 exe 分发的 www 目录
            _appWww = Path.Combine(AppContext.BaseDirectory, "www");
            // OTA 覆盖目录：用户数据目录，联网更新后写入
            _otaWww = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "YToolbox", "www");

            Load += async (s, e) => await InitWebView();
        }

        private async Task InitWebView()
        {
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "YToolbox", "WebView2");

            _env = await CoreWebView2Environment.CreateAsync(null, userData);
            await webView.EnsureCoreWebView2Async(_env);

            var settings = webView.CoreWebView2.Settings;
            settings.AreDefaultContextMenusEnabled = false;
            settings.AreDevToolsEnabled = false;
            settings.IsStatusBarEnabled = false;
            settings.UserAgent = settings.UserAgent + " ToolboxWin/2.0";

            // 接收网页发来的应用设置指令
            webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            webView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;

            // 离线内核：拦截本站所有请求，改从本地资源读取
            webView.CoreWebView2.WebResourceRequested += OnResourceRequested;
            webView.CoreWebView2.AddWebResourceRequestedFilter(
                "https://yty16.github.io/*", CoreWebView2WebResourceContext.All);

            // 联网时后台与网站同步（OTA），离线则静默跳过
            _ = SiteUpdater.CheckAndUpdateAsync(_otaWww, _http);

            webView.CoreWebView2.Navigate("https://yty16.github.io/");
        }

        private void OnResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            var uri = new Uri(e.Request.Uri);
            if (uri.Host != _siteHost) return; // 非本站域名（如 pages.dev 下载）走真实网络

            string path = uri.AbsolutePath;
            if (path == "/version.json" || path == "/app-bundle.zip") return; // 版本检测/更新包永远走网络

            // Service Worker 返回空操作，避免 App 内启用 PWA 缓存干扰离线内容
            if (path.EndsWith("/sw.js"))
            {
                var sw = Encoding.UTF8.GetBytes(
                    "/* in-app no-op service worker */\n" +
                    "self.addEventListener('install',function(e){self.skipWaiting();});\n" +
                    "self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());});\n");
                e.Response = _env.CreateWebResourceResponse(
                    new MemoryStream(sw), 200, "OK",
                    "Content-Type: application/javascript; charset=utf-8");
                return;
            }

            string local = MapLocal(path);
            if (local != null && File.Exists(local))
            {
                var mime = GuessMime(local);
                var stream = File.OpenRead(local);
                e.Response = _env.CreateWebResourceResponse(
                    stream, 200, "OK",
                    $"Content-Type: {mime}; charset=utf-8\r\nCache-Control: no-cache");
            }
            // 本地没有该文件：不设置 Response，WebView2 回落真实网络（离线则触发错误页）
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            // 向页面暴露 Windows 应用版本号
            _ = webView.CoreWebView2.ExecuteScriptAsync("window.__toolboxVersion='2.0.0';");
        }

        private async void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            var msg = e.WebMessageAsJson;
            if (msg != null && msg.StartsWith("\"") && msg.EndsWith("\""))
                msg = msg.Substring(1, msg.Length - 2);

            switch (msg)
            {
                case "clearCache":
                    try
                    {
                        await webView.CoreWebView2.Profile.ClearBrowsingDataAsync();
                        await webView.CoreWebView2.ExecuteScriptAsync("showToast('缓存已清理，重启后生效','🧹');");
                    }
                    catch (Exception ex)
                    {
                        await webView.CoreWebView2.ExecuteScriptAsync($"showToast('清理缓存失败: {ex.Message}','⚠️');");
                    }
                    break;

                case "checkUpdate":
                    try
                    {
                        await webView.CoreWebView2.ExecuteScriptAsync("showToast('正在检查更新...','🔄');");
                        await SiteUpdater.CheckAndUpdateAsync(_otaWww, _http);
                        await webView.CoreWebView2.ExecuteScriptAsync("showToast('检查完成，如有更新将在下次启动时生效','✅');");
                    }
                    catch (Exception ex)
                    {
                        await webView.CoreWebView2.ExecuteScriptAsync($"showToast('检查更新失败: {ex.Message}','⚠️');");
                    }
                    break;

                case "exitApp":
                    Invoke(new Action(() => Application.Exit()));
                    break;

                case "getVersion":
                    await webView.CoreWebView2.ExecuteScriptAsync("window.__toolboxVersion='2.0.0';");
                    break;
            }
        }

        private string MapLocal(string path)
        {
            if (string.IsNullOrEmpty(path) || path == "/") path = "/index.html";
            if (path.EndsWith("/")) path += "index.html";
            string rel = path.TrimStart('/').Replace('/', '\\');

            // 1) OTA 覆盖目录优先
            string ota = Path.Combine(_otaWww, rel);
            if (File.Exists(ota)) return ota;
            // 2) 打包基线
            return Path.Combine(_appWww, rel);
        }

        private static string GuessMime(string path)
        {
            var ext = Path.GetExtension(path).ToLowerInvariant();
            return ext switch
            {
                ".html" or ".htm" => "text/html",
                ".js" or ".mjs" => "application/javascript",
                ".css" => "text/css",
                ".json" => "application/json",
                ".xml" => "application/xml",
                ".svg" => "image/svg+xml",
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".gif" => "image/gif",
                ".webp" => "image/webp",
                ".bmp" => "image/bmp",
                ".ico" => "image/x-icon",
                ".woff" => "font/woff",
                ".woff2" => "font/woff2",
                ".ttf" => "font/ttf",
                ".otf" => "font/otf",
                ".mp3" => "audio/mpeg",
                ".wav" => "audio/wav",
                ".ogg" => "audio/ogg",
                ".mp4" => "video/mp4",
                ".webm" => "video/webm",
                ".pdf" => "application/pdf",
                ".txt" => "text/plain",
                ".wasm" => "application/wasm",
                _ => "application/octet-stream"
            };
        }
    }
}
