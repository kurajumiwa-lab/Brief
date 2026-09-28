// ---------------------------------------------------------------------------
// ARRIVAL — who is knocking, and what did the link tell us?
//
// Pure functions over a URL and a user-agent string. No window, no fetch, so
// they can be tested directly.
//
// THE HONEST LIMIT.
//
// A TikTok (or Instagram, or Facebook) in-app browser CANNOT hand a site the
// device's Google account. No browser exposes that, and code claiming to read
// it would be inventing an identity. What is real:
//
//   * the link can carry a Brief-signed token (`?bt=`) holding the email it
//     was minted for — one tap, no typing, verified server-side;
//   * the webview may already hold a Brief session from a previous visit;
//   * Google Identity Services may still work inside the webview, in which
//     case it returns a real ID token that the server verifies.
//
// So `emailHintFrom()` returns a hint the SERVER will re-verify, never a
// client-side assertion of identity. A bare `?email=` is deliberately ignored:
// anyone can type one into a URL.
// ---------------------------------------------------------------------------

export type ArrivalChannel =
  | 'tiktok'
  | 'instagram'
  | 'facebook'
  | 'twitter'
  | 'whatsapp'
  | 'telegram'
  | 'snapchat'
  | 'linkedin'
  | 'browser';

const UA_PATTERNS: [ArrivalChannel, RegExp][] = [
  ['tiktok', /(BytedanceWebview|musical_ly|Bytelocale|TikTok|trill_)/i],
  ['instagram', /Instagram/i],
  ['facebook', /(FBAN|FBAV|FB_IAB)/i],
  ['snapchat', /Snapchat/i],
  ['linkedin', /LinkedInApp/i],
  ['twitter', /(Twitter|TwitterAndroid)/i],
  ['whatsapp', /WhatsApp/i],
  ['telegram', /Telegram/i]
];

/** Which app's in-app browser is this, as far as the user agent admits. */
export function detectInAppBrowser(userAgent: string | null | undefined): ArrivalChannel {
  const ua = String(userAgent ?? '');
  for (const [channel, pattern] of UA_PATTERNS) {
    if (pattern.test(ua)) return channel;
  }
  return 'browser';
}

/** Is this a webview where Google's popup sign-in is likely to be blocked? */
export function isRestrictedWebview(channel: ArrivalChannel): boolean {
  return channel === 'tiktok' || channel === 'instagram' || channel === 'facebook' || channel === 'snapchat';
}

function paramsOf(url: string): URLSearchParams {
  const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
  return new URLSearchParams(query);
}

/**
 * The referral channel this visit should be attributed to.
 *
 * An explicit campaign parameter wins, because that is a stated fact about the
 * link. Otherwise fall back to what the user agent says, and only call it a
 * plain browser when neither knows.
 */
export function arrivalSource(url: string, userAgent: string | null | undefined): ArrivalChannel {
  const params = paramsOf(url);
  const stated = (params.get('utm_source') || params.get('ref') || params.get('src') || '').toLowerCase();
  const known = (['tiktok', 'instagram', 'facebook', 'twitter', 'whatsapp', 'telegram', 'snapchat', 'linkedin'] as ArrivalChannel[])
    .find((c) => stated === c);
  if (known) return known;
  return detectInAppBrowser(userAgent);
}

/**
 * A mailbox-delivered, one-use link token, if the URL carries one.
 *
 * The client posts it to the server; the server verifies the stored
 * single-use proof before it means anything. Legacy signed links are refused.
 */
export function linkTokenFrom(url: string): string | null {
  const token = paramsOf(url).get('bt');
  return token && token.includes('.') ? token : null;
}

/** Strip the arrival parameters once used, so a reload cannot replay them. */
export function urlWithoutArrivalParams(url: string): string {
  const [base, query = ''] = url.split('?');
  if (!query) return url;
  const params = new URLSearchParams(query);
  for (const key of ['bt', 'ref', 'src']) params.delete(key);
  const rest = params.toString();
  return rest ? `${base}?${rest}` : base;
}
