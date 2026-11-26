import { Link } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * CHATS — the conversations, as a list you can read at a glance.
 *
 * One row per room: who, the last thing said, when, and how many are unread.
 * That is the entire row. The brief asks for a compact list and this is the
 * shape a messaging app has used for twenty years, because it works: the eye
 * scans names down the left, times down the right, and the bold row is the one
 * with something new.
 *
 * What is deliberately NOT here:
 *
 *   · a heading above the list. The tab you are standing on already says what
 *     this is; a second "Conversations" label is a redundant heading, and the
 *     brief names those specifically.
 *   · a per-row description sentence. `last_message` is the description.
 *   · a bordered card per row. Rows are separated by one hairline, which is
 *     what makes a list look like a list and not a stack of tiles.
 *
 * Rooms the server has not joined yet are shown the same way — they are real
 * rooms you can read, and hiding them would make the list disagree with Chat.
 */
export default function InboxChats({ rooms = [], loading = false, error = null, onRetry }) {
  if (loading) {
    return (
      <div className="divide-y divide-edge-1" data-testid="inbox-chats-loading" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <span className="h-11 w-11 shrink-0 rounded-full bg-surface-2" />
            <span className="min-w-0 flex-1 space-y-1.5">
              <span className="block h-3 w-1/3 rounded bg-surface-2" />
              <span className="block h-3 w-2/3 rounded bg-surface-2" />
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="py-8 text-center" data-testid="inbox-chats-error">
        <p className="text-sm font-semibold text-ink-1">Chats did not load.</p>
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

  if (!rooms.length) {
    return (
      <div className="py-10 text-center" data-testid="inbox-chats-empty">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-ink-3">
          <MessageSquare size={19} aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-bold text-ink-1">No conversations yet</p>
        <p className="mx-auto mt-1 max-w-[16rem] text-2xs leading-relaxed text-ink-3">
          A message from someone you trade with appears here.
        </p>
      </div>
    );
  }

  return (
    <ul role="tabpanel" id="inbox-panel-chats" aria-labelledby="inbox-tab-chats" className="divide-y divide-edge-1">
      {rooms.map((room) => {
        const unread = (room.unread_count || 0) > 0;
        const preview =
          room.last_message?.body
          || (room.room_type === "direct" ? "Direct conversation" : "Conversation");
        const name = room.name || "Conversation";

        return (
          <li key={room.id}>
            <Link
              to={`/chat?room=${room.id}`}
              data-testid="inbox-chat-row"
              className={cn(
                // 44px minimum, whole row tappable, one focus ring.
                "flex min-h-11 items-center gap-3 py-2.5 transition-colors hover:bg-surface-2",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600",
              )}
            >
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2"
                aria-hidden="true"
              >
                <MessageSquare size={18} />
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-sm",
                    unread ? "font-bold text-ink-1" : "font-semibold text-ink-2",
                  )}
                >
                  {name}
                </span>
                {/* One line. `line-clamp-1` rather than a character slice, so
                    the ellipsis lands where the width actually ends. */}
                <span
                  className={cn(
                    "mt-0.5 line-clamp-1 block text-2xs",
                    unread ? "text-ink-2" : "text-ink-3",
                  )}
                >
                  {preview}
                </span>
              </span>

              <span className="flex shrink-0 flex-col items-end gap-1 pl-1">
                {room.last_message_at && (
                  <span className="text-micro tabular-nums text-ink-4">
                    {relativeTime(room.last_message_at)}
                  </span>
                )}
                {unread && (
                  <span
                    aria-label={`${room.unread_count} unread`}
                    className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1.5 text-micro font-bold tabular-nums text-white"
                  >
                    {room.unread_count > 99 ? "99+" : room.unread_count}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
