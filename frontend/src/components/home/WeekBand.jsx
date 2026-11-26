import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, ListChecks, Repeat } from "lucide-react";
import CorridorTaskBoard from "@/components/tasks/CorridorTaskBoard";
import RoutineSharePrompt from "@/components/routines/RoutineSharePrompt";
import InboxTimeline from "@/components/inbox/InboxTimeline";

/**
 * YOUR WEEK — the four things the Inbox used to carry, on the screen that owns
 * "what is on this week".
 *
 * The brief moved these here for a reason: they are *scheduled work*, not
 * messages. Putting them above the conversation list meant a person opening
 * their messages scrolled past a calendar, a work board and a routine prompt
 * first. On Home they sit with the events and opportunities they belong to.
 *
 * This is a move, not a rewrite. Every piece is the same component the Inbox
 * imported — same API calls, same actions, same empty states — rendered in one
 * band with one heading instead of five separate headings.
 *
 * Order is by time pressure:
 *
 *   1. what is on your calendar (rounds, RSVPs, bookings) — has a date
 *   2. work you can take this week                        — has a deadline
 *   3. routines that need sharing                         — has a day
 *
 * Each section keeps its own heading, because each answers a different
 * question. What the brief called redundant was the *page-level* furniture —
 * three summary tiles, a "Waiting on a reply" header, an "Everything else"
 * eyebrow — not the label on a section that is genuinely a different list.
 */
export default function WeekBand({
  agenda = [],
  agendaLoading = false,
  agendaError = "",
  onRetryAgenda,
  onOpenPass,
  onConfirmTrade,
  confirmingId,
  taskDays = [],
  taskData = null,
  onTasksChanged,
  defaultRegion,
  town,
  sharePrompts = [],
  onShared,
}) {
  // Nothing to show and nothing loading: the band is honest and stays away.
  // A permanent empty calendar above a Home feed is exactly the "everything at
  // once" the brief is asking to remove.
  const hasAgenda = agenda.length > 0 || agendaLoading || Boolean(agendaError);
  const hasWork = Boolean(taskData);
  const hasRoutines = sharePrompts.length > 0;

  if (!hasAgenda && !hasWork && !hasRoutines) return null;

  return (
    <section aria-labelledby="week-heading" className="space-y-3" data-testid="week-band">
      <div className="flex items-end justify-between gap-3 px-1">
        <h2 id="week-heading" className="text-title-section font-bold tracking-tight text-ink-1">
          Your week
        </h2>
        <Link
          to="/calendar"
          className="inline-flex min-h-11 items-center gap-1 text-2xs font-bold text-ink-3 hover:text-ink-1"
        >
          <CalendarDays size={13} aria-hidden="true" />
          Calendar
          <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </div>

      {hasAgenda && (
        <InboxTimeline
          items={agenda}
          loading={agendaLoading}
          error={agendaError}
          onRetry={onRetryAgenda}
          onOpenPass={onOpenPass}
          onConfirmTrade={onConfirmTrade}
          confirmingId={confirmingId}
          taskDays={taskDays}
        />
      )}

      {hasRoutines && (
        <div className="flex items-start gap-2 px-1">
          <Repeat size={14} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <RoutineSharePrompt prompts={sharePrompts} onShared={onShared} />
          </div>
        </div>
      )}

      {hasWork && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 px-1">
            <ListChecks size={13} className="text-ink-4" aria-hidden="true" />
            <span className="text-micro font-bold uppercase tracking-[0.12em] text-ink-4">
              Work
            </span>
          </div>
          <CorridorTaskBoard
            data={taskData}
            onChanged={onTasksChanged}
            defaultRegion={defaultRegion}
            town={town}
          />
        </div>
      )}
    </section>
  );
}
