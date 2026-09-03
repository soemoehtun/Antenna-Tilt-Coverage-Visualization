import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { destinationPoint, normalizeBearing, sectorPolygon, toDegrees, toRadians } from "../lib/geo";

export type BaseMapId = "satellite";

export interface DisplayBeam {
  name: string;
  color: string;
  show: boolean;
  distance: number;
}

interface NeighborSite {
  name: string;
  lat: number;
  lon: number;
  azimuths: number[];
}

interface TiltMapProps {
  latitude: number;
  longitude: number;
  azimuth: number;
  horizontalBeamwidth: number;
  beams: DisplayBeam[];
  baseMap: BaseMapId;
  showRings: boolean;
  showCellLabel: boolean;
  showNeighbors: boolean;
  onSiteChange: (lat: number, lon: number) => void;
  onAzimuthChange?: (azimuth: number) => void;
  /**
   * When provided (Downtilt angle tab), the red-dot handle becomes a
   * Google-Earth-ruler — drag it freely to set both azimuth (360°) and
   * beam distance simultaneously.  Fires with the new distance in metres.
   */
  onDistanceChange?: (distanceMeters: number) => void;
  hoverMarker?: { lat: number; lon: number } | null;
}

// ─── Geo utilities ────────────────────────────────────────────────────────────
function bearingTo(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(lon2 - lon1)) * Math.cos(r(lat2));
  const x =
    Math.cos(r(lat1)) * Math.sin(r(lat2)) -
    Math.sin(r(lat1)) * Math.cos(r(lat2)) * Math.cos(r(lon2 - lon1));
  return normalizeBearing(toDegrees(Math.atan2(y, x)));
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6_371_000;
  const r = (d: number) => (d * Math.PI) / 180;
  const dφ = r(lat2 - lat1);
  const dλ = r(lon2 - lon1);
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}



// ─── Static assets ────────────────────────────────────────────────────────────
const BASE_LAYERS: Record<BaseMapId, { url: string; attribution: string }> = {
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
  },
};

const NEIGHBOR_SITES: NeighborSite[] = [
  { name: "SFD1002", lat: 42.7045, lon: 23.3315, azimuths: [0, 120, 240] },
  { name: "SFD1003", lat: 42.6905, lon: 23.3361, azimuths: [30, 150, 270] },
  { name: "SFD1004", lat: 42.6895, lon: 23.3095, azimuths: [60, 180, 300] },
  { name: "SFD1005", lat: 42.7058, lon: 23.3099, azimuths: [90, 210, 330] },
  { name: "SFD1006", lat: 42.7112, lon: 23.3242, azimuths: [20, 140, 260] },
  { name: "SFD1007", lat: 42.6832, lon: 23.3248, azimuths: [100, 220, 340] },
  { name: "SFD1008", lat: 42.6980, lon: 23.2995, azimuths: [10, 130, 250] },
  { name: "SFD1009", lat: 42.6940, lon: 23.3445, azimuths: [70, 190, 310] },
];

const SITE_SVG = `<svg viewBox="0 0 199.653 199.653" width="42" height="42" xmlns="http://www.w3.org/2000/svg"><g><path fill="#d51010" d="M131.111,122.83l-1.696-1.378l-21.913-74.605c2.552-2.086,4.001-5.118,4.001-8.41 c0-6.023-4.903-10.93-10.93-10.93c-6.023,0-10.926,4.907-10.926,10.93c0,3.876,2.047,7.412,5.393,9.38L83.387,87.514l-1.668,1.489 l0.988,0.805l-31.616,107.62l-0.236,0.809l4.835,1.414l3.847-13.077l66.391-59.13l20.983,71.405l0.24,0.805l4.835-1.414 l-21.895-74.497L131.111,122.83z M123.338,122.987l-61.112,54.431l24.723-84.15L123.338,122.987z M89.478,88.831L109.37,71.08 l13.142,44.725L89.478,88.831z M90.506,81.154l9.362-31.837c0.952,0.111,1.95,0.011,3.042-0.24l4.892,16.652L90.506,81.154z"/><path fill="#d51010" d="M121.09,33.945c0,2.348-0.612,4.667-1.761,6.71l-0.2,0.673l2.215,2.605l0.616-1.009 c1.675-2.709,2.555-5.819,2.555-8.979c0-3.003-0.809-5.97-2.33-8.582l-0.412-0.709l-0.723,0.404 c-0.472,0.258-0.963,0.483-1.464,0.673l-0.952,0.347l0.523,0.87C120.421,29.067,121.09,31.487,121.09,33.945z"/><path fill="#d51010" d="M126.713,50.816c0.125,0.132,0.258,0.254,0.379,0.39l0.651,0.719l0.619-0.759 c4.005-4.867,6.209-10.987,6.209-17.221c0-5.662-1.768-11.116-5.118-15.79l-0.676-0.938l-0.684,0.934 c-0.354,0.49-0.719,0.981-1.099,1.453l-0.387,0.487l0.351,0.512c2.741,3.983,4.184,8.589,4.184,13.346 c0,5.458-1.814,10.597-5.25,14.874l-0.401,0.505l0.712,0.963C126.369,50.469,126.541,50.644,126.713,50.816z"/><path fill="#d51010" d="M142.066,33.945c0,8.213-2.985,16.219-8.403,22.536l-0.537,0.626l0.619,0.548 c0.301,0.268,0.612,0.53,0.92,0.784l1.066,0.909l0.544-0.637c5.944-6.932,9.219-15.729,9.219-24.769 c0-9.337-3.446-18.342-9.692-25.349l-0.691-0.787l-0.616,0.855c-0.351,0.487-0.694,0.991-1.041,1.507l-0.365,0.53l0.422,0.487 C139.031,17.515,142.066,25.592,142.066,33.945z"/><path fill="#d51010" d="M152.985,33.945c0,10.794-3.862,21.28-10.88,29.536l-0.558,0.662l0.676,0.533 c0.394,0.326,0.791,0.662,1.174,0.995l0.777,0.673l0.548-0.644c7.541-8.872,11.696-20.145,11.696-31.755 c0-12.39-4.652-24.232-13.099-33.348L142.764,0l-0.616,0.533c-0.29,0.251-0.583,0.523-0.863,0.784l-1.081,0.984l0.58,0.626 C148.655,11.402,152.985,22.418,152.985,33.945z"/><path fill="#d51010" d="M78.305,43.934l2.316-2.745l-0.297-0.53c-1.152-2.044-1.764-4.363-1.764-6.71 c0-2.462,0.673-4.882,1.936-7l0.519-0.87l-0.948-0.347c-0.501-0.193-0.991-0.415-1.464-0.673l-0.719-0.404l-0.412,0.709 c-1.532,2.613-2.333,5.579-2.333,8.582c0,3.157,0.88,6.267,2.552,8.979L78.305,43.934z"/><path fill="#d51010" d="M71.294,51.167l0.612,0.759l0.655-0.719c0.125-0.136,0.251-0.258,0.383-0.39 c0.172-0.172,0.344-0.347,0.548-0.587l0.673-0.902l-0.404-0.505c-3.432-4.277-5.254-9.416-5.254-14.874 c0-4.756,1.449-9.362,4.184-13.346l0.354-0.512l-0.39-0.487c-0.383-0.469-0.744-0.963-1.102-1.453l-0.68-0.934l-0.673,0.941 c-3.346,4.67-5.118,10.128-5.118,15.79C65.081,40.18,67.29,46.296,71.294,51.167z"/><path fill="#d51010" d="M63.381,58.715l0.544,0.637l1.066-0.909c0.308-0.254,0.616-0.519,0.916-0.784l0.623-0.548 l-0.544-0.626c-5.418-6.317-8.4-14.319-8.4-22.536c0-8.353,3.038-16.431,8.553-22.754l0.422-0.487l-0.361-0.533 c-0.347-0.519-0.698-1.02-1.041-1.507l-0.612-0.855L63.85,8.6c-6.252,7.007-9.692,16.012-9.692,25.349 C54.162,42.986,57.433,51.786,63.381,58.715z"/><path fill="#d51010" d="M55.612,66.227l0.641-0.551c0.39-0.333,0.784-0.673,1.185-0.995l0.673-0.533l-0.558-0.662 c-7.022-8.256-10.887-18.742-10.887-29.536c0-11.531,4.338-22.543,12.207-31.014l0.576-0.626l-1.07-0.984 c-0.29-0.261-0.58-0.533-0.87-0.784l-0.619-0.533l-0.548,0.598c-8.45,9.115-13.106,20.958-13.106,33.348 c0,11.61,4.155,22.883,11.699,31.755L55.612,66.227z"/></g></svg>`;

const NEIGHBOR_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#ffffff" stroke="#64748b" stroke-width="1.5"/><polygon points="12,5 16,17 12,14.5 8,17" fill="#64748b"/></svg>`;

// ─── Label HTML builder (ruler midpoint badge) ────────────────────────────────
function rulerLabelHtml(dist: number, bearing: number) {
  return `
    <div style="
      background:rgba(15,23,42,0.88);
      color:#fff;
      font-family:system-ui,sans-serif;
      font-size:11px;
      font-weight:600;
      padding:4px 8px;
      border-radius:6px;
      white-space:nowrap;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
      border:1px solid rgba(255,255,255,0.12);
      pointer-events:none;
      display:flex;
      align-items:center;
      gap:6px;
    ">
      <span style="opacity:0.65;font-weight:400">↗</span>
      <span>${fmtDist(dist)}</span>
      <span style="opacity:0.55;font-size:9px">|</span>
      <span style="opacity:0.8;font-weight:400">${Math.round(bearing)}°</span>
    </div>`;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TiltMap({
  latitude,
  longitude,
  azimuth,
  horizontalBeamwidth,
  beams,
  baseMap,
  showRings,
  showCellLabel,
  showNeighbors,
  onSiteChange,
  onAzimuthChange,
  onDistanceChange,
  hoverMarker,
}: TiltMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  // Layer groups (created once in the init effect)
  const beamsGroupRef     = useRef<L.LayerGroup | null>(null);
  const siteGroupRef      = useRef<L.LayerGroup | null>(null);
  const rulerGroupRef     = useRef<L.LayerGroup | null>(null); // ruler line + dot + label
  const ringsGroupRef     = useRef<L.LayerGroup | null>(null);
  const neighborsGroupRef = useRef<L.LayerGroup | null>(null);
  const hoverGroupRef     = useRef<L.LayerGroup | null>(null);

  // Always-fresh refs — accessible inside Leaflet handlers without stale closure
  const onSiteChangeRef     = useRef(onSiteChange);
  const onAzimuthChangeRef  = useRef(onAzimuthChange);
  const onDistanceChangeRef = useRef(onDistanceChange);
  const latRef  = useRef(latitude);
  const lonRef  = useRef(longitude);
  const hbwRef  = useRef(horizontalBeamwidth);
  const beamsRef = useRef(beams);

  /**
   * True while the red dot is being dragged.
   * Prevents the beam-polygon React effect from clearing Leaflet's live preview.
   */
  const isDraggingRef = useRef(false);

  // Sync every ref on every render (cheap, no effect needed for refs)
  useEffect(() => { onSiteChangeRef.current = onSiteChange; }, [onSiteChange]);
  useEffect(() => { onAzimuthChangeRef.current = onAzimuthChange; }, [onAzimuthChange]);
  useEffect(() => { onDistanceChangeRef.current = onDistanceChange; }, [onDistanceChange]);
  useEffect(() => { latRef.current = latitude; }, [latitude]);
  useEffect(() => { lonRef.current = longitude; }, [longitude]);
  useEffect(() => { hbwRef.current = horizontalBeamwidth; }, [horizontalBeamwidth]);
  useEffect(() => { beamsRef.current = beams; }, [beams]);

  // ── Map initialisation (once) ───────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [latitude, longitude],
      zoom: 13,
      zoomControl: false,
      preferCanvas: true,
    });
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
    beamsGroupRef.current     = L.layerGroup().addTo(map);
    ringsGroupRef.current     = L.layerGroup().addTo(map);
    rulerGroupRef.current     = L.layerGroup().addTo(map);
    siteGroupRef.current      = L.layerGroup().addTo(map);
    neighborsGroupRef.current = L.layerGroup().addTo(map);
    hoverGroupRef.current     = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(() => mapRef.current?.invalidateSize());
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Base tile layer swap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileLayerRef.current?.remove();
    const def = BASE_LAYERS[baseMap];
    tileLayerRef.current = L.tileLayer(def.url, { attribution: def.attribution, maxZoom: 20 }).addTo(map);
  }, [baseMap]);

  // Re-centre when site coordinates change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    if (Math.abs(c.lat - latitude) > 0.0015 || Math.abs(c.lng - longitude) > 0.0015)
      map.setView([latitude, longitude], map.getZoom(), { animate: true });
  }, [latitude, longitude]);

  // ── Helper: redraw beam wedges directly in a Leaflet group (no React) ────────
  function redrawBeams(
    group: L.LayerGroup,
    lat: number, lon: number, az: number, hbw: number,
    beamList: DisplayBeam[],
  ) {
    group.clearLayers();
    beamList.filter((b) => b.show).forEach((beam) => {
      const d = Math.max(beam.distance, 60);
      L.polygon(sectorPolygon(lat, lon, normalizeBearing(az), hbw, d), {
        color: beam.color, weight: 2,
        fillColor: beam.color, fillOpacity: 0.22, opacity: 0.9,
      })
        .bindTooltip(
          `<strong>${beam.name}</strong><br/>${(d / 1000).toFixed(2)} km ground reach`,
          { sticky: true },
        )
        .addTo(group);
    });
  }

  // Beam wedge polygons — skipped during drag (drag handler owns the canvas)
  useEffect(() => {
    const g = beamsGroupRef.current;
    if (!g || isDraggingRef.current) return;
    redrawBeams(g, latitude, longitude, azimuth, horizontalBeamwidth, beams);
  }, [latitude, longitude, azimuth, horizontalBeamwidth, beams]);

  // ── Coverage rings ──────────────────────────────────────────────────────────
  useEffect(() => {
    const g = ringsGroupRef.current;
    if (!g) return;
    g.clearLayers();
    if (!showRings) return;
    [1000, 2000, 3000].forEach((r, i) => {
      L.circle([latitude, longitude], { radius: r, color: "#4f46e5", weight: 1, dashArray: "6 6", fill: false, opacity: 0.5 }).addTo(g);
      const lp = sectorPolygon(latitude, longitude, normalizeBearing(azimuth), 0.01, r)[1];
      L.marker(lp, {
        interactive: false,
        icon: L.divIcon({ className: "tiltplane-ring-label", html: `<span>${i + 1} km</span>`, iconSize: [48, 14], iconAnchor: [24, 0] }),
      }).addTo(g);
    });
  }, [latitude, longitude, azimuth, showRings]);

  // ── Site marker ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const g = siteGroupRef.current;
    if (!g) return;
    g.clearLayers();
    const m = L.marker([latitude, longitude], {
      draggable: true, autoPan: true,
      icon: L.divIcon({
        className: "tiltplane-site-icon",
        html: `<div style="display:flex;align-items:center;justify-content:center;width:52px;height:52px;background:rgba(255,255,255,0.92);border:2px solid #d51010;border-radius:50%;box-shadow:0 3px 10px rgba(213,16,16,0.35);cursor:grab">${SITE_SVG}</div>`,
        iconSize: [56, 56], iconAnchor: [28, 28],
      }),
    })
      .bindTooltip("<strong>Drag to move site</strong>", { direction: "top" })
      .addTo(g);
    m.on("dragstart", () => { (m.getElement() as HTMLElement | null)?.style.setProperty("cursor", "grabbing"); });
    m.on("dragend",   () => {
      const p = m.getLatLng();
      onSiteChangeRef.current(Math.round(p.lat * 10000) / 10000, Math.round(p.lng * 10000) / 10000);
    });
    if (showCellLabel) {
      L.marker([latitude, longitude], {
        interactive: false, keyboard: false,
        icon: L.divIcon({
          className: "tiltplane-cell-label",
          html: `<div><strong>CELL_001</strong><span>${latitude.toFixed(4)} · ${longitude.toFixed(4)} · AZ ${normalizeBearing(azimuth).toFixed(0)}°</span></div>`,
          iconSize: [190, 30], iconAnchor: [-14, -8],
        }),
      }).addTo(g);
    }
  }, [latitude, longitude, azimuth, showCellLabel]);

  // ── Google-Earth-style ruler handle ────────────────────────────────────────
  //
  //  Downtilt angle tab  →  Free 2-D drag: rotate (360°) + resize distance
  //  Coverage distance tab  →  Azimuth-only, snapped to fixed arc
  //
  //  Ruler anatomy (in radial / Downtilt angle mode):
  //    ┌─────────────────────────────────── antenna site
  //    │ (dashed line, the "ruler")
  //    │   [  3.21 km | 120°  ]  ← floating label at midpoint
  //    │
  //    ●  ← draggable red endpoint (any direction)
  //
  //  All ruler elements are Leaflet objects updated in-place inside the drag
  //  handler — zero React re-renders during drag.  isDraggingRef prevents the
  //  beam-polygon effect from wiping the live preview.
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const rulerGroup = rulerGroupRef.current;
    const beamGroup  = beamsGroupRef.current;
    if (!rulerGroup || !beamGroup || !mapRef.current) return;
    rulerGroup.clearLayers();
    if (!onAzimuthChange) return;

    const az       = normalizeBearing(azimuth);
    const central  = beamsRef.current.find((b) => b.name === "Central");
    const initDist = Math.max(central?.distance ?? 400, 200);
    const radial   = typeof onDistanceChange === "function";

    const siteLl = L.latLng(latitude, longitude);
    const tipGeo = destinationPoint(latitude, longitude, az, initDist);
    const tipLl  = L.latLng(tipGeo.lat, tipGeo.lon);



    // ── Endpoint dot (clean circle, no tooltip) ───────────────────────────
    // Slightly larger in radial mode so it's easy to grab.
    const dotHtml = `<div style="
        width:${radial ? 16 : 14}px;
        height:${radial ? 16 : 14}px;
        background:#d51010;
        border:2.5px solid #ffffff;
        border-radius:50%;
        box-shadow:0 2px 8px rgba(213,16,16,0.6);
        cursor:grab;
      "></div>`;

    const iconSize:   [number, number] = radial ? [16, 16] : [14, 14];
    const iconAnchor: [number, number] = radial ? [8, 8]   : [7, 7];

    const dot = L.marker([tipLl.lat, tipLl.lng], {
      draggable: true, autoPan: true,
      icon: L.divIcon({ className: "tiltplane-azimuth-dot", html: dotHtml, iconSize, iconAnchor }),
    })
      .addTo(rulerGroup);

    // ── Drag state ─────────────────────────────────────────────────────────
    let liveAz   = az;
    let liveDist = initDist;
    let rafHandle = 0;

    dot.on("dragstart", () => {
      isDraggingRef.current = true;
      (dot.getElement() as HTMLElement | null)?.style.setProperty("cursor", "grabbing");
    });

    dot.on("drag", (e: L.LeafletEvent) => {
      const target = e.target as L.Marker;
      const pos    = target.getLatLng();
      const lat0   = latRef.current;
      const lon0   = lonRef.current;

      // Bearing: always free 360°
      liveAz = bearingTo(lat0, lon0, pos.lat, pos.lng);

      if (radial) {
        // ── Free 2-D: rotate AND resize ─────────────────────────────────
        const maxDist = 25000; // 25 km maximum
        liveDist = Math.max(100, Math.min(haversineMeters(lat0, lon0, pos.lat, pos.lng), maxDist));

        // Redraw beam wedge — direct Leaflet, no React latency
        const preview = beamsRef.current.map((b) => ({ ...b, distance: liveDist }));
        redrawBeams(beamGroup, lat0, lon0, liveAz, hbwRef.current, preview);

        // Throttle React state update to 1× per animation frame
        cancelAnimationFrame(rafHandle);
        rafHandle = requestAnimationFrame(() => {
          onDistanceChangeRef.current?.(liveDist);
        });
      } else {
        // ── Azimuth-only: snap to fixed arc ─────────────────────────────
        liveDist = initDist;
        const snapped = destinationPoint(lat0, lon0, liveAz, initDist);
        target.setLatLng([snapped.lat, snapped.lon]);
        redrawBeams(beamGroup, lat0, lon0, liveAz, hbwRef.current, beamsRef.current);
      }
    });


    dot.on("dragend", () => {
      cancelAnimationFrame(rafHandle);
      isDraggingRef.current = false;
      (dot.getElement() as HTMLElement | null)?.style.setProperty("cursor", "grab");
      // Commit final rounded values to React state (single update)
      onAzimuthChangeRef.current?.(Math.round(liveAz * 10) / 10);
      if (radial) onDistanceChangeRef.current?.(Math.round(liveDist));
    });

  // NOTE: `beams` intentionally omitted — read via beamsRef to avoid recreating
  // the dot every time displayBeams updates during drag.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, azimuth, onAzimuthChange, onDistanceChange]);

  // ── Hover crosshair from elevation chart ────────────────────────────────────
  useEffect(() => {
    const g = hoverGroupRef.current;
    if (!g) return;
    g.clearLayers();
    if (!hoverMarker) return;
    L.circle([hoverMarker.lat, hoverMarker.lon], { radius: 30, color: "#d51010", weight: 1.5, fill: false, dashArray: "4 3", opacity: 0.9 }).addTo(g);
    L.circleMarker([hoverMarker.lat, hoverMarker.lon], { radius: 5, color: "#d51010", fillColor: "#ffffff", fillOpacity: 1, weight: 2 }).addTo(g);
  }, [hoverMarker]);

  // ── Neighbour sites overlay ─────────────────────────────────────────────────
  useEffect(() => {
    const g = neighborsGroupRef.current;
    if (!g) return;
    g.clearLayers();
    if (!showNeighbors) return;
    NEIGHBOR_SITES.forEach((site) => {
      site.azimuths.forEach((saz) => {
        L.polygon(sectorPolygon(site.lat, site.lon, saz, 65, 450), {
          color: "#64748b", weight: 1, fillColor: "#94a3b8", fillOpacity: 0.18, opacity: 0.7,
        }).addTo(g);
      });
      L.marker([site.lat, site.lon], {
        icon: L.divIcon({ className: "tiltplane-neighbor-icon", html: NEIGHBOR_SVG, iconSize: [24, 24], iconAnchor: [12, 12] }),
      })
        .bindTooltip(`<strong>${site.name}</strong> · 3-sector site`)
        .addTo(g);
    });
  }, [showNeighbors]);

  return <div ref={containerRef} className="absolute inset-0 z-0" />;
}
