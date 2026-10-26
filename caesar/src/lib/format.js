/** Small, boring formatters. Kept together so the whole app rounds the same way. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(iso, now = Date.now()) {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return "";
  const diff = Math.max(0, now - at);
  if (diff < 45_000) return "just now";
  if (diff < HOUR) return `${Math.round(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} h ago`;
  if (diff < 7 * DAY) return `${Math.round(diff / DAY)} d ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Data used, said the way a phone bill says it. */
export function dataSize(kb) {
  const n = Number(kb) || 0;
  if (n < 1) return "<1 KB";
  if (n < 1024) return `${Math.round(n)} KB`;
  return `${(n / 1024).toFixed(1)} MB`;
}

export function compact(n) {
  const value = Number(n) || 0;
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function count(n, singular, plural = `${singular}s`) {
  const value = Number(n) || 0;
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}

export function initials(name = "") {
  return String(name)
    .replace(/^@/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function percent(value, places = 0) {
  return `${(Number(value) * 100).toFixed(places)}%`;
}

export default { relativeTime, dataSize, compact, count, initials, percent };
