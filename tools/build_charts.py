#!/usr/bin/env python3
"""Build per-airport chart lists from the FAA d-TPP metafile (approach plates, airport diagrams,
SIDs, STARs, minimums, hot spots).  Writes data/charts/<ICAO>.json and data/charts/index.json.

Usage: build_charts.py [OUT_DIR]   (downloads the current cycle's metafile itself)
"""
import datetime, io, json, os, shutil, sys, urllib.request
import xml.etree.ElementTree as ET

ANCHOR = datetime.date(2026, 1, 22)       # AIRAC 2601
UA = {'User-Agent': 'route-desk-charts (personal flight-sim planner)'}

def cycles_around(today):
    """(cycle id, effective date) for the cycle in force today and the one before it."""
    out, d, k = [], ANCHOR, 0
    while d - datetime.timedelta(days=28) > today: d -= datetime.timedelta(days=28)   # (not needed for dates after 2026)
    eff = ANCHOR
    while eff + datetime.timedelta(days=28) <= today: eff += datetime.timedelta(days=28)
    for e in (eff + datetime.timedelta(days=28), eff, eff - datetime.timedelta(days=28)):
        first = e
        while (first - datetime.timedelta(days=28)).year == e.year: first -= datetime.timedelta(days=28)
        n = (e - first).days // 28 + 1
        out.append((f'{e.year % 100:02d}{n:02d}', e))
    return out

def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return r.read()

def main(out):
    today = datetime.date.today()
    data = cycle = None
    for cid, eff in cycles_around(today):
        if eff > today + datetime.timedelta(days=0):
            continue
        try:
            data = fetch(f'https://aeronav.faa.gov/d-tpp/{cid}/xml_data/d-tpp_Metafile.xml'); cycle = cid; break
        except Exception as e:
            print('skip', cid, e)
    if not data:
        print('no metafile found'); return 1
    root = ET.parse(io.BytesIO(data)).getroot()
    if os.path.isdir(out): shutil.rmtree(out)
    os.makedirs(out)
    index, alias = {}, {}
    for apt in root.iter('airport_name'):
        icao = (apt.get('icao_ident') or '').strip().upper(); ident = (apt.get('apt_ident') or '').strip().upper()
        key = icao or ident
        if not key: continue
        charts = []
        for rec in apt.findall('record'):
            g = lambda t: (rec.findtext(t) or '').strip()
            pdf, code, name = g('pdf_name'), g('chart_code'), g('chart_name')
            if not pdf or pdf.upper().startswith('DELETED') or g('useraction').upper() == 'D': continue
            charts.append([code, name, pdf])
        if not charts: continue
        json.dump({'apt': key, 'ident': ident, 'name': apt.get('ID', ''), 'cycle': cycle, 'charts': charts},
                  open(os.path.join(out, key + '.json'), 'w'), separators=(',', ':'))
        index[key] = len(charts)
        if ident and ident != key: alias[ident] = key
    json.dump({'cycle': cycle, 'base': f'https://aeronav.faa.gov/d-tpp/{cycle}/', 'airports': index, 'alias': alias},
              open(os.path.join(out, 'index.json'), 'w'), separators=(',', ':'))
    print(f'charts cycle {cycle}: {len(index)} airports, {sum(index.values())} charts')
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'charts')))
