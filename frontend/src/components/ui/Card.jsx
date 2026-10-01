import { cn } from "@/lib/utils";

/**
 * v2.7 look: borderless glass surface — separation comes from the blur,
 * the gradient lift and the shadow (never from a drawn line).
 */
export default function Card({ className, hover, padding = "p-4", onClick, children, as: Tag = "div", ...rest }) {
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "glass rounded-2xl animate-fade-in",
        padding,
        (hover || onClick) && "glass-hover cursor-pointer text-left w-full",
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
