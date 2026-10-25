import { Package } from "lucide-react";
import Media from "@/components/ui/Media";
import { cn } from "@/lib/utils";

/**
 * The media slot of a listing card.
 *
 * When a listing carries a real image (`item.images[0]`), we display it.
 * Otherwise, we render a solid-surface product illustration keyed to the
 * category so every card has an immediate visual anchor without fabricating
 * stock photography.
 *
 * "Otherwise" includes a photo that no longer loads. A listing whose file was
 * lost (an instance that restarted, a deleted upload, an old absolute URL) used
 * to show the browser's broken-image glyph on every shelf it appeared on. The
 * illustration is the designed answer to "no photo", and a dead file is no
 * photo.
 */
const TONES = [
  "bg-brand-50 text-brand-700 dark:bg-surface-2 dark:text-brand-300",
  "bg-blue-50 text-blue-700 dark:bg-surface-2 dark:text-blue-300",
  "bg-accent-50 text-accent-700 dark:bg-surface-2 dark:text-accent-300",
  "bg-purple-50 text-purple-700 dark:bg-surface-2 dark:text-purple-300",
  "bg-teal-50 text-teal-700 dark:bg-surface-2 dark:text-teal-300",
  "bg-rose-50 text-rose-700 dark:bg-surface-2 dark:text-rose-300",
];

const toneFor = (s = "") => TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];

/** The product illustration, exported so other screens can reuse the same idea. */
export function StockIllustration({ item, className }) {
  const label = item?.category || item?.name || "stock";
  return (
    <div className={cn("absolute inset-0 grid place-items-center", toneFor(label), className)} aria-hidden="true">
      <div className="relative flex flex-col items-center gap-1.5 px-3 text-center">
        <div className="w-11 h-11 rounded-2xl bg-surface-0 border border-edge-1 shadow-2xs flex items-center justify-center">
          <Package size={20} strokeWidth={1.8} />
        </div>
        <span className="text-micro font-bold uppercase tracking-[0.12em] px-2 py-0.5 rounded-full bg-surface-0 border border-edge-1 text-ink-2 line-clamp-1">
          {item?.category || " Wholesale stock "}
        </span>
      </div>
    </div>
  );
}

export default function StockThumb({ item, className, ratio = "aspect-[16/10]", rounded = "", children }) {
  return (
    <div className={cn("relative overflow-hidden bg-surface-2 border-b border-edge-1", ratio, rounded, className)}>
      <Media
        src={item?.images?.[0]}
        alt={item?.name || ""}
        className="absolute inset-0 w-full h-full object-cover"
        fallback={<StockIllustration item={item} />}
      />
      {children}
    </div>
  );
}
