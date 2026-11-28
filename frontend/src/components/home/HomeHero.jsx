import { useNavigate } from "react-router-dom";
import MarketplaceSearch from "@/components/search/MarketplaceSearch";
import LocationIndicator from "@/components/location/LocationIndicator";
import { resultsHref } from "@/config/searchCategories";

/**
 * THE HOME HERO — where you are, what you want.
 *
 * Chats and Notifications live in the top AppHeader so they are never
 * duplicated on Home.
 */
function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

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
  const counts = attention || { chats: 0, notifications: unread, waiting: 0 };

  return (
    <header className="space-y-3.5">
      <div className="min-w-0">
        <p className="ds-eyebrow">{dateLabel}</p>
        <h1 className="ds-display mt-1">
          {greetingFor(hour)}, {displayName}. What’s moving?
        </h1>
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
