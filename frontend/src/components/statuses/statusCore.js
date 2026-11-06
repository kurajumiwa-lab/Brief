/**
 * Small shared helpers for business statuses. Kept free of React so the rules
 * can be read and tested on their own.
 */

/** Video statuses are off until the backend flag is switched on (asked of the owner first). */
export const VIDEO_ENABLED = import.meta.env?.VITE_STATUS_VIDEO_ENABLED === "true";

/** Coloured ring = something unseen; muted ring = already viewed. */
export function ringState(group) {
  return group?.unseen ? "unseen" : "seen";
}

export function ringClass(group) {
  return ringState(group) === "unseen" ? "ring-2 ring-brand-500" : "ring-1 ring-edge-2";
}

export function initialOf(name) {
  const text = String(name || "").trim();
  return text ? text.charAt(0).toUpperCase() : "?";
}

/** The backend's plain-language reason, or a calm fallback. */
export function errorText(err, fallback = "Something went wrong. Please try again.") {
  const detail = err?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

/** How long ago, in plain words (e.g. "3 h ago"). */
export function agoText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

/** Time left before a status disappears, in plain words. */
export function leftText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((t - now) / 60000));
  if (mins < 60) return `${mins} min left`;
  return `${Math.round(mins / 60)} h left`;
}
