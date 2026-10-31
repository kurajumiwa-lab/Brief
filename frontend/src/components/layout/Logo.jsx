import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { BRAND } from "@/config/brand";

/**
 * The mark: three nodes and the lines between them, inside a rounded square —
 * the connection layer, drawn. It replaces a shelf glyph (stacked bars), which
 * said "stock" and nothing else; a school looking for an electrician is not
 * looking at a shelf.
 *
 * The third node is `tech` green: the network's second voice, meaning "this
 * exists and works". Drawn inline so it costs nothing and inherits the theme.
 */
export function LogoMark({ size = 32, className }) {
  return (
    <span
      className={cn("inline-grid place-items-center rounded-xl bg-ink-1 text-surface-0 shrink-0", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 20 20" fill="none">
        <path
          d="M10 5.1v9.6M5.4 14.4h9.2M6.6 6.6 3.9 12.7M13.4 6.6l2.7 6.1"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          opacity="0.5"
        />
        <circle cx="10" cy="4.3" r="2.1" fill="currentColor" />
        <circle cx="3.9" cy="16" r="2.1" fill="currentColor" />
        <circle cx="16.1" cy="16" r="2.1" className="fill-tech-500" />
      </svg>
    </span>
  );
}

export default function Logo({ to = "/", compact = false, className }) {
  return (
    <Link
      to={to}
      className={cn("flex items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50", className)}
      aria-label={`${BRAND.name} — home`}
    >
      <LogoMark />
      {!compact && (
        <span className="hidden sm:flex items-baseline gap-1">
          <span className="text-lg font-extrabold tracking-tight text-ink-1 leading-none">{BRAND.wordmark}</span>
          <span className="w-1.5 h-1.5 rounded-full bg-tech-500 mb-0.5" aria-hidden="true" />
        </span>
      )}
    </Link>
  );
}
