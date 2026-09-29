import { cn } from "@/lib/utils";

export default function Tabs({ tabs, value, onChange, variant = "underline", className, size = "md" }) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-center gap-1 overflow-x-auto",
        variant === "underline" ? "border-b border-edge-1" : "bg-surface-1 border border-edge-1 rounded-lg p-1 w-fit",
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
              "inline-flex items-center gap-1.5 whitespace-nowrap font-medium transition-colors focus:outline-none",
              size === "sm" ? "text-xs" : "text-sm",
              variant === "underline"
                ? cn("px-3 py-2 -mb-px border-b-2", active ? "border-brand-500 text-ink-1" : "border-transparent text-ink-4 hover:text-ink-2")
                : cn("px-3 py-1.5 rounded-md", active ? "bg-surface-3 text-ink-1" : "text-ink-4 hover:text-ink-2")
            )}
          >
            {Icon && <Icon size={14} />}
            {t.label}
            {t.count !== undefined && t.count !== null && (
              <span className={cn("ml-0.5 rounded-full px-1.5 text-2xs font-mono", active ? "bg-brand-950 text-brand-300" : "bg-surface-3 text-ink-4")}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
