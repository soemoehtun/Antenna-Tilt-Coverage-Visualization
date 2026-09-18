import type {
  AntennaParams,
  BeamAngles,
  BeamDistance,
  BeamKey,
  CalcMode,
  CoverageResult,
} from "../types";
import { destinationPoint, normalizeBearing, toDeg, toRad } from "./geo";

/** Beams that never reach the receiver plane are drawn out to this range (m). */
export const MAX_DISTANCE = 25_000;

export const DEFAULT_PARAMS: AntennaParams = {
  latitude: 17.6026,
  longitude: 98.0365,
  antennaHeight: 32,
  dtmHeight: 540,
  includeDtm: true,
  azimuth: 120,
  tilt: 4,
  horizontalBeamwidth: 25,
  verticalBeamwidth: 6.5,
  receiverHeight: 0,
  targetDistance: 5442,
};

export const BEAM_LABELS: Record<BeamKey, string> = {
  lower: "Inner Beam",
  center: "Center Beam",
  upper: "Outer Beam",
};

/** Depression angles of the three reference planes of the vertical pattern. */
export function beamAngles(tiltDeg: number, verticalBeamwidthDeg: number): BeamAngles {
  const half = verticalBeamwidthDeg / 2;
  return {
    upper: tiltDeg - half,
    center: tiltDeg,
    lower: tiltDeg + half,
  };
}

/**
 * Flat-earth ground distance at which a ray leaving the antenna with the given
 * depression angle meets the receiver plane:  d = Δh / tan(angle).
 *
 *  • angle ≤ 0°  → the ray is horizontal or pointing up → never lands → Infinity
 *  • angle ≥ 90° → straight down (or backwards) → 0
 */
export function groundDistanceFromTilt(heightDiff: number, angleDeg: number): number {
  if (!Number.isFinite(heightDiff) || !Number.isFinite(angleDeg)) return NaN;
  if (heightDiff < 0) return NaN;
  if (angleDeg <= 0) return Infinity;
  if (angleDeg >= 90) return 0;
  return heightDiff / Math.tan(toRad(angleDeg));
}

/** Downtilt needed to land the boresight at `distance`:  arctan(Δh / d). Result in degrees. */
export function requiredDowntilt(heightDiff: number, distance: number): number {
  if (!Number.isFinite(heightDiff) || !Number.isFinite(distance) || distance <= 0) return NaN;
  return toDeg(Math.atan(heightDiff / distance));
}

/** Height of a ray above the reference datum at ground distance `d`. */
export function rayHeight(antennaHeight: number, angleDeg: number, d: number): number {
  return antennaHeight - Math.tan(toRad(angleDeg)) * d;
}

export function validateParams(
  p: AntennaParams,
  mode: CalcMode,
): { errors: string[]; locationErrors: string[] } {
  const errors: string[] = [];
  const locationErrors: string[] = [];

  const num = (v: number) => Number.isFinite(v);

  if (!num(p.latitude) || p.latitude < -90 || p.latitude > 90) {
    locationErrors.push("Latitude must be between −90° and 90°.");
  }
  if (!num(p.longitude) || p.longitude < -180 || p.longitude > 180) {
    locationErrors.push("Longitude must be between −180° and 180°.");
  }

  if (!num(p.antennaHeight) || p.antennaHeight <= 0) {
    errors.push("Antenna height must be greater than 0 m.");
  }
  if (!num(p.receiverHeight) || p.receiverHeight < 0) {
    errors.push("Receiver height cannot be negative.");
  }
  if (num(p.antennaHeight) && num(p.receiverHeight) && p.antennaHeight - p.receiverHeight <= 0) {
    errors.push(
      "Receiver is at or above the antenna – a downward beam can never intersect the receiver plane.",
    );
  }
  if (!num(p.dtmHeight)) {
    errors.push("Terrain (DTM) height must be a number.");
  }
  if (!num(p.verticalBeamwidth) || p.verticalBeamwidth <= 0 || p.verticalBeamwidth > 180) {
    errors.push("Vertical beamwidth must be between 0° and 180°.");
  }
  if (!num(p.horizontalBeamwidth) || p.horizontalBeamwidth <= 0 || p.horizontalBeamwidth > 360) {
    errors.push("Horizontal beamwidth must be between 0° and 360°.");
  }
  if (!num(p.azimuth)) {
    errors.push("Azimuth must be a number.");
  }
  if (mode === "coverage") {
    if (!num(p.tilt)) {
      errors.push("Tilt must be a number.");
    } else if (p.tilt >= 90) {
      errors.push("A tilt of 90° or more points the antenna straight down or backwards.");
    } else if (p.tilt < -90) {
      errors.push("Tilt cannot be less than −90°.");
    }
  } else if (!num(p.targetDistance) || p.targetDistance <= 0) {
    errors.push("Target distance must be greater than 0 m.");
  }

  return { errors, locationErrors };
}

function makeBeam(
  key: BeamKey,
  angle: number,
  heightDiff: number,
  p: AntennaParams,
): BeamDistance {
  const distance = groundDistanceFromTilt(heightDiff, angle);
  const reachesPlane = Number.isFinite(distance);
  const clamped = !reachesPlane || distance > MAX_DISTANCE;
  const displayDistance = clamped ? MAX_DISTANCE : distance;
  return {
    key,
    label: BEAM_LABELS[key],
    angle,
    distance,
    reachesPlane,
    clamped,
    displayDistance,
    groundPoint: destinationPoint(p.latitude, p.longitude, p.azimuth, displayDistance),
  };
}

/** Main entry point – evaluates the complete model for a set of inputs. */
export function calculateCoverage(p: AntennaParams, mode: CalcMode): CoverageResult {
  const { errors, locationErrors } = validateParams(p, mode);
  const valid = errors.length === 0;
  const locationValid = locationErrors.length === 0;
  const warnings: string[] = [];

  const heightDiff = p.antennaHeight - p.receiverHeight;
  const effectiveHeight = p.antennaHeight + (p.includeDtm ? p.dtmHeight : 0);

  let tilt = p.tilt;
  let solvedDowntilt: number | null = null;
  if (mode === "downtilt") {
    solvedDowntilt = valid ? requiredDowntilt(heightDiff, p.targetDistance) : NaN;
    tilt = solvedDowntilt;
  }

  const angles = beamAngles(tilt, p.verticalBeamwidth);
  const safeParams: AntennaParams = locationValid
    ? p
    : { ...p, latitude: 0, longitude: 0 };

  const beams: Record<BeamKey, BeamDistance> = {
    upper: makeBeam("upper", angles.upper, heightDiff, safeParams),
    center: makeBeam("center", angles.center, heightDiff, safeParams),
    lower: makeBeam("lower", angles.lower, heightDiff, safeParams),
  };

  if (valid) {
    if (angles.center <= 0) {
      warnings.push(
        "The boresight is at or above the horizon, so the main beam never reaches the receiver plane (drawn out to 25 km).",
      );
    }
    if (angles.lower >= 90) {
      warnings.push("The lower −3 dB edge points past vertical – part of the beam is aimed behind the mast.");
    }
    const anyClampedFinite = Object.values(beams).some((b) => b.reachesPlane && b.clamped);
    if (anyClampedFinite) {
      warnings.push("One or more beam distances exceed 25 km and are clamped for drawing.");
    }
    if (mode === "downtilt" && solvedDowntilt !== null && solvedDowntilt < 0.1) {
      warnings.push("The required downtilt is under 0.1° – a tiny mechanical error will move the boresight by kilometres.");
    }
    if (p.includeDtm && p.dtmHeight < 0) {
      warnings.push("Terrain height is below sea level – check the DTM value.");
    }
  }

  const half = p.horizontalBeamwidth / 2;
  const innerRadius = beams.lower.distance;
  const outerRadius = beams.upper.distance;

  return {
    mode,
    valid,
    locationValid,
    errors: [...errors, ...locationErrors],
    warnings,
    effectiveHeight,
    heightDiff,
    tilt,
    solvedDowntilt,
    angles,
    beams,
    innerRadius,
    outerRadius,
    footprintLength: outerRadius - innerRadius,
    sector: {
      left: normalizeBearing(p.azimuth - half),
      right: normalizeBearing(p.azimuth + half),
    },
    maxDistance: MAX_DISTANCE,
  };
}
