import { cn } from "@/lib/utils";

const TONES = {
  default: "text-ink-1",
  brand: "text-brand-600 dark:text-brand-400",
  amber: "text-accent-600 dark:text-accent-400",
  blue: "text-blue-600 dark:text-blue-400",
  red: "text-red-600 dark:text-red-400",
};

/**
 * v3 stat tile. The figure leads; the label is a quiet caption above it.
 * Tabular numerals keep columns of stats aligned.
 */
export default function Stat({ label, value, hint, icon: Icon, tone = "default", trend, className, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "bg-surface-0 border border-edge-1 rounded-2xl p-4 text-left w-full",
        onClick && "glass-hover cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-micro uppercase tracking-[0.1em] text-ink-4 font-bold">{label}</span>
        {Icon && <Icon size={15} className="text-ink-4" aria-hidden="true" />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn("text-2xl font-bold leading-none tabular-nums", TONES[tone] || TONES.default)}>{value}</span>
        {trend && <span className="text-2xs font-semibold text-ink-4">{trend}</span>}
      </div>
      {hint && <p className="mt-2 text-2xs text-ink-4 leading-snug">{hint}</p>}
    </Tag>
  );
}
