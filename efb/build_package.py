#!/usr/bin/env python3
"""Assemble the ready-to-use Community folder package (routedesk-efb) and zip it."""
import json, os, shutil, time, zipfile
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'dist', 'routedesk-efb')
shutil.rmtree(os.path.join(HERE, 'dist'), ignore_errors=True)
files = {
    'html_ui/efb_ui/efb_apps/RouteDesk/RouteDesk.js': 'PackageSources/RouteDesk/RouteDesk.js',
    'html_ui/efb_ui/efb_apps/RouteDesk/Assets/app-icon.svg': 'PackageSources/RouteDesk/Assets/app-icon.svg',
    'ContentInfo/routedesk-efb/thumbnail.jpg': 'PackageDefinitions/routedesk-efb/ContentInfo/thumbnail.jpg',
}
version = json.load(open(os.path.join(HERE, 'version.json')))['version']
for dst, src in files.items():
    p = os.path.join(OUT, dst); os.makedirs(os.path.dirname(p), exist_ok=True); shutil.copyfile(os.path.join(HERE, src), p)
manifest = {
    "dependencies": [], "content_type": "MISC", "title": "Route Desk EFB", "manufacturer": "", "creator": "badzepplinflyer",
    "package_version": version, "minimum_game_version": "1.0.0", "builder": "Microsoft Flight Simulator 2024",
    "package_order_hint": "MISC", "release_notes": {"neutral": {"LastUpdate": "", "OlderHistory": ""}}
}
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=2)
# layout.json lists every file except the two manifests, with size and Windows FILETIME
now_ft = int((time.time() + 11644473600) * 10_000_000)
content = []
for root, _, names in os.walk(OUT):
    for n in sorted(names):
        rel = os.path.relpath(os.path.join(root, n), OUT).replace(os.sep, '/')
        if rel in ('manifest.json', 'layout.json'): continue
        content.append({"path": rel, "size": os.path.getsize(os.path.join(root, n)), "date": now_ft})
content.sort(key=lambda x: x['path'])
json.dump({"content": content}, open(os.path.join(OUT, 'layout.json'), 'w'), indent=2)
zp = os.path.join(HERE, 'dist', 'routedesk-efb.zip')
with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, names in os.walk(OUT):
        for n in names:
            full = os.path.join(root, n)
            z.write(full, os.path.relpath(full, os.path.dirname(OUT)))
print('built', zp, os.path.getsize(zp), 'bytes, version', version)
