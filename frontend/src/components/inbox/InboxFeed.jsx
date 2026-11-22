import { Link } from "react-router-dom";
import { Bell, ChevronRight } from "lucide-react";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import { relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * THE WAITING LIST — grouped, not one undifferentiated wall.
 *
 * The Activity screen this replaces grouped its notifications by what they are
 * (invitations, replies, trades…) with a heading and a one-line description
 * each, because "twelve rows, newest first" answers "who spoke last" and not
 * "what kind of thing needs me". Messages and trades join those groups here
 * rather than sitting in their own tabs.
 *
 * Three states, kept visibly distinct — this is the part that is easy to get
 * wrong and was wrong in the first draft of the merge: a failed load rendered
 * as "nothing is waiting", which is a lie the page tells in the one moment it
 * matters. Loading, failure and emptiness each get their own branch, and the
 * failure branch names what broke and offers the way back.
 */

export const GROUP_ORDER = [
  "messages",
  "invitations",
  "replies",
  "trades",
  "events",
  "community",
  "account",
];

export default function InboxFeed({
  rows,
  meta,
  status,
  onRetry,
  emptyBody,
  actOn,
}) {
  if (status === "loading") {
    return (
      <div className="mt-3 space-y-2" data-testid="inbox-loading">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        data-testid="activity-error"
        role="alert"
        className="mt-3 flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2"
      >
        <Bell size={14} className="shrink-0 text-danger" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-xs font-semibold text-ink-1">
          Couldn&apos;t load activity — notifications and trades may be missing.
        </p>
        <Button size="xs" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div
        data-testid="activity-empty"
        className="mt-3 flex items-center gap-2.5 px-1 py-6"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          <Bell size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink-1">You&apos;re all caught up.</p>
          <p className="text-2xs leading-snug text-ink-3">{emptyBody}</p>
        </div>
      </div>
    );
  }

  const byKind = new Map();
  for (const row of rows) {
    if (!byKind.has(row.kind)) byKind.set(row.kind, []);
    byKind.get(row.kind).push(row);
  }
  const ordered = [...byKind.keys()].sort(
    (a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b),
  );

  return (
    <div className="mt-3 space-y-4">
      {ordered.map((kind) => {
        const group = byKind.get(kind);
        const meta_ = meta[kind] || { label: kind, blurb: "" };
        const Icon = meta_.icon || Bell;
        return (
          <section
            key={kind}
            aria-labelledby={`inbox-${kind}`}
            data-testid={`activity-section-${kind}`}
            className="space-y-1.5"
          >
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-surface-2 text-ink-3">
                <Icon size={14} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 id={`inbox-${kind}`} className="text-xs font-bold text-ink-1">
                  {meta_.label}
                </h3>
                {meta_.blurb && <p className="text-micro text-ink-4">{meta_.blurb}</p>}
              </div>
            </div>

            <ul className="divide-y divide-edge-1 overflow-hidden rounded-2xl border border-edge-1 bg-surface-1 shadow-xs">
              {group.map((row) => (
                <li key={row.key}>
                  <Link
                    to={row.to}
                    onClick={() => actOn?.(row)}
                    className={cn(
                      "flex min-h-tap items-start gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2",
                      row.unread && "bg-brand-50/50 dark:bg-brand-500/5",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                        row.unread ? "bg-brand-500" : "bg-transparent",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-xs",
                            row.unread ? "font-bold text-ink-1" : "font-semibold text-ink-2",
                          )}
                        >
                          {row.title}
                        </span>
                        {row.at && (
                          <span className="shrink-0 text-micro text-ink-4">
                            {relativeTime(row.at)}
                          </span>
                        )}
                      </span>
                      {row.body && (
                        <span className="mt-0.5 line-clamp-1 block text-2xs text-ink-3">
                          {row.body}
                        </span>
                      )}
                    </span>
                    <ChevronRight
                      size={15}
                      className="mt-1 shrink-0 text-ink-4"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
