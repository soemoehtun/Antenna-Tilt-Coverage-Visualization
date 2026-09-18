import { useCallback, useEffect, useRef, useState } from "react";
import { fetchElevations, isAbortError, isRateLimitError, RateLimitError, sleep } from "../lib/api";
import { profilePoints } from "../lib/geo";
import type { TerrainSample } from "../types";

export type TerrainStatus = "idle" | "loading" | "ok" | "error";

export const PROFILE_SAMPLES = 90;

/** Debounce: Open-Meteo rate-limit budgets are per-IP and per-min; space non-forced calls. */
const AUTO_DEBOUNCE_MS = 1800;
/** Maximum total fetch attempts within one logical request (initial + retries on 429). */
const MAX_ATTEMPTS = 3;

/**
 * Debounced terrain profile along the azimuth (Copernicus DEM via Open-Meteo).
 * The first sample is the site itself, so it doubles as the site elevation.
 * The previous profile is kept while a new one loads to avoid flicker.
 *
 * HTTP 429 is handled by backing off (Retry-After respected, minimum ~20 s)
 * and retrying automatically — up to 3 attempts per logical request. Cache
 * hits in `fetchElevations` prevent repeat network calls for identical tracks.
 */
export function useTerrainProfile(lat: number, lon: number, azimuth: number, lengthM: number, enabled: boolean) {
  const [profile, setProfile] = useState<TerrainSample[] | null>(null);
  const [status, setStatus] = useState<TerrainStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  /** When true, the active load is retry-exhausted and waiting for a manual retry. */
  const [exhausted, setExhausted] = useState(false);
  const lastNonce = useRef(-1);

  // Rounded keys so sub-metre drags / half-degree azimuth steps don't refetch.
  const latKey = Math.round(lat * 1e5) / 1e5;
  const lonKey = Math.round(lon * 1e5) / 1e5;
  const azKey = Math.round(azimuth * 2) / 2;

  // key identity for the current logical request — reset on any change
  useEffect(() => {
    setExhausted(false);
  }, [latKey, lonKey, azKey, lengthM]);

  useEffect(() => {
    if (!enabled || exhausted) return;
    const forced = nonce !== lastNonce.current;
    lastNonce.current = nonce;

    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        setStatus("loading");
        setError(null);

        const pts = profilePoints({ lat: latKey, lon: lonKey }, azKey, lengthM, PROFILE_SAMPLES);
        const targets = pts.map((p) => p.point);

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const z = await fetchElevations(targets, {
              signal: controller.signal,
              // spread out follow-up chunks on retries
              startDelayMs: attempt > 1 ? 1500 : 0,
            });
            if (!controller.signal.aborted) {
              setProfile(pts.map((p, i) => ({ distance: p.distance, elevation: z[i] ?? 0, point: p.point })));
              setStatus("ok");
              setExhausted(false);
            }
            return;
          } catch (e) {
            if (isAbortError(e)) return;

            if (isRateLimitError(e) && attempt < MAX_ATTEMPTS) {
              // wait the cooldown before retrying — never stop silent
              setStatus("loading");
              setError("Elevation service rate-limits requests — waiting to retry…");
              await sleep((e as RateLimitError).cooldownMs);
              if (controller.signal.aborted) return;
              continue;
            }

            // hard fail (non-429 error, or exhausted retries)
            setStatus("error");
            setError(
              isRateLimitError(e)
                ? "Elevation service is still rate-limiting us — wait a minute and retry manually."
                : e instanceof Error
                  ? e.message
                  : "Failed to load terrain data",
            );
            if (isRateLimitError(e)) setExhausted(true);
            return;
          }
        }
      },
      forced ? 0 : AUTO_DEBOUNCE_MS,
    );

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [latKey, lonKey, azKey, lengthM, enabled, nonce, exhausted]);

  const retry = useCallback(() => {
    setExhausted(false);
    setNonce((n) => n + 1);
  }, []);

  return { profile, status, error, retry };
}
