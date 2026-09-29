import { cn } from "@/lib/utils";

export default function Card({ className, hover, padding = "p-4", onClick, children, as: Tag = "div", ...rest }) {
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "rounded-xl border border-edge-1 bg-surface-1 animate-fade-in",
        padding,
        (hover || onClick) && "transition-colors hover:border-edge-2 hover:bg-surface-2/60",
        onClick && "cursor-pointer text-left w-full",
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
      {action}
    </div>
  );
}

export function CardTitle({ className, children, sub }) {
  return (
    <div>
      <h3 className={cn("text-sm font-semibold text-ink-1 leading-tight", className)}>{children}</h3>
      {sub && <p className="text-xs text-ink-4 mt-0.5">{sub}</p>}
    </div>
  );
}
