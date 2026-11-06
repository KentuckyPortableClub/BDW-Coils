# KY GIS Workbench (unlisted)

**URL once pushed:** https://kentuckyportableclub.github.io/BDW-Coils/tools/ky-maprep-gis.html
Deep link to a park: `…/ky-maprep-gis.html?ref=US-10172`

This page is a map workbench for the Kentucky POTA Mapping Rep. It works like a light version of ArcGIS Pro.
It is **unlisted**, not secret: nothing links to it and it carries `noindex`, but anyone who has the URL can open it.
Do not put secrets, private owner names or private drafts in it.

## Files (both go in `tools/`)
- `ky-maprep-gis.html`: the whole app (Leaflet 1.9.4 and Turf 7.1.0 load from CDN, so no build step)
- `ky-gis-layers.json`: the layer catalog (a copy of the handoff `layers.json`). Edit this file to add or remove layers.

## What it does
- **Layers:** switch on any of the KY live layers, the federal layers (PAD-US, NPS, FWS, USFS) and the KPC-curated GeoJSON. Each layer has an opacity slider and a status (loading / count / not answering).
- **Identify:** click the map to get attribute cards from every visible layer, with acres measured from each returned shape. Each card has buttons for Zoom, Edit as sketch, GeoJSON, KML and Pin vs this.
- **Measure / Area:** live miles, km and feet, or acres, square miles and hectares.
- **Sketch:** draw a proposed boundary with live acres and drag the corners to edit it. Export it as GeoJSON or KML, or copy the GeoJSON. You can start a sketch from any official polygon.
- **Pin check:** use a POTA pin, a dropped pin (PIN tool, or right-click / long-press) or a ref search. It reports inside or outside, plus distance to the edge, for every visible polygon within about 5 mi.
- **UPDATES** (top bar, with a red number when something changed) checks every layer: is it answering, how many shapes it has in Kentucky (with the change since the last check), and when it was last edited where the server reports that. It also shows the PAD-US version, the KPC GeoJSON file dates, and new or removed services on the KY state GIS server. **SHOW LAYERS → ADD TO MAP** tries a new layer for this visit, and **COPY CATALOG ENTRY** gives a ready-to-paste block for `ky-gis-layers.json`. A quiet check runs by itself when the last one is over 7 days old. Results are kept in each browser's own storage.
- **? HELP** opens a how-to page covering quick start, every tool, phone tips and caveats. `…/ky-maprep-gis.html#help` opens it directly, and first-time visitors get a hint to tap it.
- A credits strip lists the sources for the layers that are on. The About panel has the PAD-US note, the rules and the full source list.

## Rules built in
- The Grant County, **New Mexico** parcel service and Experience Builder `08912973707d446eb0e87212ffce1ee4` are blocked in code, even if someone adds them to the JSON.
- `ky-kpc-drawn.geojson` (OSM-traced) is drawn dashed and labeled "UNOFFICIAL · NOT EVIDENCE".
- On parcel layers (the catalog group, or any service/layer whose name says PVA or parcel, including ones added from UPDATES), owner name, address, city, state, zip, account and deed fields are dropped before display, and never used as a heading or file name.
- OSM is used for basemap tiles only.

## Acceptance tests (run 2026-11-06 in a browser at the kentuckyportableclub.github.io origin)
| Test | Result |
|---|---|
| Blackford Oaks WMA identify (KDFWR live) | ✅ `Blackford Oaks WMA`, measured 564.83 ac |
| Salato US-10172 on PAD-US | ✅ PAD `GIS_Acres` 250, measured 250.08 ac (the neighbouring KDFWR Game Farm polygon also shows) |
| Pin vs boundary | ✅ Carr Creek SP pin is INSIDE (222 ft to edge); a pin 3 mi north is OUTSIDE (1.32 mi) |
| Export | ✅ `.geojson` and `.kml` generated with name, acres and source (not yet opened in Google Earth) |
| Banned layer | ✅ not in the layer list |
| Credits | ✅ the strip updates per layer (KDFWR, USGS PAD-US, …) |
| CORS / services | ✅ KY GIS query + export, PAD-US query + export, NPS (11 in KY box), FWS (47), USFS EDW, api.pota.app (193 parks), KPC-Links GeoJSON |
| Updates checker (network) | ✅ count queries answer for KY, PAD-US, NPS and USFS (all in about 1 s). The KY service list (170 services) and sub-layer lists load, and Last-Modified is readable on the KPC files |
| Updates panel: first check baseline, second check diffs (CHANGED / NEW / GONE), badge survives quiet checks until opened | ✅ review 2026-11-06 |
| UPDATES → SHOW LAYERS → ADD TO MAP (point + polygon KY layers), COPY CATALOG ENTRY | ✅ review 2026-11-06 |
| Parcel privacy: no owner name/address in cards, pin-check headings or file names | ✅ review 2026-11-06 |
| HELP page, jump links, `#help` | ✅ review 2026-11-06 |
| Phone 375×812 layout | ✅ review 2026-11-06 |
| Hidden | ⬜ check after the push: must not be linked from `index.html` |
