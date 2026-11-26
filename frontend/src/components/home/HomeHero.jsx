import { Link, useNavigate } from "react-router-dom";
import { Bell, MessageCircle } from "lucide-react";
import MarketplaceSearch from "@/components/search/MarketplaceSearch";
import LocationIndicator from "@/components/location/LocationIndicator";
import { resultsHref } from "@/config/searchCategories";

/**
 * THE HOME HERO — what needs attention, where you are, what you want.
 *
 * The brief asks Home to answer "who needs me?" before it becomes a catalogue.
 * Chats and Notifications therefore sit directly beside the greeting with
 * their own real counts and their own permanent routes. A single combined
 * "waiting" number cannot tell a person which messages need a reply.
 *
 * The place is never guessed: the location control says what the app knows,
 * and "Location unavailable" when it does not know. The search is the app's
 * search, not a second implementation.
 */
function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const shown = (count) => (count > 99 ? "99+" : count);

export default function HomeHero({
  name = "there",
  firstName,
  attention,
  unread = 0,
  term = "",
  onTermChange,
  now = new Date(),
}) {
  const navigate = useNavigate();
  const hour = now instanceof Date ? now.getHours() : new Date(now).getHours();
  const dateLabel = now instanceof Date
    ? now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    : "";
  const displayName = firstName || name;
  // Older callers pass a single combined `unread`; keep them working while the
  // real page supplies the two separate readings.
  const counts = attention || { chats: 0, notifications: unread, waiting: 0 };

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ds-eyebrow">{dateLabel}</p>
          <h1 className="ds-display mt-1.5">
            {greetingFor(hour)}, {displayName}
          </h1>
        </div>

        {/* The communication-first row. Both destinations stay visible on a
            phone; counts are named for screen readers and never colour-only. */}
        <nav aria-label="Inbox shortcuts" className="flex shrink-0 items-center gap-2">
          <Link
            to="/inbox?tab=chats"
            data-testid="home-chats"
            aria-label={counts.chats > 0
              ? `Chats, ${counts.chats} unread message${counts.chats === 1 ? "" : "s"}`
              : "Chats, no unread messages"}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-edge-2 bg-surface-1 px-3 text-2xs font-bold text-ink-2 transition-colors hover:border-brand-500 hover:text-ink-1"
          >
            <MessageCircle size={15} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Chats</span>
            <span aria-hidden="true" className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-50 px-1 tabular-nums text-brand-800 dark:bg-brand-500/15 dark:text-brand-300">
              {shown(counts.chats)}
            </span>
          </Link>
          <Link
            to="/inbox?tab=notifications"
            data-testid="home-notifications"
            aria-label={counts.notifications > 0
              ? `Notifications, ${counts.notifications} unread`
              : "Notifications, none unread"}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-edge-2 bg-surface-1 px-3 text-2xs font-bold text-ink-2 transition-colors hover:border-brand-500 hover:text-ink-1"
          >
            <Bell size={15} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Notifications</span>
            <span aria-hidden="true" className="grid h-5 min-w-5 place-items-center rounded-full bg-accent-50 px-1 tabular-nums text-accent-700 dark:bg-accent-500/15 dark:text-accent-300">
              {shown(counts.notifications)}
            </span>
          </Link>
        </nav>
      </div>

      {counts.waiting > 0 && (
        <p className="text-2xs font-semibold text-ink-3">
          {counts.waiting} trade{counts.waiting === 1 ? "" : "s"} waiting on your confirmation
        </p>
      )}

      {/* WHERE AM I. One compact control, and it never guesses a place. */}
      <LocationIndicator />

      {/* WHAT DO I WANT. The biggest control on the screen, because search is
          the shortest path from a thought to a thing that exists. */}
      <MarketplaceSearch
        variant="hero"
        value={term}
        onChange={onTermChange}
        onSubmit={(text) => navigate(resultsHref({ q: text }))}
        showCategories={false}
        placeholder="Search goods, services, rentals and events"
        aria-label="Search everything"
      />
    </header>
  );
}
