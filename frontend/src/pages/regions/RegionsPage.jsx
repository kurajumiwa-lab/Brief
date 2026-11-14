import ExplorePage from "@/pages/explore/ExplorePage";

/**
 * REGIONS — the discovery screen, region-aware.
 *
 * The old discovery layout is back: one search, the four posting types, the
 * colour-coded category tiles, the filters and the results. What changed is the
 * knob at the top. It used to name a market ("Gikomba"), which made the app
 * read like a vendor directory and expired whenever a trader moved. It now
 * names a region — a corridor with a hub city — and the same feed answers
 * "what is around here?".
 *
 * The region directory lives at /regions/all, and a single region still has its
 * own page at /regions/:slug.
 */
export default function RegionsPage() {
  return <ExplorePage regionAware />;
}
