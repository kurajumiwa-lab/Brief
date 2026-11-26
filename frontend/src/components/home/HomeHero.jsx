import { Link, useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import MarketplaceSearch from "@/components/search/MarketplaceSearch";
import LocationIndicator from "@/components/location/LocationIndicator";
import { resultsHref } from "@/config/searchCategories";

/**
 * THE HOME HERO — who you are, where you are, and what you want.
 *
 * The brief asks for a Home that opens on discovery and answers, in this
 * order: the greeting and the notifications, a compact location, and one
 * search field. Everything else moved down.
 *
 * What changed, and why:
 *
 *   · THE PLACE IS GONE. The old hero named a town — "Looking around
 *     Nairobi" — and that town was guessed from the business address or from
 *     the last region this device happened to use. It was an assumption
 *     printed as a fact, and it moved every result on the screen. Now the
 *     location control says what the app actually knows, and says
 *     "Location unavailable" when it does not know.
 *   · THE SEARCH IS THE APP'S SEARCH. It is the same component Explore uses,
 *     it writes to the same place, and submitting goes to the same dedicated
 *     results screen. There is no second search implementation and no second
 *     set of results.
 *   · THE NOTIFICATIONS ARE UP HERE. Anything waiting on a reply is an
 *     action, and an action that is below four shelves is an action nobody
 *     takes.
 */
function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function HomeHero({
  name = "there",
  firstName,
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

  return (
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ds-eyebrow">{dateLabel}</p>
          <h1 className="ds-display mt-1.5">
            {greetingFor(hour)}, {displayName}
          </h1>
        </div>

        <Link
          to="/inbox"
          data-testid="home-notifications"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-edge-2 bg-surface-1 px-3 text-2xs font-bold text-ink-2 transition-colors hover:border-brand-500 hover:text-ink-1"
        >
          <Bell size={15} aria-hidden="true" />
          {unread > 0 ? `${unread} waiting` : "Inbox"}
        </Link>
      </div>

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
