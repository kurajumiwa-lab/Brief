import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The order-panel quantity control. Clamped to the item's minimum order and
 * its available (not in-stock) quantity — the UI can never request more than
 * the shelf can actually release.
 */
export default function QuantityStepper({ value, onChange, min = 1, max = Infinity, step = 1, unit, disabled, className, id }) {
  const clamp = (n) => Math.max(min, Math.min(max, n));
  const set = (n) => onChange(clamp(Number.isFinite(n) ? n : min));

  return (
    <div className={cn("inline-flex items-stretch rounded-xl border border-edge-2 bg-surface-0 overflow-hidden", disabled && "opacity-50", className)}>
      <button
        type="button"
        onClick={() => set(value - step)}
        disabled={disabled || value <= min}
        aria-label="Decrease quantity"
        className="w-11 grid place-items-center text-ink-2 hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
      >
        <Minus size={16} />
      </button>
      <div className="flex items-baseline justify-center gap-1 px-2 min-w-[5rem] border-x border-edge-1">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={Number.isFinite(max) ? max : undefined}
          disabled={disabled}
          onChange={(e) => set(parseInt(e.target.value, 10))}
          aria-label="Quantity"
          className="w-full bg-transparent text-center text-base font-bold text-ink-1 tabular-nums focus:outline-none py-2.5"
        />
        {unit && <span className="text-2xs text-ink-4 shrink-0 pr-1">{unit}</span>}
      </div>
      <button
        type="button"
        onClick={() => set(value + step)}
        disabled={disabled || value >= max}
        aria-label="Increase quantity"
        className="w-11 grid place-items-center text-ink-2 hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
