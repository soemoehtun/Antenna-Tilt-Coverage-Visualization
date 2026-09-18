/** Which quantity the engine solves for. */
export type CalcMode = "coverage" | "downtilt";

/** Display unit system (all internal values stay metric). */
export type UnitSystem = "metric" | "imperial";

export interface LatLon {
  lat: number;
  lon: number;
}

/** All user-editable inputs. Lengths are metres, angles are degrees. */
export interface AntennaParams {
  latitude: number;
  longitude: number;
  /** Antenna height above local ground (m). */
  antennaHeight: number;
  /** Terrain height at the site, AMSL (m). */
  dtmHeight: number;
  /** Add the DTM height to the antenna height to get an AMSL reference. */
  includeDtm: boolean;
  /** Bearing of the main beam, clockwise from true north (°). */
  azimuth: number;
  /** Mechanical/electrical downtilt, positive = down (°). */
  tilt: number;
  /** -3 dB horizontal beamwidth (°). */
  horizontalBeamwidth: number;
  /** -3 dB vertical beamwidth (°). */
  verticalBeamwidth: number;
  /** Height of the receiver above ground (m). */
  receiverHeight: number;
  /** Desired boresight ground distance for the downtilt solver (m). */
  targetDistance: number;
}

export type BeamKey = "upper" | "center" | "lower";

export interface BeamAngles {
  /** tilt − VBW/2 */
  upper: number;
  /** tilt */
  center: number;
  /** tilt + VBW/2 */
  lower: number;
}

export interface BeamDistance {
  key: BeamKey;
  label: string;
  /** Depression angle below horizontal (°). */
  angle: number;
  /** Flat-earth ground distance (m). Infinity when the ray never reaches the receiver plane. */
  distance: number;
  reachesPlane: boolean;
  /** True when the distance exceeds MAX_DISTANCE and is clamped for drawing. */
  clamped: boolean;
  /** min(distance, MAX_DISTANCE) – always finite, used for drawing. */
  displayDistance: number;
  /** Geodesic point at displayDistance along the azimuth. */
  groundPoint: LatLon;
}

export interface CoverageResult {
  mode: CalcMode;
  /** Geometry inputs are valid and the numbers below are meaningful. */
  valid: boolean;
  /** Latitude/longitude are within range. */
  locationValid: boolean;
  errors: string[];
  warnings: string[];
  /** antennaHeight (+ dtmHeight when includeDtm). */
  effectiveHeight: number;
  /** antennaHeight − receiverHeight. */
  heightDiff: number;
  /** Effective tilt used for the geometry (input tilt, or the solved tilt). */
  tilt: number;
  /** arctan(heightDiff / targetDistance) in downtilt mode, otherwise null. */
  solvedDowntilt: number | null;
  angles: BeamAngles;
  beams: Record<BeamKey, BeamDistance>;
  /** Ground distance of the lower −3 dB edge (m). */
  innerRadius: number;
  /** Ground distance of the upper −3 dB edge (m). */
  outerRadius: number;
  /** outerRadius − innerRadius (m). */
  footprintLength: number;
  /** Sector edge bearings (azimuth ± HBW/2), normalised 0–360. */
  sector: { left: number; right: number };
  maxDistance: number;
}

export interface TerrainSample {
  /** Ground distance from the site (m). */
  distance: number;
  /** Elevation AMSL (m). */
  elevation: number;
  point: LatLon;
}
