/* i18n engine — Chinese/English bilingual switcher
 * Usage: include assets/i18n-dict.js then assets/i18n.js before </body>.
 * - Reads localStorage 'lang' (remembered choice); first visit auto-detects via navigator.language.
 * - Translates static text nodes + attributes (placeholder/title/alt/aria-label/value/label).
 * - MutationObserver re-translates dynamically rendered content (SITE_DATA, loot results, etc.).
 * - Injects a language toggle button (into #langToggleHost if present, else a floating button).
 * - Opt out of a subtree with data-no-i18n.
 */
(function () {
  "use strict";
  // 构建令牌（混淆署名，Base64("yty16")，源码不可见明文）
  var _i18nToken = "eXR5MTY=";

  var DICT = (window.I18N_DICT && typeof window.I18N_DICT === "object") ? window.I18N_DICT : {};
  var STORAGE_KEY = "lang";
  var ATTRS = ["placeholder", "title", "alt", "aria-label", "value", "label"];

  // ---- language detection ----
  function getLang() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "zh") return saved;
    } catch (e) {}
    var nav = (navigator.language || navigator.userLanguage || "zh").toLowerCase();
    return nav.indexOf("zh") === 0 ? "zh" : "en";
  }

  var lang = getLang();

  // ---- capture original text/attributes so we can switch back & forth ----
  var textOrig = new WeakMap();
  var attrOrig = new WeakMap(); // el -> {attr: originalValue}

  function isNoTranslate(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute && el.hasAttribute("data-no-i18n")) return true;
    if (el.closest) return !!el.closest("[data-no-i18n]");
    return false;
  }

  function translateValue(orig) {
    if (lang !== "en") return orig;
    var key = orig.trim();
    if (key.length && DICT[key]) {
      var pre = orig.slice(0, orig.indexOf(key));
      var post = orig.slice(orig.lastIndexOf(key) + key.length);
      return pre + DICT[key] + post;
    }
    return orig;
  }

  function applyTextNode(node) {
    if (node.nodeType !== 3) return; // text node only
    if (!node.nodeValue || !node.nodeValue.trim()) return;
    var parent = node.parentNode;
    if (!parent || isNoTranslate(parent)) return;
    if (parent.nodeType === 1) {
      var tag = parent.tagName;
      // skip script/style content
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "INPUT") return;
    }
    if (!textOrig.has(node)) textOrig.set(node, node.nodeValue);
    node.nodeValue = translateValue(textOrig.get(node));
  }

  function applyAttr(el) {
    if (isNoTranslate(el)) return;
    ATTRS.forEach(function (attr) {
      if (!el.hasAttribute(attr)) return;
      var cur = el.getAttribute(attr);
      if (cur == null) return;
      var store = attrOrig.get(el);
      if (!store) { store = {}; attrOrig.set(el, store); }
      if (!(attr in store)) store[attr] = cur;
      var orig = store[attr];
      var translated = translateValue(orig);
      if (translated !== cur) el.setAttribute(attr, translated);
    });
  }

  function walk(root, cb) {
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var batch = [];
    var n;
    while ((n = walker.nextNode())) batch.push(n);
    batch.forEach(cb);
  }

  function applyAll(root) {
    root = root || document.documentElement;
    walk(root, applyTextNode);
    // attributes
    var all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    Array.prototype.forEach.call(all, applyAttr);
  }

  function setHtmlLang() {
    try { document.documentElement.setAttribute("lang", lang === "en" ? "en" : "zh-CN"); } catch (e) {}
  }

  // ---- toggle button ----
  var btn = null;
  function renderButtonLabel() {
    if (!btn) return;
    // show the language the user would switch TO
    btn.textContent = lang === "zh" ? "EN" : "中";
    btn.title = lang === "zh" ? "Switch to English" : "切换到中文";
    btn.setAttribute("aria-label", btn.title);
  }

  function injectButton() {
    var host = document.getElementById("langToggleHost");
    btn = document.createElement("button");
    btn.id = "i18nLangBtn";
    btn.type = "button";
    btn.className = "i18n-lang-btn";
    renderButtonLabel();
    btn.addEventListener("click", function () {
      setLang(lang === "zh" ? "en" : "zh");
    });
    if (host) {
      host.appendChild(btn);
    } else {
      // floating fallback
      btn.classList.add("i18n-floating");
      document.body.appendChild(btn);
    }
  }

  function injectStyle() {
    if (document.getElementById("i18nStyle")) return;
    var s = document.createElement("style");
    s.id = "i18nStyle";
    s.textContent =
      ".i18n-lang-btn{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:34px;padding:0 10px;" +
      "border-radius:9px;border:1px solid var(--border,rgba(128,128,128,.35));background:var(--surface,rgba(255,255,255,.08));" +
      "color:var(--text,#111);font-size:13px;font-weight:700;cursor:pointer;user-select:none;line-height:1;letter-spacing:.3px;}" +
      ".i18n-lang-btn:hover{border-color:var(--accent,#6366f1);color:var(--accent,#6366f1);}" +
      ".i18n-floating{position:fixed;top:12px;right:12px;z-index:2147483000;box-shadow:0 4px 16px rgba(0,0,0,.18);}";
    document.head.appendChild(s);
  }

  // ---- public API ----
  function setLang(next) {
    if (next !== "en" && next !== "zh") return;
    lang = next;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    setHtmlLang();
    applyAll(document.documentElement);
    renderButtonLabel();
    if (typeof window.onI18nChange === "function") {
      try { window.onI18nChange(lang); } catch (e) {}
    }
  }

  window.i18n = {
    setLang: setLang,
    getLang: function () { return lang; },
    t: function (zh) { return (lang === "en" && DICT[zh]) ? DICT[zh] : zh; },
    isNoTranslate: isNoTranslate
  };

  // ---- init ----
  function init() {
    injectStyle();
    setHtmlLang();
    injectButton();
    applyAll(document.documentElement);

    // re-translate dynamically added content (e.g., sections rendered by SITE_DATA, loot results)
    if (window.MutationObserver) {
      var mo = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type === "childList") {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var node = m.addedNodes[j];
              if (node.nodeType === 1) {
                walk(node, applyTextNode);
                var kids = node.querySelectorAll ? node.querySelectorAll("*") : [];
                Array.prototype.forEach.call(kids, applyAttr);
                applyAttr(node);
              } else if (node.nodeType === 3) {
                applyTextNode(node);
              }
            }
          }
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }

    // also re-apply shortly after load in case of late async renders
    setTimeout(function () { applyAll(document.documentElement); }, 300);
    setTimeout(function () { applyAll(document.documentElement); }, 1200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
