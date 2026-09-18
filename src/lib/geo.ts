import type { LatLon } from "../types";

/** Mean Earth radius (m). */
export const EARTH_RADIUS_M = 6371008.8;

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Wrap any bearing into the range [0, 360). */
export function normalizeBearing(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const b = deg % 360;
  return b < 0 ? b + 360 : b;
}

/** Wrap a longitude into [-180, 180). */
export function normalizeLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Destination point given a start, an initial bearing and a distance along a
 * great circle (spherical Earth). Standard "direct" Haversine formulation.
 */
export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceM: number,
): LatLon {
  if (!Number.isFinite(distanceM) || distanceM === 0) {
    return { lat, lon };
  }
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);

  const sinPhi2 = sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const y = Math.sin(theta) * sinDelta * cosPhi1;
  const x = cosDelta - sinPhi1 * sinPhi2;
  const lambda2 = lambda1 + Math.atan2(y, x);

  return { lat: toDeg(phi2), lon: normalizeLongitude(toDeg(lambda2)) };
}

/** Great-circle distance between two points (m). */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing from point 1 to point 2 (°, 0–360). */
export function initialBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normalizeBearing(toDeg(Math.atan2(y, x)));
}

/**
 * Points along an arc of constant ground distance, swept from
 * (azimuth − beamwidth/2) to (azimuth + beamwidth/2).
 */
export function arcPoints(
  center: LatLon,
  azimuthDeg: number,
  beamwidthDeg: number,
  radiusM: number,
  steps = 48,
): LatLon[] {
  const bw = Math.min(360, Math.max(0, beamwidthDeg));
  const start = azimuthDeg - bw / 2;
  const pts: LatLon[] = [];
  const n = Math.max(2, Math.ceil((bw / 360) * steps * 4) + 1);
  for (let i = 0; i < n; i++) {
    const b = start + (bw * i) / (n - 1);
    pts.push(destinationPoint(center.lat, center.lon, b, radiusM));
  }
  return pts;
}

/** Closed wedge polygon: site → outer arc → site. */
export function sectorPolygon(
  center: LatLon,
  azimuthDeg: number,
  beamwidthDeg: number,
  radiusM: number,
  steps = 48,
): LatLon[] {
  const arc = arcPoints(center, azimuthDeg, beamwidthDeg, radiusM, steps);
  if (beamwidthDeg >= 360) return arc;
  return [center, ...arc, center];
}

/** Closed annular-sector polygon between an inner and an outer radius. */
export function annularSectorPolygon(
  center: LatLon,
  azimuthDeg: number,
  beamwidthDeg: number,
  innerM: number,
  outerM: number,
  steps = 48,
): LatLon[] {
  const outer = arcPoints(center, azimuthDeg, beamwidthDeg, outerM, steps);
  const inner = arcPoints(center, azimuthDeg, beamwidthDeg, innerM, steps).reverse();
  return [...outer, ...inner, outer[0]];
}

/** Evenly spaced sample points from the site out along a bearing (first point is the site itself). */
export function profilePoints(
  center: LatLon,
  bearingDeg: number,
  lengthM: number,
  count: number,
): { distance: number; point: LatLon }[] {
  const n = Math.max(2, count);
  const out: { distance: number; point: LatLon }[] = [];
  for (let i = 0; i < n; i++) {
    const d = (lengthM * i) / (n - 1);
    out.push({ distance: d, point: destinationPoint(center.lat, center.lon, bearingDeg, d) });
  }
  return out;
}
