import { addDays, format, isToday, isTomorrow, startOfDay } from "date-fns";
import { parseApiDate } from "@/lib/formatters";
import { formatKes } from "@/lib/receipts";

/**
 * Shared vocabulary for the Inbox agenda and the Trade Pass.
 *
 * A round may have no date. That is a real state, not a reason to hide it:
 * undated rows stay in the `All` list and are never given a fake day in the
 * week strip.
 */

export function agendaDate(value) {
  return parseApiDate(value);
}

export function agendaDayKey(value) {
  const date = agendaDate(value);
  return date ? format(date, "yyyy-MM-dd") : null;
}

export function agendaDatePill(value) {
  const date = agendaDate(value);
  if (!date) return "No date yet";
  const day = isToday(date)
    ? "TODAY"
    : isTomorrow(date)
      ? "TOMORROW"
      : format(date, "EEE").toUpperCase();
  return `${day} • ${format(date, "h a")}`;
}

export function agendaWeek(items = [], now = new Date()) {
  const start = startOfDay(now);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const key = format(date, "yyyy-MM-dd");
    return {
      key,
      dayName: index === 0 ? "Today" : format(date, "EEE"),
      dayNum: format(date, "d"),
      hasItems: items.some((item) => agendaDayKey(item.starts_at) === key),
    };
  });
}

export function agendaCounter(item) {
  const joined = Number(item.joined || 0);
  const capacity = Number(item.capacity || 0);
  if (capacity > 0) return `${Math.min(joined, capacity)}/${capacity} joined`;
  if (joined > 0) return `${joined} joined`;
  return "";
}

export function agendaMeta(item) {
  const place = item.place || "Near you";
  const price = item.price_kes ? formatKes(item.price_kes) : null;
  return [item.counterparty?.name, place, price].filter(Boolean).join(" • ");
}

export const AGENDA_TONES = {
  confirmed: "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300",
  joined: "border-info/30 bg-info-soft text-info",
  waiting: "border-warn/30 bg-warn-soft text-warn",
};
