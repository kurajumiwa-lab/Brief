/**
 * MarketTrust shared words and formatting. Plain language only: no jargon on screen.
 * Points are not money, and every screen that shows them must say so.
 */

export const COUNTRIES = [
  { code: "KE", name: "Kenya", currency: "KES" },
  { code: "ET", name: "Ethiopia", currency: "ETB" },
  { code: "UG", name: "Uganda", currency: "UGX" },
];

export const POINTS_NOTE = "Points are rewards, not money. They cannot be cashed out, withdrawn or sent to anyone.";

export const countryName = (code) => COUNTRIES.find((c) => c.code === code)?.name || code;

/** A score out of 5, or an honest message when there are not enough reviews yet. */
export function scoreText(reputation) {
  if (!reputation || reputation.score == null) return "Not enough reviews yet";
  return `${Number(reputation.score).toFixed(1)} out of 5 · ${reputation.review_count} review${reputation.review_count === 1 ? "" : "s"}`;
}

export const TIER_LABEL = {
  confirmed_token: "Verified visit: till code used",
  unverified: "Not verified: no till code",
};

export const TIER_BADGE = {
  confirmed_token: "brand",
  unverified: "gray",
};

export const CHECK_METHODS = [
  { value: "storefront_photo", label: "Storefront photo seen" },
  { value: "field_visit", label: "Visited in person" },
  { value: "document", label: "Business papers seen" },
  { value: "community_corroboration", label: "Confirmed by other businesses" },
];

export const STATUS_LABEL = {
  pending: "Waiting for a Brief check",
  active: "Checked by Brief",
  removed: "Removed",
};

/** A key for one redemption click. Retrying the same click reuses the key. */
export function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function errorText(err, fallback) {
  const detail = err?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}
