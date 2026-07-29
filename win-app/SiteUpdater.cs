using System;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace YToolboxWinApp
{
    /// <summary>
    /// OTA 同步：启动后比对站点 version.json，若远端版本更新则下载 app-bundle.zip
    /// 解压到用户数据目录 www，覆盖本地基线，实现“与网站同步更新”。
    /// 离线或无网络时静默跳过，不影响已安装的离线内容。
    /// </summary>
    internal static class SiteUpdater
    {
        private const string VersionUrl = "https://yty16.github.io/version.json";

        public static async Task CheckAndUpdateAsync(string otaWww, HttpClient http)
        {
            try
            {
                var json = await http.GetStringAsync(VersionUrl);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                int remote = root.GetProperty("version").GetInt32();
                string bundleUrl = root.GetProperty("bundleUrl").GetString()
                                   ?? "https://yty16.github.io/app-bundle.zip";

                int local = ReadLocalVersion(otaWww);
                if (remote <= local) return;

                var zipBytes = await http.GetByteArrayAsync(bundleUrl);
                Directory.CreateDirectory(otaWww);
                string zipPath = Path.Combine(otaWww, "app-bundle.zip");
                await File.WriteAllBytesAsync(zipPath, zipBytes);
                ExtractZip(zipPath, otaWww);
                WriteLocalVersion(otaWww, remote);
            }
            catch
            {
                // 离线或网络异常：保持现状
            }
        }

        private static int ReadLocalVersion(string dir)
        {
            var f = Path.Combine(dir, ".version");
            if (!File.Exists(f)) return 0;
            return int.TryParse(File.ReadAllText(f), out int v) ? v : 0;
        }

        private static void WriteLocalVersion(string dir, int v)
        {
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, ".version"), v.ToString());
        }

        private static void ExtractZip(string zip, string dest)
        {
            using var archive = ZipFile.OpenRead(zip);
            foreach (var entry in archive.Entries)
            {
                if (entry.FullName.EndsWith("/")) continue;
                // app-bundle.zip 内文件带 www/ 前缀，去掉后落到 OTA 目录
                string name = entry.FullName;
                if (name.StartsWith("www/", StringComparison.OrdinalIgnoreCase))
                    name = name.Substring(4);
                string outPath = Path.Combine(dest, name.Replace('/', '\\'));
                string outDir = Path.GetDirectoryName(outPath);
                if (outDir != null) Directory.CreateDirectory(outDir);
                // 防 Zip Slip 路径穿越
                if (!Path.GetFullPath(outPath).StartsWith(
                        Path.GetFullPath(dest), StringComparison.OrdinalIgnoreCase))
                    continue;
                entry.ExtractToFile(outPath, true);
            }
        }
    }
}
