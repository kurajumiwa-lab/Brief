import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * The mark: a shelf glyph (three stacked bars, the top one short — stock going
 * out) inside a rounded square, with a brand dot for the "live" network.
 * Drawn inline so it costs nothing and inherits the theme.
 */
export function LogoMark({ size = 32, className }) {
  return (
    <span
      className={cn("inline-grid place-items-center rounded-xl bg-ink-1 text-surface-0 shrink-0", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 20 20" fill="none">
        <rect x="2" y="3.5" width="10" height="2.6" rx="1.3" fill="currentColor" />
        <rect x="2" y="8.7" width="16" height="2.6" rx="1.3" fill="currentColor" opacity="0.72" />
        <rect x="2" y="13.9" width="13" height="2.6" rx="1.3" fill="currentColor" opacity="0.45" />
        <circle cx="16.4" cy="4.8" r="2.4" className="fill-brand-500" />
      </svg>
    </span>
  );
}

export default function Logo({ to = "/", compact = false, className }) {
  return (
    <Link
      to={to}
      className={cn("flex items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50", className)}
      aria-label="Ogallo — home"
    >
      <LogoMark />
      {!compact && (
        <span className="hidden sm:flex items-baseline gap-1">
          <span className="text-lg font-extrabold tracking-tight text-ink-1 leading-none">ogallo</span>
          <span className="w-1.5 h-1.5 rounded-full bg-brand-500 mb-0.5" aria-hidden="true" />
        </span>
      )}
    </Link>
  );
}
