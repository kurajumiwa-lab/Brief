import { cn } from "@/lib/utils";

/**
 * Filter chip — the marketplace's primary faceting control. A pressed chip is
 * announced via aria-pressed, not just coloured.
 */
export default function Chip({ active, onClick, icon: Icon, count, children, className, size = "md", ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold whitespace-nowrap",
        "border transition-[background-color,border-color,color] duration-1 ease-out",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
        size === "sm" ? "h-7 px-3 text-2xs" : "h-9 px-4 text-xs",
        active
          ? "bg-ink-1 text-surface-0 border-ink-1"
          : "bg-surface-0 text-ink-2 border-edge-2 hover:border-ink-4 hover:text-ink-1",
        className
      )}
      {...rest}
    >
      {Icon && <Icon size={14} aria-hidden="true" />}
      {children}
      {count !== undefined && count !== null && (
        <span className={cn("tabular-nums font-bold", active ? "text-surface-0/70" : "text-ink-4")}>{count}</span>
      )}
    </button>
  );
}
