# -*- coding: utf-8 -*-
"""
将整条提交历史（从远程 main 当前 HEAD 可达的所有祖先）日期整体 +1 年。
首次提交 2024-07-01 -> 2025-07-01，其余同步 +1 年，间隔保持不变。
内容完全不变，仅日期平移。支持含 merge 的非线性历史（递归重建，父先于子）。
"""
import os
import re
import sys
import json
import time
import subprocess
import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
OWNER = "yty16"
REPO = "yty16.github.io"
BASE = f"https://api.github.com/repos/{OWNER}/{REPO}"


def load_token():
    cred = os.path.join(os.path.expanduser("~"), ".git-credentials")
    with open(cred, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if "github.com" in line:
                m = re.search(r"https://[^:]+:([^@]+)@github\.com", line)
                if m:
                    return m.group(1)
    raise SystemExit("未找到 github token")


TOKEN = load_token()
mapping = {}


def curl(method, url, data=None, retries=6):
    cmd = ["curl", "-sk", "-X", method,
           "-H", "Authorization: token " + TOKEN,
           "-H", "Accept: application/vnd.github+json",
           "-H", "X-GitHub-Api-Version: 2022-11-28",
           "-H", "Content-Type: application/json"]
    if data is not None:
        cmd += ["-d", json.dumps(data, ensure_ascii=False)]
    cmd.append(url)
    for _ in range(retries):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        except Exception as e:
            print("  curl 异常:", e, flush=True)
            time.sleep(3)
            continue
        if out.returncode != 0:
            print("  curl 失败 rc=%d: %s" % (out.returncode, out.stderr[:160]),
                  flush=True)
            time.sleep(3)
            continue
        if out.stderr and "rate limit" in out.stderr.lower():
            print("  速率限制，等待 30s", flush=True)
            time.sleep(30)
            continue
        return out.stdout
    raise SystemExit("curl 重试耗尽: " + url)


def shift_year(iso):
    s = iso
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.datetime.fromisoformat(s)
    try:
        dt2 = dt.replace(year=dt.year + 1)
    except ValueError:
        dt2 = dt.replace(year=dt.year + 1, month=2, day=28)
    return dt2.isoformat()


def rebuild(sha):
    """递归重建：先确保全部 parent 已重建，再重建自身。返回新 sha。"""
    if sha in mapping:
        return mapping[sha]
    c = json.loads(curl("GET", f"{BASE}/git/commits/{sha}"))
    tree = c["tree"]["sha"]
    msg = c["message"]
    a = c["author"]
    cm = c["committer"]
    parents = c.get("parents", [])
    new_parents = [rebuild(p["sha"]) for p in parents]
    body = {
        "message": msg,
        "tree": tree,
        "parents": new_parents,
        "author": {"name": a["name"], "email": a["email"],
                   "date": shift_year(a["date"])},
        "committer": {"name": cm["name"], "email": cm["email"],
                      "date": shift_year(cm["date"])},
    }
    res = json.loads(curl("POST", f"{BASE}/git/commits", body))
    new = res["sha"]
    mapping[sha] = new
    print("  %s -> %s" % (sha[:8], new[:8]), flush=True)
    return new


def main():
    print("[1/3] 获取当前 main HEAD ...", flush=True)
    refs = json.loads(curl("GET", f"{BASE}/git/refs/heads/main"))
    head = refs["object"]["sha"]
    print("      HEAD =", head, flush=True)

    print("[2/3] 递归重建提交（日期 +1 年）...", flush=True)
    new_head = rebuild(head)
    print("      新 HEAD =", new_head, flush=True)
    print("      共重建 %d 个提交" % len(mapping), flush=True)

    print("[3/3] force 更新 main 引用 ...", flush=True)
    curl("PATCH", f"{BASE}/git/refs/heads/main",
         {"sha": new_head, "force": True})
    print("完成。首次提交日期已平移 +1 年，内容不变。", flush=True)


if __name__ == "__main__":
    main()
