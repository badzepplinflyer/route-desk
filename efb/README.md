# Route Desk for the MSFS 2024 tablet (EFB)

A small app for the in-game tablet. Press **Send to tablet** on the Route Desk website, then open
**Route Desk** on the tablet and tap **Load flight plan**. The flight goes into the sim's flight plan
and the aircraft's avionics through the sim's own route API (`FlightPlanRouteManager`).

## Install
1. Download `downloads/routedesk-efb.zip` (or the "Download it" link on the website).
2. Unzip it so the folder `routedesk-efb` sits directly inside your MSFS 2024 **Community** folder.
3. Restart the sim, start a flight, open the tablet and pick **Route Desk**.
4. On the website press **Send to tablet** and enter the 8-character code shown on the tablet (once).

## How flights travel
The website stores the flight on the Route Desk relay (`relay/worker.js`, a Cloudflare Worker with
Workers KV) under the tablet code. The tablet checks the relay every 5 seconds while the app is open.
Flights are kept for 24 hours. No account is needed to send or receive. Anyone who knows a tablet code
could send a flight to it, so "Make a new tablet code" on the tablet replaces it if needed.

## Works with
Aircraft that use the sim's own (Working Title) avionics: the default airliners and GA.
PMDG, Fenix and FlyByWire run their own FMS and don't read this route.

## Build from source
`python3 build_package.py` assembles `dist/routedesk-efb` (manifest.json + layout.json) and a zip.
Alternatively open `RouteDeskProject.xml` in MSFS Developer Mode and Build All In Project.

Structure follows the MIT-licensed [msfs-efb-iframe](https://github.com/RCCSilva/msfs-efb-iframe) sample.
