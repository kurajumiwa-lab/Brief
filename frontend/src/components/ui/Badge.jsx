import { cn } from "@/lib/utils";

const variants = {
  brand: "bg-brand-950 text-brand-300 border-brand-800/60",
  blue: "bg-blue-950/60 text-blue-300 border-blue-800/50",
  amber: "bg-amber-950/60 text-amber-300 border-amber-800/50",
  red: "bg-red-950/60 text-red-300 border-red-800/50",
  purple: "bg-purple-950/60 text-purple-300 border-purple-800/50",
  gray: "bg-surface-3 text-ink-3 border-edge-2",
  outline: "bg-transparent text-ink-3 border-edge-2",
};

export default function Badge({ variant = "gray", size = "sm", dot, className, children, ...rest }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap",
        size === "xs" ? "px-1.5 py-px text-2xs" : size === "md" ? "px-2.5 py-0.5 text-xs" : "px-2 py-0.5 text-2xs",
        variants[variant] || variants.gray,
        className
      )}
      {...rest}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
