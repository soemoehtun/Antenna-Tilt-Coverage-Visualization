import { describe, expect, it } from "vitest";
import {
  beamAngles,
  calculateCoverage,
  DEFAULT_PARAMS,
  groundDistanceFromTilt,
  MAX_DISTANCE,
  rayHeight,
  requiredDowntilt,
  validateParams,
} from "../lib/antenna";
import { destinationPoint, haversineMeters, initialBearing, normalizeBearing } from "../lib/geo";
import { terrainIntersection } from "../lib/terrain";

/** tan() of an angle given in degrees – used to compute independent expected values. */
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

describe("groundDistanceFromTilt", () => {
  it("matches Δh / tan(θ) for the reference defaults (32 m, 4°)", () => {
    const d = groundDistanceFromTilt(32, 4);
    expect(d).toBeCloseTo(32 / tan(4), 6);
    expect(d).toBeCloseTo(457.62, 1);
  });

  it("returns Infinity when the ray is horizontal or pointing up", () => {
    expect(groundDistanceFromTilt(32, 0)).toBe(Infinity);
    expect(groundDistanceFromTilt(32, -3)).toBe(Infinity);
  });

  it("returns 0 when pointing straight down", () => {
    expect(groundDistanceFromTilt(32, 90)).toBe(0);
    expect(groundDistanceFromTilt(32, 120)).toBe(0);
  });

  it("scales linearly with the height difference", () => {
    expect(groundDistanceFromTilt(64, 4)).toBeCloseTo(2 * groundDistanceFromTilt(32, 4), 9);
  });

  it("returns NaN for non-finite input", () => {
    expect(groundDistanceFromTilt(NaN, 4)).toBeNaN();
    expect(groundDistanceFromTilt(32, NaN)).toBeNaN();
  });
});

describe("requiredDowntilt", () => {
  it("solves arctan(Δh / d) for the reference target (32 m, 5442 m)", () => {
    const t = requiredDowntilt(32, 5442);
    expect(t).toBeCloseTo((Math.atan(32 / 5442) * 180) / Math.PI, 9);
    expect(t).toBeCloseTo(0.337, 3);
  });

  it("is the inverse of groundDistanceFromTilt", () => {
    const d = groundDistanceFromTilt(32, 4);
    expect(requiredDowntilt(32, d)).toBeCloseTo(4, 9);
  });

  it("returns NaN for a non-positive distance", () => {
    expect(requiredDowntilt(32, 0)).toBeNaN();
    expect(requiredDowntilt(32, -5)).toBeNaN();
  });
});

describe("beamAngles", () => {
  it("places the −3 dB edges at tilt ∓ VBW/2", () => {
    expect(beamAngles(4, 6.5)).toEqual({ upper: 0.75, center: 4, lower: 7.25 });
  });
});

describe("rayHeight", () => {
  it("drops to the receiver plane exactly at the computed ground distance", () => {
    const d = groundDistanceFromTilt(32, 4);
    expect(rayHeight(572, 4, d)).toBeCloseTo(540, 6);
    expect(rayHeight(32, 4, 0)).toBe(32);
  });
});

describe("calculateCoverage – coverage mode", () => {
  const r = calculateCoverage(DEFAULT_PARAMS, "coverage");

  it("is valid with the reference defaults", () => {
    expect(r.valid).toBe(true);
    expect(r.locationValid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("computes height terms", () => {
    expect(r.heightDiff).toBe(32);
    expect(r.effectiveHeight).toBe(572);
    expect(calculateCoverage({ ...DEFAULT_PARAMS, includeDtm: false }, "coverage").effectiveHeight).toBe(32);
    expect(calculateCoverage({ ...DEFAULT_PARAMS, receiverHeight: 1.5 }, "coverage").heightDiff).toBeCloseTo(30.5, 9);
  });

  it("derives the three beam distances from the tilt", () => {
    expect(r.beams.center.distance).toBeCloseTo(32 / tan(4), 6);
    expect(r.beams.lower.distance).toBeCloseTo(32 / tan(7.25), 6);
    expect(r.beams.upper.distance).toBeCloseTo(32 / tan(0.75), 6);
    expect(r.innerRadius).toBe(r.beams.lower.distance);
    expect(r.outerRadius).toBe(r.beams.upper.distance);
    expect(r.innerRadius).toBeLessThan(r.beams.center.distance);
    expect(r.beams.center.distance).toBeLessThan(r.outerRadius);
    expect(r.footprintLength).toBeCloseTo(r.outerRadius - r.innerRadius, 9);
  });

  it("computes the horizontal sector edges", () => {
    expect(r.sector.left).toBeCloseTo(107.5, 9);
    expect(r.sector.right).toBeCloseTo(132.5, 9);
  });

  it("places the boresight ground point along the azimuth", () => {
    const gp = r.beams.center.groundPoint;
    const dist = haversineMeters(DEFAULT_PARAMS.latitude, DEFAULT_PARAMS.longitude, gp.lat, gp.lon);
    expect(dist).toBeCloseTo(r.beams.center.distance, 3);
    const brg = initialBearing(DEFAULT_PARAMS.latitude, DEFAULT_PARAMS.longitude, gp.lat, gp.lon);
    expect(brg).toBeCloseTo(DEFAULT_PARAMS.azimuth, 2);
  });

  it("treats zero tilt as an unbounded boresight, clamped for drawing", () => {
    const z = calculateCoverage({ ...DEFAULT_PARAMS, tilt: 0 }, "coverage");
    expect(z.valid).toBe(true);
    expect(z.beams.center.distance).toBe(Infinity);
    expect(z.beams.center.reachesPlane).toBe(false);
    expect(z.beams.center.clamped).toBe(true);
    expect(z.beams.center.displayDistance).toBe(MAX_DISTANCE);
    expect(z.beams.upper.distance).toBe(Infinity);
    expect(z.beams.lower.distance).toBeCloseTo(32 / tan(3.25), 6);
    expect(z.warnings.some((w) => /horizon/i.test(w))).toBe(true);
  });

  it("leaves the outer radius unbounded when the upper edge is above the horizon", () => {
    const u = calculateCoverage({ ...DEFAULT_PARAMS, tilt: 2 }, "coverage");
    expect(u.beams.center.reachesPlane).toBe(true);
    expect(u.beams.upper.reachesPlane).toBe(false);
    expect(u.outerRadius).toBe(Infinity);
    expect(u.warnings).toHaveLength(0);
  });
});

describe("calculateCoverage – downtilt mode", () => {
  const r = calculateCoverage(DEFAULT_PARAMS, "downtilt");

  it("solves the downtilt for the target distance", () => {
    expect(r.valid).toBe(true);
    expect(r.solvedDowntilt).not.toBeNull();
    expect(r.solvedDowntilt as number).toBeCloseTo(0.337, 3);
    expect(r.tilt).toBe(r.solvedDowntilt);
  });

  it("lands the boresight exactly on the target distance", () => {
    expect(r.beams.center.distance).toBeCloseTo(DEFAULT_PARAMS.targetDistance, 6);
  });

  it("derives the −3 dB edges from the solved tilt", () => {
    const a = beamAngles(r.tilt, DEFAULT_PARAMS.verticalBeamwidth);
    expect(r.angles).toEqual(a);
    expect(r.beams.lower.distance).toBeCloseTo(32 / tan(a.lower), 6);
    // upper edge is above the horizon for such a shallow tilt
    expect(r.beams.upper.distance).toBe(Infinity);
  });
});

describe("validation", () => {
  it("rejects a receiver at or above the antenna", () => {
    const r = calculateCoverage({ ...DEFAULT_PARAMS, receiverHeight: 32 }, "coverage");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/at or above the antenna/i);
  });

  it("rejects tilts of 90° or more", () => {
    expect(validateParams({ ...DEFAULT_PARAMS, tilt: 90 }, "coverage").errors.length).toBeGreaterThan(0);
    expect(validateParams({ ...DEFAULT_PARAMS, tilt: 89.9 }, "coverage").errors).toHaveLength(0);
  });

  it("rejects non-positive target distances only in downtilt mode", () => {
    expect(validateParams({ ...DEFAULT_PARAMS, targetDistance: 0 }, "downtilt").errors.length).toBeGreaterThan(0);
    expect(validateParams({ ...DEFAULT_PARAMS, targetDistance: 0 }, "coverage").errors).toHaveLength(0);
  });

  it("separates location errors from geometry errors", () => {
    const r = calculateCoverage({ ...DEFAULT_PARAMS, latitude: 95 }, "coverage");
    expect(r.valid).toBe(true);
    expect(r.locationValid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/latitude/i);
  });

  it("rejects out-of-range beamwidths", () => {
    expect(validateParams({ ...DEFAULT_PARAMS, verticalBeamwidth: 0 }, "coverage").errors.length).toBeGreaterThan(0);
    expect(validateParams({ ...DEFAULT_PARAMS, horizontalBeamwidth: 400 }, "coverage").errors.length).toBeGreaterThan(0);
  });
});

describe("geo helpers", () => {
  it("normalises bearings", () => {
    expect(normalizeBearing(-10)).toBe(350);
    expect(normalizeBearing(370)).toBe(10);
    expect(normalizeBearing(360)).toBe(0);
  });

  it("moves ~0.008993° of latitude per 1 km due north", () => {
    const p = destinationPoint(17.6026, 98.0365, 0, 1000);
    expect(p.lat - 17.6026).toBeCloseTo(0.008993, 5);
    expect(p.lon).toBeCloseTo(98.0365, 9);
  });

  it("round-trips distance and bearing through the haversine formulas", () => {
    const p = destinationPoint(17.6026, 98.0365, 120, 5442);
    expect(haversineMeters(17.6026, 98.0365, p.lat, p.lon)).toBeCloseTo(5442, 3);
    expect(initialBearing(17.6026, 98.0365, p.lat, p.lon)).toBeCloseTo(120, 3);
  });

  it("returns the origin for zero distance", () => {
    expect(destinationPoint(10, 20, 45, 0)).toEqual({ lat: 10, lon: 20 });
  });
});

describe("terrainIntersection", () => {
  const flat = Array.from({ length: 11 }, (_, i) => ({ distance: i * 100, z: 0 }));

  it("reproduces the flat-earth distance on flat terrain", () => {
    expect(terrainIntersection(flat, 32, 4, 0)).toBeCloseTo(32 / tan(4), 6);
  });

  it("stops early when a hill rises into the beam", () => {
    const hill = flat.map((s) => ({ ...s, z: s.distance >= 300 ? 40 : 0 }));
    const d = terrainIntersection(hill, 32, 4, 0) as number;
    expect(d).toBeGreaterThan(200);
    expect(d).toBeLessThan(300);
  });

  it("returns null when the ray never meets the terrain within the profile", () => {
    expect(terrainIntersection(flat, 32, 0, 0)).toBeNull();
    expect(terrainIntersection(flat, 32, 1, 0)).toBeNull(); // lands at ~1833 m, beyond 1000 m
  });

  it("honours the receiver height", () => {
    const d0 = terrainIntersection(flat, 32, 4, 0) as number;
    const d1 = terrainIntersection(flat, 32, 4, 1.5) as number;
    expect(d1).toBeCloseTo((30.5 / 32) * d0, 6);
  });
});
