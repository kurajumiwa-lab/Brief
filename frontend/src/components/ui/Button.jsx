import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// v2.7: borderless — secondary/outline are glass tints, not outlined boxes
const variants = {
  primary:
    "bg-gradient-to-b from-brand-500 to-brand-600 text-white hover:from-brand-400 hover:to-brand-600 active:from-brand-600 active:to-brand-700 shadow-[0_8px_24px_-8px_rgba(34,168,103,0.55)] disabled:hover:from-brand-500 disabled:hover:to-brand-600",
  secondary: "bg-white/[0.07] text-ink-1 backdrop-blur-md hover:bg-white/[0.12]",
  outline: "bg-white/[0.04] text-ink-2 hover:text-ink-1 hover:bg-white/[0.08] backdrop-blur-md",
  ghost: "text-ink-3 hover:text-ink-1 hover:bg-white/[0.06]",
  danger: "bg-red-600/90 text-white hover:bg-red-600",
  dangerGhost: "text-red-400 hover:bg-red-500/10",
};

const sizes = {
  xs: "h-7 px-2 text-xs gap-1 rounded-md",
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-9 px-4 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-sm gap-2 rounded-xl",
  icon: "h-8 w-8 rounded-lg",
};

const Button = forwardRef(function Button(
  { variant = "primary", size = "md", loading = false, icon: Icon, iconRight: IconRight, fullWidth, className, children, disabled, type = "button", ...rest },
  ref
) {
  const iconSize = size === "xs" ? 12 : size === "lg" ? 16 : 14;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors select-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface-0",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" /> : Icon ? <Icon size={iconSize} /> : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} /> : null}
    </button>
  );
});

export default Button;
