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
The website posts the flight to the public relay ntfy.sh on the topic `routedesk-<tablet code>`;
the tablet checks that topic every few seconds while the app is open. Messages expire after 12 hours.
Anyone who knows your tablet code could post to it, so keep the code to yourself. "Make a new tablet code"
on the tablet replaces it.

## Works with
Aircraft that use the sim's own (Working Title) avionics: the default airliners and GA.
PMDG, Fenix and FlyByWire run their own FMS and don't read this route.

## Build from source
`python3 build_package.py` assembles `dist/routedesk-efb` (manifest.json + layout.json) and a zip.
Alternatively open `RouteDeskProject.xml` in MSFS Developer Mode and Build All In Project.

Structure follows the MIT-licensed [msfs-efb-iframe](https://github.com/RCCSilva/msfs-efb-iframe) sample.
