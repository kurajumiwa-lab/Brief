/**
 * SHARING — one implementation of the share-then-copy pattern.
 *
 * Ogallo already shares shop links from two places with the same six lines:
 * `navigator.share` when the device can, the clipboard when it cannot, silence
 * when the vendor dismisses the sheet. This module is that pattern, extracted
 * so the invite banner and the shop summary behave exactly like the rest of
 * the app — and so a future referral code has one place to live.
 *
 * It invents nothing: no rewards, no tracking links, no referral rules. It
 * shares a URL.
 */

/** The absolute URL of a route in this deployment (works on phone and desktop). */
export const appUrl = (path = "/") => {
  try {
    return new URL(path, window.location.origin).toString();
  } catch {
    return path;
  }
};

/**
 * Share a link. Returns how it ended so the caller can word its feedback:
 *   "shared"    the OS sheet took it
 *   "copied"    no share sheet — the link is on the clipboard
 *   "dismissed" the vendor closed the sheet (say nothing)
 *   "failed"    neither route worked (say that, honestly)
 */
export async function shareLink({ title, text, url }) {
  if (typeof navigator === "undefined") return "failed";

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "dismissed";
      // Any other failure (permissions, unsupported payload) falls through to
      // the clipboard rather than leaving the vendor with nothing.
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return "copied";
    }
  } catch {
    /* fall through */
  }
  return "failed";
}
