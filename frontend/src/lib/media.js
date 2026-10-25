/**
 * MEDIA URLS — one place that turns whatever a record stores into something an
 * `<img src>` can actually load.
 *
 * Every upload is served from the API origin at `/static/<key>` (see
 * `backend/app/routes/media.py`), and this app talks to its own origin only, so
 * a relative `/static/uploads/…` is the correct URL in development (proxied by
 * Vite) and in production (routed to the backend by `vercel.json`).
 *
 * Three shapes reach us, and they are all the same file:
 *
 *   "/static/uploads/<uuid>/photo.jpg"   what the API returns today
 *   "uploads/<uuid>/photo.jpg"           a key that lost its prefix (bulk
 *                                        imports, older records)
 *   "https://cdn.example/x.jpg"          a bucket/CDN URL, or a legacy absolute
 *                                        URL — passed through untouched
 *
 * Nothing here invents a path: an unrecognised string is returned as-is, so a
 * genuinely broken URL still reaches the image handler and can fail visibly —
 * which is the `<Media>` component's job, not this function's.
 */

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function mediaUrl(src) {
  if (typeof src !== "string") return "";
  const url = src.trim();
  if (!url) return "";
  if (ABSOLUTE.test(url)) return url;
  if (url.startsWith("/static/")) return url;
  if (url.startsWith("/uploads/")) return `/static${url}`;
  if (url.startsWith("uploads/")) return `/static/${url}`;
  return url.startsWith("/") ? url : `/${url}`;
}

export default mediaUrl;
