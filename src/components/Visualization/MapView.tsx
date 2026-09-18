import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useRef } from "react";
import { BEAM_COLORS, MAST_COLOR } from "../../lib/colors";
import { formatAngle, formatLength } from "../../lib/format";
import { annularSectorPolygon, arcPoints, destinationPoint, sectorPolygon } from "../../lib/geo";
import type { AntennaParams, BeamKey, CoverageResult, UnitSystem } from "../../types";
import { Overlay } from "../ui/primitives";

interface MapViewProps {
  params: AntennaParams;
  result: CoverageResult;
  unit: UnitSystem;
  onMove: (lat: number, lon: number) => void;
  /** Hovered terrain-profile point to spotlight with a red dot (null = hidden). */
  hover?: { distance: number; lat: number; lon: number } | null;
}

const SITE_ICON = L.divIcon({
  className: "",
  html: `<div style="position:relative;width:20px;height:20px">
    <div style="position:absolute;inset:0;border-radius:9999px;background:${MAST_COLOR};opacity:.35;animation:tp-pulse 2s ease-out infinite"></div>
    <div style="position:absolute;inset:4px;border-radius:9999px;background:${MAST_COLOR};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4)"></div>
  </div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const toLatLngs = (pts: { lat: number; lon: number }[]): L.LatLngTuple[] => pts.map((p): L.LatLngTuple => [p.lat, p.lon]);
const hasSize = (el: HTMLElement | null) => !!el && el.clientWidth > 0 && el.clientHeight > 0;

export function MapView({ params, result, unit, onMove, hover }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const hoverMarkerRef = useRef<L.CircleMarker | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  /** Fit to the coverage the next time the map is drawn with a real size. */
  const pendingFitRef = useRef(true);

  const fitToCoverage = useCallback(() => {
    const map = mapRef.current;
    if (!map || !result.locationValid) return;
    const r = Math.max(result.beams.upper.displayDistance, result.beams.center.displayDistance, 150);
    const site = { lat: params.latitude, lon: params.longitude };
    const pts = sectorPolygon(site, params.azimuth, params.horizontalBeamwidth, r * 1.1);
    pts.push(destinationPoint(site.lat, site.lon, params.azimuth + 180, r * 0.15));
    map.fitBounds(L.latLngBounds(toLatLngs(pts)), { padding: [28, 28] });
  }, [params.latitude, params.longitude, params.azimuth, params.horizontalBeamwidth, result]);
  const fitRef = useRef(fitToCoverage);
  fitRef.current = fitToCoverage;

  const flushPendingFit = useCallback(() => {
    if (!pendingFitRef.current || !hasSize(containerRef.current)) return;
    pendingFitRef.current = false;
    fitRef.current();
  }, []);

  // ---- create the map once --------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [params.latitude, params.longitude],
      zoom: 14,
      zoomControl: false,
      attributionControl: false,
    });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
    }).addTo(map);

    const overlays = L.layerGroup().addTo(map);
    const marker = L.marker([params.latitude, params.longitude], {
      draggable: true,
      icon: SITE_ICON,
      title: "Antenna site – drag to move",
      zIndexOffset: 1000,
    }).addTo(map);
    marker.on("dragend", () => {
      const ll = marker.getLatLng();
      onMoveRef.current(ll.lat, ll.lng);
    });

    mapRef.current = map;
    overlayRef.current = overlays;
    markerRef.current = marker;

    // Also fires when the map tab becomes visible (size goes from 0 to real).
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      flushPendingFit();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      markerRef.current = null;
      pendingFitRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushPendingFit]);

  // ---- keep the marker in sync; follow the site if it left the viewport ----
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !result.locationValid) return;
    const ll = L.latLng(params.latitude, params.longitude);
    if (!marker.getLatLng().equals(ll)) marker.setLatLng(ll);
    if (!hasSize(containerRef.current)) {
      pendingFitRef.current = true; // moved while hidden – re-fit when shown
      return;
    }
    if (!map.getBounds().pad(-0.1).contains(ll)) map.panTo(ll);
  }, [params.latitude, params.longitude, result.locationValid]);

  // ---- redraw the coverage geometry with distinct beam colors -------------
  useEffect(() => {
    const group = overlayRef.current;
    if (!group) return;
    group.clearLayers();
    if (!result.valid || !result.locationValid) return;

    const site = { lat: params.latitude, lon: params.longitude };
    const { azimuth, horizontalBeamwidth: hbw } = params;
    const { beams } = result;
    const outerR = beams.upper.displayDistance;
    const innerR = Math.min(beams.lower.displayDistance, outerR);
    const centerR = Math.min(beams.center.displayDistance, outerR);
    const add = (layer: L.Layer) => layer.addTo(group);

    // 1. Inner Beam Sector (Green zone: site -> innerR)
    if (innerR > 0) {
      add(
        L.polygon(toLatLngs(sectorPolygon(site, azimuth, hbw, innerR)), {
          stroke: false,
          fillColor: BEAM_COLORS.lower, // Green
          fillOpacity: 0.22,
        }).bindTooltip(
          `<strong>Inner Beam</strong><br/>0 → ${formatLength(innerR, unit)} · ${formatAngle(beams.lower.angle)}`,
          { sticky: true, className: "tp-tooltip" },
        ),
      );
    }

    // 2. Center Beam Sector (Blue zone: innerR -> centerR)
    if (centerR > innerR) {
      add(
        L.polygon(toLatLngs(annularSectorPolygon(site, azimuth, hbw, innerR, centerR)), {
          stroke: false,
          fillColor: BEAM_COLORS.center, // Blue
          fillOpacity: 0.22,
        }).bindTooltip(
          `<strong>Center Beam</strong><br/>${formatLength(innerR, unit)} → ${formatLength(centerR, unit)} · ${formatAngle(beams.center.angle)}`,
          { sticky: true, className: "tp-tooltip" },
        ),
      );
    }

    // 3. Outer Beam Sector (Orange zone: centerR -> outerR)
    if (outerR > centerR) {
      add(
        L.polygon(toLatLngs(annularSectorPolygon(site, azimuth, hbw, centerR, outerR)), {
          stroke: false,
          fillColor: BEAM_COLORS.upper, // Orange
          fillOpacity: 0.2,
        }).bindTooltip(
          `<strong>Outer Beam</strong><br/>${formatLength(centerR, unit)} → ${
            beams.upper.reachesPlane && !beams.upper.clamped ? formatLength(outerR, unit) : "∞"
          } · ${formatAngle(beams.upper.angle)}`,
          { sticky: true, className: "tp-tooltip" },
        ),
      );
    }

    // Sector boundary lines
    for (const edge of [azimuth - hbw / 2, azimuth + hbw / 2]) {
      const p = destinationPoint(site.lat, site.lon, edge, outerR);
      add(
        L.polyline(toLatLngs([site, p]), {
          color: "#94a3b8",
          weight: 1.5,
          opacity: 0.5,
          dashArray: "3 4",
          interactive: false,
        }),
      );
    }

    // Center Boresight Line (Blue)
    add(
      L.polyline(toLatLngs([site, destinationPoint(site.lat, site.lon, azimuth, centerR)]), {
        color: BEAM_COLORS.center,
        weight: 3,
        opacity: 0.95,
        dashArray: beams.center.clamped ? "8 6" : undefined,
        interactive: false,
      }),
    );

    // Beam Arcs: Inner (Green), Center (Blue), Outer (Orange)
    const order: BeamKey[] = ["lower", "center", "upper"];
    for (const key of order) {
      const b = beams[key];
      add(
        L.polyline(toLatLngs(arcPoints(site, azimuth, hbw, b.displayDistance)), {
          color: BEAM_COLORS[key],
          weight: key === "center" ? 3.5 : 2.5,
          opacity: 1,
          dashArray: b.clamped ? "6 6" : undefined,
        }).bindTooltip(
          `<strong>${b.label}</strong><br/>angle ${formatAngle(b.angle)} · ${
            b.reachesPlane ? formatLength(b.distance, unit) : "above the horizon"
          }${b.clamped && b.reachesPlane ? " (clamped)" : ""}`,
          { sticky: true, className: "tp-tooltip" },
        ),
      );
      if (key === "center" && b.reachesPlane && !b.clamped) {
        add(
          L.circleMarker([b.groundPoint.lat, b.groundPoint.lon], {
            radius: 5.5,
            color: "#ffffff",
            weight: 2,
            fillColor: BEAM_COLORS.center,
            fillOpacity: 1,
          }).bindTooltip(`Center Beam Ground Point<br/>${b.groundPoint.lat.toFixed(5)}, ${b.groundPoint.lon.toFixed(5)}`, {
            className: "tp-tooltip",
          }),
        );
      }
    }

    flushPendingFit();
  }, [params, result, unit, flushPendingFit]);

  // ---- red-dot spotlight for the hovered terrain-profile point ------------
  // Kept outside the overlay group so coverage redraws never clear it.
  useEffect(() => {
    const map = mapRef.current;
    if (hoverMarkerRef.current) {
      hoverMarkerRef.current.remove();
      hoverMarkerRef.current = null;
    }
    if (!map || !hover || !result.locationValid) return;
    const dot = L.circleMarker([hover.lat, hover.lon], {
      radius: 8,
      color: "#ffffff",
      weight: 2.5,
      fillColor: "#ef4444",
      fillOpacity: 1,
      interactive: true,
    }).bindTooltip(`Profile point · ${formatLength(hover.distance, unit)} along azimuth`, {
      className: "tp-tooltip",
      direction: "top",
      offset: [0, -10],
    });
    dot.addTo(map);
    dot.bringToFront();
    hoverMarkerRef.current = dot;
    return () => {
      dot.remove();
      if (hoverMarkerRef.current === dot) hoverMarkerRef.current = null;
    };
  }, [hover, result.locationValid, unit]);

  const blocked = !result.valid || !result.locationValid;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" aria-label="Coverage map" />

      <button
        type="button"
        onClick={fitToCoverage}
        title="Zoom to the coverage sector"
        className="absolute right-2 top-2 z-[1000] inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/85 px-2.5 text-[11px] font-medium text-slate-200 shadow-lg backdrop-blur transition hover:bg-slate-800"
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
        </svg>
        Fit to coverage
      </button>

      {blocked && (
        <Overlay tone="error">
          <strong className="block text-sm">Nothing to draw</strong>
          {result.locationValid ? "Fix the inputs to show the coverage sector." : "Enter a valid latitude and longitude."}
        </Overlay>
      )}
    </div>
  );
}
