import { useCallback, useEffect, useMemo, useState } from "react";
import { ControlPanel } from "./components/ControlPanel/ControlPanel";
import { ResultsStrip } from "./components/ResultsStrip";
import { ElevationChart } from "./components/Visualization/ElevationChart";
import { MapView } from "./components/Visualization/MapView";
import { useTerrainProfile } from "./hooks/useTerrainProfile";
import { calculateCoverage, DEFAULT_PARAMS, MAX_DISTANCE } from "./lib/antenna";
import { round } from "./lib/format";
import { profileLengthFor, terrainBlockDistances } from "./lib/terrain";
import type { AntennaParams, CalcMode, UnitSystem } from "./types";
import { cn } from "./utils/cn";

/**
 * The terrain height is looked up from the DEM (first sample of the terrain
 * profile) rather than typed in, so the engine's DTM fields stay off.
 */
const INITIAL_PARAMS: AntennaParams = { ...DEFAULT_PARAMS, dtmHeight: 0, includeDtm: false };

/** All lengths are shown in metres/kilometres (no imperial toggle). */
const UNIT: UnitSystem = "metric";

export default function App() {
  const [params, setParams] = useState<AntennaParams>(INITIAL_PARAMS);
  const [mode, setMode] = useState<CalcMode>("coverage");
  /** null keeps the terrain profile matched automatically to the beam reach. */
  const [profileDistanceOverride, setProfileDistanceOverride] = useState<number | null>(null);
  /** Terrain-profile hover spotlighted on the map with a red dot. */
  const [profileHover, setProfileHover] = useState<{ distance: number; lat: number; lon: number } | null>(null);
  /** Mobile-only: which panel the bottom navigation shows (desktop shows both). */
  const [mobileView, setMobileView] = useState<"inputs" | "results">("inputs");

  const update = useCallback(<K extends keyof AntennaParams>(key: K, value: AntennaParams[K]) => {
    setParams((p) => (p[key] === value ? p : { ...p, [key]: value }));
  }, []);

  const setLocation = useCallback((lat: number, lon: number) => {
    setParams((p) => ({ ...p, latitude: round(lat, 6), longitude: round(lon, 6) }));
  }, []);

  const handleProfileHover = useCallback((hover: { distance: number; lat: number; lon: number } | null) => {
    setProfileHover(hover);
  }, []);

  const result = useMemo(() => calculateCoverage(params, mode), [params, mode]);
  const suggestedProfileLength = useMemo(() => profileLengthFor(result), [result]);
  const profileLength = profileDistanceOverride ?? suggestedProfileLength;

  // A moved site / new azimuth / new range invalidates the old hover point.
  useEffect(() => {
    setProfileHover(null);
  }, [params.latitude, params.longitude, params.azimuth, profileLength]);
  const terrain = useTerrainProfile(params.latitude, params.longitude, params.azimuth, profileLength, result.locationValid);
  const siteElevation = terrain.profile?.[0]?.elevation ?? null;

  /** Where each beam first hits real terrain – shown beneath the results. */
  const blocks = useMemo(
    () => terrainBlockDistances(terrain.profile, params.antennaHeight, params.receiverHeight, result.angles),
    [terrain.profile, params.antennaHeight, params.receiverHeight, result.angles],
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 lg:h-screen lg:overflow-hidden">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-800 px-4 py-2 sm:px-5">
        <div className="min-w-0 leading-tight">
          <h1 className="text-sm font-bold tracking-tight text-white sm:text-base">
            Antenna Downtilt &amp; Coverage Calculator
          </h1>
          <p className="hidden max-w-xl text-[11px] leading-snug text-slate-500 md:block">
            Calculates the approximate antenna downtilt angle for optimal coverage and signal strength, and determines the beam&rsquo;s
            inner and outer coverage radius based on the antenna beamwidth.
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Inputs – on mobile only shown when the "Inputs" tab is active */}
        <aside
          className={cn(
            "shrink-0 border-b border-slate-800 bg-slate-900/40 pb-16 lg:block lg:h-full lg:w-[320px] lg:overflow-y-auto lg:border-b-0 lg:border-r lg:pb-0",
            mobileView === "inputs" ? "block" : "hidden",
          )}
        >
          <ControlPanel
            params={params}
            mode={mode}
            unit={UNIT}
            siteElevation={siteElevation}
            terrainStatus={terrain.status}
            onModeChange={setMode}
            onChange={update}
          />
        </aside>

        {/* Results – on mobile only shown when the "Results" tab is active */}
        <main
          className={cn(
            "min-w-0 flex-1 flex-col pb-16 lg:flex lg:pb-0",
            mobileView === "results" ? "flex" : "hidden",
          )}
        >
          <ResultsStrip params={params} result={result} mode={mode} unit={UNIT} blocks={blocks} />

          {/* map on top, terrain profile along the same azimuth below it */}
          <div className="flex h-[680px] flex-col lg:h-auto lg:min-h-0 lg:flex-1">
            <div className="min-h-0 flex-1">
              <MapView params={params} result={result} unit={UNIT} onMove={setLocation} hover={profileHover} />
            </div>
            <div className="h-64 shrink-0 border-t border-slate-800 lg:h-[46%] lg:min-h-[250px]">
              <ElevationChart
                params={params}
                result={result}
                unit={UNIT}
                profile={terrain.profile}
                status={terrain.status}
                error={terrain.error}
                onRetry={terrain.retry}
                profileDistance={profileLength}
                suggestedProfileDistance={suggestedProfileLength}
                isProfileDistanceAutomatic={profileDistanceOverride === null}
                onProfileDistanceChange={(distance) =>
                  setProfileDistanceOverride(Math.max(500, Math.min(MAX_DISTANCE, distance)))
                }
                onResetProfileDistance={() => setProfileDistanceOverride(null)}
                onProfileHover={handleProfileHover}
              />
            </div>
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation – hidden on desktop where both panels are visible */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-[1200] grid h-16 grid-cols-2 border-t border-slate-800 bg-slate-950/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          type="button"
          onClick={() => setMobileView("inputs")}
          aria-current={mobileView === "inputs" ? "page" : undefined}
          className={cn(
            "flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors",
            mobileView === "inputs" ? "text-sky-400" : "text-slate-500 hover:text-slate-300",
          )}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16M4 12h16M4 18h10" />
            <circle cx="17" cy="18" r="2.2" fill="currentColor" stroke="none" />
            <circle cx="9" cy="12" r="2.2" fill="currentColor" stroke="none" />
            <circle cx="14" cy="6" r="2.2" fill="currentColor" stroke="none" />
          </svg>
          Inputs
        </button>
        <button
          type="button"
          onClick={() => setMobileView("results")}
          aria-current={mobileView === "results" ? "page" : undefined}
          className={cn(
            "flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors",
            mobileView === "results" ? "text-sky-400" : "text-slate-500 hover:text-slate-300",
          )}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 20h18" />
            <path d="M5 16l4-6 4 3 6-8" />
            <circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none" />
          </svg>
          Results
        </button>
      </nav>
    </div>
  );
}
