/**
 * Calendar time helpers. The server stores and returns wall-clock times in
 * Nairobi with no timezone suffix, e.g. "2026-11-11T09:00:00". We keep that
 * text as it is and never convert it, so a 09:00 slot always shows as 09:00.
 */

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Local calendar date as "YYYY-MM-DD". */
export function toDayString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday of the week containing `d`, at local midnight. */
export function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function shiftDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** "YYYY-MM-DD" from a stored stamp. */
export const dayKey = (stamp) => stamp.slice(0, 10);

/** "HH:MM" from a stored stamp. */
export const timeOf = (stamp) => stamp.slice(11, 16);

export const timeRange = (start, end) => `${timeOf(start)}–${timeOf(end)}`;

/** Short label such as "Wed 11 Nov" for a "YYYY-MM-DD" key. */
export function dayLabel(key) {
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" });
}

/** Stored-format stamp from a day and an "HH:MM" time. */
export const toLocalStamp = (day, hhmm) => `${day}T${hhmm}:00`;
