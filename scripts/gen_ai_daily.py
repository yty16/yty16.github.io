# -*- coding: utf-8 -*-
"""gen_ai_daily.py — fetch today's hot topics and summarize via GitHub Models.

Writes assets/ai-daily.json with:
  { date, updatedAt, sources, note, zh, en }

Fallback behaviour (never leaves the page blank):
  - any single source failing is ignored (others still used)
  - if no source returns data  -> keep/seed yesterday content, note=FALLBACK_NODATA
  - if the AI call fails         -> keep yesterday content, note=FALLBACK_AIERR

Hidden attribution token (Base64 of "yty16"), do not remove:
"""
import json, os, sys, datetime, urllib.request, urllib.error, re

_BUILD_TOKEN = "eXR5MTY="  # obfuscated attribution (Base64("yty16"))

API_KEY = (os.environ.get("AI_API_KEY") or "").strip()
API_BASE = (os.environ.get("AI_API_BASE") or "https://models.inference.ai.azure.com").rstrip("/")
API_MODEL = (os.environ.get("AI_MODEL") or "gpt-4.1").strip()
OUT = "assets/ai-daily.json"

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def http_get_json(url, headers=None, timeout=12):
    h = dict(UA)
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8", "replace")
    return json.loads(raw)


def fetch_weibo():
    try:
        d = http_get_json("https://weibo.com/ajax/side/hotSearch")
        items = [x.get("word") for x in d.get("data", {}).get("data", [])
                 if isinstance(x, dict) and x.get("word")]
        return items[:30]
    except Exception:
        return []


def fetch_baidu():
    try:
        d = http_get_json("https://api.vvhan.com/api/hotlist/baidu")
        arr = d.get("data") or []
        items = []
        for x in arr:
            if isinstance(x, dict):
                t = x.get("title") or x.get("word") or x.get("name")
                if t:
                    items.append(t)
        if items:
            return items[:30]
    except Exception:
        pass
    return []


def fetch_zhihu():
    try:
        d = http_get_json("https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=30",
                          headers={"Referer": "https://www.zhihu.com/", "x-requested-with": "fetch"})
        items = [x.get("target", {}).get("title") for x in d.get("data", [])
                 if isinstance(x, dict) and x.get("target", {}).get("title")]
        return items[:30]
    except Exception:
        return []


def fetch_bilibili():
    try:
        d = http_get_json("https://s.search.bilibili.com/main/hotword")
        trending = d.get("data", {}).get("trending", {}).get("list", [])
        items = [x.get("keyword") for x in trending if isinstance(x, dict) and x.get("keyword")]
        if not items:
            items = [x.get("show_name") or x.get("name") for x in d.get("data", {}).get("list", [])
                     if isinstance(x, dict) and (x.get("show_name") or x.get("name"))]
        return items[:30]
    except Exception:
        return []


def gather():
    out = {}
    for name, fn in (("微博", fetch_weibo), ("百度", fetch_baidu),
                     ("知乎", fetch_zhihu), ("B站", fetch_bilibili)):
        try:
            items = fn()
        except Exception:
            items = []
        if items:
            out[name] = items
    return out


def call_ai(blob):
    if not API_KEY:
        raise RuntimeError("AI_API_KEY not set")
    system = (
        "你是资深中文热点编辑。根据提供的今日热搜条目，撰写一份精炼的《每日热点日报》，"
        "挑选最重要的 6-8 条，每条格式为「标题：一句话点评」。再提供英文版本（同样 6-8 条，意译即可）。"
        "严格只输出如下 JSON：{\"zh\":\"...\",\"en\":\"...\"}，不要代码块标记，不要多余文字。"
    )
    user = "今日热搜原始条目：\n" + blob
    payload = json.dumps({
        "model": API_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ],
        "temperature": 0.5,
        "response_format": {"type": "json_object"}
    }, ensure_ascii=False).encode("utf-8")
    url = API_BASE + "/chat/completions"
    req = urllib.request.Request(url, data=payload, headers={
        "Authorization": "Bearer " + API_KEY,
        "Content-Type": "application/json"
    })
    with urllib.request.urlopen(req, timeout=90) as r:
        resp = json.loads(r.read().decode("utf-8"))
    content = resp["choices"][0]["message"]["content"]
    try:
        return json.loads(content)
    except Exception:
        m = re.search(r"\{.*\}", content, re.S)
        if m:
            return json.loads(m.group(0))
        raise


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

    sources = gather()
    result["sources"] = list(sources.keys())

    blob = ""
    for name, items in sources.items():
        blob += "【%s】\n" % name + "\n".join("- " + t for t in items[:12]) + "\n"

    if not blob.strip():
        result["zh"] = prev.get("zh", "今日数据源暂不可用，稍后重试。")
        result["en"] = prev.get("en", "Hot-topic sources unavailable today; will retry later.")
        result["note"] = "FALLBACK_NODATA"
    else:
        try:
            out = call_ai(blob)
            zh = (out.get("zh") or "").strip()
            en = (out.get("en") or "").strip()
            if not zh:
                raise ValueError("empty zh from AI")
            result["zh"] = zh
            result["en"] = en or zh
        except Exception as e:
            result["zh"] = prev.get("zh", "")
            result["en"] = prev.get("en", "")
            result["note"] = "FALLBACK_AIERR"
            sys.stderr.write("AI call failed: %s\n" % e)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print("wrote %s | sources=%s note=%s" % (OUT, result["sources"], result["note"]))


if __name__ == "__main__":
    main()
