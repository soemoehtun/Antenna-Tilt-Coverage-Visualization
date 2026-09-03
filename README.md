# TiltPlane Antenna Tilt Calculator

TiltPlane is a React + Vite web application for calculating antenna tilt planes on a **real interactive map** (Leaflet with free tiles) and exporting them as a Google Earth KML file. The workflow is based on the G-NetTilt / G-NetLook idea: enter a cell location, antenna parameters, antenna beamwidth values, then visualize upper/central/lower tilt planes live on the map and generate KML planes that can be opened and switched on or off in Google Earth.

## Map

- **Click anywhere on the map** to move the antenna site.
- Base layers (free, no API key):
  - **Light** — CARTO basemap
  - **Streets** — OpenStreetMap
  - **Satellite** — Esri World Imagery
- Overlays: coverage rings (1/2/3 km), cell name label, demo neighbor cellfile sites (G-NetLook style).
- An internet connection is required to load map tiles.

## What It Calculates

The app creates three antenna planes:

| Plane | Angle formula |
| --- | --- |
| Central max power | `tilt` |
| Upper -3 dB | `tilt - verticalBeamwidth / 2` |
| Lower -3 dB | `tilt + verticalBeamwidth / 2` |

For each plane, the ground distance is estimated with:

```text
distance = effectiveHeight / tan(planeAngle)
```

If a plane angle is `0` degrees or less, the beam does not intersect the ground in the simple tilt model, so the app uses the configured max range.

## DTM Height Option

The calculator includes a switch named **Include DTM in calculation**.

When DTM is included:

```text
effectiveHeight = antennaHeight + DTMHeight
```

When DTM is not included:

```text
effectiveHeight = antennaHeight
```

Use **Include DTM** when your calculation should use altitude above mean sea level or when your exported KML should be positioned with the terrain height added. Leave it off when the antenna height is already the only height you want to use, for example height above local ground level.

### Auto-fetch DTM

Click **Auto-fetch DTM elevation** in the side panel to query the real terrain elevation for the current site coordinates from [OpenTopoData](https://www.opentopodata.org/) (free, SRTM 90 m dataset). The returned elevation is written into the DTM height field and DTM inclusion is switched on automatically.

## Terrain-Adjusted Profile

When **Elevation Chart** is clicked in the header, the tool fetches real terrain data along the antenna azimuth following a 5-step process:

1. **Route Sampling** — 64 points are sampled along the azimuth from the site to the configured distance using geodesic (`destinationPointWgs84`) calculations.
2. **Elevation Fetch** — elevations are retrieved from the Open-Meteo elevation API (`api.open-meteo.com/v1/elevation`).
3. **Dense Interpolation** — the 64 samples are interpolated into 260 dense points for smooth rendering.
4. **Ray-Terrain Intersection** — for each beam ray (upper, center, lower), the code walks the terrain profile and finds where `terrain_elevation - ray_height` crosses zero (sign change detection with linear interpolation).
5. **RF Signal Scoring** — each terrain segment gets a signal quality score (0–1) based on:
   - **Beam proximity** — Gaussian decay from the beam center axis
   - **Line-of-sight blockage** — penalized when terrain angle exceeds the previous horizon angle
   - **Distance decay** — exponential rolloff with distance
   - Terrain segments are colored green (strong) → yellow (weak) → red (shadowed)

## Inputs

| Input | Meaning |
| --- | --- |
| Latitude | Cell latitude in decimal degrees |
| Longitude | Cell longitude in decimal degrees |
| Antenna height | Antenna height in meters |
| DTM height | Terrain elevation in meters |
| Include DTM | Adds DTM height to antenna height for the calculation |
| Azimuth | Antenna direction in degrees |
| Tilt | Electrical or total downtilt in degrees |
| Horizontal beamwidth | Horizontal beam opening in degrees |
| Vertical beamwidth | Vertical beam opening in degrees |
| Max range | Maximum distance used when the beam is horizontal or above horizon |
| Frequency | Carrier frequency in MHz, used for the Fresnel zone in the elevation profile |

## KML Output

Click **Export KML** to export `tiltplane.kml`.

The file contains one polygon for each plane:

1. Upper -3 dB plane
2. Central max power plane
3. Lower -3 dB plane

Open the KML file in Google Earth to view the antenna geometry. The generated polygons use the entered latitude, longitude, azimuth, horizontal beamwidth, vertical beamwidth, tilt, and selected DTM behavior.

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Notes

This is a planning and visualization calculator. Real radio coverage depends on terrain profile, clutter, antenna pattern files, frequency, EIRP, propagation model, and receiver conditions.