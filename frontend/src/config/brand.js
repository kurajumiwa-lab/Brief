/**
 * ONE PLACE FOR THE NAME — and for deciding which name it is.
 *
 * The product has been through four names: "Byway", "My Shop App", "Ogallo" and
 * "Brief". The code carried all of them at once, so a user could read a
 * different product name on every other screen and the README announced a fifth.
 *
 * The name is **Brief**. It is what the rendered interface says — on the rate
 * card, the referral landing, the trust pages, the tasks portal, the CSV
 * disclaimer and the enterprise pitch — so the configuration now agrees with the
 * product instead of contradicting it. `wordmark` is how the mark is set, and
 * every string that matters reads from here.
 *
 * Deliberately kept:
 *   · `parent`: "Ogallo" was the name on real shopfront boards and receipts. A
 *     rebrand is not a reason to make those strangers, so it stays in the
 *     footer as the thing this grew out of.
 *   · `Morning Brief` is a *feature* (the read-only daily summary), not the
 *     product name. It is unrelated and stays.
 *
 * Renaming the product is an edit to this file and nothing else. `test/brand.test.js`
 * fails if the rendered UI and this file disagree again.
 */

export const BRAND = {
  /** Full name, for titles, headings and sentences. */
  name: "Brief",
  /** How the mark is set on screen. */
  wordmark: "Brief",
  /** Short form for tight spaces (tab bar, badges). */
  short: "Brief",
  /** The name this network was built under; kept, not erased. */
  parent: "Ogallo",
  /**
   * One line, used under the mark and in the page title.
   *
   * v2.18 (direction C) replaced "the trade network with receipts". Receipts
   * were the promise of the *trading* product; this line is the promise of the
   * *connection layer* — and it survives the honest description of what exists
   * today, because connecting people is exactly what is shipped.
   */
  tagline: "the digital connection layer for everyday trade",
  /** The address people type. */
  domain: "vendorworld.ke",
  /** Fallback domain shown until the real one is live. */
  legacyDomain: "vendorworld.kikk",
};

/** `Brief — the digital connection layer for everyday trade` */
export const pageTitle = (suffix = BRAND.tagline) => `${BRAND.name} — ${suffix}`;

export default BRAND;
