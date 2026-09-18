import type { BeamKey } from "../types";

/** One colour per beam – used identically across map, terrain chart, controls, and results. */
export const BEAM_COLORS: Record<BeamKey, string> = {
  lower: "#22c55e", // Green (Inner Beam)
  center: "#3b82f6", // Blue (Center Beam / Boresight)
  upper: "#f97316", // Orange (Outer Beam)
};

export const FOOTPRINT_COLOR = "#3b82f6";
export const SECTOR_COLOR = "#64748b"; // slate-500
export const ANTENNA_COLOR = "#c4b5fd"; // violet-300
export const MAST_COLOR = "#a78bfa"; // violet-400
export const GROUND_COLOR = "#1e293b"; // slate-800
export const GROUND_LINE_COLOR = "#64748b"; // slate-500
export const TERRAIN_FILL = "#3f3f46"; // zinc-700
export const TERRAIN_LINE = "#a1a1aa"; // zinc-400
export const GRID_COLOR = "#1e293b";
export const AXIS_TEXT = "#94a3b8"; // slate-400
export const TEXT_STRONG = "#e2e8f0"; // slate-200
export const CHART_BG = "#020617"; // slate-950
export const RX_PLANE_COLOR = "#f0abfc"; // fuchsia-300
