/*
 * i18n.js — path/param based bilingual engine for yty16.github.io
 * Language is determined by the URL, not by an in-page toggle:
 *   /en , /en/ , ?__lang=en , ?lang=en  -> English
 *   /zh , /zh/ , ?__lang=zh             -> Chinese
 *   anything else (incl. /)             -> Chinese (default)
 * The language switch control navigates to the corresponding site URL.
 */
(function () {
  "use strict";

  var dict = (window.I18N_DICT && typeof window.I18N_DICT === "object") ? window.I18N_DICT : {};
  var ATTRS = ["placeholder", "title", "alt", "aria-label", "value", "label"];

  function getLang() {
    var path = window.location.pathname || "";
    var search = window.location.search || "";
    if (/(?:[?&])(?:__lang|lang)=en/.test(search) || path.indexOf("/en") === 0) return "en";
    if (path.indexOf("/zh") === 0) return "zh";
    return "zh";
  }
  var lang = getLang();

  function fill(str, vars) {
    if (!vars || typeof str !== "string") return str;
    for (var k in vars) {
      if (!Object.prototype.hasOwnProperty.call(vars, k)) continue;
      var val = vars[k];
      if (val === undefined || val === null) continue;
      str = str.split("{" + k + "}").join(String(val));
    }
    return str;
  }

  // Public translate: given a key (or raw text) return its translation.
  function t(key, vars) {
    if (lang !== "en") return fill(key, vars);
    var v = (typeof dict[key] === "string") ? dict[key] : key;
    return fill(v, vars);
  }

  // Translate a raw text-node value, preserving surrounding whitespace.
  function translateText(value) {
    if (lang !== "en") return value;
    var n = value.trim();
    if (n && dict[n]) {
      var a = value.slice(0, value.indexOf(n));
      var b = value.slice(value.lastIndexOf(n) + n.length);
      return a + dict[n] + b;
    }
    return value;
  }

  function skip(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.hasAttribute && node.hasAttribute("data-no-i18n")) return true;
    if (node.closest && node.closest("[data-no-i18n]")) return true;
    return false;
  }

  function translateAttributes(node) {
    ATTRS.forEach(function (attr) {
      if (!node.hasAttribute(attr)) return;
      var cur = node.getAttribute(attr);
      if (cur === null) return;
      var key = cur.trim();
      if (lang === "en" && dict[key]) {
        node.setAttribute(attr, dict[key]);
      }
    });
  }

  function translateDataI18n(node) {
    if (skip(node)) return;
    var key = node.getAttribute("data-i18n");
    if (key && dict[key]) {
      node.textContent = dict[key];
      return;
    }
    var tpl = node.getAttribute("data-i18n-template");
    if (tpl && dict[tpl]) {
      var out = dict[tpl];
      var varsAttr = node.getAttribute("data-i18n-vars");
      if (varsAttr) {
        try {
          var vars = JSON.parse(varsAttr);
          out = fill(out, vars);
        } catch (e) { /* ignore bad json */ }
      }
      node.textContent = out;
    }
  }

  function walk(root) {
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    var n;
    while ((n = walker.nextNode())) textNodes.push(n);
    textNodes.forEach(function (tn) {
      var parent = tn.parentNode;
      if (!parent || parent.nodeType !== 1) return;
      if (skip(parent)) return;
      var tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "INPUT") return;
      tn.nodeValue = translateText(tn.nodeValue);
    });
    var all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    Array.prototype.forEach.call(all, function (el) {
      if (skip(el)) return;
      translateAttributes(el);
      translateDataI18n(el);
    });
  }

  function translate(root) {
    walk(root || document.documentElement);
  }

  // Render the language switch control inside #langToggleHost.
  // It navigates to the other language's site URL (no in-page toggle).
  function renderToggle() {
    var host = document.getElementById("langToggleHost");
    if (!host) return;
    var en = (lang === "en");
    host.innerHTML = "";
    var a = document.createElement("a");
    a.className = "lang-switch";
    a.href = en ? "/zh/" : "/en/";
    a.textContent = en ? "中文" : "EN";
    a.setAttribute("data-no-i18n", "");
    host.appendChild(a);
  }

  function applyDocumentLang() {
    try {
      document.documentElement.setAttribute("lang", lang === "en" ? "en" : "zh-CN");
    } catch (e) { /* ignore */ }
  }

  // After a language stub redirect (?__lang=en -> /en/), rewrite the URL
  // so the address bar shows the clean path.
  function cleanupUrl() {
    try {
      var s = window.location.search || "";
      var m = s.match(/(?:[?&])(?:__lang|lang)=(en|zh)/);
      if (m) {
        var target = m[1] === "en" ? "/en/" : "/zh/";
        history.replaceState({}, "", target);
      }
    } catch (e) { /* ignore */ }
  }

  function init() {
    applyDocumentLang();
    translate(document);
    renderToggle();
    cleanupUrl();
  }

  // Expose API + keep onI18nChange hook for dynamic re-renders (no recursion).
  window.i18n = {
    t: t,
    translate: translate,
    getLang: getLang
  };
  window.onI18nChange = function () {
    translate(document);
    renderToggle();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
