import ExplorePage from "@/pages/explore/ExplorePage";

/**
 * REGIONS — the Explore screen.
 *
 * The tab is called Explore and the route is /regions, because the URL is a
 * promise: a link in a WhatsApp thread has to keep working. What is on the
 * screen is one marketplace view — one location, one search with its five
 * categories, one filter door, and the listings.
 *
 * The region directory lives at /regions/all, and a single region still has
 * its own page at /regions/:slug.
 */
export default function RegionsPage() {
  return <ExplorePage />;
}
