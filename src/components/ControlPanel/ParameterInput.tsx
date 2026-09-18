import { useEffect, useState } from "react";
import { cn } from "../../utils/cn";

export interface ParameterInputProps {
  id: string;
  label: string;
  /** Canonical value (metres / degrees). */
  value: number;
  onChange: (v: number) => void;
  /** Suffix shown inside the field, e.g. "m", "°". */
  unit?: string;
  /** Convert canonical → displayed value (e.g. metres → feet). */
  toDisplay?: (v: number) => number;
  /** Convert displayed → canonical value. */
  fromDisplay?: (v: number) => number;
  step?: number;
  min?: number;
  max?: number;
  /** Max decimals used when formatting the displayed value. */
  decimals?: number;
  /** Short explanation shown on hover. */
  help?: string;
  /** Optional slider (canonical units). Use `log: true` for wide spans. */
  slider?: { min: number; max: number; step?: number; log?: boolean };
  /** Colour dot next to the label, tying the input to a line in the charts. */
  accent?: string;
}

function formatDisplay(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return "";
  return Number(v.toFixed(decimals)).toString();
}

export function ParameterInput({
  id,
  label,
  value,
  onChange,
  unit,
  toDisplay,
  fromDisplay,
  step,
  min,
  max,
  decimals = 4,
  help,
  slider,
  accent,
}: ParameterInputProps) {
  const display = toDisplay ? toDisplay(value) : value;
  const [text, setText] = useState(() => formatDisplay(display, decimals));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatDisplay(display, decimals));
  }, [display, decimals, focused]);

  const parsed = Number(text.trim().replace(",", "."));
  const invalid = text.trim() === "" || Number.isNaN(parsed);
  const outOfRange = !invalid && ((min !== undefined && parsed < min) || (max !== undefined && parsed > max));

  const commit = (raw: string) => {
    setText(raw);
    const n = Number(raw.trim().replace(",", "."));
    if (raw.trim() === "" || Number.isNaN(n)) return;
    onChange(fromDisplay ? fromDisplay(n) : n);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <label htmlFor={id} title={help} className="flex items-center gap-1.5 text-xs text-slate-300">
          {accent && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: accent }} aria-hidden />}
          {label}
        </label>
        <div
          className={cn(
            "flex h-8 w-full items-center overflow-hidden rounded-md border bg-slate-950 transition focus-within:ring-1 focus-within:ring-sky-500/40 sm:w-28 sm:shrink-0",
            invalid
              ? "border-rose-500"
              : outOfRange
                ? "border-amber-500"
                : "border-slate-700 hover:border-slate-600 focus-within:border-sky-500",
          )}
        >
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(e) => commit(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              setText(formatDisplay(display, decimals));
            }}
            onKeyDown={(e) => {
              if (!step || invalid || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
              e.preventDefault();
              const dir = e.key === "ArrowUp" ? 1 : -1;
              const next = Number((parsed + dir * step * (e.shiftKey ? 10 : 1)).toFixed(decimals));
              setText(next.toString());
              onChange(fromDisplay ? fromDisplay(next) : next);
            }}
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-right font-mono text-xs tabular-nums text-slate-100 outline-none"
          />
          {unit && <span className="select-none pr-2 text-[10px] text-slate-500">{unit}</span>}
        </div>
      </div>
      {slider &&
        (slider.log ? (
          // Log-scale slider: position t ∈ [0,1000] ↔ value = min·(max/min)^(t/1000)
          <input
            type="range"
            aria-label={`${label} slider`}
            min={0}
            max={1000}
            step={1}
            value={Math.round(
              1000 *
                (Math.log(Math.max(value, slider.min)) - Math.log(slider.min)) /
                (Math.log(slider.max) - Math.log(slider.min)),
            )}
            onChange={(e) => {
              const t = Number(e.target.value) / 1000;
              onChange(Math.round(slider.min * Math.exp(Math.log(slider.max / slider.min) * t)));
            }}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-800"
            style={{ color: accent ?? "#38bdf8" }}
          />
        ) : (
          <input
            type="range"
            aria-label={`${label} slider`}
            min={slider.min}
            max={slider.max}
            step={slider.step ?? step ?? 1}
            value={Math.min(slider.max, Math.max(slider.min, value))}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-800"
            style={{ color: accent ?? "#38bdf8" }}
          />
        ))}
    </div>
  );
}
