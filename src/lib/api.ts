import type { LatLon } from "../types";

const ELEVATION_ENDPOINT = "https://api.open-meteo.com/v1/elevation";
/** Open-Meteo accepts at most 100 coordinates per request. */
const MAX_POINTS_PER_REQUEST = 100;

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface FetchElevationsOptions {
  signal?: AbortSignal;
  /** Wait before the request starts, to space out requests when refetching. */
  startDelayMs?: number;
}

/**
 * Thrown when the elevation service rate-limits the request (HTTP 429, or an
 * error body reporting it).
 */
export class RateLimitError extends Error {
  readonly status: number;
  readonly cooldownMs: number;

  constructor(message: string, cooldownMs: number) {
    super(message);
    this.name = "RateLimitError";
    this.status = 429;
    this.cooldownMs = cooldownMs;
  }
}

export function isRateLimitError(e: unknown): e is RateLimitError {
  return e instanceof RateLimitError;
}

/* ---- caching ------------------------------------------------------------ */

// Persist up to this many complete profiles (each with ≤100 points).
const MEM = new Map<string, number[]>();
const MEM_MAX = 60;

const STORAGE_KEY = "tiltplane-elevation-cache-v3";
const STORAGE_MAX = 30;

// Paths are keyed by the string representation of their point list.
function cacheKey(points: LatLon[]): string {
  return points.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(";").toLowerCase();
}

function readPersistent(): Map<string, number[]> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, number[]>));
  } catch {
    return new Map();
  }
}

function writePersistent(cache: Map<string, number[]>) {
  try {
    const entries = [...cache.entries()].slice(-STORAGE_MAX);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // ignore – storage unavailable
  }
}

let persistentLoaded = false;
let persistent: Map<string, number[]> = new Map();

function cached(key: string): number[] | undefined {
  const mem = MEM.get(key);
  if (mem) return mem;
  if (!persistentLoaded) {
    persistentLoaded = true;
    persistent = readPersistent();
  }
  const hit = persistent.get(key);
  if (hit) {
    MEM.delete(key);
    MEM.set(key, hit);
    return hit;
  }
  return undefined;
}

function store(key: string, data: number[]) {
  MEM.delete(key);
  MEM.set(key, data);
  while (MEM.size > MEM_MAX) {
    const oldest = MEM.keys().next().value;
    if (oldest === undefined) break;
    MEM.delete(oldest);
  }
  persistent.delete(key);
  persistent.set(key, data);
  writePersistent(persistent);
}

/* ---- fetch one chunk (≤100 pts) ------------------------------------------ */

async function fetchChunk(points: LatLon[], signal?: AbortSignal): Promise<number[]> {
  const lat = points.map((p) => p.lat.toFixed(5)).join(",");
  const lon = points.map((p) => p.lon.toFixed(5)).join(",");
  const res = await fetch(`${ELEVATION_ENDPOINT}?latitude=${lat}&longitude=${lon}`, { signal });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? "30");
    const cooldown = Math.max(Math.round(retryAfter * 1000), 20_000);
    throw new RateLimitError(
      "Elevation service responded with HTTP 429 (rate-limited) — backing off shortly and auto-retrying.",
      cooldown,
    );
  }
  if (!res.ok) {
    throw new Error(`Elevation service responded with HTTP ${res.status}`);
  }

  const json = (await res.json()) as { elevation?: unknown; reason?: string; error?: boolean };
  if (json.error) {
    if (/rate/i.test(String(json.reason ?? ""))) {
      throw new RateLimitError(json.reason ?? "Elevation service rate limit", 20_000);
    }
    throw new Error(json.reason ?? "Elevation service rejected the request");
  }
  if (!Array.isArray(json.elevation)) {
    throw new Error(json.reason ?? "Unexpected response from elevation service");
  }

  const out: number[] = [];
  for (const v of json.elevation) {
    const n = Number(v);
    out.push(Number.isFinite(n) ? n : 0);
  }
  return out;
}

/* ---- batch ------------------------------------------------------------ */

/**
 * Fetch terrain elevations (m AMSL, Copernicus DEM GLO-90 via Open-Meteo) for
 * a list of points. Strongly cached per complete track; identical inputs are
 * served from memory / localStorage without touching the network.
 */
export async function fetchElevations(
  points: LatLon[],
  optionsOrSignal?: FetchElevationsOptions | AbortSignal,
): Promise<number[]> {
  const options: FetchElevationsOptions =
    optionsOrSignal instanceof AbortSignal || optionsOrSignal === undefined
      ? { signal: optionsOrSignal }
      : optionsOrSignal;
  const { signal, startDelayMs = 0 } = options;

  const chunks: number[][] = [];
  for (let i = 0; i < points.length; i += MAX_POINTS_PER_REQUEST) {
    const chunkPoints = points.slice(i, i + MAX_POINTS_PER_REQUEST);
    const chunkKey = `${cacheKey(chunkPoints)}::${i}`;
    const hit = cached(chunkKey);
    chunks.push(hit ?? []);
    if (!hit) {
      if (startDelayMs > 0) await sleep(startDelayMs);
      const data = await fetchChunk(chunkPoints, signal);
      store(chunkKey, data);
      chunks[chunks.length - 1] = data;
    }
  }
  return chunks.flat();
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}
