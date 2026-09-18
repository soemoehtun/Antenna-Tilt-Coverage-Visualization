import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "sm",
  className,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm";
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-50",
        size === "xs" ? "h-7 px-2 text-[11px]" : "h-9 px-3 text-xs",
        variant === "primary" && "bg-sky-500 text-white hover:bg-sky-400",
        variant === "secondary" && "border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700/80",
        variant === "ghost" && "text-slate-400 hover:bg-slate-800 hover:text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Overlay({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "error" }) {
  return (
    <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-[2px]">
      <div
        className={cn(
          "max-w-sm rounded-lg border px-4 py-3 text-center text-xs leading-relaxed shadow-xl",
          tone === "error" ? "border-rose-800 bg-rose-950/80 text-rose-100" : "border-slate-700 bg-slate-900/90 text-slate-200",
        )}
      >
        {children}
      </div>
    </div>
  );
}
