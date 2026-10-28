#!/usr/bin/env python3
"""Build per-airport procedure files (SIDs, STARs, approaches) from the FAA CIFP (ARINC 424).

Usage: build_cifp.py FAACIFP18 OUT_DIR
Writes OUT_DIR/<AIRPORT>.json and OUT_DIR/index.json. Source data is public domain (FAA).
"""
import json, os, re, sys, shutil
from collections import defaultdict

def coord(s):
    s = s.strip()
    if len(s) < 9 or s[0] not in 'NSEW':
        return None
    try:
        if s[0] in 'NS':
            v = int(s[1:3]) + int(s[3:5]) / 60 + int(s[5:9]) / 360000
        else:
            v = int(s[1:4]) + int(s[4:6]) / 60 + int(s[6:10]) / 360000
    except ValueError:
        return None
    return round(-v if s[0] in 'SW' else v, 6)

def alt(s):
    s = s.strip()
    if not s:
        return None
    try:
        return int(s[2:]) * 100 if s.startswith('FL') else int(s)
    except ValueError:
        return None

def num(s, scale=1):
    s = s.strip()
    try:
        return round(int(s) / scale, 1) if s else None
    except ValueError:
        return None

APP_TYPES = {'I': 'ILS', 'L': 'LOC', 'B': 'LOC BC', 'R': 'RNAV (GPS)', 'H': 'RNAV (RNP)', 'V': 'VOR', 'D': 'VOR/DME',
             'S': 'VOR', 'N': 'NDB', 'Q': 'NDB/DME', 'X': 'LDA', 'U': 'SDF', 'P': 'GPS', 'G': 'IGS', 'J': 'GLS', 'T': 'TACAN'}
SID_RW, SID_CM, SID_EN = set('014FT'), set('25M'), set('36SV')
STAR_EN, STAR_CM, STAR_RW = set('147F'), set('258M'), set('369S')

def main(src, out):
    enrt, navaid, term, aptref = {}, {}, {}, {}
    runways = defaultdict(dict)
    procs = defaultdict(list)
    cycle = ''
    with open(src, encoding='latin-1') as f:
        for line in f:
            if line.startswith('HDR01'):
                m = re.search(r'(\d{4})\s+\d\d-[A-Z]{3}-\d{4}', line)
                cycle = m.group(1) if m else ''
                continue
            if len(line) < 100 or line[0] != 'S':
                continue
            sec = line[4]
            if sec == 'E' and line[5] == 'A':
                c = (coord(line[32:41]), coord(line[41:51]))
                if c[0] is not None:
                    enrt[(line[13:18].strip(), line[19:21])] = c + ('W', line[19:21], '')
            elif sec == 'D':
                key = (line[13:17].strip(), line[19:21])
                c = (coord(line[32:41]), coord(line[41:51]))
                kind = 'N' if line[5] == 'B' else 'V'
                if c[0] is None:
                    c = (coord(line[55:64]), coord(line[64:74]))
                if c[0] is not None:
                    navaid[key] = c + (kind, line[19:21], '')
            elif sec == 'P':
                apt, sub = line[6:10].strip(), line[12]
                if sub in 'CN':
                    c = (coord(line[32:41]), coord(line[41:51]))
                    if c[0] is not None:
                        term[(apt, line[13:18].strip(), line[19:21])] = c + ('N' if sub == 'N' else 'W', line[19:21], apt)
                elif sub == 'A':
                    c = (coord(line[32:41]), coord(line[41:51]))
                    if c[0] is not None:
                        aptref[apt] = c + ('A', line[10:12], '')
                elif sub == 'G' and line[38] in '01':
                    c = (coord(line[32:41]), coord(line[41:51]))
                    if c[0] is not None:
                        runways[apt][line[13:18].strip()[2:]] = [c[0], c[1], num(line[66:71]), num(line[71:75])]
                elif sub in 'DEF' and line[38] in '01':
                    procs[apt].append(line.rstrip('\n'))

    def lookup(apt, ident, region, s1, s2):
        if not ident:
            return None
        if s1 == 'P' and s2 in 'CN':
            return term.get((apt, ident, region))
        if s1 == 'P' and s2 == 'G':
            r = runways[apt].get(ident[2:])
            return (r[0], r[1], 'R', '', apt) if r else None
        if s1 == 'P' and s2 == 'A':
            return aptref.get(ident)
        if s1 == 'E':
            return enrt.get((ident, region))
        if s1 == 'D':
            return navaid.get((ident, region))
        return term.get((apt, ident, region)) or enrt.get((ident, region)) or navaid.get((ident, region))

    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)
    index = {}
    for apt, lines in procs.items():
        fixes = {}
        groups = defaultdict(list)  # (sub, ident, rtype, trans) -> legs
        order = []
        for l in lines:
            sub, ident, rtype, trans = l[12], l[13:19].strip(), l[19], l[20:25].strip()
            fix, region, s1, s2 = l[29:34].strip(), l[34:36], l[36], l[37]
            if fix and fix not in fixes:
                c = lookup(apt, fix, region, s1, s2)
                if c:
                    fixes[fix] = [c[0], c[1], c[2], c[3].strip(), c[4]]
            desc = l[39:43]
            leg = [fix, l[47:49].strip(), l[82].strip(), alt(l[84:89]), alt(l[89:94]), num(l[99:102]),
                   num(l[70:74], 10), num(l[74:78], 10), desc[3].strip() + ('m' if desc[2] == 'M' else ''), l[43].strip()]
            while leg and leg[-1] in (None, ''):
                leg.pop()
            k = (sub, ident, rtype, trans)
            if k not in groups:
                order.append(k)
            groups[k].append(leg)
        sids, stars, apps = {}, {}, {}
        for k in order:
            sub, ident, rtype, trans = k
            legs = groups[k]
            if sub == 'D':
                if rtype == '0':
                    continue
                p = sids.setdefault(ident, {'id': ident, 'rnav': rtype in '456FMS', 'rw': {}, 'cm': [], 'tr': {}})
                if rtype in SID_RW or trans.startswith('RW'):
                    p['rw'][trans or 'ALL'] = legs
                elif rtype in SID_EN:
                    p['tr'][trans] = legs
                else:
                    p['cm'] = legs
            elif sub == 'E':
                p = stars.setdefault(ident, {'id': ident, 'rnav': rtype in '456FMS', 'tr': {}, 'cm': [], 'rw': {}})
                if rtype in STAR_RW or trans.startswith('RW'):
                    p['rw'][trans or 'ALL'] = legs
                elif rtype in STAR_EN:
                    p['tr'][trans] = legs
                else:
                    p['cm'] = legs
            elif sub == 'F':
                m = re.match(r'^([A-Z])(\d{2}[LRC]?)?-?([A-Z])?', ident)
                t = APP_TYPES.get(ident[0], ident[0])
                rw = (m.group(2) or '') if m else ''
                suf = (m.group(3) or '') if m else ''
                name = f"{t} {suf + ' ' if suf and rw else ''}{rw}".strip() if rw else f"{t}-{suf or ident[1:]}"
                p = apps.setdefault(ident, {'id': ident, 'name': name, 't': t, 'rw': rw, 'tr': {}, 'fin': [], 'ma': []})
                if rtype == 'A':
                    p['tr'][trans] = legs
                else:
                    fin, ma, seen_map = [], [], False
                    for g in legs:
                        role = g[8] if len(g) > 8 else ''
                        if seen_map or 'm' in str(role):
                            seen_map = True
                            ma.append(g)
                        else:
                            fin.append(g)
                        if str(role).startswith('M'):
                            seen_map = True
                    p['fin'], p['ma'] = fin, ma
        data = {'apt': apt, 'cycle': cycle, 'rw': runways.get(apt, {}), 'fx': fixes,
                'sid': list(sids.values()), 'star': list(stars.values()), 'app': list(apps.values())}
        with open(os.path.join(out, apt + '.json'), 'w') as f:
            json.dump(data, f, separators=(',', ':'))
        index[apt] = [len(sids), len(stars), len(apps)]
    with open(os.path.join(out, 'index.json'), 'w') as f:
        json.dump({'cycle': cycle, 'airports': index}, f, separators=(',', ':'))
    print(f'cycle {cycle}: {len(index)} airports')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
