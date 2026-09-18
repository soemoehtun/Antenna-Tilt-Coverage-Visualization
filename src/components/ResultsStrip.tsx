import { BEAM_COLORS } from "../lib/colors";
import { formatAngle, formatLength } from "../lib/format";
import type { TerrainBlockDistances } from "../lib/terrain";
import type { AntennaParams, BeamKey, CalcMode, CoverageResult, UnitSystem } from "../types";

interface ResultsStripProps {
  params: AntennaParams;
  result: CoverageResult;
  mode: CalcMode;
  unit: UnitSystem;
  /** Where each beam is first blocked by terrain (null until the DEM loads). */
  blocks: TerrainBlockDistances | null;
}

export function ResultsStrip({ params, result, mode, unit, blocks }: ResultsStripProps) {
  const ok = result.valid;
  const { beams } = result;
  const dh = formatLength(result.heightDiff, unit, { long: true });

  /** "Terrain block · 1.28 km" line for a beam, or a clear/pending note. */
  const blockLine = (key: BeamKey): string => {
    if (!ok) return "";
    if (!blocks) return "terrain block · loading…";
    const d = blocks[key];
    if (d === null) return `no terrain block within ${formatLength(blocks.searchedTo, unit)}`;
    return `terrain block · ${formatLength(d, unit)}`;
  };

  const primary =
    mode === "coverage"
      ? {
          label: "Center Beam",
          value: !ok ? "—" : beams.center.reachesPlane ? formatLength(beams.center.distance, unit) : "∞",
          sub: !ok
            ? "check the inputs"
            : beams.center.reachesPlane
              ? `boresight tilt ${formatAngle(result.tilt)} · Δh ${dh}`
              : "boresight is at or above the horizon",
        }
      : {
          label: "Required Downtilt",
          value: ok ? formatAngle(result.solvedDowntilt ?? NaN, 3) : "—",
          sub: ok ? `boresight at ${formatLength(params.targetDistance, unit)} · Δh ${dh}` : "check the inputs",
        };

  const beamData = (key: BeamKey) => {
    const b = beams[key];
    return {
      value: !ok ? "—" : b.reachesPlane ? formatLength(b.distance, unit) : "∞",
      sub: "",
    };
  };

  const tiles = [
    { label: "Inner Beam", ...beamData("lower"), color: BEAM_COLORS.lower, block: blockLine("lower") },
    { ...primary, color: BEAM_COLORS.center, block: blockLine("center") },
    { label: "Outer Beam", ...beamData("upper"), color: BEAM_COLORS.upper, block: blockLine("upper") },
  ];

  return (
    <div className="border-b border-slate-800">
      <div className="grid grid-cols-1 divide-y divide-slate-800 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {tiles.map((t) => (
          <div key={t.label} className="px-3 py-2.5 transition-colors hover:bg-slate-900/80 sm:px-4 sm:py-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
              <span className="text-slate-200">{t.label}</span>
            </div>
            <div className="mt-0.5 font-mono text-2xl font-semibold tabular-nums text-slate-50">{t.value}</div>
            {t.sub && <div className="text-[11px] text-slate-500">{t.sub}</div>}
            {t.block && (
              <div className="mt-0.5 font-mono text-[11px] tabular-nums" style={{ color: t.color }}>
                {t.block}
              </div>
            )}
          </div>
        ))}
      </div>

      {(result.errors.length > 0 || result.warnings.length > 0) && (
        <div className="space-y-1 px-4 pb-3">
          {result.errors.map((e) => (
            <p key={e} className="text-xs text-rose-300">
              ✕ {e}
            </p>
          ))}
          {result.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-300">
              ! {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
