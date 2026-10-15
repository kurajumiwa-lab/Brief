import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * A COMPACT METRIC GROUP — the replacement for a row of stat cards (v3.2).
 *
 * Four numbers a merchant reads at a glance, separated by hairlines instead of
 * being boxed into four bordered tiles. The hairline does the work the cards
 * used to: it groups the row, it holds two columns on a phone, and it costs no
 * vertical space.
 *
 * Contract, deliberately small:
 *   · `label` is the quiet caption above the figure;
 *   · `value` is the figure — the only large type in the row;
 *   · `note` is the one line that says *where the number came from*;
 *   · `to` makes the whole cell a link. A linked cell's accessible name is the
 *     label, the figure and the note together, so a screen reader never hears
 *     a naked number.
 *
 * A caller with no number passes `value="—"` and says why in `note`: an
 * unknown figure stays unknown, it is never rounded up to something cheerful.
 */
export default function StatStrip({ stats = [], className, columns = 4 }) {
  if (!stats.length) return null;

  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-y-3",
        columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-4",
        className
      )}
    >
      {stats.map(({ key, label, value, note, to }) => (
        <div key={key || label} className={cn("group relative min-w-0 border-t border-edge-1 pt-3 pr-3")}>
          {to && (
            <Link
              to={to}
              aria-label={`${label}: ${value}. ${note || ""}`.trim()}
              className="absolute inset-0 z-10 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            />
          )}
          <dt className="text-micro font-bold uppercase tracking-[0.1em] text-ink-4">{label}</dt>
          <dd className="mt-1.5 text-xl font-bold leading-none text-ink-1 tabular-nums">{value}</dd>
          {note && (
            <dd
              className={cn(
                "mt-1 text-micro leading-snug text-ink-4 transition-colors",
                to && "group-hover:text-brand-700 dark:group-hover:text-brand-300"
              )}
            >
              {note}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
