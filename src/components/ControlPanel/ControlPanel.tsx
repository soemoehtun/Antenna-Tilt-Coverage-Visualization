import type { ReactNode } from "react";
import type { TerrainStatus } from "../../hooks/useTerrainProfile";
import { BEAM_COLORS } from "../../lib/colors";
import { formatLength, fromDisplayLength, lengthUnitLabel, toDisplayLength } from "../../lib/format";
import type { AntennaParams, CalcMode, UnitSystem } from "../../types";
import { BookmarkTabs, type BookmarkTab } from "../ui/tabs-like-bookmark";
import { ParameterInput } from "./ParameterInput";

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h3>
        {hint && <span className="text-[10px] text-slate-600">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

interface ControlPanelProps {
  params: AntennaParams;
  mode: CalcMode;
  unit: UnitSystem;
  /** Site ground elevation from the DEM (m AMSL), when known. */
  siteElevation: number | null;
  terrainStatus: TerrainStatus;
  onModeChange: (m: CalcMode) => void;
  onChange: <K extends keyof AntennaParams>(key: K, value: AntennaParams[K]) => void;
}

export function ControlPanel({
  params,
  mode,
  unit,
  siteElevation,
  terrainStatus,
  onModeChange,
  onChange,
}: ControlPanelProps) {
  const lenUnit = lengthUnitLabel(unit);
  const toLen = (m: number) => toDisplayLength(m, unit);
  const fromLen = (v: number) => fromDisplayLength(v, unit);
  const lenDecimals = unit === "metric" ? 2 : 1;

  const elevationText =
    siteElevation !== null
      ? `${formatLength(siteElevation, unit, { long: true })} AMSL`
      : terrainStatus === "loading"
        ? "fetching…"
        : terrainStatus === "error"
          ? "unavailable"
          : "—";

  const antennaHeightInput = (
    <ParameterInput
      id="antennaHeight"
      label="Height above ground"
      unit={lenUnit}
      value={params.antennaHeight}
      onChange={(v) => onChange("antennaHeight", v)}
      toDisplay={toLen}
      fromDisplay={fromLen}
      step={1}
      min={0}
      decimals={lenDecimals}
      help="Height of the antenna's radiating centre above the local ground."
    />
  );

  const tiltInput = (
    <ParameterInput
      id="tilt"
      label="Downtilt"
      unit="°"
      accent={BEAM_COLORS.center}
      value={params.tilt}
      onChange={(v) => onChange("tilt", v)}
      step={0.1}
      min={-90}
      max={89.9}
      decimals={2}
      slider={{ min: -5, max: 30, step: 0.1 }}
      help="Total (mechanical + electrical) downtilt of the boresight below horizontal. Negative values tilt upwards."
    />
  );

  const targetDistanceInput = (
    <ParameterInput
      id="targetDistance"
      label="Target distance"
      unit={lenUnit}
      accent={BEAM_COLORS.center}
      value={params.targetDistance}
      onChange={(v) => onChange("targetDistance", v)}
      toDisplay={toLen}
      fromDisplay={fromLen}
      step={10}
      min={1}
      decimals={lenDecimals}
      slider={{ min: 50, max: 25000, log: true }}
      help="Ground distance at which the boresight should reach the receiver plane."
    />
  );

  const azimuthInput = (
    <ParameterInput
      id="azimuth"
      label="Azimuth"
      unit="°"
      value={params.azimuth}
      onChange={(v) => onChange("azimuth", v)}
      step={1}
      decimals={1}
      slider={{ min: 0, max: 360, step: 1 }}
      help="Bearing of the main beam, clockwise from true north (0° = N, 90° = E)."
    />
  );

  const vbwInput = (
    <ParameterInput
      id="verticalBeamwidth"
      label="Vertical beamwidth"
      unit="°"
      value={params.verticalBeamwidth}
      onChange={(v) => onChange("verticalBeamwidth", v)}
      step={0.5}
      min={0.1}
      max={180}
      decimals={2}
      help="−3 dB beamwidth in the vertical plane. The upper and lower edges sit at tilt ∓ half of this value."
    />
  );

  const hbwInput = (
    <ParameterInput
      id="horizontalBeamwidth"
      label="Horizontal beamwidth"
      unit="°"
      value={params.horizontalBeamwidth}
      onChange={(v) => onChange("horizontalBeamwidth", v)}
      step={1}
      min={1}
      max={360}
      decimals={1}
      help="−3 dB beamwidth in the horizontal plane – the width of the sector on the map."
    />
  );

  const receiverGroup = (
    <Group title="Receiver">
      <ParameterInput
        id="receiverHeight"
        label="Height above ground"
        unit={lenUnit}
        value={params.receiverHeight}
        onChange={(v) => onChange("receiverHeight", v)}
        toDisplay={toLen}
        fromDisplay={fromLen}
        step={0.5}
        min={0}
        decimals={lenDecimals}
        help="Height of the receiving antenna above ground (e.g. 1.5 m for a handset). Distances are measured where the beam crosses this plane."
      />
    </Group>
  );

  const siteGroup = (
    <Group title="Site" hint="or drag the marker on the map">
      <ParameterInput
        id="latitude"
        label="Latitude"
        unit="°"
        value={params.latitude}
        onChange={(v) => onChange("latitude", v)}
        step={0.001}
        min={-90}
        max={90}
        decimals={6}
        help="Decimal degrees, positive north."
      />
      <ParameterInput
        id="longitude"
        label="Longitude"
        unit="°"
        value={params.longitude}
        onChange={(v) => onChange("longitude", v)}
        step={0.001}
        min={-180}
        max={180}
        decimals={6}
        help="Decimal degrees, positive east."
      />
      <div className="flex items-center justify-between text-xs" title="Looked up automatically from the Copernicus DEM; used by the terrain profile.">
        <span className="text-slate-400">Ground elevation</span>
        <span className="font-mono tabular-nums text-slate-200">{elevationText}</span>
      </div>
    </Group>
  );

  const modeTabs: BookmarkTab[] = [
    {
      value: "coverage",
      label: "Coverage Distance",
      content: (
        <div className="flex flex-col gap-6">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Set the downtilt to see where each beam reaches the ground.
          </p>
          <Group title="Antenna">
            {antennaHeightInput}
            {tiltInput}
            {azimuthInput}
            {vbwInput}
            {hbwInput}
          </Group>
          {receiverGroup}
          {siteGroup}
        </div>
      ),
    },
    {
      value: "downtilt",
      label: "Required Downtilt",
      content: (
        <div className="flex flex-col gap-6">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Set the target ground distance to get the downtilt the antenna needs.
          </p>
          <Group title="Antenna">
            {antennaHeightInput}
            {targetDistanceInput}
            {azimuthInput}
            {vbwInput}
            {hbwInput}
          </Group>
          {receiverGroup}
          {siteGroup}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-4">
      <BookmarkTabs
        tabs={modeTabs}
        value={mode}
        onValueChange={(v) => onModeChange(v as CalcMode)}
        contentClassName="px-3 pt-3 pb-6"
      />
    </div>
  );
}
