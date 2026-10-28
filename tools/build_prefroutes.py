#!/usr/bin/env python3
"""Build data/prefroutes.json from the FAA preferred routes database (prefroutes_db.csv).

Usage: build_prefroutes.py prefroutes_db.csv OUT_FILE
Output: {"o": {ORIG: {DEST: [[type, route, altitude, aircraft, area, hours], ...]}}}
"""
import csv, json, sys
from collections import defaultdict

def main(src, out):
    data = defaultdict(lambda: defaultdict(list))
    n = 0
    with open(src, encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            o, d, route = (r.get('Orig') or '').strip(), (r.get('Dest') or '').strip(), ' '.join((r.get('Route String') or '').split())
            if not o or not d or not route:
                continue
            hours = ' '.join(x for x in (r.get('Hours1'), r.get('Hours2'), r.get('Hours3')) if x and x.strip())
            data[o][d].append([(r.get('Type') or '').strip(), route, (r.get('Altitude') or '').strip(),
                               (r.get('Aircraft') or '').strip(), (r.get('Area') or '').strip(), hours])
            n += 1
    json.dump({'o': data}, open(out, 'w'), separators=(',', ':'))
    print(f'{n} preferred routes, {len(data)} origins')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
