#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""上传游戏文件到站点仓库，并自动解锁下载页 / Scratch 页上的对应卡片。

用法：
    python scripts/upload_games.py 小猫回家路.sb3 赛车.sb3
    python scripts/upload_games.py 大鱼吃小鱼.zip --as download/大鱼吃小鱼.zip
    python scripts/upload_games.py *.sb3 --dry-run      # 只校验不上传

路由规则：
    *.sb3            -> download/scratch/<ascii 名>.sb3（中文名查 SB3_MAP，否则自动转 ASCII）
    其它             -> download/<原文件名>；原名非 ASCII 时必须用 --as 指定路径

上传后会同步改两处文案：
    download/scratch-games.html 的 GAMES 项：ok false->true，并填 size
    assets/app.js 的 SITE_DATA：命中文件且处于 disabled 的按钮自动解锁
"""
import argparse
import base64
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

_attr = "eXR5MTY="  # 隐藏署名，勿删

REPO = "yty16/yty16.github.io"
BRANCH = "main"
API = "https://api.github.com"
TIMEOUT = 120

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SB3_MAP = {
    "小猫回家路": "cat-home",
    "植物大战僵尸": "pvz",
    "字母闯天关": "abc-adventure",
    "超级马里奥3": "mario3",
    "超级马里奥 3": "mario3",
    "方块闯天关": "block-quest",
    "华容道": "huarongdao",
    "切水果": "fruit-ninja",
    "赛车": "racing",
    "2D我的世界": "2d-minecraft",
    "2D 我的世界": "2d-minecraft",
}

# SITE_DATA 里被标记为「异常/待修复」的按钮，重新上传同名文件后恢复成正常样式
REPAIR_MAP = {
    "download/大鱼吃小鱼.zip": ("压缩包异常，待修复", "经典休闲", "warn", "download"),
}


def human_size(n):
    if n >= 1024 * 1024:
        return "%.1f MB" % (n / 1024.0 / 1024.0)
    if n >= 1024:
        return "%.0f KB" % (n / 1024.0)
    return "%d B" % n


def slugify(name):
    s, out = name, []
    for ch in s:
        if ch.isascii() and (ch.isalnum() or ch in "-_"):
            out.append(ch)
    return "".join(out) or "game"


def get_token():
    cred = os.path.expanduser("~/.git-credentials")
    if os.path.exists(cred):
        with io.open(cred, encoding="utf-8", errors="ignore") as f:
            for line in f:
                m = re.search(r"https://[^:]+:([^@\s]+)@github\.com", line)
                if m:
                    return m.group(1).strip()
    env = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if env:
        return env
    sys.exit("找不到 GitHub token：请检查 ~/.git-credentials 或设置 GITHUB_TOKEN")


def api(path, token, method="GET", payload=None, raw=False):
    url = API + path
    data = None
    headers = {
        "Authorization": "token " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "upload-games-script",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        body = e.read()
        sys.exit("API %s %s 失败 %s：%s" % (method, path, e.code, body[:400].decode("utf-8", "ignore")))
    except Exception as e:
        sys.exit("API %s %s 异常：%s" % (method, path, e))
    if raw:
        return body
    return json.loads(body.decode("utf-8")) if body else {}


def validate(path):
    """返回 (ok, 说明)。空文件与「空壳压缩包」一律拒绝。"""
    if not os.path.isfile(path):
        return False, "文件不存在"
    size = os.path.getsize(path)
    if size == 0:
        return False, "0 字节空文件"
    if zipfile.is_zipfile(path):
        try:
            z = zipfile.ZipFile(path)
            total = sum(i.file_size for i in z.infolist())
            files = [i for i in z.infolist() if not i.is_dir()]
            if not files:
                return False, "压缩包内没有文件"
            if total == 0:
                return False, "空壳压缩包（%d 个条目内容全为 0 字节）" % len(files)
            if path.lower().endswith(".sb3"):
                names = set(i.filename for i in files)
                if "project.json" not in names:
                    return False, "不是有效的 .sb3（缺少 project.json）"
        except Exception as e:
            return False, "压缩包无法解析：%s" % e
    elif path.lower().endswith(".sb3"):
        return False, "不是有效的 .sb3（非 zip 格式）"
    return True, "%s，%d 个条目" % (human_size(size), len(zipfile.ZipFile(path).infolist())) if zipfile.is_zipfile(path) else human_size(size)


def target_for(path, as_arg):
    if as_arg:
        return as_arg.replace("\\", "/").lstrip("/")
    base = os.path.basename(path)
    stem, ext = os.path.splitext(base)
    if ext.lower() == ".sb3":
        key = stem.strip()
        slug = SB3_MAP.get(key) or SB3_MAP.get(key.replace(" ", "")) or slugify(stem)
        return "download/scratch/%s.sb3" % slug
    if base.isascii():
        return "download/" + base
    sys.exit("文件名含非 ASCII 字符（%s），请用 --as download/<英文名>%s 指定" % (base, ext))


def count_ready(html):
    return len(re.findall(r"ok:\s*true", html))


def patch_scratch_entry(js, ready):
    """首页「Scratch 游戏合集」卡片的副标题跟随实际上线数量。"""
    if ready >= 9:
        line2 = "全部 9 款已上线"
    elif ready > 0:
        line2 = "部分已上线，点击进入"
    else:
        return None
    pat = re.compile(r'(\{"link":"download/scratch-games\.html","line1":"Scratch 游戏合集","line2":")[^"]*(")')
    m = pat.search(js)
    if not m or m.group(0).count(line2):
        return None
    new = m.group(1) + line2 + m.group(2)
    print("  ✓ 首页 Scratch 卡片副标题 -> %s" % line2)
    return js[:m.start()] + new + js[m.end():]


def patch_scratch_page(targets):
    """把已上传的 sb3 在 GAMES 里置为 ok 并填体积。返回新内容或 None。"""
    p = os.path.join(ROOT, "download", "scratch-games.html")
    if not os.path.exists(p):
        return None
    s = io.open(p, encoding="utf-8").read()
    changed = False
    for rel, size in targets.items():
        if not rel.startswith("download/scratch/"):
            continue
        page_rel = rel[len("download/"):]  # scratch/xxx.sb3
        m = re.search(r'\{[^{}]*file:\s*"' + re.escape(page_rel) + r'"[^{}]*\}', s)
        if not m:
            print("  ! GAMES 里找不到 %s" % page_rel)
            continue
        item = m.group(0)
        new = re.sub(r"ok:\s*false", "ok: true", item)
        new = re.sub(r'size:\s*"[^"]*"', 'size: "%s"' % human_size(size), new)
        if new != item:
            s = s[:m.start()] + new + s[m.end():]
            changed = True
            print("  ✓ Scratch 页解锁 %s（%s）" % (page_rel, human_size(size)))
    return s if changed else None


def patch_site_data(targets):
    """解锁 SITE_DATA 中指向这些文件的按钮。返回新内容或 None。"""
    p = os.path.join(ROOT, "assets", "app.js")
    if not os.path.exists(p):
        return None
    s = io.open(p, encoding="utf-8").read()
    changed = False
    for rel in targets:
        # 先修「异常/待修复」文案
        if rel in REPAIR_MAP:
            old_line2, new_line2, old_badge, new_badge = REPAIR_MAP[rel]
            old = '{"link":"%s","line1":"%s","line2":"%s","badge":"%s","disabled":!0}' % (
                rel, os.path.basename(os.path.splitext(rel)[0]), old_line2, old_badge)
            # line1 未必等于文件名，用正则更稳
            pat = re.compile(r'\{"link":"' + re.escape(rel) + r'","line1":"[^"]*","line2":"'
                             + re.escape(old_line2) + r'","badge":"' + old_badge + r'","disabled":!0\}')
            m = pat.search(s)
            if m:
                new = m.group(0).replace('"line2":"%s"' % old_line2, '"line2":"%s"' % new_line2)
                new = new.replace('"badge":"%s"' % old_badge, '"badge":"%s"' % new_badge)
                new = new.replace(',"disabled":!0', '')
                s = s[:m.start()] + new + s[m.end():]
                changed = True
                print("  ✓ SITE_DATA 恢复 %s" % rel)
                continue
        # 通用：去掉该链接上的 disabled 标记
        pat = re.compile(r'\{"link":"' + re.escape(rel) + r'"[^{}]*\}')
        m = pat.search(s)
        if m and '"disabled":!0' in m.group(0):
            new = m.group(0).replace(',"disabled":!0', '').replace('"disabled":!0,', '')
            s = s[:m.start()] + new + s[m.end():]
            changed = True
            print("  ✓ SITE_DATA 解锁 %s" % rel)
    return s if changed else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", help="待上传的游戏文件")
    ap.add_argument("--as", dest="as_arg", help="指定仓库内目标路径（仅单个文件时有效）")
    ap.add_argument("--dry-run", action="store_true", help="只校验不上传")
    ap.add_argument("--message", dest="message", default="", help="commit message")
    args = ap.parse_args()

    if args.as_arg and len(args.files) != 1:
        sys.exit("--as 只能配合单个文件使用")

    print("校验文件：")
    plan = {}
    for f in args.files:
        ok, why = validate(f)
        print("  %s %s（%s）" % ("✓" if ok else "✗", os.path.basename(f), why))
        if not ok:
            sys.exit(1)
        rel = target_for(f, args.as_arg)
        print("       -> %s" % rel)
        plan[rel] = f
    if args.dry_run:
        print("\n--dry-run：校验通过，未上传。")
        return

    token = get_token()
    tip = api("/repos/%s/commits/%s" % (REPO, BRANCH), token)
    base_tree = tip["commit"]["tree"]["sha"]
    parent = tip["sha"]
    print("\n远程 tip %s，base_tree %s" % (parent[:10], base_tree[:10]))

    tree = []
    for rel, local in plan.items():
        with open(local, "rb") as fh:
            blob = api("/repos/%s/git/blobs" % REPO, token, "POST",
                       {"content": base64.b64encode(fh.read()).decode("ascii"), "encoding": "base64"})
        tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print("  ↑ blob %s（%s）" % (rel, human_size(os.path.getsize(local))))

    extra = {}
    html_path = os.path.join(ROOT, "download", "scratch-games.html")
    new_html = patch_scratch_page({k: os.path.getsize(v) for k, v in plan.items()})
    if new_html:
        extra["download/scratch-games.html"] = new_html
    ready = count_ready(new_html or (io.open(html_path, encoding="utf-8").read()
                                     if os.path.exists(html_path) else ""))

    new_js = patch_site_data(plan)
    if new_js is None and os.path.exists(os.path.join(ROOT, "assets", "app.js")):
        new_js = io.open(os.path.join(ROOT, "assets", "app.js"), encoding="utf-8").read()
    if new_js:
        patched = patch_scratch_entry(new_js, ready)
        if patched and patched != new_js:
            new_js = patched
        if new_js != (io.open(os.path.join(ROOT, "assets", "app.js"), encoding="utf-8").read()
                      if os.path.exists(os.path.join(ROOT, "assets", "app.js")) else None):
            extra["assets/app.js"] = new_js

    for rel, content in extra.items():
        blob = api("/repos/%s/git/blobs" % REPO, token, "POST",
                   {"content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
                    "encoding": "base64"})
        tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print("  ↑ 更新 %s" % rel)

    new_tree = api("/repos/%s/git/trees" % REPO, token, "POST",
                   {"base_tree": base_tree, "tree": tree})
    ts = time.strftime("%Y-%m-%dT%H:%M:%S+08:00")
    who = {"name": "yty16", "email": "3069505332@qq.com", "date": ts}
    msg = args.message or ("games: upload %s" % ", ".join(os.path.basename(v) for v in plan.values()))
    commit = api("/repos/%s/git/commits" % REPO, token, "POST",
                 {"message": msg, "tree": new_tree["sha"], "parents": [parent],
                  "author": who, "committer": who})
    api("/repos/%s/git/refs/heads/%s" % (REPO, BRANCH), token, "PATCH", {"sha": commit["sha"]})
    print("\n已推送 commit %s：%s" % (commit["sha"][:10], msg))

    listing = api("/repos/%s/contents/download?ref=%s" % (REPO, BRANCH), token)
    print("复核 download/ 共 %d 项：" % len(listing))
    for i in listing:
        print("   %10d  %s" % (i["size"], i["name"]))


if __name__ == "__main__":
    main()
