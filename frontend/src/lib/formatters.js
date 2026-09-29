import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";

// The API serialises naive UTC datetimes ("2026-10-10T05:00:00", no offset);
// treat anything without an explicit offset as UTC so it renders in local time.
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const toDate = (d) => {
  if (!d) return null;
  const date = typeof d === "string" ? parseISO(HAS_OFFSET.test(d) ? d : d + "Z") : d;
  return isValid(date) ? date : null;
};
export const parseApiDate = toDate;

export const currency = (n, opts = {}) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? "—"
    : new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0, ...opts }).format(Number(n));

export const num = (n) => (n === null || n === undefined ? "—" : new Intl.NumberFormat("en-KE").format(Number(n)));

export const compactNum = (n) =>
  n === null || n === undefined ? "—" : new Intl.NumberFormat("en-KE", { notation: "compact", maximumFractionDigits: 1 }).format(Number(n));

export const relativeTime = (d) => {
  const date = toDate(d);
  if (!date) return "";
  const diff = Date.now() - date.getTime();
  if (Math.abs(diff) < 45_000) return "just now";
  return formatDistanceToNowStrict(date, { addSuffix: true });
};

export const shortDate = (d) => {
  const date = toDate(d);
  return date ? format(date, "d MMM yyyy") : "";
};

export const shortDateTime = (d) => {
  const date = toDate(d);
  return date ? format(date, "d MMM · HH:mm") : "";
};

export const timeOnly = (d) => {
  const date = toDate(d);
  return date ? format(date, "HH:mm") : "";
};

export const dayLabel = (d) => {
  const date = toDate(d);
  return date ? format(date, "EEE d MMM") : "";
};

/** Value for <input type="datetime-local"> from an ISO string */
export const toLocalInput = (d) => {
  const date = toDate(d);
  return date ? format(date, "yyyy-MM-dd'T'HH:mm") : "";
};
