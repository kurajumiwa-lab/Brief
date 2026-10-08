import { cn } from "@/lib/utils";

/**
 * v3 tabs. `underline` is the real marketplace pattern — a moving rule under
 * the active label, which reads as navigation. `pill` is for in-card segmenting.
 */
export default function Tabs({ tabs, value, onChange, variant = "underline", className, size = "md" }) {
  const pill = variant !== "underline";
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-center overflow-x-auto no-scrollbar",
        pill ? "gap-1 bg-surface-2 rounded-xl p-1 w-fit" : "gap-1 border-b border-edge-1",
        className
      )}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        const Icon = t.icon;
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 whitespace-nowrap font-semibold transition-colors duration-1 ease-out",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded-lg",
              size === "sm" ? "text-2xs" : "text-sm",
              pill
                ? cn("px-3 py-1.5", active ? "bg-surface-0 text-ink-1 shadow-xs" : "text-ink-3 hover:text-ink-1")
                : cn("px-3 py-2.5 -mb-px", active ? "text-brand-700 dark:text-brand-300" : "text-ink-3 hover:text-ink-1")
            )}
          >
            {Icon && <Icon size={15} aria-hidden="true" />}
            {t.label}
            {t.count !== undefined && t.count !== null && (
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1.5 py-px text-micro font-bold tabular-nums",
                  active ? "bg-brand-600 text-white" : "bg-surface-3 text-ink-3"
                )}
              >
                {t.count}
              </span>
            )}
            {!pill && active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
