import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * v3 — one button, seven intents, four sizes.
 *
 * Rules the whole product obeys:
 *   · exactly one `primary` per view (the core action)
 *   · `secondary` carries a real hairline — a light UI needs the edge
 *   · touch targets are ≥40px from `md` up, ≥44px at `lg`
 *   · the focus ring is a token, never removed
 */
const variants = {
  primary:
    "bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 " +
    "disabled:hover:bg-brand-600",
  secondary:
    "bg-surface-0 text-ink-1 border border-edge-2 shadow-xs hover:bg-surface-2 hover:border-edge-3 active:bg-surface-3",
  outline:
    "bg-transparent text-ink-2 border border-edge-2 hover:bg-surface-2 hover:text-ink-1 active:bg-surface-3",
  ghost: "bg-transparent text-ink-3 hover:bg-surface-2 hover:text-ink-1 active:bg-surface-3",
  subtle: "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25",
  danger: "bg-red-600 text-white shadow-xs hover:bg-red-700 active:bg-red-800",
  dangerGhost: "bg-transparent text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10",
};

const sizes = {
  xs: "h-7 px-2.5 text-2xs gap-1 rounded-lg",
  sm: "h-9 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-11 px-5 text-sm gap-2 rounded-xl",
  xl: "h-12 px-6 text-base gap-2.5 rounded-xl",
  icon: "h-9 w-9 rounded-lg",
  iconLg: "h-11 w-11 rounded-xl",
};

const ICON = { xs: 13, sm: 14, md: 16, lg: 17, xl: 18, icon: 16, iconLg: 18 };

const Button = forwardRef(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    icon: Icon,
    iconRight: IconRight,
    fullWidth,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref
) {
  const iconSize = ICON[size] ?? 16;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center font-semibold whitespace-nowrap select-none",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-1 ease-out",
        "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45",
        variants[variant] || variants.primary,
        sizes[size] || sizes.md,
        fullWidth && "w-full",
        className
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 size={iconSize} className="animate-spin shrink-0" aria-hidden="true" />
      ) : Icon ? (
        <Icon size={iconSize} className="shrink-0" aria-hidden="true" />
      ) : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} className="shrink-0" aria-hidden="true" /> : null}
    </button>
  );
});

export default Button;
