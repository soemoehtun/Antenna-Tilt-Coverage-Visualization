import { useEffect, useId, useMemo, useState } from "react";
import { useElementSize } from "../../hooks/useElementSize";
import { PROFILE_SAMPLES, type TerrainStatus } from "../../hooks/useTerrainProfile";
import { rayHeight } from "../../lib/antenna";
import { destinationPoint } from "../../lib/geo";
import {
  ANTENNA_COLOR,
  AXIS_TEXT,
  BEAM_COLORS,
  CHART_BG,
  GRID_COLOR,
  GROUND_LINE_COLOR,
  MAST_COLOR,
  TERRAIN_FILL,
  TERRAIN_LINE,
  TEXT_STRONG,
} from "../../lib/colors";
import { formatAngle, formatLength, niceTicks, M_PER_FT, M_PER_MILE } from "../../lib/format";
import { terrainIntersection } from "../../lib/terrain";
import type { AntennaParams, BeamKey, CoverageResult, TerrainSample, UnitSystem } from "../../types";
import { Button, Overlay } from "../ui/primitives";

const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const ORDER: BeamKey[] = ["upper", "center", "lower"];

interface ElevationChartProps {
  params: AntennaParams;
  result: CoverageResult;
  unit: UnitSystem;
  profile: TerrainSample[] | null;
  status: TerrainStatus;
  error: string | null;
  onRetry: () => void;
  /** Current terrain sampling distance along the azimuth (m). */
  profileDistance: number;
  /** Beam-based range used when the slider is in automatic mode (m). */
  suggestedProfileDistance: number;
  isProfileDistanceAutomatic: boolean;
  onProfileDistanceChange: (distance: number) => void;
  onResetProfileDistance: () => void;
  /** Called with the hovered ground distance + map location, or null on leave. */
  onProfileHover?: (hover: { distance: number; lat: number; lon: number } | null) => void;
}

function axisUnit(maxMeters: number, unit: UnitSystem): { factor: number; label: string } {
  if (unit === "metric") {
    return maxMeters >= 4000 ? { factor: 1000, label: "km" } : { factor: 1, label: "m" };
  }
  return maxMeters >= 3 * M_PER_MILE ? { factor: M_PER_MILE, label: "mi" } : { factor: M_PER_FT, label: "ft" };
}

const PROFILE_MIN_DISTANCE = 500;
const PROFILE_MAX_DISTANCE = 25_000;

/** Map a terrain distance to a log-scale slider position in [0, 1000]. */
function profileDistanceToSlider(distance: number): number {
  const clamped = Math.max(PROFILE_MIN_DISTANCE, Math.min(PROFILE_MAX_DISTANCE, distance));
  return Math.round(
    (1000 * (Math.log(clamped) - Math.log(PROFILE_MIN_DISTANCE))) /
      (Math.log(PROFILE_MAX_DISTANCE) - Math.log(PROFILE_MIN_DISTANCE)),
  );
}

/** Map a log-scale slider position in [0, 1000] back to metres. */
function sliderToProfileDistance(position: number): number {
  const t = position / 1000;
  return Math.round(PROFILE_MIN_DISTANCE * Math.exp(Math.log(PROFILE_MAX_DISTANCE / PROFILE_MIN_DISTANCE) * t));
}

export function ElevationChart({
  params,
  result,
  unit,
  profile,
  status,
  error,
  onRetry,
  profileDistance,
  suggestedProfileDistance,
  isProfileDistanceAutomatic,
  onProfileDistanceChange,
  onResetProfileDistance,
  onProfileHover,
}: ElevationChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const clipId = `ep${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [hoverD, setHoverD] = useState<number | null>(null);

  const h = params.antennaHeight;
  const rx = params.receiverHeight;

  const chart = useMemo(() => {
    if (!profile || profile.length < 2) return null;
    const samples = profile.map((s) => ({ distance: s.distance, z: s.elevation }));
    const baseZ = samples[0].z; // site ground elevation from the DEM
    const antennaZ = baseZ + h;
    const planeZ = baseZ + rx;
    const hits = ORDER.map((key) => ({
      key,
      beam: result.beams[key],
      terrainDistance: terrainIntersection(samples, antennaZ, result.beams[key].angle, rx),
    }));
    const zs = samples.map((s) => s.z);
    return {
      samples,
      antennaZ,
      planeZ,
      hits,
      zLo: Math.min(...zs, planeZ),
      zHi: Math.max(...zs, antennaZ),
      maxD: samples[samples.length - 1].distance,
    };
  }, [profile, h, rx, result]);

  const W = Math.max(320, width || 0);
  const H = Math.max(200, height || 0);
  const margin = { top: 28, right: 26, bottom: 44, left: 64 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;

  const maxD = chart?.maxD ?? 1000;
  const span = chart ? Math.max(chart.zHi - chart.zLo, Math.max(h, 10)) : Math.max(h, 10);
  const zMin = (chart?.zLo ?? 0) - span * 0.12;
  const zMax = (chart?.zHi ?? h) + span * 0.18;
  const sx = plotW / maxD;
  const sy = plotH / (zMax - zMin);
  const X = (d: number) => margin.left + d * sx;
  const Y = (z: number) => margin.top + plotH - (z - zMin) * sy;

  const xu = axisUnit(maxD, unit);
  const xTicks = niceTicks(0, maxD / xu.factor, Math.max(3, Math.round(plotW / 90)));
  const yu = axisUnit(Math.abs(zMax), unit);
  const yTicks = niceTicks(zMin / yu.factor, zMax / yu.factor, Math.max(2, Math.round(plotH / 50)));

  const terrainPath = chart
    ? chart.samples.map((s, i) => `${i === 0 ? "M" : "L"}${X(s.distance).toFixed(1)},${Y(s.z).toFixed(1)}`).join(" ")
    : "";
  const bottom = (margin.top + plotH).toFixed(1);
  const terrainArea = chart ? `${terrainPath} L${X(maxD).toFixed(1)},${bottom} L${X(0).toFixed(1)},${bottom} Z` : "";

  const rays = chart
    ? ORDER.map((key) => ({ key, x2: X(maxD), y2: Y(rayHeight(chart.antennaZ, result.beams[key].angle, maxD)) }))
    : [];

  const hitLabels = chart
    ? chart.hits
        .filter((hit) => hit.terrainDistance !== null)
        .map((hit) => {
          const d = hit.terrainDistance as number;
          return { key: hit.key, x: X(d), y: Y(rayHeight(chart.antennaZ, hit.beam.angle, d)), text: formatLength(d, unit) };
        })
        .sort((a, b) => a.x - b.x)
        .reduce<{ key: BeamKey; x: number; y: number; text: string; row: number }[]>((acc, cur) => {
          const prev = acc[acc.length - 1];
          const row = prev && cur.x - prev.x < cur.text.length * 6.5 + 12 ? prev.row + 1 : 0;
          acc.push({ ...cur, row });
          return acc;
        }, [])
    : [];

  const exaggeration = sy / sx;
  const showData = chart !== null && result.valid;

  // Drop a stale hover crosshair when the site / azimuth / range changes.
  useEffect(() => {
    setHoverD(null);
  }, [params.latitude, params.longitude, params.azimuth, maxD]);

  /** Linear-interpolated terrain elevation at ground distance d. */
  const terrainAt = (d: number): number | null => {
    if (!chart) return null;
    const s = chart.samples;
    if (d <= 0) return s[0].z;
    for (let i = 1; i < s.length; i++) {
      if (d <= s[i].distance) {
        const a = s[i - 1];
        const b = s[i];
        const t = (d - a.distance) / Math.max(1e-9, b.distance - a.distance);
        return a.z + (b.z - a.z) * t;
      }
    }
    return s[s.length - 1].z;
  };

  const hoverZ = hoverD !== null ? terrainAt(hoverD) : null;

  const handlePlotMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!chart || !showData || !result.locationValid) return;
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = (e.clientX - rect.left) * (W / rect.width);
    const d = Math.max(0, Math.min(maxD, (svgX - margin.left) / sx));
    setHoverD(d);
    if (onProfileHover) {
      const gp = destinationPoint(params.latitude, params.longitude, params.azimuth, d);
      onProfileHover({ distance: d, lat: gp.lat, lon: gp.lon });
    }
  };

  const handlePlotLeave = () => {
    setHoverD(null);
    onProfileHover?.(null);
  };

  return (
    <div className="flex h-full w-full flex-col bg-slate-950">
      <div ref={ref} className="relative min-h-0 flex-1">
      {!result.locationValid && <Overlay tone="error">Enter a valid latitude and longitude to load the terrain profile.</Overlay>}
      {result.locationValid && !result.valid && <Overlay tone="error">Fix the inputs to project the beams onto the terrain.</Overlay>}
      {result.locationValid && result.valid && status === "error" && !chart && (
        <Overlay tone="error">
          <strong className="block text-sm">Terrain data unavailable</strong>
          <span className="block text-rose-200/80">{error}</span>
          <Button size="xs" variant="secondary" className="mt-2" onClick={onRetry}>
            Retry
          </Button>
        </Overlay>
      )}
      {result.locationValid && result.valid && status === "loading" && !chart && (
        <Overlay>
          <span className="inline-flex items-center gap-2">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
            Sampling {PROFILE_SAMPLES} terrain points along {formatAngle(params.azimuth, 0)}…
          </span>
        </Overlay>
      )}

      {width > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Terrain elevation profile along the antenna azimuth with beam rays"
          fontFamily={FONT}
          style={{ display: "block" }}
        >
          <defs>
            <clipPath id={`${clipId}-plot`}>
              <rect x={margin.left} y={margin.top} width={plotW} height={plotH} />
            </clipPath>
            <linearGradient id={`${clipId}-terrain`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={TERRAIN_FILL} stopOpacity={0.95} />
              <stop offset="1" stopColor={TERRAIN_FILL} stopOpacity={0.45} />
            </linearGradient>
          </defs>
          <rect width={W} height={H} fill={CHART_BG} />

          {xTicks.map((t) => (
            <line key={`gx${t}`} x1={X(t * xu.factor)} x2={X(t * xu.factor)} y1={margin.top} y2={margin.top + plotH} stroke={GRID_COLOR} />
          ))}
          {yTicks.map((t) => (
            <line key={`gy${t}`} x1={margin.left} x2={margin.left + plotW} y1={Y(t * yu.factor)} y2={Y(t * yu.factor)} stroke={GRID_COLOR} />
          ))}

          <g clipPath={`url(#${clipId}-plot)`}>
            {showData && chart && (
              <>
                <path d={terrainArea} fill={`url(#${clipId}-terrain)`} />
                <path d={terrainPath} fill="none" stroke={TERRAIN_LINE} strokeWidth={1.5} strokeLinejoin="round" />

                {rays.map((r) => (
                  <line
                    key={r.key}
                    x1={X(0)}
                    y1={Y(chart.antennaZ)}
                    x2={r.x2}
                    y2={r.y2}
                    stroke={BEAM_COLORS[r.key]}
                    strokeWidth={r.key === "center" ? 2.2 : 1.5}
                    strokeDasharray={r.key === "center" ? undefined : "7 4"}
                    strokeLinecap="round"
                  />
                ))}

                {hitLabels.map((l) => (
                  <g key={l.key}>
                    <line x1={l.x} x2={l.x} y1={l.y} y2={margin.top + plotH} stroke={BEAM_COLORS[l.key]} strokeDasharray="2 3" opacity={0.6} />
                    <circle cx={l.x} cy={l.y} r={4.5} fill={BEAM_COLORS[l.key]} stroke={CHART_BG} strokeWidth={1.5} />
                    <text
                      x={l.x}
                      y={l.y - 11 - l.row * 13}
                      textAnchor="middle"
                      fontSize={10}
                      fontFamily={MONO}
                      fontWeight={600}
                      fill={BEAM_COLORS[l.key]}
                      stroke={CHART_BG}
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {l.text}
                    </text>
                  </g>
                ))}

                <line x1={X(0)} x2={X(0)} y1={Y(chart.samples[0].z)} y2={Y(chart.antennaZ)} stroke={MAST_COLOR} strokeWidth={3} strokeLinecap="round" />
                <circle cx={X(0)} cy={Y(chart.antennaZ)} r={4} fill={ANTENNA_COLOR} stroke="#fff" strokeWidth={1.2} />
                <text x={X(0) + 8} y={Y(chart.antennaZ) - 8} fontSize={10} fontWeight={600} fill={ANTENNA_COLOR}>
                  antenna · {formatLength(chart.antennaZ, unit, { long: true })} AMSL
                </text>

                {hoverD !== null && hoverZ !== null && (
                  <g pointerEvents="none">
                    <line
                      x1={X(hoverD)}
                      x2={X(hoverD)}
                      y1={margin.top}
                      y2={margin.top + plotH}
                      stroke="#ef4444"
                      strokeWidth={1.2}
                      strokeDasharray="4 3"
                      opacity={0.9}
                    />
                    <circle cx={X(hoverD)} cy={Y(hoverZ)} r={5} fill="#ef4444" stroke="#fff" strokeWidth={1.5} />
                    <text
                      x={Math.min(Math.max(X(hoverD), margin.left + 34), margin.left + plotW - 34)}
                      y={Y(hoverZ) - 10}
                      textAnchor="middle"
                      fontSize={10}
                      fontFamily={MONO}
                      fontWeight={700}
                      fill="#ef4444"
                      stroke={CHART_BG}
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {formatLength(hoverD, unit)}
                    </text>
                  </g>
                )}
              </>
            )}
          </g>

          {/* hover capture + crosshair cursor over the plot */}
          {showData && (
            <rect
              x={margin.left}
              y={margin.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              style={{ cursor: "crosshair" }}
              onMouseMove={handlePlotMove}
              onMouseLeave={handlePlotLeave}
            />
          )}

          <line x1={margin.left} x2={margin.left + plotW} y1={margin.top + plotH} y2={margin.top + plotH} stroke={GROUND_LINE_COLOR} />
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotH} stroke={GROUND_LINE_COLOR} />
          {xTicks.map((t) => (
            <g key={`tx${t}`} transform={`translate(${X(t * xu.factor)},${margin.top + plotH})`}>
              <line y2={4} stroke={GROUND_LINE_COLOR} />
              <text y={15} textAnchor="middle" fontSize={10} fill={AXIS_TEXT} fontFamily={MONO}>
                {t}
              </text>
            </g>
          ))}
          {yTicks.map((t) => (
            <g key={`ty${t}`} transform={`translate(${margin.left},${Y(t * yu.factor)})`}>
              <line x2={-4} stroke={GROUND_LINE_COLOR} />
              <text x={-7} y={3.5} textAnchor="end" fontSize={10} fill={AXIS_TEXT} fontFamily={MONO}>
                {t}
              </text>
            </g>
          ))}
          <text x={margin.left + plotW / 2} y={H - 8} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
            Ground distance along azimuth {formatAngle(params.azimuth, 0)} ({xu.label})
          </text>
          <text transform={`translate(14,${margin.top + plotH / 2}) rotate(-90)`} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
            Elevation AMSL ({yu.label})
          </text>

          <text x={margin.left} y={16} fontSize={10} fill={AXIS_TEXT}>
            {chart
              ? `Copernicus DEM · vertical scale ×${exaggeration >= 10 ? exaggeration.toFixed(0) : exaggeration.toFixed(1)}`
              : "Waiting for terrain data…"}
            {status === "loading" && chart ? " · updating…" : ""}
          </text>
          <g transform={`translate(${W - margin.right - 275},9)`} fontSize={10}>
            <line x1={0} x2={14} y1={4.5} y2={4.5} stroke={BEAM_COLORS.lower} strokeWidth={2} strokeDasharray="4 2" />
            <text x={18} y={8} fill={TEXT_STRONG}>
              Inner
            </text>

            <line x1={60} x2={74} y1={4.5} y2={4.5} stroke={BEAM_COLORS.center} strokeWidth={2.5} />
            <text x={78} y={8} fill={TEXT_STRONG}>
              Center
            </text>

            <line x1={128} x2={142} y1={4.5} y2={4.5} stroke={BEAM_COLORS.upper} strokeWidth={2} strokeDasharray="4 2" />
            <text x={146} y={8} fill={TEXT_STRONG}>
              Outer
            </text>

            <rect x={194} y={0} width={12} height={9} fill={TERRAIN_FILL} />
            <text x={210} y={8} fill={TEXT_STRONG}>
              Terrain
            </text>
          </g>
        </svg>
      )}
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-slate-800 bg-slate-900/70 px-3 sm:px-4">
        <div className="min-w-[7.5rem] leading-tight">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Terrain distance</div>
          <div className="font-mono text-xs font-semibold tabular-nums text-slate-100">
            {formatLength(profileDistance, unit)}
            {isProfileDistanceAutomatic && <span className="ml-1 font-sans text-[10px] font-normal text-slate-500">auto</span>}
          </div>
        </div>
        <span className="hidden text-[10px] text-slate-600 sm:inline">0.5 km</span>
        <input
          type="range"
          aria-label="Terrain profile distance"
          title="Adjust how far along the azimuth to sample and draw the terrain profile"
          min={0}
          max={1000}
          step={1}
          value={profileDistanceToSlider(profileDistance)}
          onChange={(event) => onProfileDistanceChange(sliderToProfileDistance(Number(event.target.value)))}
          className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-slate-800"
          style={{ color: BEAM_COLORS.center }}
        />
        <span className="hidden text-[10px] text-slate-600 sm:inline">25 km</span>
        {!isProfileDistanceAutomatic && (
          <Button
            size="xs"
            variant="ghost"
            className="shrink-0 px-1.5"
            onClick={onResetProfileDistance}
            title={`Restore the automatic beam-based distance (${formatLength(suggestedProfileDistance, unit)})`}
          >
            Auto
          </Button>
        )}
      </div>
    </div>
  );
}
