import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell, CalendarDays, CheckCircle2, MessageSquare, Plus, RefreshCw,
  ShoppingBag, Sparkles, Store, Trash2, UserPlus,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Skeleton from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";
import { ledgerAPI } from "@/lib/ledgerApi";
import { TEMPLATE_LABELS } from "@/lib/inference";
import { relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { NOTIFICATION_ROUTES } from "@/config/constants";
import { useOutsideStore } from "@/stores/outsideStore";

/**
 * ACTIVITY — a dashboard, not a landing page.
 *
 * The order is deliberate and is the whole point of the screen: three numbers
 * you can read at a glance, the one setting that decides what you get told
 * about, then the filters, then the feed. Everything above the feed has to fit
 * in a phone's first screen, because a person opening "what is waiting for me"
 * should not have to scroll to find out.
 *
 * Two layout rules that are load-bearing rather than taste:
 *
 *   · the three statistics are a **grid of three equal columns**. Not a
 *     carousel, not a horizontal scroller. A count you have to swipe to see is
 *     a count that is not being shown.
 *   · the **filters** are one horizontally scrolling row, because seven
 *     categories cannot fit across 360px and wrapping them costs four lines of
 *     vertical space above the content.
 *
 * The filter set is rendered from `GROUP_META`, not from whatever the server
 * returned this minute. A filter that disappears when it happens to be empty
 * reads as a filter that no longer exists.
 */

const GROUP_META = {
  invitations: { label: "Invitations", icon: UserPlus, blurb: "Requests to join, invites and approvals" },
  events: { label: "Events", icon: CalendarDays, blurb: "Reminders and changes to things you're going to" },
  replies: { label: "Replies", icon: MessageSquare, blurb: "Answers, quotes and stop requests" },
  trades: { label: "Trades & Bookings", icon: ShoppingBag, blurb: "Orders, repairs and local bookings in progress" },
  community: { label: "Communities", icon: Store, blurb: "News from your groups and lists" },
  account: { label: "Account", icon: Bell, blurb: "Verification, watches and everything else" },
};

const WATCH_TYPE_OPTIONS = [
  { value: "", label: "Any posting type" },
  { value: "available", label: "Available (offers, produce, tools)" },
  { value: "wanted", label: "Wanted (repairs, help, group buys)" },
  { value: "scheduled", label: "Scheduled (artisan rounds, sessions)" },
  { value: "opportunity", label: "Opportunity (tasks, youth opportunities)" },
];

const WATCH_TEMPLATE_OPTIONS = [
  { value: "", label: "Any category" },
  ...Object.entries(TEMPLATE_LABELS).map(([value, label]) => ({ value, label })),
];

export default function ActivityPage() {
  const activity = useOutsideStore((s) => s.activity);
  const status = useOutsideStore((s) => s.activityStatus);
  const loadActivity = useOutsideStore((s) => s.loadActivity);
  const [group, setGroup] = useState("all");

  const [watches, setWatches] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchForm, setWatchForm] = useState({
    posting_type: "wanted",
    inferred_template: "repair_artisan",
    keyword: "",
    area_name: "",
    radius_km: "15",
  });

  const loadLedgerExtras = useCallback(async () => {
    try {
      const [wRes, bRes] = await Promise.all([
        ledgerAPI.listWatches(),
        ledgerAPI.myBookings(),
      ]);
      setWatches(wRes?.data?.items || []);
      setBookings(bRes?.data?.items || []);
    } catch {
      /* optional in minimal environments */
    }
  }, []);

  useEffect(() => {
    loadActivity();
    loadLedgerExtras();
  }, [loadActivity, loadLedgerExtras]);

  const onAddWatch = async (e) => {
    e.preventDefault();
    try {
      await ledgerAPI.createWatch({
        posting_type: watchForm.posting_type || null,
        inferred_template: watchForm.inferred_template || null,
        keyword: watchForm.keyword.trim() || null,
        area_name: watchForm.area_name.trim() || null,
        radius_km: Number(watchForm.radius_km) || 15,
      });
      toast.success("Neighbourhood watch saved");
      setWatchOpen(false);
      setWatchForm((f) => ({ ...f, keyword: "" }));
      await loadLedgerExtras();
    } catch (err) {
      toast.error(apiError(err, "Could not save watch"));
    }
  };

  const onDeleteWatch = async (watchId) => {
    try {
      await ledgerAPI.deleteWatch(watchId);
      setWatches((prev) => prev.filter((w) => w.id !== watchId));
      toast.success("Watch removed");
    } catch (err) {
      toast.error(apiError(err, "Could not remove watch"));
    }
  };

  const onActOnNotification = (notificationId) => {
    ledgerAPI.markNotificationActed(notificationId).catch(() => {});
  };

  const groups = activity?.groups || [];
  const counts = activity?.counts || {};
  const countsByKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  const visible = group === "all" ? groups.filter((g) => g.items.length) : groups.filter((g) => g.key === group);
  const activeBookings = bookings.filter((b) => ["agreed", "in_progress"].includes(b.status));

  return (
    <div className="min-w-0" data-testid="activity-page">
      {/* ── 1. the heading, and nothing under it ─────────────────────────── */}
      {/* "Connect" (v2.18): everything that is waiting on you or on someone
          else — replies, invitations, orders, quotations. The route is still
          /activity and every notification deep link still lands here. */}
      <h1 className="mb-3 text-2xl font-bold leading-tight tracking-tight text-ink-1">Connect</h1>

      {/* ── 2. three numbers, always all three, always in one row ────────── */}
      <ul
        className="mb-3.5 grid grid-cols-3 gap-2 overflow-hidden"
        data-testid="activity-stats"
        aria-label="Activity at a glance"
      >
        <StatTile
          icon={MessageSquare}
          value={counts.rooms_active_today ?? 0}
          label="Conversations"
          hint="active today"
          to="/chat"
          testId="activity-rooms"
        />
        <StatTile
          icon={CalendarDays}
          value={counts.attending ?? 0}
          label="Events"
          hint="upcoming"
          to="/events?tab=mine"
          testId="activity-attending"
        />
        <StatTile
          icon={Bell}
          value={counts.unread_notifications ?? 0}
          label="Notifications"
          hint="unread"
          testId="activity-unread"
        />
      </ul>

      {/* ── 3. the one setting that decides what you are told about ──────── */}
      <section
        data-testid="activity-watches-panel"
        className="mb-3.5 rounded-2xl border border-edge-1 bg-surface-1 p-3 shadow-xs"
      >
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <Sparkles size={15} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold leading-tight text-ink-1">Neighbourhood watches</h2>
            <p className="mt-0.5 text-2xs leading-snug text-ink-3">
              Alerts for local needs, artisans and produce.
            </p>
          </div>
          <Button
            size="xs"
            variant="secondary"
            icon={watchOpen ? undefined : Plus}
            onClick={() => setWatchOpen((v) => !v)}
            data-testid="toggle-add-watch-btn"
            className="shrink-0"
          >
            {watchOpen ? "Close" : "Add"}
          </Button>
        </div>

        {watchOpen && (
          <form onSubmit={onAddWatch} className="mt-3 grid gap-2.5 rounded-xl border border-edge-1 bg-surface-0 p-3 sm:grid-cols-2">
            <Select
              label="Posting type"
              options={WATCH_TYPE_OPTIONS}
              value={watchForm.posting_type}
              onChange={(e) => setWatchForm((f) => ({ ...f, posting_type: e.target.value }))}
            />
            <Select
              label="Category / template"
              options={WATCH_TEMPLATE_OPTIONS}
              value={watchForm.inferred_template}
              onChange={(e) => setWatchForm((f) => ({ ...f, inferred_template: e.target.value }))}
            />
            <Input
              label="Keyword (optional)"
              value={watchForm.keyword}
              onChange={(e) => setWatchForm((f) => ({ ...f, keyword: e.target.value }))}
              placeholder="e.g. fence, cobbler, napier"
              data-testid="watch-keyword-input"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Area"
                value={watchForm.area_name}
                onChange={(e) => setWatchForm((f) => ({ ...f, area_name: e.target.value }))}
                placeholder="Kisii, Muthaiga…"
              />
              <Input
                label="Radius (km)"
                type="number"
                min={1}
                max={200}
                value={watchForm.radius_km}
                onChange={(e) => setWatchForm((f) => ({ ...f, radius_km: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button size="sm" type="submit" data-testid="save-watch-btn">
                Save watch preference
              </Button>
            </div>
          </form>
        )}

        {watches.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {watches.map((w) => (
              <li
                key={w.id}
                className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-edge-1 bg-surface-0 px-2.5 py-1 text-2xs text-ink-2"
              >
                <span className="truncate">
                  {[
                    w.posting_type || "any",
                    w.inferred_template ? TEMPLATE_LABELS[w.inferred_template] || w.inferred_template : null,
                    w.keyword ? `“${w.keyword}”` : null,
                    w.area_name || `${w.radius_km} km`,
                  ].filter(Boolean).join(" · ")}
                </span>
                <button
                  type="button"
                  aria-label="Remove watch"
                  onClick={() => onDeleteWatch(w.id)}
                  className="shrink-0 text-ink-4 hover:text-danger"
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 4. every filter, one scrolling row, never wrapped ───────────── */}
      <div
        className="scroll-x-quiet -mx-1 mb-3 flex flex-nowrap gap-2 overflow-x-auto px-1 py-0.5"
        role="group"
        aria-label="Filter activity"
        data-testid="activity-filters"
      >
        <Chip active={group === "all"} onClick={() => setGroup("all")}>
          Everything
        </Chip>
        {Object.entries(GROUP_META).map(([key, meta]) => {
          const live = countsByKey[key];
          const unread = (live?.items || []).filter((i) => !i.is_read).length;
          return (
            <Chip
              key={key}
              active={group === key}
              count={unread || undefined}
              onClick={() => setGroup(key)}
              data-testid={`activity-group-${key}`}
            >
              {meta.label}
            </Chip>
          );
        })}
      </div>

      {/* ── 5. what is waiting, in the normal flow ──────────────────────── */}
      <div className="min-h-[38vh] space-y-4">
        {activeBookings.length > 0 && (
          <section
            data-testid="active-ledger-bookings"
            className="rounded-2xl border border-brand-500/30 bg-brand-50/50 p-3 dark:bg-brand-500/10"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-ink-1">
                Active bookings ({activeBookings.length})
              </p>
              <Badge variant="brand" size="sm">Direct non-custodial</Badge>
            </div>
            <ul className="mt-2 space-y-1.5">
              {activeBookings.map((bk) => (
                <li key={bk.id} className="flex items-center justify-between gap-3 rounded-xl border border-edge-1 bg-surface-0 px-3 py-2">
                  <div className="min-w-0">
                    <Link
                      to={`/activities/${bk.activity_id}`}
                      className="block truncate text-xs font-bold text-ink-1 hover:text-brand-700"
                    >
                      {bk.activity_title || "Agreed local booking"}
                    </Link>
                    <p className="text-micro text-ink-4">
                      {bk.scheduled_label || "Active"} · Settlement: {bk.settlement_method?.replace(/_/g, " ")}
                    </p>
                  </div>
                  <Link to={`/activities/${bk.activity_id}`} className="shrink-0">
                    <Button size="xs" variant="secondary">Open</Button>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {status === "loading" && !activity ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
          </div>
        ) : status === "error" ? (
          <ActivityError onRetry={loadActivity} />
        ) : visible.length === 0 ? (
          <EmptyActivity />
        ) : (
          visible.map((g) => (
            <GroupSection key={g.key} group={g} onAct={onActOnNotification} />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * ONE NUMBER.
 *
 * Three of these sit in a `grid-cols-3`, so every dimension here is chosen to
 * survive a 320px screen: `min-w-0` on the item, no fixed widths, and a value
 * that steps down rather than pushing its neighbours sideways. The whole tile
 * is the link, so the tap target is the thing you are looking at.
 */
function StatTile({ icon: Icon, value, label, hint, to, testId }) {
  const inner = (
    <>
      <span className="grid h-7 w-7 place-items-center rounded-[10px] bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
        <Icon size={14} aria-hidden="true" />
      </span>
      <span className="mt-1 block text-2xl font-bold leading-none tabular-nums text-ink-1 max-[360px]:text-xl">
        {value}
      </span>
      {/* "Conversations" is the longest word that has to survive a 320px
          screen. It steps down a size below 380px and hyphenates rather than
          breaking wherever it happens to run out of room — a wrapped label is
          fine, a word cut in half is not. */}
      <span className="mt-1 block text-2xs font-semibold leading-tight text-ink-2 hyphens-auto break-words max-[380px]:text-micro">
        {label}
      </span>
      <span className="block text-micro leading-tight text-ink-4 hyphens-auto break-words">
        {hint}
      </span>
    </>
  );

  const className = cn(
    "flex min-h-[104px] min-w-0 flex-col justify-center rounded-2xl border border-edge-1",
    "bg-surface-1 p-2.5 shadow-xs",
    to && "transition-colors hover:border-edge-2 hover:bg-surface-2",
  );

  return (
    <li data-testid={testId} className="min-w-0">
      {to ? (
        <Link to={to} className={cn(className, "h-full")}>
          {inner}
        </Link>
      ) : (
        <div className={cn(className, "h-full")}>{inner}</div>
      )}
    </li>
  );
}

/** A failed load is one line in the flow: what broke, and the way back. */
function ActivityError({ onRetry }) {
  return (
    <div
      data-testid="activity-error"
      role="alert"
      className="flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2"
    >
      <RefreshCw size={14} className="shrink-0 text-danger" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-xs font-semibold text-ink-1">Couldn't load activity.</p>
      <Button size="xs" variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** Nothing waiting is good news, and should look like it — not like an error. */
function EmptyActivity() {
  return (
    <div data-testid="activity-empty" className="flex items-center gap-2.5 px-1 py-6">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
        <CheckCircle2 size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-ink-1">You're all caught up.</p>
        <p className="text-2xs leading-snug text-ink-3">
          Nothing is waiting on you.{" "}
          <Link to="/explore" className="font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
            Find something nearby
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function GroupSection({ group, onAct }) {
  const meta = GROUP_META[group.key] || { label: group.key, icon: Bell, blurb: "" };
  const Icon = meta.icon;

  return (
    <section
      aria-labelledby={`activity-${group.key}`}
      data-testid={`activity-section-${group.key}`}
      className="space-y-1.5"
    >
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-surface-2 text-ink-3">
          <Icon size={14} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id={`activity-${group.key}`} className="text-xs font-bold text-ink-1">
            {meta.label}
          </h2>
          <p className="text-micro text-ink-4">{meta.blurb}</p>
        </div>
      </div>

      <ul className="divide-y divide-edge-1 overflow-hidden rounded-2xl border border-edge-1 bg-surface-1 shadow-xs">
        {group.items.map((item) => {
          const to = item.data?.to || NOTIFICATION_ROUTES[item.type] || "/activity";
          return (
            <li key={item.id}>
              <Link
                to={to}
                onClick={() => onAct?.(item.id)}
                className={cn(
                  "flex min-h-tap items-start gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2",
                  !item.is_read && "bg-brand-50/50 dark:bg-brand-500/5",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    item.is_read ? "bg-transparent" : "bg-brand-500",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-ink-1">{item.title}</span>
                    {item.acted_upon_at && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-micro font-semibold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
                        <CheckCircle2 size={10} aria-hidden="true" /> Acted on
                      </span>
                    )}
                  </span>
                  {item.body && <span className="mt-0.5 block text-2xs leading-snug text-ink-3">{item.body}</span>}
                  <span className="mt-0.5 block text-micro text-ink-4">
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
