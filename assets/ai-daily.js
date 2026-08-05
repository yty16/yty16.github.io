/* AI Daily card renderer — fetches assets/ai-daily.json and shows zh/en by current language.
 * Hidden attribution (Base64 of "yty16") = eXR5MTY= */
(function () {
  "use strict";
  var _attr = "eXR5MTY=";
  var body = document.getElementById("aiDailyBody");
  var dateEl = document.getElementById("aiDailyDate");
  var noteEl = document.getElementById("aiDailyNote");
  var cached = null;

  function curLang() {
    return (window.i18n && window.i18n.getLang && window.i18n.getLang() === "en") ? "en" : "zh";
  }
  function esc(s) {
    return (s == null ? "" : String(s))
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function render() {
    if (!cached) return;
    var l = curLang();
    var text = (l === "en" ? cached.en : cached.zh) || (l === "en" ? cached.zh : cached.en) || "";
    if (body) {
      var html = (text + "").split(/\n+/).filter(function (x) { return x.trim(); })
        .map(function (line) { return "<p>" + esc(line) + "</p>"; }).join("");
      body.innerHTML = html || "<p>" + (l === "en" ? "No content." : "暂无内容。") + "</p>";
    }
    if (dateEl) dateEl.textContent = cached.date || "";
    if (noteEl) {
      var n = cached.note || "";
      var msg = "";
      if (n === "FALLBACK_AIERR") msg = (l === "en") ? "(Showing yesterday's content; today's generation failed)" : "（展示昨日内容，今日生成失败）";
      else if (n === "FALLBACK_NODATA") msg = (l === "en") ? "(No hot-topic sources available today)" : "（今日数据源暂不可用）";
      noteEl.textContent = msg;
    }
  }
  function load() {
    if (body) body.innerHTML = '<div class="ai-daily-loading">' + (curLang() === "en" ? "Loading…" : "加载中…") + "</div>";
    fetch("assets/ai-daily.json?_=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { cached = d || {}; render(); })
      .catch(function () {
        if (body) body.innerHTML = '<div class="ai-daily-loading">' + (curLang() === "en" ? "Failed to load." : "加载失败。") + "</div>";
      });
  }
  // inject style (reuses existing .section / .section-header classes from the site theme)
  if (!document.getElementById("aiDailyStyle")) {
    var s = document.createElement("style");
    s.id = "aiDailyStyle";
    s.textContent =
      ".ai-daily-section .section-header{position:relative;}" +
      ".ai-daily-date{margin-left:auto;font-size:12px;color:var(--text-muted,#888);opacity:.85;white-space:nowrap;}" +
      ".ai-daily-body{padding:4px 2px 2px;line-height:1.7;font-size:14.5px;}" +
      ".ai-daily-body p{margin:0 0 9px;padding-left:14px;position:relative;}" +
      ".ai-daily-body p::before{content:'';position:absolute;left:0;top:9px;width:6px;height:6px;border-radius:50%;background:var(--accent,#6366f1);}" +
      ".ai-daily-loading{color:var(--text-muted,#888);font-size:14px;padding:6px 2px;}" +
      ".ai-daily-note{margin-top:4px;font-size:12px;color:#e0a458;opacity:.95;}";
    document.head.appendChild(s);
  }
  load();
  window.onI18nChange = function () { render(); };
})();
