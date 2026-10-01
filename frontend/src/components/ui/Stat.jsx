import { cn } from "@/lib/utils";
import DigitalNumber from "./DigitalNumber";

const TONES = { default: "default", brand: "brand", amber: "amber", blue: "blue", red: "red" };

/**
 * v2.7 stat tile: borderless glass + digital (timer-style) readout.
 * Clickable variants open popup screens.
 */
export default function Stat({ label, value, hint, icon: Icon, tone = "default", digital = true, className, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "glass glass-hover digital-sheen rounded-2xl p-4 text-left w-full min-w-[11.5rem]",
        onClick && "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs uppercase tracking-[0.14em] text-ink-4 font-medium">{label}</span>
        {Icon && <Icon size={14} className="text-ink-4" />}
      </div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        {digital ? (
          <DigitalNumber value={value} tone={TONES[tone] || "default"} />
        ) : (
          <span className="text-3xl font-semibold leading-none text-ink-1">{value}</span>
        )}
      </div>
      {hint && <p className="mt-2 text-2xs text-ink-4 leading-snug">{hint}</p>}
    </Tag>
  );
}
