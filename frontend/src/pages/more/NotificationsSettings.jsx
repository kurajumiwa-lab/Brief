import WatchesPanel from "@/components/inbox/WatchesPanel";

/**
 * WHAT YOU GET TOLD ABOUT — a setting, in Settings.
 *
 * The neighbourhood watches panel decides which notifications arrive. It was
 * living at the top of the Inbox, above the conversation list, because the old
 * Activity screen had nothing else and consolidating the two inboxes moved it
 * along. But a watch is configuration: it changes what will be sent, it is not
 * something that was sent, and putting it above the messages meant every visit
 * to the Inbox started with a form.
 *
 * Same component, same API, same rows — a move, not a rewrite. Reached from
 * Settings & records, which is where the account's controls are.
 */
export default function NotificationsSettings() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <header>
        <p className="eyebrow">Settings</p>
        <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-ink-1">
          Notifications
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-3">
          A watch is what makes a notification arrive. Name a thing and a place,
          and you are told when it appears — nothing else is sent about it.
        </p>
      </header>

      <WatchesPanel />
    </div>
  );
}
