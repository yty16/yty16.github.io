# -*- coding: utf-8 -*-
"""gen_ai_daily.py — fetch today's hot topics and summarize via GitHub Models.

Writes assets/ai-daily.json with:
  { date, updatedAt, sources [{name, items:[{title,url}]}], note, zh, en }

Data sources (ordered by reliability on GitHub Actions ubuntu-latest):
  1. GitHub Trending — via GitHub Search API (100% reliable, uses GITHUB_TOKEN)
  2. Hacker News     — HN Algolia API (free, no key, always up globally)
  3. Reddit          — r/worldnews + r/popular (public JSON)
  4-7. Weibo/Zhihu/Baidu/Bilibili — Weibo & Zhihu via viki.moe relay;
       Baidu scraped from top.baidu.com; Bilibili via official hot-search API
       (all reachable from GitHub Actions; CN relays are best-effort).

Fallback behaviour (never leaves the page blank):
  - any single source failing is ignored (others still used)
  - if no source returns data  -> keep/seed yesterday content, note=FALLBACK_NODATA
  - if the AI call fails         -> keep yesterday content, note=FALLBACK_AIERR

Hidden attribution token (Base64 of "yty16"), do not remove:
"""
import json, os, sys, datetime, re, time, random, urllib.request, urllib.error, urllib.parse

_BUILD_TOKEN = "eXR5MTY="  # obfuscated attribution (Base64("yty16"))

API_KEY = (os.environ.get("AI_API_KEY") or "").strip()
# GitHub Models was retired on 2026-07-30; default to a free, no-real-name,
# OpenAI-compatible provider (OpenRouter). Override via AI_API_BASE / AI_MODEL.
API_BASE = (os.environ.get("AI_API_BASE") or "https://openrouter.ai/api/v1").rstrip("/")
API_MODEL = (os.environ.get("AI_MODEL") or "z-ai/glm-5.2:free").strip()
OUT = "assets/ai-daily.json"
# GitHub token: use AI_API_KEY first (user's PAT), fall back to GITHUB_TOKEN
GH_TOKEN = API_KEY or (os.environ.get("GITHUB_TOKEN") or "").strip()

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}


def http_get(url, headers=None, timeout=15):
    """Return (raw_bytes, status_code)."""
    h = dict(UA)
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(), r.status
    except urllib.error.HTTPError as e:
        return e.read(), e.code
    except Exception as e:
        sys.stderr.write("GET %s failed: %s\n" % (url, e))
        return None, -1


def http_get_json(url, headers=None, timeout=15):
    raw, code = http_get(url, headers, timeout)
    if raw is None or code != 200:
        return None
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        return None


def _gh_api(path, timeout=15):
    """Call GitHub REST API with auth token."""
    url = "https://api.github.com" + path
    h = dict(UA)
    if GH_TOKEN:
        h["Authorization"] = "token " + GH_TOKEN
    raw, code = http_get(url, h, timeout)
    if raw is None or code not in (200, 202):
        return None
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        return None


# ── Source 1: GitHub Trending (100% reliable from Actions) ──────────────

def fetch_github_trending():
    """Today's trending repositories via GitHub Search API.

    Tries several time windows because a strict `created:today` query returns
    almost nothing when the workflow runs right after UTC midnight (few repos
    created in the last few minutes). Falls back to recently-pushed popular
    repos, which is a good "trending today" signal.
    """
    try:
        tz8 = datetime.timezone(datetime.timedelta(hours=8))
        now = datetime.datetime.now(tz8)
        today = now.strftime("%Y-%m-%d")
        past = (now - datetime.timedelta(days=2)).strftime("%Y-%m-%d")
        windows = [
            "pushed:>=" + today,
            "created:>=" + today,
            "created:>=" + past,
        ]
        for q in windows:
            d = _gh_api(
                "/search/repositories?q=" + q
                + "&sort=stars&order=desc&per_page=15",
                timeout=20)
            if not d or not d.get("items"):
                continue
            items = []
            for r in d.get("items", [])[:15]:
                t = r.get("full_name") or r.get("name") or ""
                desc = r.get("description") or ""
                title = t + (": " + desc if desc else "")
                html_url = r.get("html_url") or ""
                items.append({"title": title, "url": html_url})
            if len(items) >= 3:
                return items[:15]
        return []
    except Exception as e:
        sys.stderr.write("GitHub trending failed: %s\n" % e)
        return []


# ── Source 2: Hacker News (global, free, no key) ─────────────────────

def fetch_hackernews():
    """Top 30 HN stories via HN Algolia Search API."""
    try:
        d = http_get_json(
            "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30"
            "&attributesToRetrieve=title,url")
        if not d:
            return []
        return [{"title": h.get("title"), "url": (h.get("url") or "").strip()}
                for h in d.get("hits", [])
                if isinstance(h, dict) and h.get("title")][:30]
    except Exception:
        return []


# ── Source 3: Reddit (public JSON) ────────────────────────────────────

def fetch_reddit():
    """Hot posts from r/worldnews + r/popular / r/technology."""
    items = []
    for sub in ("r/worldnews/hot", "r/technology/hot", "r/popular"):
        try:
            d = http_get_json(
                "https://www.reddit.com/%s.json?limit=12" % sub,
                headers={"Accept": "application/json"})
            if not d:
                continue
            for child in d.get("data", {}).get("children", []):
                dd = child.get("data", {}) or {}
                t = (dd.get("title") or "").strip()
                if t:
                    items.append({"title": t, "url": "https://reddit.com" + (dd.get("permalink") or "")})
        except Exception:
            continue
    seen, uniq = set(), []
    for it in items:
        key = it["title"].lower()
        if key not in seen:
            seen.add(key)
            uniq.append(it)
    return uniq[:30]


# ── Source 4-7: Chinese platforms (best-effort via CN relay APIs) ───────

def fetch_weibo():
    """Weibo hot search via viki.moe (China-hosted relay)."""
    try:
        d = http_get_json("https://60s-api.viki.moe/v2/weibo")
        if not d or d.get("code") != 200:
            return []
        items = [{"title": x.get("title"), "url": x.get("link", "")}
                 for x in d.get("data", [])
                 if isinstance(x, dict) and x.get("title")]
        return items[:30]
    except Exception:
        return []


def fetch_zhihu():
    """Zhihu hot list via viki.moe relay."""
    try:
        d = http_get_json("https://60s-api.viki.moe/v2/zhihu")
        if not d or d.get("code") != 200:
            return []
        items = [{"title": x.get("title"), "url": x.get("link", "")}
                 for x in d.get("data", [])
                 if isinstance(x, dict) and x.get("title")]
        return items[:30]
    except Exception:
        return []


def fetch_baidu():
    """Baidu realtime hot list, scraped from the official board page
    (top.baidu.com). The page embeds its data in a <!--s-data:...--> comment.
    This is the official site on a global CDN, so it is reachable from GitHub
    Actions (unlike third-party CN relays that are often blocked there)."""
    try:
        raw, code = http_get("https://top.baidu.com/board?tab=realtime", timeout=15)
        if not raw or code != 200:
            return []
        html = raw.decode("utf-8", "replace")
        m = re.search(r"<!--s-data:(.*?)-->", html, re.S)
        if not m:
            return []
        j = json.loads(m.group(1))
        cards = ((j.get("data") or {}).get("cards") or [])
        items = []
        for card in cards:
            for it in (card.get("content") or []):
                if not isinstance(it, dict):
                    continue
                w = it.get("word") or it.get("query")
                if not w:
                    continue
                url = it.get("url") or it.get("rawUrl") or \
                    ("https://www.baidu.com/s?wd=" + urllib.parse.quote(w))
                items.append({"title": w, "url": url})
        return items[:30]
    except Exception as e:
        sys.stderr.write("Baidu fetch failed: %s\n" % e)
        return []


def fetch_bilibili():
    """Bilibili hot search (热搜) via the official API. Returns trending
    keywords with direct links. Reachable from GitHub Actions (global CDN)."""
    try:
        d = http_get_json(
            "https://api.bilibili.com/x/web-interface/search/square?limit=30",
            timeout=15)
        if not d or d.get("code") != 0:
            return []
        lst = ((d.get("data") or {}).get("trending") or {}).get("list") or []
        items = []
        for it in lst:
            if not isinstance(it, dict):
                continue
            kw = it.get("keyword") or it.get("show_name")
            if not kw:
                continue
            uri = it.get("uri") or ""
            url = uri if uri.startswith("http") else \
                ("https://search.bilibili.com/all?keyword=" + urllib.parse.quote(kw))
            items.append({"title": kw, "url": url})
        return items[:30]
    except Exception as e:
        sys.stderr.write("Bilibili fetch failed: %s\n" % e)
        return []


# ── Gather ─────────────────────────────────────────────────────────────

# Chinese platforms first (what the user wants), then reliable global sources.
# Order also drives the hotlist ranking: top slots fill with Chinese items.
_SOURCE_FNS = [
    ("微博",         fetch_weibo),
    ("知乎",         fetch_zhihu),
    ("百度",         fetch_baidu),
    ("B站",          fetch_bilibili),
    ("GitHub 热门",   fetch_github_trending),
    ("Hacker News",  fetch_hackernews),
    ("Reddit",       fetch_reddit),
]


def gather():
    out = []
    for name, fn in _SOURCE_FNS:
        try:
            items = fn()
        except Exception as e:
            sys.stderr.write("Source [%s] error: %s\n" % (name, e))
            items = []
        cnt = len(items)
        print("  [%s] → %d items" % (name, cnt))
        if items:
            out.append({"name": name, "items": items[:12]})
    return out


# ── AI Summary ─────────────────────────────────────────────────────────

_FREE_CHAIN = (
    "z-ai/glm-5.2:free",
    "minimax/minimax-m2.7:free",
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "minimax/minimax-m3:free",
    "inclusionai/ling-3.0-flash-fin:free",
    "thinkingmachines/inkling-small:free",
    "liquid/lfm-2.5-2.6b:free",
)

_RETRY_STATUS = (408, 409, 425, 429, 500, 502, 503, 504)


def _providers():
    """Ordered (base_url, model, key) tuples to try.

    AI_MODEL accepts a comma-separated model list so a rate-limited upstream
    model falls through to the next one. When the primary endpoint is
    OpenRouter (or OPENROUTER_API_KEY is set), a chain of distinct free
    models from different upstreams is appended as last-resort fallbacks.
    """
    key = API_KEY
    provs = []
    if API_BASE and API_MODEL:
        for m in API_MODEL.split(","):
            m = m.strip()
            if m:
                provs.append((API_BASE, m, key))
    extra = (os.environ.get("AI_PROVIDERS") or "").strip()
    for part in extra.split(","):
        part = part.strip()
        if "::" not in part:
            continue
        b, m = part.split("::", 1)
        if b.strip() and m.strip():
            provs.append((b.strip().rstrip("/"), m.strip(), key))
    or_key = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
    if not or_key and "openrouter.ai" in API_BASE:
        or_key = key
    if or_key:
        for m in _FREE_CHAIN:
            provs.append(("https://openrouter.ai/api/v1", m, or_key))
    seen, out = set(), []
    for p in provs:
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def _chat(base, model, key, body, timeout=75):
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(base + "/chat/completions", data=payload, headers={
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def call_ai(blob):
    if not API_KEY:
        raise RuntimeError("AI_API_KEY not set")
    system = (
        "你是资深中英双语热点编辑。根据提供的今日热搜条目（来自 GitHub、Hacker News、"
        "Reddit、微博、知乎等多个平台），撰写一份精炼的《AI 每日热点日报》。\n\n"
        "要求：\n"
        "1. 从所有条目中挑选最重要的 6-8 条（兼顾科技、社会、娱乐、国际等维度）\n"
        "2. 中文版格式：每条「标题：一句话点评」，语言简洁有力、口语化\n"
        "3. 英文版：同样 6-8 条，意译而非直译，符合英文新闻习惯\n"
        "4. 严格只输出如下 JSON：{\"zh\":\"...\",\"en\":\"...\"}\n"
        "5. 不要代码块标记，不要多余文字"
    )
    user = "今日全球热搜原始条目（来自多个平台）：\n" + blob
    last_err = None
    tried = 0
    for base, model, key in _providers():
        tried += 1
        for attempt in range(3):
            body = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user}
                ],
                "temperature": 0.5,
            }
            if attempt == 0:
                body["response_format"] = {"type": "json_object"}
            try:
                resp = _chat(base, model, key, body)
            except urllib.error.HTTPError as e:
                err_body = ""
                try:
                    err_body = e.read().decode("utf-8", "replace")
                except Exception:
                    pass
                last_err = "HTTP %d @ %s [%s]: %s" % (e.code, base, model, err_body[:160])
                sys.stderr.write("AI model %s failed: %s\n" % (model, last_err))
                if e.code in (401, 403) or attempt >= 2:
                    break
                time.sleep(4 * (attempt + 1) + random.random() * 3)
                continue
            except Exception as e:
                last_err = "%s @ %s [%s]: %s" % (type(e).__name__, base, model, e)
                sys.stderr.write("AI model %s error: %s\n" % (model, last_err))
                if attempt >= 2:
                    break
                time.sleep(3 + random.random() * 2)
                continue
            content = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
            if not content.strip():
                last_err = "empty content @ %s [%s]" % (base, model)
                sys.stderr.write("AI model %s returned empty content\n" % model)
                if attempt >= 2:
                    break
                time.sleep(3)
                continue
            try:
                return json.loads(content)
            except Exception:
                m = re.search(r"\{.*\}", content, re.S)
                if m:
                    try:
                        return json.loads(m.group(0))
                    except Exception:
                        pass
                last_err = "bad JSON @ %s [%s]: %s" % (base, model, content[:120])
                sys.stderr.write("AI model %s returned non-JSON\n" % model)
                if attempt >= 2:
                    break
                time.sleep(2)
    raise RuntimeError("all %d AI providers failed; last: %s" % (tried, last_err))


# ── Fallback digest (used when the AI call fails but hot-list data exists) ─

def build_fallback_digest(sources, lang):
    """Compile a plain (non-AI) "today's highlights" list from hot-list data,
    plus an honest note telling the user how to enable the AI summary."""
    if lang == "zh":
        note = ("⚠️ AI 智能总结暂不可用：GitHub Models 已于 2026-07-30 正式退役"
                "（原接口返回 404/410），本仓库已改用 OpenAI 兼容的免费服务。"
                "请在仓库 Settings → Secrets 添加 AI_API_KEY"
                "（OpenRouter / Groq 等免实名服务的 API Key）即可恢复 AI 总结。"
                "热点榜数据正常。")
        label = "今日要点（自动汇编，非 AI）："
    else:
        note = ("⚠️ AI summary unavailable: GitHub Models was retired on 2026-07-30 "
                "(endpoint now returns 404/410). This repo now uses a free "
                "OpenAI-compatible provider. Add an AI_API_KEY secret (OpenRouter / "
                "Groq API key, no real-name required) to restore the AI summary. "
                "Hot-list data is fine.")
        label = "Today's highlights (auto-compiled, not AI):"
    picked, seen = [], set()
    for src in sources:
        for it in src.get("items", [])[:3]:
            t = (it.get("title") or "").strip()
            if t and t not in seen:
                seen.add(t)
                picked.append(t)
            if len(picked) >= 8:
                break
        if len(picked) >= 8:
            break
    lines = [note, "", label]
    lines += ["• " + t for t in picked]
    return "\n".join(lines)


# ── Main ───────────────────────────────────────────────────────────────

def main():
    tz8 = datetime.timezone(datetime.timedelta(hours=8))
    today = datetime.datetime.now(tz8)
    date_str = today.strftime("%Y-%m-%d")
    result = {
        "date": date_str,
        "updatedAt": today.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
        "sources": [],
        "note": "",
        "zh": "",
        "en": ""
    }
    prev = {}
    if os.path.exists(OUT):
        try:
            prev = json.load(open(OUT, encoding="utf-8"))
        except Exception:
            prev = {}

    print("=== AI Daily Report Generator ===")
    print("API model: %s" % API_MODEL)
    print("has API_KEY: %s" % bool(API_KEY))
    print("AI providers configured: %d" % len(_providers()))

    sources = gather()
    result["sources"] = [{"name": s["name"], "items": s["items"]} for s in sources]

    blob = ""
    for src in sources:
        blob += "【%s】\n" % src["name"]
        for it in src["items"]:
            if isinstance(it, dict):
                t, u = it.get("title", ""), it.get("url", "")
                blob += "- " + t + ("  → " + u if u else "") + "\n"
            else:
                blob += "- " + str(it) + "\n"

    if not blob.strip():
        result["zh"] = prev.get("zh", "今日数据源暂不可用，稍后重试。")
        result["en"] = prev.get("en", "Hot-topic sources unavailable today; will retry later.")
        result["note"] = "FALLBACK_NODATA"
        print("WARNING: all sources empty → FALLBACK_NODATA")
    else:
        try:
            out = call_ai(blob)
            zh = (out.get("zh") or "").strip()
            en = (out.get("en") or "").strip()
            if not zh:
                raise ValueError("empty zh from AI")
            result["zh"] = zh
            result["en"] = en or zh
            print("AI summary OK (zh=%d chars, en=%d chars)" % (len(zh), len(en)))
        except Exception as e:
            # Don't fall back to a possibly-stale/placeholder previous summary.
            # Instead compile a real digest from today's hot-list so the left
            # panel is never empty or misleading.
            result["zh"] = build_fallback_digest(sources, "zh")
            result["en"] = build_fallback_digest(sources, "en")
            result["note"] = "FALLBACK_AIERR"
            sys.stderr.write("AI call failed: %s\n" % e)
            print("ERROR: AI call failed → FALLBACK_AIERR (digest compiled from hot-list)")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    names = [s["name"] for s in sources]
    print("wrote %s | sources=%s note=%s" % (OUT, names, result["note"]))

    # Save dated copy for history browsing
    hist_dir = "assets/ai-daily-history"
    os.makedirs(hist_dir, exist_ok=True)
    date_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    hist_path = os.path.join(hist_dir, "%s.json" % date_str)
    with open(hist_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print("wrote %s (history)" % hist_path)


if __name__ == "__main__":
    main()
