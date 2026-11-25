/**
 * ONE PLACE FOR THE NAME — and for deciding which name it is.
 *
 * The product has been through five names: "Byway", "My Shop App", "Ogallo",
 * "Brief" and now "Wasta". The code carried four of them at once, so a user
 * could read a different product name on every other screen and the README
 * announced another.
 *
 * The name is **Wasta**. It is what the rendered interface says — on the rate
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
 *     product name. It is unrelated and stays. The same is true of the `/brief`
 *     route and the English form-field label "Brief" — a short description of a
 *     post is a word, not a brand.
 *   · `domain` is empty on purpose. `vendorworld.ke` was never registered and no
 *     deployment sets `VITE_PAGE_DOMAIN`, so printing it told every vendor their
 *     page lived at an address that did not answer. `pageAddress()` now falls
 *     back to the `/p/{handle}` route, which does answer.
 *
 * Renaming the product is an edit to this file and nothing else. `test/brand.test.js`
 * fails if the rendered UI and this file disagree again.
 */

export const BRAND = {
  /** Full name, for titles, headings and sentences. */
  name: "Wasta",
  /** How the mark is set on screen. */
  wordmark: "Wasta",
  /** Short form for tight spaces (tab bar, badges). */
  short: "Wasta",
  /** The name this network was built under; kept, not erased. */
  parent: "Ogallo",
  /**
   * One line, used under the mark and in the page title.
   *
   * v2.18 (direction C) replaced "the trade network with receipts". Wasta
   * replaces that with the promise the product actually keeps: the network
   * already connects people to suppliers and providers, and named endorsements
   * make the connection trustworthy. It does not claim introductions the
   * software cannot yet make.
   */
  tagline: "The power of the right connections.",
  /**
   * The same promise at a length that survives a small centred line.
   *
   * `tagline` is 35 characters and the splash renders it at `text-2xs` inside
   * `max-w-xs` with `px-8`, where a line that long wraps and truncates the
   * promise on the one screen where it is the only thing to read. This form is
   * 22 characters — for the splash, the boot handshake and anywhere the mark
   * sits above a short line of text. `tagline` stays for titles and sentences.
   */
  shortLine: "The right connections.",
  /**
   * The manner, under the promise.
   *
   * The cold-start screen has room for one more line under the wordmark, and
   * it should say something the promise does not: not what the product is
   * for, but how it goes about it. Thirty-six characters — long enough to be
   * a sentence, short enough to sit under a mark on a phone.
   */
  noteLine: "A more considered way to connect.",
  /** The address people type. Empty until a Wasta domain is owned and routed. */
  domain: "",
  /** Fallback domain shown until the real one is live. */
  legacyDomain: "vendorworld.kikk",
};

/** `Wasta — The power of the right connections.` */
export const pageTitle = (suffix = BRAND.tagline) => `${BRAND.name} — ${suffix}`;

export default BRAND;
