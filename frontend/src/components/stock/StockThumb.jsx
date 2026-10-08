import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The media slot of a listing card.
 *
 * A marketplace card needs a visual anchor, but Brief_ must never invent one:
 * stock rows carry an optional `images` array and most of them are empty. When
 * there is a real image we show it; when there is not we draw a deterministic
 * category pattern — honest, recognisable, and free (no request, no layout
 * shift, no stock-photo lie).
 */
const WASHES = [
  "from-brand-500/15 to-brand-500/[0.04] text-brand-700 dark:text-brand-300",
  "from-blue-500/15 to-blue-500/[0.04] text-blue-700 dark:text-blue-300",
  "from-accent-500/15 to-accent-500/[0.04] text-accent-700 dark:text-accent-300",
  "from-purple-500/15 to-purple-500/[0.04] text-purple-700 dark:text-purple-300",
  "from-teal-500/15 to-teal-500/[0.04] text-teal-700 dark:text-teal-300",
  "from-rose-500/15 to-rose-500/[0.04] text-rose-700 dark:text-rose-300",
];

const washFor = (s = "") => WASHES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % WASHES.length];

export default function StockThumb({ item, className, ratio = "aspect-[16/10]", rounded = "", children }) {
  const src = item?.images?.[0];
  const label = item?.category || item?.name || "stock";

  return (
    <div className={cn("relative overflow-hidden bg-surface-2", ratio, rounded, className)}>
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className={cn("absolute inset-0 bg-gradient-to-br grid place-items-center", washFor(label))} aria-hidden="true">
          <svg className="absolute inset-0 w-full h-full opacity-[0.35]" aria-hidden="true">
            <defs>
              <pattern id={`grid-${washFor(label).length}`} width="18" height="18" patternUnits="userSpaceOnUse">
                <path d="M18 0H0v18" fill="none" stroke="currentColor" strokeWidth="0.6" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#grid-${washFor(label).length})`} />
          </svg>
          <div className="relative flex flex-col items-center gap-1.5">
            <Package size={22} strokeWidth={1.6} />
            <span className="text-micro font-bold uppercase tracking-[0.12em] opacity-80 px-2 text-center line-clamp-1">
              {item?.category || "uncategorised"}
            </span>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
