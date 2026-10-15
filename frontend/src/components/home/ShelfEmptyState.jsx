import { cn } from "@/lib/utils";

/**
 * A SHELF WITH NOTHING TO SHOW — said in one line.
 *
 * Two honest cases, one component:
 *
 *   · the shelf failed to load → say so, offer a retry, and let the rest of the
 *     feed carry on (a failed shelf never blanks the page);
 *   · the shelf loaded and the network is genuinely empty for it → the shelf
 *     hides itself instead (see CuratedShelf), because an empty carousel is a
 *     dead end and a padded one would be a lie.
 *
 * `tone="quiet"` is the second case, available for surfaces that would rather
 * explain than disappear.
 */
export default function ShelfEmptyState({ icon: Icon, title, description, action, tone = "quiet", className }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-edge-2 bg-surface-1 px-3.5 py-3",
        className
      )}
      role="status"
    >
      {Icon && (
        <span
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-xl",
            tone === "danger" ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300" : "bg-surface-2 text-ink-3"
          )}
          aria-hidden="true"
        >
          <Icon size={15} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-ink-1">{title}</p>
        {description && <p className="text-2xs text-ink-4">{description}</p>}
      </div>
      {action}
    </div>
  );
}
