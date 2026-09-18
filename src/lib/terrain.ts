import type { BeamKey, CoverageResult, TerrainSample } from "../types";
import { MAX_DISTANCE } from "./antenna";
import { clamp, niceStep } from "./format";
import { toRad } from "./geo";

const ORDER: BeamKey[] = ["upper", "center", "lower"];

/** Distance at which each beam is blocked by terrain, plus how far we looked. */
export interface TerrainBlockDistances {
  /** Ground distance of the first terrain intersection (m), or null if none. */
  upper: number | null;
  center: number | null;
  lower: number | null;
  /** Length of the sampled profile (m) – the search range for the values above. */
  searchedTo: number;
}

/**
 * Length of the terrain profile to sample: 1.3× the farthest finite beam
 * distance, rounded up to a "nice" value so small tilt tweaks don't refetch.
 */
export function profileLengthFor(result: CoverageResult): number {
  const finite = ORDER.map((k) => result.beams[k])
    .filter((b) => b.reachesPlane && b.distance > 0)
    .map((b) => b.distance);
  const raw = clamp(finite.length ? Math.max(...finite) * 1.3 : MAX_DISTANCE, 500, MAX_DISTANCE);
  const step = niceStep(raw, 5);
  return Math.min(MAX_DISTANCE, Math.ceil(raw / step) * step);
}

/**
 * Ground distance at which each beam is first blocked by real terrain.
 * Returns null per beam when the ray clears the terrain for the whole profile.
 */
export function terrainBlockDistances(
  profile: TerrainSample[] | null,
  antennaHeightAGL: number,
  receiverHeight: number,
  angles: { upper: number; center: number; lower: number },
): TerrainBlockDistances | null {
  if (!profile || profile.length < 2) return null;
  const samples = profile.map((s) => ({ distance: s.distance, z: s.elevation }));
  // The profile starts at the site, so its first sample is the mast's ground level.
  const antennaZ = samples[0].z + antennaHeightAGL;
  return {
    upper: terrainIntersection(samples, antennaZ, angles.upper, receiverHeight),
    center: terrainIntersection(samples, antennaZ, angles.center, receiverHeight),
    lower: terrainIntersection(samples, antennaZ, angles.lower, receiverHeight),
    searchedTo: samples[samples.length - 1].distance,
  };
}

/** First ground distance at which a ray drops to (terrain + receiver height), or null. */
export function terrainIntersection(
  samples: { distance: number; z: number }[],
  antennaZ: number,
  angleDeg: number,
  rxHeight: number,
): number | null {
  const t = Math.tan(toRad(angleDeg));
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const f0 = antennaZ - t * a.distance - (a.z + rxHeight);
    const f1 = antennaZ - t * b.distance - (b.z + rxHeight);
    if (i === 1 && f0 <= 0) return 0;
    if (f0 > 0 && f1 <= 0) {
      return a.distance + ((b.distance - a.distance) * f0) / (f0 - f1);
    }
  }
  return null;
}
