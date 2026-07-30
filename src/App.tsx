import { useCallback, useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import ElevationProfile, { type ElevationSample } from "./components/ElevationProfile";
import TiltMap, { type BaseMapId, type DisplayBeam } from "./components/TiltMap";
import {
  destinationPoint,
  kmlColor,
  normalizeBearing,
} from "./lib/geo";

type FormState = {
  latitude: number;
  longitude: number;
  antennaHeight: number;
  dtmHeight: number;
  includeDtm: boolean;
  azimuth: number;
  tilt: number;
  horizontalBeamwidth: number;
  verticalBeamwidth: number;
  receiverHeight: number;
  targetDistance: number;
};

type SolveMode = "distance" | "angle";

type Beam = {
  name: string;
  angle: number;
  color: string;
  show: boolean;
};

type BeamResult = Beam & {
  distance: number;
  flatDistance: number;
  isTerrainAdjusted: boolean;
  reachesGround: boolean;
};

type CoverageResult = {
  mode: SolveMode;
  downtiltAngle: number;
  receiverDistance: number;
  innerRadius: number;
  outerRadius: number;
  effectiveHeight: number;
  receiverHeight: number;
  heightDifference: number;
  verticalBeamwidth: number;
  beams: BeamResult[];
};

const MAX_DISTANCE = 15000;
const FREQUENCY_MHZ = 1800;

type DistanceUnit = "km" | "m" | "ft";

const initialState: FormState = {
  latitude: 16.6933,
  longitude: 96.2516,
  antennaHeight: 32,
  dtmHeight: 540,
  includeDtm: true,
  azimuth: 120,
  tilt: 8,
  horizontalBeamwidth: 30,
  verticalBeamwidth: 3,
  receiverHeight: 0,
  targetDistance: 5442,
};

export default function App() {
  const [form, setForm] = useState<FormState>(initialState);
  const [baseMap, setBaseMap] = useState<BaseMapId>("light");
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>("m");
  const [showRings, setShowRings] = useState(true);
  const [showElevationChart, setShowElevationChart] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSamples, setProfileSamples] = useState<ElevationSample[]>([]);
  const [profileRange, setProfileRange] = useState<number | "auto">("auto");
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [solveMode, setSolveMode] = useState<SolveMode>("distance");
  const [hoverLocation, setHoverLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [showLegend, setShowLegend] = useState(true);
  // Slide-in sidebar (open by default on desktop, closed on mobile)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") return window.innerWidth >= 768;
    return true;
  });
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setSidebarOpen(true);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Auto-fetch the real DTM (terrain) elevation whenever the site moves so the
  // ribbon always reports the actual ground height instead of a typed value.
  useEffect(() => {
    let cancelled = false;
    const lat = form.latitude;
    const lon = form.longitude;

    const timer = setTimeout(async () => {
      setDtmFetching(true);
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { elevation?: number[] };
        const value = json.elevation?.[0];
        if (!cancelled && typeof value === "number" && Number.isFinite(value)) {
          setForm((current) =>
            current.latitude === lat && current.longitude === lon
              ? { ...current, dtmHeight: Math.round(value * 10) / 10 }
              : current,
          );
        }
        setDtmFetching(false);
      } catch {
        setDtmFetching(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.latitude, form.longitude]);
  const beams: Beam[] = useMemo(
    () => [
      { name: "Upper -3 dB", angle: 0, color: "#06b6d4", show: true },
      { name: "Central", angle: 0, color: "#eab308", show: true },
      { name: "Lower -3 dB", angle: 0, color: "#f97316", show: true },
    ],
    [],
  );

  const effectiveHeight = form.includeDtm
    ? form.antennaHeight + form.dtmHeight
    : form.antennaHeight;

  // Results rendered on the map. They are fixed after Calculate and do NOT change
  // when the elevation chart is opened. Terrain intersections stay inside the chart.
  const results: BeamResult[] = useMemo(() => {
    if (!coverage) return [];
    return coverage.beams;
  }, [coverage]);

  const displayBeams: DisplayBeam[] = useMemo(
    () =>
      results.map((beam) => ({
        name: beam.name,
        color: beam.color,
        show: beam.show,
        distance: beam.distance,
      })),
    [results],
  );

  const updateNumber = (key: keyof FormState, value: string) => {
    // Don't overwrite state for in-progress input (clearing, lone minus/dot).
    // This lets the user empty a field without it snapping back to 0.
    if (value === "" || value === "-" || value === ".") return;
    setForm((current) => ({ ...current, [key]: Number(value) }));
  };

  // Pasternack-style calculation. Two modes:
  //  - distance: known tilt  ->  receiver distance + inner/outer radius
  //  - angle:    known target distance + receiver height -> required downtilt angle
  const handleCalculate = () => {
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const deg = (r: number) => (r * 180) / Math.PI;
    const H = effectiveHeight;

    // Height difference between transmitter and receiver (Ht - Hr)
    const heightDiff = H - form.receiverHeight;

    let downtiltAngle: number;
    let receiverDistance: number;

    if (solveMode === "angle") {
      // Adt = arctan((Ht - Hr) / D) - when solving for angle, use height difference
      const D = Math.max(form.targetDistance, 0.001);
      downtiltAngle = deg(Math.atan(heightDiff / D));
      receiverDistance = D;
    } else {
      downtiltAngle = form.tilt;
      // For coverage distance, use full effective height H so Receiver Distance,
      // Inner and Outer radii all use the same reference and stay stable.
      // This matches the example: 5442 m, 2943 m, 3.277e+4 m for H=572 m, tilt=6°.
      receiverDistance = downtiltAngle > 0 ? H / Math.tan(rad(downtiltAngle)) : Infinity;
    }

    // Coverage radii measured from the antenna base using full height H
    const radiusAt = (angle: number) => (angle > 0 ? H / Math.tan(rad(angle)) : Infinity);
    const innerRadius = radiusAt(downtiltAngle + form.verticalBeamwidth / 2);
    const outerRadius = radiusAt(downtiltAngle - form.verticalBeamwidth / 2);

    const angleFor = (name: string) => {
      if (name.includes("Upper")) return downtiltAngle - form.verticalBeamwidth / 2;
      if (name.includes("Lower")) return downtiltAngle + form.verticalBeamwidth / 2;
      return downtiltAngle;
    };

    const beamResults: BeamResult[] = beams.map((beam) => {
      const angle = angleFor(beam.name);
      const d = radiusAt(angle);
      const clamped = Number.isFinite(d) ? Math.min(d, MAX_DISTANCE) : MAX_DISTANCE;
      return {
        ...beam,
        angle,
        distance: clamped,
        flatDistance: clamped,
        isTerrainAdjusted: false,
        reachesGround: angle > 0,
      };
    });

    // Keep the tilt field in sync when solving for the angle
    if (solveMode === "angle") {
      setForm((current) => ({
        ...current,
        tilt: Math.round(downtiltAngle * 100) / 100,
      }));
    }

    setCoverage({
      mode: solveMode,
      downtiltAngle,
      receiverDistance,
      innerRadius,
      outerRadius,
      effectiveHeight: H,
      receiverHeight: form.receiverHeight,
      heightDifference: heightDiff,
      verticalBeamwidth: form.verticalBeamwidth,
      beams: beamResults,
    });
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  // Track whether DTM is currently being fetched so the ribbon can show it.
  const [dtmFetching, setDtmFetching] = useState(false);

  const handleSiteChange = useCallback((lat: number, lon: number) => {
    setForm((current) => ({ ...current, latitude: lat, longitude: lon, dtmHeight: 0 }));
    setDtmFetching(true);
  }, []);

  // Elevation profile intersections are used only inside the chart itself.
  // They do NOT modify the Beam Coverage Result - the coverage stays fixed after Calculate.
  const handleIntersections = useCallback(() => {
    // no-op - keep coverage stable
  }, []);

  // Pasternack-style value: plain up to ~10k, exponential beyond, "∞" for no ground hit.
  const formatCoverage = (meters: number) => {
    if (!Number.isFinite(meters)) return "∞";
    let value = meters;
    let unit = "m";
    if (distanceUnit === "km") {
      value = meters / 1000;
      unit = "km";
    } else if (distanceUnit === "ft") {
      value = meters * 3.28084;
      unit = "ft";
    }
    const text = value >= 10000 ? value.toExponential(3) : value.toFixed(distanceUnit === "km" ? 3 : 0);
    return `${text} ${unit}`;
  };

  const loadElevationProfile = async (rangeOverride?: number | "auto") => {
    if (!coverage && !rangeOverride) return;
    const selectedRange = rangeOverride ?? profileRange;
    // Cover the farthest beam (the upper -3 dB ray) plus margin so every ray can
    // find its terrain intersection inside the sampled profile.
    const farthestFlat = coverage
      ? Math.max(...coverage.beams.map((b) => b.flatDistance))
      : effectiveHeight / Math.tan((Math.max(form.tilt - form.verticalBeamwidth / 2, 0.5) * Math.PI) / 180);
    const autoDistance = Math.min(
      MAX_DISTANCE,
      Math.max(farthestFlat * 1.35, 400),
    );
    const profileDistance =
      selectedRange === "auto"
        ? autoDistance
        : Math.min(MAX_DISTANCE, Math.max(500, selectedRange));

    setShowElevationChart(true);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
    setProfileLoading(true);
    setProfileError(null);
    setProfileSamples([]);

    try {
      // --- STEP 1: ROUTE SAMPLING (64 points sampled along azimuth via geodesic destinationPointWgs84) ---
      const numSamples = 64;
      const sampledCoords: { lat: number; lon: number; distance: number }[] = [];
      const az = normalizeBearing(form.azimuth);

      for (let i = 0; i < numSamples; i++) {
        const d = (i / (numSamples - 1)) * profileDistance;
        const point = destinationPoint(form.latitude, form.longitude, az, d);
        sampledCoords.push({ lat: point.lat, lon: point.lon, distance: d });
      }

      // --- STEP 2: ELEVATION FETCH FROM OPEN-METEO API ---
      const latsStr = sampledCoords.map((c) => c.lat.toFixed(5)).join(",");
      const lonsStr = sampledCoords.map((c) => c.lon.toFixed(5)).join(",");
      const openMeteoUrl = `https://api.open-meteo.com/v1/elevation?latitude=${latsStr}&longitude=${lonsStr}`;

      const res = await fetch(openMeteoUrl);
      if (!res.ok) throw new Error("Open-Meteo elevation request failed");

      const json = (await res.json()) as { elevation?: number[] };
      const elevations = json.elevation;

      if (!Array.isArray(elevations) || elevations.length !== numSamples) {
        throw new Error("Invalid elevation response format");
      }

      const validSamples: ElevationSample[] = sampledCoords.map((c, i) => ({
        distance: c.distance,
        elevation: elevations[i] ?? 0,
      }));

      setProfileSamples(validSamples);
    } catch {
      // Fallback to OpenTopoData if Open-Meteo is unreachable
      try {
        const end = destinationPoint(
          form.latitude,
          form.longitude,
          normalizeBearing(form.azimuth),
          profileDistance,
        );
        const locations = `${form.latitude},${form.longitude}|${end.lat},${end.lon}`;
        const query = new URLSearchParams({
          locations,
          samples: "64",
          interpolation: "cubic",
        });
        const resFallback = await fetch(`https://api.opentopodata.org/v1/srtm90m?${query.toString()}`);
        if (!resFallback.ok) throw new Error("Fallback failed");
        const jsonFallback = (await resFallback.json()) as { results?: { elevation?: number | null }[] };
        const rawSamples = jsonFallback.results ?? [];
        const validSamples = rawSamples
          .map((sample, index) => ({
            distance: (profileDistance * index) / Math.max(rawSamples.length - 1, 1),
            elevation: sample.elevation,
          }))
          .filter((sample): sample is ElevationSample => typeof sample.elevation === "number");

        if (validSamples.length < 2) throw new Error("No fallback samples");
        setProfileSamples(validSamples);
      } catch {
        setProfileError("Terrain data could not be loaded. Check your connection and try again.");
      }
    } finally {
      setProfileLoading(false);
    }
  };

  const onExportKml = () => {
    const buildSectorCoordinates = (distance: number) => {
      const hbwHalf = form.horizontalBeamwidth / 2;
      const startBearing = form.azimuth - hbwHalf;
      const endBearing = form.azimuth + hbwHalf;
      const steps = 32;
      const coords = [`${form.longitude},${form.latitude}`];

      for (let i = 0; i <= steps; i += 1) {
        const bearing = normalizeBearing(startBearing + ((endBearing - startBearing) * i) / steps);
        const point = destinationPoint(form.latitude, form.longitude, bearing, distance);
        coords.push(`${point.lon},${point.lat}`);
      }

      coords.push(`${form.longitude},${form.latitude}`);
      return coords.join(" ");
    };

    const sitePlacemark = `    <Placemark>
      <name>Antenna site</name>
      <description>Latitude: ${form.latitude.toFixed(6)}, Longitude: ${form.longitude.toFixed(6)}, Antenna height: ${form.antennaHeight.toFixed(1)} m, DTM included: ${form.includeDtm ? "yes" : "no"}</description>
      <styleUrl>#siteIcon</styleUrl>
      <Point>
        <coordinates>${form.longitude},${form.latitude}</coordinates>
      </Point>
    </Placemark>`;

    const placemarks = results
      .filter((beam) => beam.show)
      .map((beam) => {
        const coords = buildSectorCoordinates(beam.distance);
        return `    <Placemark>
      <name>${beam.name} coverage</name>
      <description>Tilt angle: ${beam.angle.toFixed(2)} deg, ground distance: ${beam.distance.toFixed(0)} m. This polygon is clamped to ground and does not include antenna height.</description>
      <Style>
        <LineStyle><color>${kmlColor(beam.color, "ff")}</color><width>2</width></LineStyle>
        <PolyStyle><color>${kmlColor(beam.color)}</color></PolyStyle>
      </Style>
      <Polygon>
        <altitudeMode>clampToGround</altitudeMode>
        <outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>
      </Polygon>
    </Placemark>`;
      })
      .join("\n");

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>TiltPlane antenna tilt</name>
    <description>Effective height: ${effectiveHeight.toFixed(2)} m. DTM: ${form.includeDtm ? "yes" : "no"}.</description>
    <Style id="siteIcon">
      <IconStyle>
        <scale>1.15</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0.85</scale></LabelStyle>
    </Style>
${sitePlacemark}
${placemarks}
  </Document>
</kml>`;

    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tiltplane.kml";
    link.click();
    URL.revokeObjectURL(url);
  };

  // Builds a printable PDF engineering report from the current Calculate snapshot,
  // including site parameters, coverage results, beam table, terrain profile summary,
  // and a simple side-view diagram of the antenna beam geometry.
  const handleGenerateReport = () => {
    if (!coverage) return;

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    let y = 48;

    const heading = (text: string, size = 14) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(size);
      doc.setTextColor(15, 23, 42);
      doc.text(text, margin, y);
      y += size * 0.9;
    };

    const rule = () => {
      y += 6;
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.75);
      doc.line(margin, y, pageWidth - margin, y);
      y += 16;
    };

    const kv = (label: string, value: string) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(100, 116, 139);
      doc.text(label, margin, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text(value, margin + 160, y);
      y += 16;
    };

    const ensureSpace = (needed: number) => {
      if (y + needed > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = 48;
      }
    };

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42);
    doc.text("Antenna Tilt & Coverage Report", margin, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated ${new Date().toLocaleString()}`, margin, y);
    y += 20;
    rule();

    // Site information
    heading("Site Information");
    y += 4;
    kv("Latitude", `${form.latitude.toFixed(6)}°`);
    kv("Longitude", `${form.longitude.toFixed(6)}°`);
    kv("Azimuth", `${normalizeBearing(form.azimuth).toFixed(1)}°`);
    kv("Antenna height (AGL)", `${form.antennaHeight.toFixed(1)} m`);
    kv("DTM height", form.includeDtm ? `${form.dtmHeight.toFixed(1)} m (included)` : "excluded");
    kv("Effective height (AMSL)", `${effectiveHeight.toFixed(1)} m`);
    rule();

    // Antenna parameters
    heading("Antenna Parameters");
    y += 4;
    kv("Solve mode", coverage.mode === "angle" ? "Downtilt angle (from distance)" : "Coverage distance (from tilt)");
    kv("Downtilt angle", `${coverage.downtiltAngle.toFixed(3)}°`);
    kv("Horizontal beamwidth", `${form.horizontalBeamwidth.toFixed(1)}°`);
    kv("Vertical beamwidth", `${form.verticalBeamwidth.toFixed(1)}°`);
    kv("Receiver height (Hr)", `${form.receiverHeight.toFixed(1)} m`);
    kv("Height difference (Ht-Hr)", `${coverage.heightDifference.toFixed(1)} m`);
    rule();

    // Coverage results
    ensureSpace(120);
    heading("Coverage Results");
    y += 4;
    kv("Receiver distance", formatCoverage(coverage.receiverDistance));
    kv("Inner coverage radius", formatCoverage(coverage.innerRadius));
    kv("Outer coverage radius", formatCoverage(coverage.outerRadius));
    rule();

    // Beam table
    ensureSpace(120);
    heading("Beam Planes");
    y += 8;
    const colX = [margin, margin + 150, margin + 280, margin + 400];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(71, 85, 105);
    doc.text("Plane", colX[0], y);
    doc.text("Angle", colX[1], y);
    doc.text("Distance", colX[2], y);
    doc.text("Ground hit", colX[3], y);
    y += 6;
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;
    results.forEach((beam) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(beam.name, colX[0], y);
      doc.text(`${beam.angle.toFixed(2)}°`, colX[1], y);
      doc.text(formatCoverage(beam.distance), colX[2], y);
      doc.text(beam.reachesGround ? "Yes" : "No (above horizon)", colX[3], y);
      y += 16;
    });
    rule();

    // Terrain profile summary (if elevation chart has been loaded)
    if (profileSamples.length > 1) {
      ensureSpace(140);
      heading("Terrain Profile Summary");
      y += 4;
      const elevations = profileSamples.map((s) => s.elevation);
      const minE = Math.min(...elevations);
      const maxE = Math.max(...elevations);
      const avgE = elevations.reduce((a, b) => a + b, 0) / elevations.length;
      const maxDist = profileSamples[profileSamples.length - 1].distance;
      kv("Profile distance", formatCoverage(maxDist));
      kv("Min terrain elevation", `${minE.toFixed(0)} m AMSL`);
      kv("Max terrain elevation", `${maxE.toFixed(0)} m AMSL`);
      kv("Avg terrain elevation", `${avgE.toFixed(0)} m AMSL`);
      kv("Data source", "Open-Meteo elevation API (64 geodesic samples)");
      rule();

      // Simple side-view beam diagram
      ensureSpace(180);
      heading("Beam Geometry Diagram", 12);
      y += 10;
      const diagTop = y;
      const diagHeight = 130;
      const diagLeft = margin;
      const diagWidth = pageWidth - margin * 2;
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(1);
      doc.rect(diagLeft, diagTop, diagWidth, diagHeight);

      const groundY = diagTop + diagHeight - 20;
      const siteX = diagLeft + 30;
      const antennaTopY = diagTop + 20;

      // Ground line
      doc.setDrawColor(120, 113, 108);
      doc.line(diagLeft + 5, groundY, diagLeft + diagWidth - 5, groundY);

      // Antenna mast
      doc.setDrawColor(213, 16, 16);
      doc.setLineWidth(2);
      doc.line(siteX, groundY, siteX, antennaTopY + 40);

      // Beam lines (scaled to fit diagram)
      const maxBeamDist = Math.max(...results.map((b) => b.distance), 1);
      const scaleX = (diagWidth - 60) / maxBeamDist;
      const colorFor = (name: string) =>
        name === "Central" ? [234, 179, 8] : name.includes("Upper") ? [6, 182, 212] : [249, 115, 22];

      results.forEach((beam) => {
        const [r, g, b] = colorFor(beam.name);
        doc.setDrawColor(r, g, b);
        doc.setLineWidth(1.5);
        const endX = Math.min(siteX + beam.distance * scaleX, diagLeft + diagWidth - 5);
        const endY = beam.reachesGround ? groundY : antennaTopY + 40 - beam.angle * 2;
        doc.line(siteX, antennaTopY + 40, endX, Math.max(endY, diagTop + 15));
      });

      y = diagTop + diagHeight + 20;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        "Yellow = central beam, cyan = upper -3dB, orange = lower -3dB (not to scale).",
        diagLeft,
        y,
      );
      y += 20;
    }

    // Footer disclaimer
    ensureSpace(60);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, pageWidth - margin, y);
    y += 16;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      doc.splitTextToSize(
        "This report is a planning and visualization aid only. Real radio coverage depends on terrain profile, clutter, antenna radiation pattern, frequency, EIRP, propagation model, and receiver conditions. Terrain data sourced from Open-Meteo / OpenTopoData public elevation APIs.",
        pageWidth - margin * 2,
      ),
      margin,
      y,
    );

    doc.save(`antenna-tilt-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // Single source of truth for the summary numbers so "Beam Coverage Result" always
  // matches what is drawn on the map / elevation chart — including terrain adjustment
  // once the profile has been opened and ray-terrain intersections are known.
  // Coverage summary is fixed after Calculate - it never changes when opening the elevation chart
  const summary = useMemo(() => {
    if (!coverage) return null;
    return {
      downtiltAngle: coverage.downtiltAngle,
      receiverDistance: coverage.receiverDistance,
      innerRadius: coverage.innerRadius,
      outerRadius: coverage.outerRadius,
      effectiveHeight: coverage.effectiveHeight,
      receiverHeight: coverage.receiverHeight,
      heightDifference: coverage.heightDifference,
      verticalBeamwidth: coverage.verticalBeamwidth,
      mode: coverage.mode,
    };
  }, [coverage]);

  // Keep the report generator available for future export integrations without exposing it in the UI.
  void handleGenerateReport;

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-50 text-slate-800 md:h-screen">
      {/* Global Header (48px) — matches sector-to-site reference */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 shadow-sm z-30 relative">
        {/* Panel toggle — visible on all screens like the reference */}
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-700 transition hover:bg-slate-100"
          aria-label={sidebarOpen ? "Hide panel" : "Show panel"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>


        <span className="truncate text-[13px] font-bold tracking-tight text-slate-900 sm:text-sm">
          Antenna Tilt &amp; Coverage Visualization
        </span>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Mobile backdrop when sidebar is open */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-20 bg-slate-900/30 backdrop-blur-[1px] md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Parameters panel — slides in/out from the left */}
        <aside
          className={`absolute inset-y-0 left-0 z-30 flex w-[92%] max-w-[420px] min-h-0 flex-col overflow-y-auto bg-white text-xs shadow-xl transition-transform duration-300 md:static md:z-auto md:w-96 md:flex md:flex-col md:overflow-hidden md:border-r md:border-slate-200 md:shadow-none ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0 md:hidden"
          }`}
        >
          {/* Calculation mode tabs */}
          <div
            className="flex border-b border-slate-200 bg-slate-50 text-[11px] font-semibold"
            role="tablist"
            aria-label="Calculation mode"
          >
            {[
              { id: "distance" as const, label: "Coverage distance" },
              { id: "angle" as const, label: "Downtilt angle" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={solveMode === tab.id}
                onClick={() => setSolveMode(tab.id)}
                className={`flex-1 border-b-2 px-3 py-2.5 transition ${
                  solveMode === tab.id
                    ? "border-slate-900 bg-white text-slate-900"
                    : "border-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Inputs section — flows naturally on mobile, scrolls on desktop */}
          <div className="px-3 pt-3 md:min-h-0 md:flex-1 md:overflow-y-auto">
            <div className="flex flex-col gap-3">
              <Field label="Latitude" value={form.latitude} step="0.0001" onChange={(v) => updateNumber("latitude", v)} />
              <Field label="Longitude" value={form.longitude} step="0.0001" onChange={(v) => updateNumber("longitude", v)} />
              <Field label="Ant. height" suffix="m" value={form.antennaHeight} onChange={(v) => updateNumber("antennaHeight", v)} />
              <Field label="Rx height" suffix="m" step="0.1" value={form.receiverHeight} onChange={(v) => updateNumber("receiverHeight", v)} />
              <Field label="Azimuth" suffix="deg" value={form.azimuth} onChange={(v) => updateNumber("azimuth", v)} />
              {solveMode === "distance" ? (
                <Field label="Tilt" suffix="deg" step="0.1" value={form.tilt} onChange={(v) => updateNumber("tilt", v)} />
              ) : (
                <Field label="Distance" suffix="m" value={form.targetDistance} onChange={(v) => updateNumber("targetDistance", v)} />
              )}
              <Field label="Horiz BW" suffix="deg" value={form.horizontalBeamwidth} onChange={(v) => updateNumber("horizontalBeamwidth", v)} />
              <Field label="Vert BW" suffix="deg" value={form.verticalBeamwidth} onChange={(v) => updateNumber("verticalBeamwidth", v)} />
            </div>

            <label className="mt-4 flex cursor-pointer items-center justify-between gap-2 border border-slate-200 bg-slate-50/50 rounded-lg px-3 py-2.5 text-[11px] uppercase tracking-wider font-medium hover:bg-slate-100/50 transition">
              <span>
                Include DTM
                <span className="block text-[10px] normal-case font-normal text-slate-500">
                  Effective = ant. + {form.includeDtm ? "DTM" : "0"}
                </span>
              </span>
              <input
                type="checkbox"
                checked={form.includeDtm}
                onChange={(event) =>
                  setForm((current) => ({ ...current, includeDtm: event.target.checked }))
                }
                className="h-4 w-4 accent-slate-900 rounded cursor-pointer"
              />
            </label>
          </div>

          {/* Action buttons — inline after inputs on mobile, pinned to bottom on desktop */}
          <div className="mt-5 px-3 pb-5 md:mt-0 md:shrink-0 md:border-t md:border-slate-200 md:py-3">
            <div className="flex flex-col gap-2">
              <button
                onClick={handleCalculate}
                className="btn-black block w-full text-center text-xs uppercase tracking-wider"
              >
                Calculate
              </button>
              <button
                onClick={() => void loadElevationProfile()}
                disabled={!coverage}
                className="btn-black block w-full text-center text-xs uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                title={!coverage ? "Calculate coverage first" : "Open terrain profile"}
              >
                Elevation Chart
              </button>
              <button
                onClick={onExportKml}
                disabled={!coverage}
                className="btn-black block w-full text-center text-xs uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                title={!coverage ? "Calculate coverage first" : "Download Google Earth KML"}
              >
                Export KML
              </button>
            </div>
          </div>

        </aside>

        {/* Map + Elevation area — always visible */}
        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1">
          <TiltMap
            latitude={form.latitude}
            longitude={form.longitude}
            azimuth={form.azimuth}
            horizontalBeamwidth={form.horizontalBeamwidth}
            beams={displayBeams}
            baseMap={baseMap}
            showRings={showRings}
            showCellLabel={false}
            showNeighbors={false}
            onSiteChange={handleSiteChange}
            onAzimuthChange={(az) => setForm((current) => ({ ...current, azimuth: az }))}
            hoverMarker={hoverLocation}
          />

          {/* Map layers panel - top right | hidden on mobile when the sidebar is open */}
          <div className={`absolute right-2 top-2 z-[500] w-56 max-w-[calc(100%-1rem)] flex-col gap-2 sm:right-3 sm:top-3 md:flex ${sidebarOpen ? "hidden md:flex" : "flex"}`}>
            <div className="flex w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm text-[11px] font-medium">
              {([
                { id: "light" as const, label: "Map" },
                { id: "streets" as const, label: "Street" },
                { id: "satellite" as const, label: "Sat" },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setBaseMap(opt.id)}
                  className={`flex-1 px-3 py-1.5 transition ${
                    baseMap === opt.id
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex w-full flex-col gap-1 text-[11px]">
              <LayerToggle label="Coverage rings (1/2/3 km)" checked={showRings} onChange={() => setShowRings((v) => !v)} />
            </div>
          </div>

          {/* Coverage Legend — floating map-legend card, hidden on mobile when the sidebar is open */}
          {summary && (
            <div className={`absolute right-3 top-24 z-[500] w-56 overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur-sm md:block ${sidebarOpen ? "hidden md:block" : "block"}`}>
              <button
                onClick={() => setShowLegend((v) => !v)}
                className="flex w-full items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-1.5"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  Coverage Legend
                </span>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className={`text-slate-400 transition-transform ${showLegend ? "" : "-rotate-90"}`}
                >
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {showLegend && (
                <div className="px-3 py-2">
                  <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-[10px] font-semibold text-slate-500">Downtilt Angle</span>
                    <span
                      className={`font-mono text-[12px] font-bold ${
                        summary.mode === "angle" ? "text-indigo-600" : "text-slate-900"
                      }`}
                    >
                      {summary.downtiltAngle.toFixed(2)}°
                    </span>
                  </div>
                  <LegendRow
                    color="#f97316"
                    label="Inner radius"
                    value={formatCoverage(summary.innerRadius)}
                  />
                  <LegendRow
                    color="#eab308"
                    label="Central beam"
                    value={formatCoverage(summary.receiverDistance)}
                    active={summary.mode === "distance"}
                  />
                  <LegendRow
                    color="#06b6d4"
                    label="Outer radius"
                    value={formatCoverage(summary.outerRadius)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Bottom Data Ribbon — single line, scrolls horizontally on small screens */}
          <div className="absolute inset-x-0 bottom-0 z-[500] flex h-7 items-center overflow-x-auto border-t border-slate-200 bg-white/95 px-2 text-[7.5px] font-medium text-slate-700 sm:text-[9px] md:h-9 md:px-4 md:text-[11px]">
            <div className="flex min-w-max items-center gap-2 whitespace-nowrap sm:gap-3 md:gap-4">
              <span className="font-mono">LAT: {form.latitude.toFixed(4)}° / LON: {form.longitude.toFixed(4)}°</span>
              <span>AZ: {normalizeBearing(form.azimuth).toFixed(0)}°</span>
              <span>TILT: {form.tilt.toFixed(1)}°</span>
              <span>
                HEIGHT: Ant({form.antennaHeight.toFixed(0)}m)
                {form.includeDtm && (
                  <> + DTM({dtmFetching ? "…" : `${form.dtmHeight.toFixed(0)}m`})</>
                )}
                {" "}= <span className="font-mono font-semibold text-slate-900">{effectiveHeight.toFixed(1)}m</span>
              </span>
            </div>
          </div>
          </div>

          {/* Terrain profile — docked strip below the map on all screens */}
          {showElevationChart && (
            <section className="flex shrink-0 flex-col border-t border-slate-200 bg-white relative z-[510]">
              <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-1.5">
                <div className="flex items-center justify-between gap-3 sm:justify-start">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    Terrain Elevation Profile
                  </span>
                  <button
                    type="button"
                    onClick={() => { setShowElevationChart(false); setHoverLocation(null); }}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 sm:hidden"
                  >
                    Close
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Range</span>
                  <input
                    type="range"
                    min="500"
                    max="15000"
                    step="100"
                    value={profileRange === "auto" ? 3000 : profileRange}
                    onChange={(e) => setProfileRange(Number(e.target.value))}
                    onMouseUp={() => {
                      if (profileSamples.length > 1) setTimeout(() => loadElevationProfile(), 0);
                    }}
                    onTouchEnd={() => {
                      if (profileSamples.length > 1) setTimeout(() => loadElevationProfile(), 0);
                    }}
                    className="h-0.5 w-24 sm:w-28 cursor-pointer appearance-none bg-slate-300 accent-slate-950 focus:outline-none"
                  />
                  <span className="w-12 font-mono text-[10px] font-bold text-slate-800">
                    {profileRange === "auto" ? "Auto" : `${(profileRange / 1000).toFixed(1)} km`}
                  </span>
                  <span className="mx-0.5 h-3 w-px bg-slate-300" />
                  <label className="flex items-center gap-1.5 text-[9px] font-semibold text-slate-500">
                    Unit
                    <select
                      value={distanceUnit}
                      onChange={(e) => setDistanceUnit(e.target.value as DistanceUnit)}
                      className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 outline-none"
                    >
                      <option value="km">km</option>
                      <option value="m">m</option>
                      <option value="ft">ft</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => { setShowElevationChart(false); setHoverLocation(null); }}
                    className="hidden rounded-md border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 sm:block"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="px-2 py-2 sm:px-3">
                {profileLoading && (
                  <div className="flex h-28 flex-col items-center justify-center gap-2 text-[11px] text-slate-500">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" />
                    Fetching terrain samples...
                  </div>
                )}
                {!profileLoading && profileError && (
                  <div className="flex h-28 flex-col items-center justify-center text-center">
                    <p className="text-[11px] font-semibold text-slate-700">Elevation profile unavailable</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">{profileError}</p>
                    <button
                      onClick={() => void loadElevationProfile()}
                      className="mt-2 rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-slate-800"
                    >
                      Try again
                    </button>
                  </div>
                )}
                {!profileLoading && !profileError && profileSamples.length > 1 && (
                  <ElevationProfile
                    samples={profileSamples}
                    antennaAmsl={profileSamples[0].elevation + form.antennaHeight}
                    siteGroundAmsl={profileSamples[0].elevation}
                    antennaHeight={form.antennaHeight}
                    azimuth={normalizeBearing(form.azimuth)}
                    tilt={form.tilt}
                    verticalBeamwidth={form.verticalBeamwidth}
                    frequencyMhz={FREQUENCY_MHZ}
                    distanceUnit={distanceUnit}
                    latitude={form.latitude}
                    longitude={form.longitude}
                    onIntersections={handleIntersections}
                    onHoverLocation={(loc) => {
                      if (loc) setHoverLocation({ lat: loc.lat, lon: loc.lon });
                      else setHoverLocation(null);
                    }}
                    beams={results.map((beam) => ({
                      name: beam.name,
                      angle: beam.angle,
                      color: beam.color,
                      distance: beam.distance,
                    }))}
                  />
                )}
              </div>

            </section>
          )}
        </main>
      </div>

    </div>
  );
}

function LayerToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 border px-2.5 py-1 rounded shadow-sm transition ${
        checked
          ? "border-slate-300 bg-white text-slate-900 font-medium"
          : "border-slate-200 bg-white/80 text-slate-400"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3 w-3 accent-slate-900 cursor-pointer"
      />
      {label}
    </label>
  );
}

function LegendRow({
  color,
  label,
  value,
  active = false,
}: {
  color: string;
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white"
          style={{ backgroundColor: color, boxShadow: `0 0 0 1px ${color}55` }}
        />
        <span className={`truncate text-[11px] ${active ? "font-bold text-slate-900" : "text-slate-600"}`}>
          {label}
        </span>
      </div>
      <span className={`shrink-0 font-mono text-[11px] font-bold ${active ? "text-indigo-600" : "text-slate-800"}`}>
        {value}
      </span>
    </div>
  );
}

function Field({
  label,
  value,
  step = "1",
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  step?: string;
  suffix?: string;
  onChange: (value: string) => void;
}) {
  // Local text buffer so the field can be fully cleared while editing.
  // It syncs from the numeric prop only when that prop actually changes.
  const [text, setText] = useState(() => String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <label className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
        {label}
      </span>
      <div className="flex flex-1 items-center overflow-hidden border border-slate-200 rounded-md bg-white hover:border-slate-300 focus-within:border-slate-400 transition">
        <input
          type="number"
          value={text}
          step={step}
          onChange={(event) => {
            setText(event.target.value);
            onChange(event.target.value);
          }}
          onBlur={() => setText(String(value))}
          className="w-full bg-transparent px-2.5 py-1.5 text-[12px] text-slate-800 outline-none"
        />
        {suffix && (
          <span className="flex w-12 items-center justify-center border-l border-slate-200 bg-slate-50 py-1.5 text-[10px] text-slate-500 font-medium">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}
