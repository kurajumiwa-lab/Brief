import { Link } from "react-router-dom";
import { ChevronRight, MapPin, Navigation } from "lucide-react";
import GlobalSearch from "@/components/layout/GlobalSearch";
import { RankChip } from "@/components/identity/Rank";

/**
 * THE HOME HERO — where you are, and what you are looking for.
 *
 * The redesign's first demand was a Home that opens on *discovery*, not on the
 * person. That sounds like a small change; it is not, because the old opening
 * was three stacked things (a date, a greeting, a rank chip) and none of them
 * could be acted on. The hero now answers the only two questions a person has
 * when they open a marketplace:
 *
 *   WHERE AM I?   a location control that is a real link to the region screen
 *   WHAT DO I WANT?  the search field, in the largest control on the screen
 *
 * The greeting is still here — it is a marketplace that knows your name — but
 * it is now the *caption* on the page rather than the headline of it. Rank
 * moves beside the greeting as a quiet chip: a fact about exposure, not the
 * subject of the screen.
 *
 * The search is the app's own `GlobalSearch`, so it keeps its scope selector
 * and its ⌘K shortcut, and it routes to the same results system as the header.
 * Nothing here is a second search implementation.
 */

function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function HomeHero({
  name = "there",
  firstName,
  rank,
  place = null,
  placeTo = "/regions",
  now = new Date(),
}) {
  const hour = now instanceof Date ? now.getHours() : new Date(now).getHours();
  const dateLabel = now instanceof Date
    ? now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    : "";
  const displayName = firstName || name;

  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ds-eyebrow">{dateLabel}</p>
          <h1 className="ds-display mt-1.5">
            {greetingFor(hour)}, {displayName}
          </h1>
        </div>
        {rank && (
          <div className="flex items-center gap-2 pt-1">
            <RankChip rank={rank} />
          </div>
        )}
      </div>

      {/* WHERE AM I. The place is a link, because "where am I looking" is a
          question with a screen behind it — and the person may want to change
          it. When no place is known the control says so and still goes
          somewhere, instead of claiming a town nobody chose. */}
      <Link
        to={placeTo}
        data-testid="home-location"
        className="ds-card ds-card-interactive ds-focus flex min-h-11 items-center gap-2.5 px-3 py-2.5"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          {place ? <MapPin size={16} aria-hidden="true" /> : <Navigation size={16} aria-hidden="true" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-micro font-bold uppercase tracking-[0.12em] text-ink-4">
            {place ? "Looking around" : "No area chosen"}
          </span>
          <span className="block truncate text-sm font-bold text-ink-1">
            {place || "Choose your area"}
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-ink-4" aria-hidden="true" />
      </Link>

      {/* WHAT DO I WANT. The biggest control on the screen, because search is
          the shortest path from a thought to a thing that exists. */}
      <GlobalSearch size="lg" />
    </header>
  );
}
