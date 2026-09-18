# Antenna Downtilt & Coverage Calculator

A small React + Vite + TypeScript tool that shows **where an antenna's vertical
beam lands on the ground** for a given downtilt – or which downtilt is needed
to land the boresight at a target distance.

The screen has three parts:

1. **Inputs** (left) – mode switch, antenna, receiver and site parameters.
2. **Results strip** – the three numbers that matter: boresight distance (or
   required downtilt), inner edge and outer edge of the −3 dB footprint.
3. **Map & terrain** (main area) — top-down sector, annular −3 dB footprint and
   beam arcs on satellite imagery (drag the marker to move the site), with the
   **terrain profile directly below it**: real terrain (Copernicus DEM via
   Open-Meteo) along the same azimuth, with the rays projected onto it so you
   can compare flat-earth distances with where the rays actually meet the ground.

## Calculation model

All geometry is a flat-earth tangent model (no refraction, no Earth curvature).

```
heightDiff        = antennaHeight − receiverHeight

upper  angle      = tilt − VBW / 2
centre angle      = tilt
lower  angle      = tilt + VBW / 2

distance(angle)   = heightDiff / tan(angle)          angle ≤ 0 → ∞ (drawn to 25 km)
innerRadius       = distance(lower angle)
outerRadius       = distance(upper angle)

requiredDowntilt  = arctan(heightDiff / targetDistance)   ← "Required Downtilt" mode

rayHeight(a, d)   = antennaAMSL − tan(a) · d              ← terrain profile
ground points     = Haversine destination(lat, lon, azimuth, distance)
```

The terrain profile samples 90 points along the azimuth via
[Open-Meteo's elevation endpoint](https://open-meteo.com/en/docs/elevation-api)
(batchable, Copernicus DEM GLO-90, free, no key). Its **Terrain distance**
slider adjusts the sampled range from 0.5 km to 25 km; use **Auto** to return
to the beam-based range.

### Defaults (reference site)

| Field | Default | Unit |
| --- | --- | --- |
| latitude / longitude | 17.6026 / 98.0365 | ° |
| antennaHeight | 32 | m |
| azimuth | 120 | ° |
| tilt | 4 | ° |
| horizontalBeamwidth | 25 | ° |
| verticalBeamwidth | 6.5 | ° |
| receiverHeight | 0 | m |
| targetDistance | 5442 | m |

With these values the boresight lands at **457.6 m**, the −3 dB footprint spans
**251.5 m → 2 444.5 m**, and the downtilt needed for 5 442 m is **0.337°**.
The site's ground elevation is fetched automatically from the DEM.

## Project layout

```
src/
├── App.tsx                          # state, layout, tabs
├── types.ts
├── lib/
│   ├── antenna.ts                   # calculation engine (pure TS)
│   ├── geo.ts                       # Haversine helpers, arcs, sector polygons
│   ├── terrain.ts                   # profile length + ray/terrain intersection
│   ├── format.ts                    # units, number formatting, axis ticks
│   ├── api.ts                       # Open-Meteo elevation client
│   └── colors.ts                    # shared palette
├── hooks/
│   ├── useElementSize.ts            # ResizeObserver hook for the SVG charts
│   └── useTerrainProfile.ts         # debounced DEM profile along the azimuth
├── components/
│   ├── ControlPanel/                # inputs + unit selector
│   ├── Visualization/
│   │   ├── MapView.tsx              # Leaflet map
│   │   └── ElevationChart.tsx       # terrain profile (SVG)
│   ├── ResultsStrip.tsx
│   └── ui/                          # primitives and bookmark-style tabs
└── __tests__/antenna.test.ts        # Vitest unit tests
```

## Scripts

```bash
npm run dev        # dev server
npm run build      # production build (single self-contained index.html)
npx vitest run     # unit tests for the engine, geo helpers and terrain intersection
```

The calculation engine works fully offline; map tiles (Esri) and terrain
data (`api.open-meteo.com/v1/elevation`, free, no key) are fetched at runtime.
Open-Meteo accepts 100 points per request, so a full 90-point profile fits in
one HTTP call. Identical tracks are strongly cached in memory + localStorage,
which — combined with the 1.8 s debounce and 20 s minimum 429 backoff — keeps
the shared free tier comfortably within budget.
