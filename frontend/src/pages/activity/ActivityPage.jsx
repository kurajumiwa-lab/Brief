import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell, CalendarDays, CheckCircle2, ClipboardList, MessageSquare, Plus, RefreshCw,
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
 * ACTIVITY — Grouped notifications with acted-upon tracking (`acted_upon_at`),
 * active Local Activity Ledger bookings awaiting completion, and user-chosen
 * Neighbourhood Watch preferences (`activity_watches`).
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
  const visible = group === "all" ? groups.filter((g) => g.items.length) : groups.filter((g) => g.key === group);
  const activeBookings = bookings.filter((b) => ["agreed", "in_progress"].includes(b.status));

  return (
    <div className="space-y-s5">
      <header className="space-y-1">
        <p className="text-micro font-bold uppercase tracking-[0.14em] text-ink-4">Activity</p>
        <h1 className="text-title-page font-bold text-ink-1">What's waiting for you</h1>
        <p className="text-sm text-ink-3">
          Invitations, replies, agreed bookings, and local watches you chose — measured by real follow-through, not screen time.
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

      {/* ── Active Local Activity Ledger Bookings ───────────────────────── */}
      {activeBookings.length > 0 && (
        <section
          data-testid="active-ledger-bookings"
          className="rounded-card-lg border border-brand-500/30 bg-brand-50/50 p-4 dark:bg-brand-500/10 space-y-2.5"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-ink-1">
              Active neighbourhood bookings ({activeBookings.length})
            </p>
            <Badge variant="brand" size="sm">Direct non-custodial</Badge>
          </div>
          <ul className="space-y-2">
            {activeBookings.map((bk) => (
              <li key={bk.id} className="flex items-center justify-between gap-3 rounded-xl border border-edge-1 bg-surface-0 px-3.5 py-2.5">
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
                <Link to={`/activities/${bk.activity_id}`}>
                  <Button size="xs" variant="secondary">Open ledger</Button>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Neighbourhood Watch Preferences (`activity_watches`) ─────────── */}
      <section
        data-testid="activity-watches-panel"
        className="rounded-card-lg border border-edge-1 bg-surface-1 p-4 shadow-xs space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <Sparkles size={15} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-ink-1">Neighbourhood watches</h2>
              <p className="text-2xs text-ink-4">
                Only notify me about specific local needs, artisan rounds, or produce in my chosen radius.
              </p>
            </div>
          </div>
          <Button
            size="xs"
            variant="secondary"
            icon={Plus}
            onClick={() => setWatchOpen((v) => !v)}
            data-testid="toggle-add-watch-btn"
          >
            {watchOpen ? "Close" : "Add watch"}
          </Button>
        </div>

        {watchOpen && (
          <form onSubmit={onAddWatch} className="grid gap-2.5 rounded-xl border border-edge-1 bg-surface-0 p-3.5 sm:grid-cols-2">
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
          <ul className="flex flex-wrap gap-2">
            {watches.map((w) => (
              <li
                key={w.id}
                className="inline-flex items-center gap-2 rounded-full border border-edge-1 bg-surface-0 px-3 py-1 text-2xs text-ink-2"
              >
                <span>
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
                  className="text-ink-4 hover:text-danger"
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

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
            <GroupSection key={g.key} group={g} onAct={onActOnNotification} />
          ))}
        </div>
      )}
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
          const to = item.data?.to || NOTIFICATION_ROUTES[item.type] || "/activity";
          return (
            <li key={item.id}>
              <Link
                to={to}
                onClick={() => onAct?.(item.id)}
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
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink-1">{item.title}</span>
                    {item.acted_upon_at && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-micro font-semibold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
                        <CheckCircle2 size={10} /> Acted on
                      </span>
                    )}
                  </span>
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
    { to: "/explore", icon: ClipboardList, title: "Find something nearby", body: "Repairs, rounds, produce and events around you." },
    { to: "/create", icon: ClipboardList, title: "Post an activity", body: "Available, Wanted, Scheduled or Opportunity." },
    { to: "/chat", icon: MessageSquare, title: "Your conversations", body: "Pick up where you left off." },
  ];

  return (
    <div data-testid="activity-empty" className="rounded-card-lg border border-edge-1 bg-surface-1 p-6 text-center shadow-xs sm:p-8">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-ink-4">
        <Bell size={22} aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-title-section font-semibold text-ink-1">Nothing is waiting on you</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-3">
        No invitations, no replies, nothing mid-flight. Add a neighbourhood watch above or post something local.
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
