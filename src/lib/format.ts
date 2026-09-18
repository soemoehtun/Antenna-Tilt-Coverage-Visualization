import type { UnitSystem } from "../types";

export const M_PER_FT = 0.3048;
export const M_PER_MILE = 1609.344;

export function lengthUnitLabel(unit: UnitSystem): "m" | "ft" {
  return unit === "metric" ? "m" : "ft";
}

/** Metres → display unit (m or ft). */
export function toDisplayLength(m: number, unit: UnitSystem): number {
  return unit === "metric" ? m : m / M_PER_FT;
}

/** Display unit (m or ft) → metres. */
export function fromDisplayLength(v: number, unit: UnitSystem): number {
  return unit === "metric" ? v : v * M_PER_FT;
}

export function formatNumber(v: number, decimals = 1): string {
  if (!Number.isFinite(v)) return v > 0 ? "∞" : v < 0 ? "−∞" : "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Human-readable length with automatic km / mi promotion (pass `long: true` to keep m / ft). */
export function formatLength(
  m: number,
  unit: UnitSystem,
  opts: { decimals?: number; long?: boolean } = {},
): string {
  if (Number.isNaN(m)) return "—";
  if (!Number.isFinite(m)) return m > 0 ? "∞" : "—";
  const decimals = opts.decimals ?? 1;
  if (unit === "metric") {
    if (Math.abs(m) >= 10_000) return `${formatNumber(m / 1000, 2)} km`;
    if (Math.abs(m) >= 1000 && !opts.long) return `${formatNumber(m / 1000, 2)} km`;
    return `${formatNumber(m, decimals)} m`;
  }
  const ft = m / M_PER_FT;
  if (Math.abs(ft) >= 5280 && !opts.long) return `${formatNumber(m / M_PER_MILE, 2)} mi`;
  return `${formatNumber(ft, decimals)} ft`;
}

export function formatAngle(deg: number, decimals = 2): string {
  if (Number.isNaN(deg)) return "—";
  if (!Number.isFinite(deg)) return deg > 0 ? "∞" : "−∞";
  return `${formatNumber(deg, decimals)}°`;
}

export function formatCoord(lat: number, lon: number, decimals = 5): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "—";
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(decimals)}° ${ns}, ${Math.abs(lon).toFixed(decimals)}° ${ew}`;
}

export function round(v: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** "Nice" tick step for an axis spanning `range` with roughly `count` ticks. */
export function niceStep(range: number, count = 6): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1;
  const rough = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  let nice: number;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  else nice = 10;
  return nice * mag;
}

export function niceTicks(min: number, max: number, count = 6): number[] {
  const step = niceStep(max - min, count);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) {
    ticks.push(round(v, 6));
    if (ticks.length > 50) break;
  }
  return ticks;
}

/** Short axis label for a length in the chosen unit system. */
export function axisLengthLabel(m: number, unit: UnitSystem): string {
  if (unit === "metric") {
    if (Math.abs(m) >= 1000) return `${round(m / 1000, 2)} km`;
    return `${round(m, 1)} m`;
  }
  const ft = m / M_PER_FT;
  if (Math.abs(ft) >= 5280) return `${round(m / M_PER_MILE, 2)} mi`;
  return `${round(ft, 0)} ft`;
}
