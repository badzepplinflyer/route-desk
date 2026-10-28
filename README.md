# Route Desk

Personal flight-plan viewer for MSFS 2024. Import a `.pln`, pick departure and arrival airports, runways and an approach type, and see the route on a terrain chart with a nav log and vertical profile.

Live at https://badzepplinflyer.github.io/route-desk/

Data:
- Airports and runways: [OurAirports](https://ourairports.com/data/) (public domain), with runway geometry from OpenStreetMap where available
- Airport layouts: © OpenStreetMap contributors (via Overpass API)
- Procedures (SIDs, STARs, approaches): FAA CIFP (public domain), refreshed each 28-day cycle by a GitHub Action
- Elevation: AWS Terrain Tiles
- Maps: OpenTopoMap, Esri

Procedures cover US airports only; elsewhere the app offers generic straight-in approaches. Always check the chart for minimums. For flight simulation only.
