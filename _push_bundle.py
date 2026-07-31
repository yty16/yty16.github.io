import os, re, base64, json, subprocess, sys
CRED = open(os.path.expanduser('~/.git-credentials'), encoding='utf-8', errors='ignore').read()
m = re.search(r'https://[^:]+:([^@]+)@', CRED)
TOKEN = m.group(1)
REPO = 'yty16/yty16.github.io'

def api(path, method='GET', data=None, extra_headers=None):
    url = f'https://api.github.com/repos/{REPO}{path}'
    cmd = ['curl', '-s', '-k', '-H', f'Authorization: token {TOKEN}', '-H', 'Accept: application/vnd.github+json']
    if extra_headers:
        for k,v in extra_headers.items(): cmd += ['-H', f'{k}: {v}']
    if data is not None:
        cmd += ['-d', data]
    cmd += ['-X', method, url]
    out = subprocess.check_output(cmd, timeout=120)
    return json.loads(out)

def get_sha(path, ref='main'):
    try:
        r = api(f'/contents/{path}?ref={ref}')
        return r.get('sha')
    except Exception:
        return None

path = 'app-bundle.zip'
sha = get_sha(path)
content = open(path, 'rb').read()
b64 = base64.b64encode(content).decode('ascii')
print('bundle size bytes:', len(content), 'b64 len:', len(b64))
body = json.dumps({'message': 'ota bundle', 'content': b64, 'branch': 'main', **({'sha': sha} if sha else {})})
resp = api(f'/contents/{path}', method='PUT', data=body, extra_headers={'Content-Type': 'application/json'})
print('resp:', resp.get('content',{}).get('sha') or resp)
