import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * NOTIFICATIONS — one chronological list, one line each.
 *
 * The old screen grouped these seven ways (messages, invitations, events,
 * replies, trades, communities, account) with a heading, an icon and a blurb
 * like "Requests to join, invites and approvals" above each group. Seven
 * headings, seven explanations, and the reader still had to scan every row to
 * find the one thing that mattered. The brief calls those redundant headings
 * out by name and this is the answer: no groups, no blurbs, newest first.
 *
 * A row is: an unread dot, a title, a one-line body, a time. The body is
 * clamped to one line rather than shortened server-side, so the text stays
 * whole for anyone who opens the record it points at.
 *
 * READ SEMANTICS — the important part.
 *
 * Opening a notification marks *that* notification read (`notificationAPI.markRead`)
 * and nothing else. There is no mark-all on this screen and no "seen" timer:
 * a screen that marks everything read because you glanced at it is how an unread
 * count becomes a lie, and the brief is explicit that opening one message must
 * not clear unrelated ones.
 */
export default function InboxNotifications({
  rows = [],
  loading = false,
  error = null,
  onRetry,
  onOpen,
}) {
  if (loading) {
    return (
      <div className="divide-y divide-edge-1" data-testid="inbox-notifications-loading" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <span className="h-9 w-9 shrink-0 rounded-full bg-surface-2" />
            <span className="min-w-0 flex-1 space-y-1.5">
              <span className="block h-3 w-2/5 rounded bg-surface-2" />
              <span className="block h-3 w-3/5 rounded bg-surface-2" />
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="py-8 text-center" data-testid="inbox-notifications-error">
        <p className="text-sm font-semibold text-ink-1">Notifications did not load.</p>
        <p className="mt-1 text-2xs text-ink-3">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex h-11 items-center rounded-btn bg-surface-2 px-4 text-2xs font-bold text-ink-1 hover:bg-surface-3"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="py-10 text-center" data-testid="inbox-notifications-empty">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-ink-3">
          <Bell size={19} aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-bold text-ink-1">You&apos;re all caught up</p>
        <p className="mx-auto mt-1 max-w-[16rem] text-2xs leading-relaxed text-ink-3">
          Replies, trades and invitations arrive here.
        </p>
      </div>
    );
  }

  return (
    <ul
      role="tabpanel"
      id="inbox-panel-notifications"
      aria-labelledby="inbox-tab-notifications"
      className="divide-y divide-edge-1"
    >
      {rows.map((row) => (
        <li key={row.key}>
          <Link
            to={row.to}
            onClick={() => onOpen?.(row)}
            data-testid="inbox-notification-row"
            className={cn(
              "flex min-h-11 items-start gap-3 py-2.5 transition-colors hover:bg-surface-2",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600",
            )}
          >
            {/* Unread is a dot in a fixed column, so titles align whether or not
                a row is read. The dot alone is not the signal — the title also
                carries weight — because colour-only state fails a screen reader
                and a greyscale screen both. */}
            <span className="mt-2 flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
              {row.unread && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    row.unread ? "font-bold text-ink-1" : "font-medium text-ink-2",
                  )}
                >
                  {row.title}
                </span>
                {row.at && (
                  <span className="shrink-0 text-micro tabular-nums text-ink-4">
                    {relativeTime(row.at)}
                  </span>
                )}
              </span>
              {row.body && (
                <span className="mt-0.5 line-clamp-1 block text-2xs text-ink-3">{row.body}</span>
              )}
            </span>
            {row.unread && <span className="sr-only">Unread</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
