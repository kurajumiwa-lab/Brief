import { cn } from "@/lib/utils";

/**
 * v2.7: no underline lines — the active tab is a filled glass pill
 * (soft glow on the brand variant, plain lift on the other).
 */
export default function Tabs({ tabs, value, onChange, variant = "underline", className, size = "md" }) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-center gap-1 overflow-x-auto",
        variant !== "underline" && "bg-white/[0.04] rounded-xl p-1 w-fit backdrop-blur-md",
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
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap font-medium transition-all duration-200 focus:outline-none",
              size === "sm" ? "text-xs" : "text-sm",
              variant === "underline"
                ? cn(
                    "px-3 py-2 rounded-xl",
                    active
                      ? "bg-brand-500/15 text-brand-200 shadow-[0_0_18px_-4px_rgba(34,168,103,0.45)]"
                      : "text-ink-4 hover:text-ink-2 hover:bg-white/[0.05]"
                  )
                : cn("px-3 py-1.5 rounded-lg", active ? "bg-white/[0.1] text-ink-1 shadow-glass" : "text-ink-4 hover:text-ink-2")
            )}
          >
            {Icon && <Icon size={14} />}
            {t.label}
            {t.count !== undefined && t.count !== null && (
              <span className={cn("ml-0.5 rounded-full px-1.5 text-2xs font-mono", active ? "bg-brand-500/25 text-brand-200" : "bg-white/[0.07] text-ink-4")}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
