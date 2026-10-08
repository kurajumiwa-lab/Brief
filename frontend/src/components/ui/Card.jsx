import { cn } from "@/lib/utils";

/**
 * v3 surface: a real card — hairline + elevation + a hover lift that only
 * fires when the card is actually interactive.
 */
export default function Card({ className, hover, padding = "p-4", onClick, children, as: Tag = "div", ...rest }) {
  const interactive = hover || onClick;
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "bg-surface-0 border border-edge-1 rounded-2xl shadow-xs",
        padding,
        interactive &&
          "glass-hover cursor-pointer text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ className, children, action }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 mb-3", className)}>
      <div className="min-w-0">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardTitle({ className, children, sub, as: Tag = "h3" }) {
  return (
    <div className="min-w-0">
      <Tag className={cn("text-sm font-semibold text-ink-1 leading-snug", className)}>{children}</Tag>
      {sub && <p className="text-2xs text-ink-4 mt-0.5">{sub}</p>}
    </div>
  );
}
