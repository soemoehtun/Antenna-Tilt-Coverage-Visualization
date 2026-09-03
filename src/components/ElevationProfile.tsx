import { useEffect, useMemo, useState } from "react";
import { destinationPoint } from "../lib/geo";

export type ElevationSample = {
  distance: number;
  elevation: number;
};

export type ProfileBeam = {
  name: string;
  angle: number;
  color: string;
};

type DistanceUnit = "km" | "m" | "ft";

export type HoverLocation = {
  lat: number;
  lon: number;
  distance: number;
  elevation: number;
  terrain: number;
  clearance: number;
};

type ElevationProfileProps = {
  samples: ElevationSample[];
  antennaAmsl: number;
  siteGroundAmsl: number;
  antennaHeight: number;
  azimuth: number;
  tilt: number;
  verticalBeamwidth: number;
  beams: ProfileBeam[];
  frequencyMhz: number;
  distanceUnit: DistanceUnit;
  latitude: number;
  longitude: number;
  onIntersections?: (hits: RayIntersection[]) => void;
  onHoverLocation?: (loc: HoverLocation | null) => void;
};

// Canvas with left padding for Y-axis elevation labels
const CHART = { left: 44, right: 8, top: 8, bottom: 22, width: 1200, height: 180 };
const DENSE_POINTS = 260;

export type RayIntersection = {
  beamName: string;
  angle: number;
  color: string;
  distance: number;
  elevation: number;
};

export type DenseSegment = {
  d1: number;
  d2: number;
  z1: number;
  z2: number;
  score: number;
  color: string;
  isShadowed: boolean;
};

export default function ElevationProfile({
  samples,
  antennaAmsl,
  siteGroundAmsl,
  antennaHeight,
  azimuth,
  tilt,
  verticalBeamwidth,
  beams,
  distanceUnit,
  latitude,
  longitude,
  onIntersections,
  onHoverLocation,
}: ElevationProfileProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const isFeet = distanceUnit === "ft";

  const formatDistAxis = (meters: number) => {
    if (distanceUnit === "ft") return `${(meters * 3.28084).toFixed(0)} ft`;
    if (distanceUnit === "m") return `${meters.toFixed(0)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const formatDistLabel = (meters: number) => {
    if (distanceUnit === "ft") return `${(meters * 3.28084).toFixed(0)} ft`;
    if (distanceUnit === "m") return `${meters.toFixed(0)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  };

  const formatElevLabel = (meters: number) => {
    if (isFeet) return `${(meters * 3.28084).toFixed(0)} ft`;
    return `${meters.toFixed(0)} m`;
  };

  const model = useMemo(() => {
    const maxDistance = samples[samples.length - 1]?.distance || 1;
    const plotW = CHART.width - CHART.left - CHART.right;
    const plotH = CHART.height - CHART.top - CHART.bottom;

    const densePoints: { distance: number; elevation: number }[] = [];
    const numSamples = samples.length;
    for (let i = 0; i < DENSE_POINTS; i++) {
      const d = (i / (DENSE_POINTS - 1)) * maxDistance;
      let sIdx = 0;
      while (sIdx < numSamples - 1 && samples[sIdx + 1].distance < d) sIdx++;
      if (sIdx >= numSamples - 1) {
        densePoints.push({ distance: d, elevation: samples[numSamples - 1].elevation });
      } else {
        const s1 = samples[sIdx];
        const s2 = samples[sIdx + 1];
        const t = (d - s1.distance) / (s2.distance - s1.distance || 1);
        densePoints.push({ distance: d, elevation: s1.elevation + t * (s2.elevation - s1.elevation) });
      }
    }

    const rayHeight = (angleDeg: number, d: number) =>
      antennaAmsl - Math.tan((angleDeg * Math.PI) / 180) * d;

    const intersections: RayIntersection[] = [];
    beams.forEach((beam) => {
      let found = false;
      for (let i = 0; i < densePoints.length - 1; i++) {
        const p1 = densePoints[i];
        const p2 = densePoints[i + 1];
        const r1 = rayHeight(beam.angle, p1.distance);
        const r2 = rayHeight(beam.angle, p2.distance);
        const diff1 = p1.elevation - r1;
        const diff2 = p2.elevation - r2;
        if ((diff1 <= 0 && diff2 >= 0) || (diff1 >= 0 && diff2 <= 0)) {
          const frac = Math.abs(diff1) / (Math.abs(diff1) + Math.abs(diff2) || 1);
          intersections.push({
            beamName: beam.name,
            angle: beam.angle,
            color: beam.color,
            distance: p1.distance + frac * (p2.distance - p1.distance),
            elevation: p1.elevation + frac * (p2.elevation - p1.elevation),
          });
          found = true;
          break;
        }
      }
      if (!found && beam.angle > 0) {
        const flatDist = antennaHeight / Math.tan((beam.angle * Math.PI) / 180);
        if (flatDist > 0 && flatDist <= maxDistance) {
          intersections.push({
            beamName: beam.name,
            angle: beam.angle,
            color: beam.color,
            distance: flatDist,
            elevation: rayHeight(beam.angle, flatDist),
          });
        }
      }
    });

    // RF signal scoring along the terrain
    let maxHorizonAngle = -Infinity;
    const denseSegments: DenseSegment[] = [];
    const halfBw = Math.max(verticalBeamwidth / 2, 0.5);
    for (let i = 0; i < densePoints.length - 1; i++) {
      const p1 = densePoints[i];
      const p2 = densePoints[i + 1];
      const midDist = (p1.distance + p2.distance) / 2;
      const midElev = (p1.elevation + p2.elevation) / 2;
      const terrainAngleDeg = (Math.atan2(antennaAmsl - midElev, midDist) * 180) / Math.PI;
      const angularDev = Math.abs(terrainAngleDeg - tilt);
      const beamProximity = Math.exp(-0.5 * Math.pow(angularDev / halfBw, 2));
      const siteAngle = (Math.atan2(midElev - antennaAmsl, midDist) * 180) / Math.PI;
      const isShadowed = siteAngle < maxHorizonAngle - 0.05;
      if (siteAngle > maxHorizonAngle) maxHorizonAngle = siteAngle;
      const losFactor = isShadowed ? 0.08 : 1.0;
      const distFactor = Math.exp(-1.2 * (midDist / maxDistance));
      const score = Math.max(0, Math.min(1, beamProximity * losFactor * distFactor));
      let color = "#ef4444";
      if (isShadowed) color = "#f43f5e";
      else if (score >= 0.5) color = "#22c55e";
      else if (score >= 0.2) color = "#eab308";
      else color = "#f97316";
      denseSegments.push({ d1: p1.distance, d2: p2.distance, z1: p1.elevation, z2: p2.elevation, score, color, isShadowed });
    }

    const beamEndOf = (name: string, angle: number) => {
      const hit = intersections.find((h) => h.beamName === name);
      if (hit) return { endD: hit.distance, endE: hit.elevation };
      return { endD: maxDistance, endE: rayHeight(angle, maxDistance) };
    };

    const allVals: number[] = [];
    densePoints.forEach((p) => allVals.push(p.elevation));
    beams.forEach((b) => {
      allVals.push(rayHeight(b.angle, 0));
      allVals.push(beamEndOf(b.name, b.angle).endE);
    });
    const rawMin = Math.min(...allVals);
    const rawMax = Math.max(...allVals);
    const pad = Math.max((rawMax - rawMin) * 0.18, 18);
    const minE = Math.max(0, Math.floor((rawMin - pad) / 10) * 10);
    const maxE = Math.ceil((rawMax + pad) / 10) * 10;

    const toX = (d: number) => CHART.left + (d / maxDistance) * plotW;
    const toY = (e: number) => CHART.top + ((maxE - e) / (maxE - minE || 1)) * plotH;

    const beamLines = beams.map((b) => {
      const { endD, endE } = beamEndOf(b.name, b.angle);
      return { ...b, points: `${toX(0)},${toY(rayHeight(b.angle, 0))} ${toX(endD)},${toY(endE)}`, endD, endE };
    });

    const upperBeam = beams.find((b) => b.name.includes("Upper")) ?? beams[0];
    const lowerBeam = beams.find((b) => b.name.includes("Lower")) ?? beams[0];
    const upperEnd = beamEndOf(upperBeam.name, upperBeam.angle);
    const lowerEnd = beamEndOf(lowerBeam.name, lowerBeam.angle);
    const lobePoly = [
      ...Array.from({ length: 36 }, (_, i) => {
        const d = (i / 35) * upperEnd.endD;
        return `${toX(d)},${toY(rayHeight(upperBeam.angle, d))}`;
      }),
      `${toX(lowerEnd.endD)},${toY(lowerEnd.endE)}`,
      ...Array.from({ length: 36 }, (_, i) => {
        const d = ((35 - i) / 35) * lowerEnd.endD;
        return `${toX(d)},${toY(rayHeight(lowerBeam.angle, d))}`;
      }),
    ].join(" ");

    const terrainArea = `${densePoints.map((p) => `${toX(p.distance)},${toY(p.elevation)}`).join(" ")} ${CHART.left + plotW},${CHART.top + plotH} ${CHART.left},${CHART.top + plotH}`;

    return { maxDistance, minE, maxE, plotW, plotH, densePoints, denseSegments, intersections, terrainArea, beamLines, lobePoly, toX, toY, rayHeight };
  }, [samples, antennaAmsl, antennaHeight, beams, tilt, verticalBeamwidth]);

  // Report intersections to the parent
  useEffect(() => {
    onIntersections?.(model.intersections);
  }, [model.intersections, onIntersections]);

  // Emit map-location for the current hover point so the map can draw a crosshair
  useEffect(() => {
    if (hoverIndex === null || hoverIndex >= model.densePoints.length) {
      onHoverLocation?.(null);
      return;
    }
    const pt = model.densePoints[hoverIndex];
    const ray = model.rayHeight(tilt, pt.distance);
    const loc = destinationPoint(latitude, longitude, azimuth, pt.distance);
    onHoverLocation?.({
      lat: loc.lat,
      lon: loc.lon,
      distance: pt.distance,
      elevation: pt.elevation,
      terrain: pt.elevation,
      clearance: ray - pt.elevation,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverIndex]);

  const hoverPoint = hoverIndex !== null ? model.densePoints[hoverIndex] : null;
  const hoverRay = hoverPoint ? model.rayHeight(tilt, hoverPoint.distance) : null;
  const hoverClearance = hoverPoint && hoverRay !== null ? hoverRay - hoverPoint.elevation : null;

  const yTicks = Array.from({ length: 4 }, (_, i) => model.maxE - (i / 3) * (model.maxE - model.minE));
  const xTicks = Array.from({ length: 6 }, (_, i) => (i / 5) * model.maxDistance);

  return (
    <div className="w-full bg-white select-none">
      <div className="relative w-full overflow-hidden bg-slate-50">
        <svg
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
          className="block w-full"
          style={{ aspectRatio: "1200 / 280", height: "auto", width: "100%" }}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Terrain elevation profile"
          onMouseLeave={() => { setHoverIndex(null); onHoverLocation?.(null); }}
        >
          <defs>
            <linearGradient id="geSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e0f2fe" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#f8fafc" stopOpacity="0.4" />
            </linearGradient>
            <linearGradient id="geTerrainFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.15" />
            </linearGradient>
            <linearGradient id="geFootprint" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#facc15" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#facc15" stopOpacity="0.04" />
            </linearGradient>
          </defs>

          {/* Sky background */}
          <rect x={CHART.left} y={0} width={model.plotW} height={model.plotH + CHART.top} fill="url(#geSky)" />

          {/* Y-axis elevation grid lines and labels */}
          {yTicks.map((t) => (
            <g key={`y-${t}`}>
              <line
                x1={CHART.left}
                x2={CHART.width - CHART.right}
                y1={model.toY(t)}
                y2={model.toY(t)}
                stroke="#e2e8f0"
                strokeWidth="0.6"
                strokeDasharray="4 4"
              />
              <text
                x={CHART.left - 6}
                y={model.toY(t) + 3}
                textAnchor="end"
                fill="#64748b"
                fontSize="9"
                fontWeight="600"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {formatElevLabel(t)}
              </text>
            </g>
          ))}

          {/* Vertical distance grid lines and labels */}
          {xTicks.map((t, idx) => (
            <g key={`x-${t}`}>
              <line
                x1={model.toX(t)}
                x2={model.toX(t)}
                y1={CHART.top}
                y2={CHART.top + model.plotH}
                stroke="#e2e8f0"
                strokeWidth="0.6"
                strokeDasharray="4 4"
              />
              <text
                x={Math.max(20, Math.min(model.toX(t), CHART.width - 24))}
                y={CHART.height - 6}
                textAnchor={idx === 0 ? "start" : idx === xTicks.length - 1 ? "end" : "middle"}
                fill="#64748b"
                fontSize="10"
                fontWeight="600"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {formatDistAxis(t)}
              </text>
            </g>
          ))}

          {/* Beam lobe footprint polygon */}
          <polygon points={model.lobePoly} fill="url(#geFootprint)" stroke="none" />

          {/* Terrain fill */}
          <polygon points={model.terrainArea} fill="url(#geTerrainFill)" />

          {/* Color-scored RF signal terrain segments */}
          {model.denseSegments.map((seg, idx) => (
            <line
              key={`seg-${idx}`}
              x1={model.toX(seg.d1)}
              y1={model.toY(seg.z1)}
              x2={model.toX(seg.d2)}
              y2={model.toY(seg.z2)}
              stroke={seg.color}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          ))}

          {/* Beam rays */}
          {model.beamLines.map((b) => (
            <polyline
              key={b.name}
              points={b.points}
              fill="none"
              stroke={b.color}
              strokeWidth={b.name === "Central" ? 2.2 : 1.4}
              strokeDasharray={b.name === "Central" ? undefined : "6 4"}
              opacity={b.name === "Central" ? 1 : 0.75}
            />
          ))}

          {/* Antenna mast at site (x = 0) */}
          <line
            x1={model.toX(0) + 1.5}
            x2={model.toX(0) + 1.5}
            y1={model.toY(siteGroundAmsl)}
            y2={model.toY(antennaAmsl)}
            stroke="#d51010"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <circle cx={model.toX(0) + 1.5} cy={model.toY(antennaAmsl)} r="4" fill="#d51010" stroke="white" strokeWidth="1.5" />

          {/* Ray-terrain intersection markers */}
          {model.intersections.map((hit) => (
            <g key={`hit-${hit.beamName}`}>
              <circle cx={model.toX(hit.distance)} cy={model.toY(hit.elevation)} r="4" fill="white" stroke={hit.color} strokeWidth="2.2" />
            </g>
          ))}

          {/* Baseline axis line */}
          <line x1={0} x2={CHART.width} y1={CHART.top + model.plotH} y2={CHART.top + model.plotH} stroke="#cbd5e1" strokeWidth="1" />

          {/* Hover detector zones */}
          {model.densePoints.map((p, i) => (
            <rect
              key={`ha-${i}`}
              x={model.toX(p.distance) - (CHART.width / DENSE_POINTS) / 2}
              y={0}
              width={CHART.width / DENSE_POINTS}
              height={CHART.top + model.plotH}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(i)}
            />
          ))}

          {/* Interactive hover crosshair and card */}
          {hoverPoint && hoverRay !== null && hoverClearance !== null && (
            <g pointerEvents="none">
              <line
                x1={model.toX(hoverPoint.distance)}
                x2={model.toX(hoverPoint.distance)}
                y1={0}
                y2={CHART.top + model.plotH}
                stroke="#0f172a"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.6"
              />
              <circle cx={model.toX(hoverPoint.distance)} cy={model.toY(hoverPoint.elevation)} r="4.5" fill="#0f172a" stroke="white" strokeWidth="2" />
              {(() => {
                const cardW = 175;
                const cardH = 86;
                const cardX = Math.min(
                  Math.max(12, model.toX(hoverPoint.distance) + 12),
                  CHART.width - cardW - 12,
                );
                const cardY = Math.max(
                  CHART.top + 6,
                  Math.min(
                    model.toY(hoverPoint.elevation) - cardH / 2,
                    CHART.top + model.plotH - cardH - 6,
                  ),
                );
                return (
                  <g transform={`translate(${cardX} ${cardY})`}>
                    <rect width={cardW} height={cardH} rx="7" fill="white" stroke="#94a3b8" strokeWidth="1.2" filter="drop-shadow(0 4px 6px rgba(0,0,0,0.1))" />
                    <rect x="0" y="0" width={cardW} height="26" rx="7" fill="#0f172a" />
                    <rect x="0" y="20" width={cardW} height="6" fill="#0f172a" />
                    <text x="12" y="17" fill="white" fontSize="11" fontWeight="700" fontFamily="ui-sans-serif, system-ui, sans-serif">
                      {formatDistLabel(hoverPoint.distance)}
                    </text>
                    <text x="12" y="44" fill="#475569" fontSize="10" fontWeight="600" fontFamily="ui-sans-serif, system-ui, sans-serif">
                      Terrain: <tspan fill="#0f172a">{formatElevLabel(hoverPoint.elevation)}</tspan>
                    </text>
                    <text x="12" y="60" fill="#475569" fontSize="10" fontWeight="600" fontFamily="ui-sans-serif, system-ui, sans-serif">
                      Center Beam: <tspan fill="#b45309">{formatElevLabel(hoverRay)}</tspan>
                    </text>
                    <text
                      x="12"
                      y="76"
                      fill={hoverClearance >= 0 ? "#16a34a" : "#dc2626"}
                      fontSize="9.5"
                      fontWeight="700"
                      fontFamily="ui-sans-serif, system-ui, sans-serif"
                    >
                      {hoverClearance >= 0 ? `Clearance: +${formatElevLabel(hoverClearance)}` : `Blocked: ${formatElevLabel(Math.abs(hoverClearance))}`}
                    </text>
                  </g>
                );
              })()}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
