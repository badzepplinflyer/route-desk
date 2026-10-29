# Route Desk for the MSFS 2024 tablet (EFB)

A small app for the in-game tablet. Press **Send to tablet** on the Route Desk website, then open
**Route Desk** on the tablet and tap **Load flight plan**. The flight goes into the sim's flight plan
and the aircraft's avionics through the sim's own route API (`FlightPlanRouteManager`).

## Install
1. Download `downloads/routedesk-efb.zip` (or the "Download it" link on the website).
2. Unzip it so the folder `routedesk-efb` sits directly inside your MSFS 2024 **Community** folder.
3. Restart the sim, start a flight, open the tablet and pick **Route Desk**.
4. On the website press **Send to tablet**. The first time, enter the 8-character code shown on the
   tablet and a fine-grained GitHub token (Only select repositories → route-desk, Contents: Read and write).
   Both stay in that browser.

## How flights travel
The website writes the flight to `tablet/<tablet code>.json` on the `tablet` branch of this repository.
The tablet reads it through the GitHub API when the app opens and on **Check now** (GitHub allows 60 of
these per hour without signing in), and from raw.githubusercontent.com every 15 seconds in the background
(no hourly limit, but GitHub can serve a copy up to 5 minutes old). The repository is public, so the
latest flight sent to each tablet code is visible to anyone who looks.

## Works with
Aircraft that use the sim's own (Working Title) avionics: the default airliners and GA.
PMDG, Fenix and FlyByWire run their own FMS and don't read this route.

## Build from source
`python3 build_package.py` assembles `dist/routedesk-efb` (manifest.json + layout.json) and a zip.
Alternatively open `RouteDeskProject.xml` in MSFS Developer Mode and Build All In Project.

Structure follows the MIT-licensed [msfs-efb-iframe](https://github.com/RCCSilva/msfs-efb-iframe) sample.
