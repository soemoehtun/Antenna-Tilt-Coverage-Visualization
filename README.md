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

## Calculation Modes

Two calculation modes available via tabs:

| Tab | Input | Output |
| --- | --- | --- |
| **Coverage Distance** | Tilt angle, antenna height, beamwidth | Receiver distance, Inner/Outer coverage radius |
| **Downtilt Angle** | Target distance, antenna height, beamwidth | Required downtilt angle |

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

When **Elevation Chart** is opened, the tool fetches real terrain data along the antenna azimuth:

1. **Route Sampling** — 64 points are sampled along the azimuth from the site to the configured distance using geodesic (`destinationPointWgs84`) calculations.
2. **Elevation Fetch** — elevations are retrieved from the Open-Meteo elevation API (`api.open-meteo.com/v1/elevation`).
3. **Dense Interpolation** — the 64 samples are interpolated into 260 dense points for smooth rendering.
4. **Ray-Terrain Intersection** — for each beam ray (upper, center, lower), the code walks the terrain profile and finds where `terrain_elevation - ray_height` crosses zero (sign change detection with linear interpolation).
6. **RF Signal Scoring** — each terrain segment gets a signal quality score (0–1) based on:
   - **Beam proximity** — Gaussian decay from the beam center axis
   - **Line-of-sight blockage** — penalized when terrain angle exceeds the previous horizon angle
   - **Distance decay** — exponential rolloff with distance
   - Terrain segments are colored green (strong) → yellow (weak) → red (shadowed)

### Elevation Profile Chart

- **Interactive hover** — hover over the profile to see distance, terrain elevation, center beam height, and clearance/blockage
- **Range slider** — adjust the profile distance (max 25 km)
- **Close button** — on the bottom data ribbon (always visible on mobile)
- **Terrain crosshair** — hover location mirrored on the map

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

## Calculation Result vs Actual (Terrain) Legend

The floating legend shows two distinct sections:

### Coverage Result (Calculation Tab) — Based on User Input Values
| Legend Item | Data Source |
|-------------|-------------|
| **Downtilt Angle** | Calculated from user's tilt input |
| **Center** | `receiverDistance` from calculation |
| **Inner** | Calculated inner radius (coverage.innerRadius) |
| **Outer** | Calculated outer radius (coverage.outerRadius) |

### ACTUAL (TERRAIN) — Based on Terrain Block Center Distance Angle
| Legend Item | Data Source |
|-------------|-------------|
| **Downtilt Angle** | Calculated from terrain angle: `atan(heightDifference / distance) * 180/π` |
| **Center** | Terrain-blocked distance from APIs |
| **Inner** | Terrain-blocked distance from APIs |
| **Outer** | Terrain-blocked distance from APIs |

> **Downtilt Angle tab**: Shows only Downtilt Angle and Center.  
> **Coverage Distance tab**: Shows all four items (Downtilt Angle, Center, Inner, Outer).

## Slider Maximum Distance

| Tab | Maximum Distance |
|-----|------------------|
| Coverage Distance | Outer radius (capped at 25 km) |
| Downtilt Angle | Center beam distance (capped at 25 km) |

## Distance Units

Supports three units with live conversion:
- **m** (meters)
- **km** (kilometers)  
- **ft** (feet)

Values over 25 km show as "over 25km".

## KML Output

Click **Export KML** to export `tiltplane.kml`.

The file contains one polygon for each plane:

1. Upper -3 dB plane
2. Central max power plane
3. Lower -3 dB plane

Open the KML file in Google Earth to view the antenna geometry.

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Default Values

The application starts with these default values:
- **Latitude**: 17.6026°
- **Longitude**: 98.0365°
- **Antenna Height**: 32 m
- **Receiver Height**: 0 m
- **Azimuth**: 120°
- **Tilt**: 4°
- **Horizontal Beamwidth**: 25°
- **Vertical Beamwidth**: 6.5°

## Validation Against Pasternack Calculator

The calculation engine matches the [Pasternack Antenna Downtilt Calculator](https://www.pasternack.com/t-calculator-antenna-downtilt.aspx):

For Transmitter Height: 32 m, Receiver Height: 0 m, Downtilt: 0.54°, Beamwidth: 6.5°:
- **Receiver Distance**: 3395 m
- **Inner Coverage Radius**: 483.1 m
- **Outer Coverage Radius**: Infinity m

## Notes

This is a planning and visualization calculator. Real radio coverage depends on terrain profile, clutter, antenna pattern files, frequency, EIRP, propagation model, and receiver conditions.