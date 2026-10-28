#!/usr/bin/env python3
"""Build data/nav.json (enroute fixes, navaids and airways) from the FAA CIFP (ARINC 424).

Usage: build_nav.py FAACIFP18 OUT_FILE
"""
import json, math, re, sys
from collections import defaultdict
sys.path.insert(0, __import__('os').path.dirname(__file__))
from build_cifp import coord

def dist(a, b):
    f1, f2 = math.radians(a[0]), math.radians(b[0]); dl = math.radians(b[1] - a[1])
    h = math.sin((f2 - f1) / 2) ** 2 + math.cos(f1) * math.cos(f2) * math.sin(dl / 2) ** 2
    return 2 * math.asin(min(1, math.sqrt(h))) * 3440.065

def main(src, out):
    fixes = defaultdict(list)   # ident -> [[lat, lon, kind]]
    keyidx = {}                 # (ident, region, kind-class) -> index in fixes[ident]
    awy = defaultdict(list)     # name -> [(seq, ident, region, sec, level)]
    cycle = ''
    lines = open(src, encoding='latin-1').read().splitlines()
    for l in lines:
        if l.startswith('HDR04'):
            m = re.search(r'VOLUME (\d{4})', l); cycle = m.group(1) if m else ''
        if len(l) < 100 or l[0] != 'S':
            continue
        if l[4] == 'E' and l[5] == 'A':
            k = (l[13:18].strip(), l[19:21], 'E'); kind = 'W'
            c = (coord(l[32:41]), coord(l[41:51]))
        elif l[4] == 'D':
            k = (l[13:17].strip(), l[19:21], 'D'); kind = 'N' if l[5] == 'B' else 'V'
            c = (coord(l[32:41]), coord(l[41:51]))
            if c[0] is None:
                c = (coord(l[55:64]), coord(l[64:74]))
        elif l[4] == 'E' and l[5] == 'R':
            awy[l[13:18].strip()].append((int(l[25:29]), l[29:34].strip(), l[34:36], l[36], l[45]))
            continue
        else:
            continue
        if c[0] is None or k in keyidx:
            continue
        keyidx[k] = len(fixes[k[0]])
        fixes[k[0]].append([round(c[0], 5), round(c[1], 5), kind])
    airways, levels = {}, {}
    for name, recs in awy.items():
        recs.sort()
        segs, cur, prev = [], [], None
        lv = set()
        for seq, ident, region, sec, level in recs:
            i = keyidx.get((ident, region, 'D' if sec == 'D' else 'E'))
            if i is None:
                continue
            p = fixes[ident][i]
            if prev and dist(prev, p) > 400:
                if len(cur) > 1: segs.append(cur)
                cur = []
            cur.append(ident if i == 0 else f'{ident}#{i}'); prev = p; lv.add(level)
        if len(cur) > 1: segs.append(cur)
        if segs:
            airways[name] = segs
            levels[name] = 'H' if lv <= {'H'} else 'L' if lv <= {'L'} else 'B'
    json.dump({'cycle': cycle, 'fixes': fixes, 'airways': airways, 'levels': levels}, open(out, 'w'), separators=(',', ':'))
    print(f'nav cycle {cycle}: {sum(len(v) for v in fixes.values())} fixes, {len(airways)} airways')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
