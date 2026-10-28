#!/usr/bin/env python3
"""Download the current FAA CIFP cycle and rebuild data/procs if it changed."""
import datetime, io, json, os, re, subprocess, sys, urllib.request, zipfile

PAGE = 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/download/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'procs')
UA = {'User-Agent': 'route-desk-cifp-updater (personal flight-sim planner)'}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()

def candidates():
    today = datetime.date.today()
    found = []
    try:
        html = get(PAGE).decode('utf-8', 'replace')
        for m in re.finditer(r'href="([^"]*CIFP_(\d{6})\.zip)"', html):
            url, d = m.group(1), m.group(2)
            if url.startswith('/'):
                url = 'https://www.faa.gov' + url
            found.append((datetime.date(2000 + int(d[:2]), int(d[2:4]), int(d[4:])), url))
    except Exception as e:
        print('download page not reachable:', e)
    # fall back to the 28-day schedule (2610 became effective 2026-10-01)
    base = datetime.date(2026, 10, 1)
    k = (today - base).days // 28
    for n in (k, k - 1):
        d = base + datetime.timedelta(days=28 * n)
        found.append((d, f'https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_{d:%y%m%d}.zip'))
    current = [f for f in found if f[0] <= today]
    return sorted(set(current), reverse=True)

def main():
    have = ''
    try:
        have = json.load(open(os.path.join(OUT, 'index.json'))).get('cycle', '')
    except Exception:
        pass
    for eff, url in candidates():
        try:
            data = get(url)
        except Exception as e:
            print('skip', url, e)
            continue
        z = zipfile.ZipFile(io.BytesIO(data))
        name = next(n for n in z.namelist() if n.endswith('FAACIFP18'))
        raw = z.read(name)
        m = re.search(rb'VOLUME (\d{4})', raw[:2000])
        cycle = m.group(1).decode() if m else ''
        print(f'available cycle {cycle} ({eff}), have {have or "none"}')
        if cycle and cycle == have:
            return 0
        path = os.path.join(ROOT, 'FAACIFP18.tmp')
        open(path, 'wb').write(raw)
        subprocess.check_call([sys.executable, os.path.join(ROOT, 'tools', 'build_cifp.py'), path, OUT])
        os.remove(path)
        return 0
    print('no CIFP download found')
    return 1

if __name__ == '__main__':
    sys.exit(main())
