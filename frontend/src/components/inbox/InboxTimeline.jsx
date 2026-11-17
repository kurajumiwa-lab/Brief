import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays, CheckCircle2, ChevronRight, QrCode, RefreshCw, Users,
} from "lucide-react";
import {
  AGENDA_TONES, agendaCounter, agendaDatePill, agendaDayKey, agendaMeta, agendaWeek,
} from "@/lib/agenda";
import { cn } from "@/lib/utils";

/**
 * INBOX: MY ACTIVE ROUNDS & RSVPS
 *
 * A flat message list answers "who spoke last". It does not answer "where do I
 * have to be this week?". This is the top of the Inbox: seven real days, the
 * rounds/events/bookings already on record, and the one action for each row.
 *
 * A submitted pledge is labelled *waiting*, not joined. Only a confirmed or
 * accepted record gets a pass button, because a pass for a place that does not
 * exist would be theatre.
 */
export default function InboxTimeline({
  items = [],
  loading = false,
  error = "",
  onRetry,
  onOpenPass,
  onConfirmTrade,
  confirmingId = null,
  // 0066: dates that carry available or claimed corridor work. A second dot,
  // emerald, so the week strip answers "where is there money this week?" as
  // well as "where do I have to be?".
  taskDays = [],
  belowStrip = null,
}) {
  const [selectedDate, setSelectedDate] = useState("ALL");
  const days = useMemo(() => agendaWeek(items), [items]);

  const shown = useMemo(
    () => (selectedDate === "ALL"
      ? items
      : items.filter((item) => agendaDayKey(item.starts_at) === selectedDate)),
    [items, selectedDate],
  );

  return (
    <section aria-labelledby="agenda-heading" data-testid="inbox-timeline" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Your week</p>
          <h2 id="agenda-heading" className="mt-1 text-base font-extrabold tracking-tight text-ink-1">
            Active rounds &amp; RSVPs
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setSelectedDate("ALL")}
          aria-pressed={selectedDate === "ALL"}
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-micro font-bold transition-colors",
            selectedDate === "ALL"
              ? "bg-brand-700 text-white"
              : "border border-edge-1 bg-surface-1 text-ink-3 hover:border-edge-2 hover:text-ink-1",
          )}
        >
          All ({items.length})
        </button>
      </div>

      <div className="rounded-2xl border border-edge-1 bg-surface-1 p-3">
        <div className="grid grid-cols-7 gap-1.5 text-center" role="group" aria-label="Filter agenda by day">
          {days.map((day) => {
            const active = selectedDate === day.key;
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => setSelectedDate(active ? "ALL" : day.key)}
                aria-pressed={active}
                aria-label={`${day.dayName} ${day.dayNum}${day.hasItems ? ", has rounds" : ""}`}
                className={cn(
                  "flex flex-col items-center rounded-xl border py-2 transition-colors",
                  active
                    ? "border-brand-700 bg-brand-700 text-white shadow-sm"
                    : "border-transparent bg-surface-0 text-ink-1 hover:border-edge-2",
                )}
              >
                <span className={cn("text-[10px] font-semibold", active ? "text-brand-100" : "text-ink-4")}>
                  {day.dayName}
                </span>
                <span className="mt-0.5 text-sm font-extrabold tabular-nums">{day.dayNum}</span>
                <span className="mt-1 flex items-center gap-0.5" aria-hidden="true">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      day.hasItems
                        ? active ? "bg-brand-200" : "bg-brand-600"
                        : "bg-transparent",
                    )}
                  />
                  {taskDays.includes(day.key) && (
                    <span
                      data-testid="task-day-dot"
                      title="Work available"
                      className={cn(
                        "h-1.5 w-1.5 rounded-full ring-1",
                        active
                          ? "bg-emerald-300 ring-emerald-200"
                          : "bg-emerald-500 ring-emerald-200 dark:ring-emerald-900",
                      )}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {belowStrip}

      {loading && items.length === 0 ? (
        <div className="rounded-2xl border border-edge-1 bg-surface-1 px-4 py-6 text-center">
          <p className="text-xs font-semibold text-ink-2">Loading your rounds…</p>
        </div>
      ) : error && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-4 py-5 text-center">
          <p className="text-xs font-semibold text-ink-1">Your rounds could not be loaded</p>
          <p className="mt-1 text-2xs text-ink-3">{error}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-300"
            >
              <RefreshCw size={12} aria-hidden="true" /> Try again
            </button>
          )}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-4 py-6 text-center">
          <CalendarDays size={20} className="mx-auto text-ink-4" aria-hidden="true" />
          <p className="mt-2 text-xs font-semibold text-ink-1">
            {selectedDate === "ALL" ? "Nothing on your calendar yet" : "Nothing scheduled for this day"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-2xs leading-relaxed text-ink-3">
            Joined bulk buys, rides, bookings and event RSVPs appear here as soon
            as they are on record.
          </p>
          {selectedDate === "ALL" && (
            <Link to="/regions" className="mt-2 inline-flex items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-300">
              Find a round near you
              <ChevronRight size={12} aria-hidden="true" />
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {shown.map((item) => {
            const counter = agendaCounter(item);
            const waiting = item.state === "waiting";
            const confirming = confirmingId === item.id;
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-edge-1 bg-surface-1 p-3.5"
                data-testid="agenda-row"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                      <CalendarDays size={11} aria-hidden="true" />
                      {agendaDatePill(item.starts_at)}
                    </span>
                    <span className={cn(
                      "rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                      AGENDA_TONES[item.state] || "border-edge-1 bg-surface-2 text-ink-3",
                    )}>
                      {item.status_label}
                    </span>
                  </div>
                  <Link
                    to={item.to}
                    className="block truncate text-sm font-bold text-ink-1 hover:underline"
                  >
                    {item.title}
                  </Link>
                  <p className="mt-0.5 truncate text-micro text-ink-4">{agendaMeta(item)}</p>
                  {counter && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-ink-3">
                      <Users size={11} aria-hidden="true" />
                      {counter}
                    </p>
                  )}
                </div>

                {waiting && item.kind === "booking" ? (
                  <button
                    type="button"
                    onClick={() => onConfirmTrade?.(item)}
                    disabled={confirming}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-700 px-3 py-2 text-micro font-bold text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
                  >
                    <CheckCircle2 size={13} aria-hidden="true" />
                    {confirming ? "Saving…" : "Confirm"}
                  </button>
                ) : item.passable ? (
                  <button
                    type="button"
                    onClick={() => onOpenPass?.(item)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-micro font-bold text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300"
                  >
                    <QrCode size={13} aria-hidden="true" />
                    Pass
                  </button>
                ) : (
                  <Link
                    to={item.to}
                    className="inline-flex shrink-0 items-center gap-1 text-micro font-bold text-ink-3 hover:text-ink-1"
                  >
                    View
                    <ChevronRight size={13} aria-hidden="true" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
