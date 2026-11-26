import { cn } from "@/lib/utils";

/**
 * TWO PERMANENT TABS — Chats and Notifications.
 *
 * The Inbox used to be a dashboard: three summary numbers, an events count, a
 * "your week" timeline, a work board, a watches panel, a mode switcher *and* a
 * seven-value filter row, all above the actual messages. A person opening the
 * screen to read one reply scrolled past most of the product first.
 *
 * This is the whole of the navigation now. Two tabs, always both, each carrying
 * its own unread count. Neither is ever hidden because it happens to be empty —
 * a tab that disappears reads as a feature that was removed.
 *
 * The counts are the reason this is a component and not two buttons: they must
 * be shown for BOTH tabs at all times, including the one you are not on, or the
 * screen has no way to tell you something arrived elsewhere.
 *
 * Deliberately not a pill row of equal halves: the brief asks for a modern
 * messaging shape, and the active segment is the brand fill. `flex-1` on both
 * keeps the two targets large and even on a phone.
 */
export default function InboxTabs({ value, onChange, chats = 0, notifications = 0 }) {
  const tabs = [
    { key: "chats", label: "Chats", count: chats, noun: "chat" },
    { key: "notifications", label: "Notifications", count: notifications, noun: "notification" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Inbox"
      className="flex gap-2"
      data-testid="inbox-tabs"
    >
      {tabs.map(({ key, label, count, noun }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={`inbox-tab-${key}`}
            aria-selected={active}
            aria-controls={`inbox-panel-${key}`}
            onClick={() => onChange(key)}
            data-testid={`inbox-tab-${key}`}
            className={cn(
              // 44px tall: this is the primary control on the screen now.
              "flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 text-sm transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0",
              active
                ? "bg-brand-600 font-semibold text-white"
                : "bg-surface-2 font-medium text-ink-2 hover:bg-surface-3 hover:text-ink-1",
            )}
          >
            <span className="truncate">{label}</span>
            {count > 0 && (
              <span
                // The count is announced as "3 unread chats", not "badge 3".
                aria-label={`${count} unread ${noun}${count === 1 ? "" : "s"}`}
                className={cn(
                  "grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-micro font-bold tabular-nums",
                  active ? "bg-white/20 text-white" : "bg-brand-600 text-white",
                )}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
