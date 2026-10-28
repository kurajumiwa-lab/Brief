/**
 * ONE PLACE FOR THE NAME.
 *
 * The product has been called Ogallo since v1. It is now Vendor World: the
 * same network, a name that says what it is and that a trader in Kisumu, a
 * shop in Kampala and a buyer in Kigali can all say without explaining it.
 *
 * "Ogallo" is not deleted. It stays as the parent in the footer, because a
 * name on somebody's receipts, in a WhatsApp thread from last year and on a
 * shopfront board is a promise, and a rebrand is not a reason to make those
 * strangers. `parent` is where that promise is kept.
 *
 * Renaming the product should be an edit to this file and nothing else. If a
 * one-word European name is preferred — `Mercato` (it), `Marché` (fr),
 * `Vendita` (it) — change `name` and `wordmark` below; every string that
 * matters reads from here.
 */

export const BRAND = {
  /** Full name, for titles, headings and sentences. */
  name: "Vendor World",
  /** How the mark is set: lowercase, no space, one word on screen. */
  wordmark: "vendorworld",
  /** Short form for tight spaces (tab bar, badges). */
  short: "Vendorworld",
  /** The name this network was built under; kept, not erased. */
  parent: "Ogallo",
  /** One line, used under the mark and in the page title. */
  tagline: "the trade network with receipts",
  /** The address people type. */
  domain: "vendorworld.ke",
  /** Fallback domain shown until the real one is live. */
  legacyDomain: "vendorworld.kikk",
};

/** `Vendor World — the trade network with receipts` */
export const pageTitle = (suffix = BRAND.tagline) => `${BRAND.name} — ${suffix}`;

export default BRAND;
