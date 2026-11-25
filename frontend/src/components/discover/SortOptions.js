/**
 * HOW RESULTS ARE ORDERED.
 *
 * Sorting is an ordering of the page already fetched — never a second
 * request and never a promise the server cannot keep. "Popular" is the feed's
 * own relevance order (proximity, timing, recency, real engagement), which is
 * not paid placement and is not a view count.
 *
 * Items without a price stay at the end of a price sort rather than being
 * treated as free, and "Newest first" reads the record's own timestamp.
 */
export const SORT_OPTIONS = [
  { value: "popular", label: "Popular" },
  { value: "price_low", label: "Price: low to high" },
  { value: "price_high", label: "Price: high to low" },
  { value: "newest", label: "Newest first" },
];
