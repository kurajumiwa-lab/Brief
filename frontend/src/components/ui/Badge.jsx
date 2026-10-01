import { cn } from "@/lib/utils";

// v2.7: tinted glass chips — no border
const variants = {
  brand: "bg-brand-500/15 text-brand-300",
  blue: "bg-blue-500/15 text-blue-300",
  amber: "bg-amber-500/15 text-amber-300",
  red: "bg-red-500/15 text-red-300",
  purple: "bg-purple-500/15 text-purple-300",
  gray: "bg-white/[0.07] text-ink-3",
  outline: "bg-white/[0.04] text-ink-3",
};

export default function Badge({ variant = "gray", size = "sm", dot, className, children, ...rest }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full backdrop-blur-md font-medium whitespace-nowrap",
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
