import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell, CalendarDays, ClipboardList, MessageSquare, RefreshCw, ShoppingBag,
  Store, UserPlus,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Skeleton from "@/components/ui/Skeleton";
import { relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { NOTIFICATION_ROUTES } from "@/config/constants";
import { useOutsideStore } from "@/stores/outsideStore";

/**
 * ACTIVITY — everything waiting for you, grouped so it can be scanned.
 *
 * A wall of undifferentiated notifications is not an inbox. The server groups
 * by kind (`invitations · events · replies · trades · community · account`)
 * and this screen lets you read one group at a time. Each group answers a
 * different question:
 *
 *   invitations  who asked me for something, or let me in
 *   events       what am I going to
 *   replies      who answered me
 *   trades       what is mid-flight and needs a step
 *   community    what happened in my groups
 *   account      the rest
 *
 * Every row links to the screen where the action actually happens, using the
 * app's existing notification route map — no new navigation was invented here.
 */

const GROUP_META = {
  invitations: { label: "Invitations", icon: UserPlus, blurb: "Requests to join, invites and approvals" },
  events: { label: "Events", icon: CalendarDays, blurb: "Reminders and changes to things you're going to" },
  replies: { label: "Replies", icon: MessageSquare, blurb: "Answers to what you asked or proposed" },
  trades: { label: "Trades", icon: ShoppingBag, blurb: "Orders, deliveries and bookings in progress" },
  community: { label: "Communities", icon: Store, blurb: "News from your groups and lists" },
  account: { label: "Account", icon: Bell, blurb: "Verification, stock and everything else" },
};

export default function ActivityPage() {
  const activity = useOutsideStore((s) => s.activity);
  const status = useOutsideStore((s) => s.activityStatus);
  const loadActivity = useOutsideStore((s) => s.loadActivity);
  const [group, setGroup] = useState("all");

  useEffect(() => { loadActivity(); }, [loadActivity]);

  const groups = activity?.groups || [];
  const counts = activity?.counts || {};
  const visible = group === "all" ? groups.filter((g) => g.items.length) : groups.filter((g) => g.key === group);

  return (
    <div className="space-y-s5">
      <header className="space-y-1">
        <p className="text-micro font-bold uppercase tracking-[0.14em] text-ink-4">Activity</p>
        <h1 className="text-title-page font-bold text-ink-1">What's waiting for you</h1>
        <p className="text-sm text-ink-3">
          Invitations, replies and updates — grouped so you can read one kind at a time.
        </p>
      </header>

      {/* ── the counts that are real work, not just noise ───────────────── */}
      <ul className="grid gap-3 sm:grid-cols-3">
        <Summary
          icon={MessageSquare}
          value={counts.rooms_active_today ?? 0}
          label={counts.rooms ? `of ${counts.rooms} conversations active today` : "conversations active today"}
          to="/chat"
          testId="activity-rooms"
        />
        <Summary
          icon={CalendarDays}
          value={counts.attending ?? 0}
          label="events you're going to"
          to="/events?tab=mine"
          testId="activity-attending"
        />
        <Summary
          icon={Bell}
          value={counts.unread_notifications ?? 0}
          label="unread notifications"
          testId="activity-unread"
        />
      </ul>

      {/* ── group filter ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter activity">
        <Chip active={group === "all"} onClick={() => setGroup("all")}>
          Everything
        </Chip>
        {groups.map((g) => {
          const meta = GROUP_META[g.key];
          if (!meta) return null;
          return (
            <Chip
              key={g.key}
              active={group === g.key}
              count={g.items.filter((i) => !i.is_read).length || undefined}
              onClick={() => setGroup(g.key)}
              data-testid={`activity-group-${g.key}`}
            >
              {meta.label}
            </Chip>
          );
        })}
      </div>

      {/* ── the list ────────────────────────────────────────────────────── */}
      {status === "loading" && !activity ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full rounded-card" />)}
        </div>
      ) : status === "error" ? (
        <div data-testid="activity-error" className="rounded-card-lg border border-edge-1 bg-surface-1 p-6 text-center">
          <p className="text-sm font-semibold text-ink-1">We couldn't load your activity.</p>
          <Button className="mt-4" variant="secondary" icon={RefreshCw} onClick={loadActivity}>
            Try again
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <EmptyActivity />
      ) : (
        <div className="space-y-s5">
          {visible.map((g) => (
            <GroupSection key={g.key} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupSection({ group }) {
  const meta = GROUP_META[group.key] || { label: group.key, icon: Bell, blurb: "" };
  const Icon = meta.icon;

  return (
    <section
      aria-labelledby={`activity-${group.key}`}
      data-testid={`activity-section-${group.key}`}
      className="space-y-2"
    >
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-surface-2 text-ink-3">
          <Icon size={15} aria-hidden="true" />
        </span>
        <div>
          <h2 id={`activity-${group.key}`} className="text-title-section font-semibold text-ink-1">
            {meta.label}
          </h2>
          <p className="text-2xs text-ink-4">{meta.blurb}</p>
        </div>
      </div>

      <ul className="divide-y divide-edge-1 overflow-hidden rounded-card border border-edge-1 bg-surface-1 shadow-xs">
        {group.items.map((item) => {
          const to = NOTIFICATION_ROUTES[item.type] || "/activity";
          return (
            <li key={item.id}>
              <Link
                to={to}
                className={cn(
                  "flex min-h-tap items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2",
                  !item.is_read && "bg-brand-50/50 dark:bg-brand-500/5",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    item.is_read ? "bg-transparent" : "bg-brand-500",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink-1">{item.title}</span>
                  {item.body && <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{item.body}</span>}
                  <span className="mt-1 block text-2xs text-ink-4">
                    {relativeTime(item.created_at)}
                    {item.sender_handle ? ` · @${item.sender_handle}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Summary({ icon: Icon, value, label, to, testId }) {
  const inner = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
        <Icon size={16} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold tabular-nums text-ink-1">{value}</span>
        <span className="block truncate text-2xs text-ink-4">{label}</span>
      </span>
    </>
  );

  const className = "flex items-center gap-3 rounded-card border border-edge-1 bg-surface-1 p-3 shadow-xs";

  return (
    <li data-testid={testId}>
      {to ? (
        <Link to={to} className={cn(className, "transition-colors hover:border-edge-2 hover:bg-surface-2")}>
          {inner}
        </Link>
      ) : (
        <div className={className}>{inner}</div>
      )}
    </li>
  );
}

function EmptyActivity() {
  const doors = [
    { to: "/explore", icon: ClipboardList, title: "Find something nearby", body: "Events, people and requests around you." },
    { to: "/create", icon: ClipboardList, title: "Post something", body: "Ask a question or plan a gathering." },
    { to: "/chat", icon: MessageSquare, title: "Your conversations", body: "Pick up where you left off." },
  ];

  return (
    <div data-testid="activity-empty" className="rounded-card-lg border border-edge-1 bg-surface-1 p-6 text-center shadow-xs sm:p-8">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-ink-4">
        <Bell size={22} aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-title-section font-semibold text-ink-1">Nothing is waiting on you</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-3">
        No invitations, no replies, nothing mid-flight. That's a fine place to be — here's what you could do instead.
      </p>
      <ul className="mx-auto mt-4 grid max-w-lg gap-2 sm:grid-cols-3">
        {doors.map(({ to, icon: Icon, title, body }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex h-full flex-col items-start gap-1.5 rounded-card border border-edge-1 p-3 text-left transition-colors hover:border-brand-500/50 hover:bg-brand-50 dark:hover:bg-brand-500/10"
            >
              <Icon size={15} className="text-brand-700 dark:text-brand-300" aria-hidden="true" />
              <span className="text-xs font-bold text-ink-1">{title}</span>
              <span className="text-micro leading-snug text-ink-4">{body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
