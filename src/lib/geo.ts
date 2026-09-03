export function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function toDegrees(value: number) {
  return (value * 180) / Math.PI;
}

export function normalizeBearing(value: number) {
  return ((value % 360) + 360) % 360;
}

export function groundDistance(height: number, angle: number, maxDistance: number) {
  if (angle <= 0) {
    return maxDistance;
  }
  const distance = height / Math.tan(toRadians(angle));
  return Math.min(Math.max(distance, 1), maxDistance);
}

export function kmlColor(hex: string, opacity = "99") {
  const clean = hex.replace("#", "");
  const rr = clean.slice(0, 2);
  const gg = clean.slice(2, 4);
  const bb = clean.slice(4, 6);
  return `${opacity}${bb}${gg}${rr}`;
}

export function destinationPoint(
  lat: number,
  lon: number,
  bearing: number,
  distanceMeters: number,
) {
  const earthRadiusMeters = 6371000;
  const angularDistance = distanceMeters / earthRadiusMeters;
  const bearingRad = toRadians(bearing);
  const latRad = toRadians(lat);
  const lonRad = toRadians(lon);

  const destinationLat = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad),
  );
  const destinationLon =
    lonRad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(destinationLat),
    );

  return {
    lat: toDegrees(destinationLat),
    lon: ((toDegrees(destinationLon) + 540) % 360) - 180,
  };
}

export const destinationPointWgs84 = destinationPoint;

/** Build a sector wedge polygon ending at [lat, lon] so it closes on the site. */
export function sectorPolygon(
  lat: number,
  lon: number,
  azimuth: number,
  horizontalBeamwidth: number,
  distanceMeters: number,
  stepDeg = 4,
): [number, number][] {
  const points: [number, number][] = [[lat, lon]];
  const start = azimuth - horizontalBeamwidth / 2;
  const end = azimuth + horizontalBeamwidth / 2;
  for (let a = start; a <= end; a += stepDeg) {
    const p = destinationPoint(lat, lon, a, distanceMeters);
    points.push([p.lat, p.lon]);
  }
  const endPoint = destinationPoint(lat, lon, end, distanceMeters);
  points.push([endPoint.lat, endPoint.lon]);
  points.push([lat, lon]);
  return points;
}
