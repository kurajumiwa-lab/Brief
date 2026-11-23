import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell, CalendarDays, CheckCircle2, Inbox, MessageSquare, Package,
  ShoppingBag, Store, UserPlus,
} from "lucide-react";
import Button from "@/components/ui/Button";
import WatchesPanel from "@/components/inbox/WatchesPanel";
import InboxFeed from "@/components/inbox/InboxFeed";
import { toast } from "@/components/ui/Toast";
import InboxTimeline from "@/components/inbox/InboxTimeline";
import { receiptsAPI } from "@/lib/receiptsApi";
import CorridorJuryCard from "@/components/spotted/CorridorJuryCard";
import CorridorTaskBoard from "@/components/tasks/CorridorTaskBoard";
import RoutineSharePrompt from "@/components/routines/RoutineSharePrompt";
import TradePassModal from "@/components/inbox/TradePassModal";
import VoucherRedeemCard from "@/components/receipts/VoucherRedeemCard";
import { useOutsideStore } from "@/stores/outsideStore";
import { useChatStore } from "@/stores/chatStore";
import { useStockStore } from "@/stores/stockStore";
import { useAuthStore } from "@/stores/authStore";
import { NOTIFICATION_ROUTES } from "@/config/constants";
import { apiError, outsideAPI, eventAPI, spottedDealAPI, corridorTaskAPI, recurringRoutineAPI } from "@/lib/api";
import { DEFAULT_REGION, regionFromPlace } from "@/config/regions";
import ledgerAPI from "@/lib/ledgerApi";
import { cn } from "@/lib/utils";

/**
 * INBOX — THE ONE INBOX.
 *
 * This screen is the only place activity is read. It used to be one of four:
 * `pages/activity/ActivityPage` (a full second inbox, reached only by old deep
 * links), `pages/mail/MailPage` (conversations, behind a flag), and the
 * notification bell — each with its own filters, its own empty states and its
 * own idea of where a notification should send you. The tab pointed at this
 * one, so the others were the ones that were wrong, and they are gone:
 *
 *   /activity  → renders this page (the tab's own component)
 *   /mail      → renders this page with conversations selected
 *
 * Activity was not deleted, it was *absorbed*. Four things it had and this
 * page did not now live here, because they were the real content:
 *
 *   · the three-number summary (conversations / events / unread),
 *   · the neighbourhood watches panel — the setting that decides what you are
 *     told about, which belongs next to the list it feeds,
 *   · grouped notifications with a read/unread distinction per group,
 *   · the "waiting on you" vs "your activity" split.
 *
 * Order is deliberate, top to bottom: what is on your calendar this week, then
 * what is actually waiting on a reply, then the long tail. The week comes first
 * because a flat list can answer "who spoke last" but never "where do I have to
 * be?".
 */

/**
 * The filter set is the union of the two screens that were merged, and it is
 * rendered from this table rather than from whatever the server returned this
 * minute: a filter that vanishes when it happens to be empty reads as a filter
 * that no longer exists.
 */
const GROUP_META = {
  messages: { label: "Messages", icon: MessageSquare, blurb: "Conversations that moved" },
  invitations: { label: "Invitations", icon: UserPlus, blurb: "Requests to join, invites and approvals" },
  events: { label: "Events", icon: CalendarDays, blurb: "Reminders and changes to things you're going to" },
  replies: { label: "Replies", icon: MessageSquare, blurb: "Answers, quotes and stop requests" },
  trades: { label: "Trades & bookings", icon: ShoppingBag, blurb: "Orders, repairs and local bookings in progress" },
  community: { label: "Communities", icon: Store, blurb: "News from your groups and lists" },
  account: { label: "Account", icon: Bell, blurb: "Verification, watches and everything else" },
};

/** Everything that is addressed to this person and can wait on a reply. */
const WAITING_KEYS = new Set(["invitations", "replies", "trades"]);

const FILTERS = [
  { value: "all", label: "All" },
  ...Object.entries(GROUP_META).map(([value, meta]) => ({ value, label: meta.label })),
];

const GROUP_ICON = Object.fromEntries(
  Object.entries(GROUP_META).map(([key, meta]) => [key, meta.icon]),
);

/**
 * WHERE A NOTIFICATION OPENS.
 *
 * The payload wins over the type, because "a group invite" is less useful than
 * "this group". Order runs from the most specific record to the least; the
 * type-to-route table is the fallback and the sender's page is the last resort,
 * so a notification can never open on the Inbox it is displayed in — landing
 * back on the list you tapped from reads as a failure, not as navigation.
 *
 * This ordering was the only part of the deleted `NotificationBell` worth
 * keeping: it is more precise than a type table, because the backend already
 * knows which room, order or group it is writing about.
 */
export function destinationFor(item) {
  const d = item.data || {};
  if (d.market_lock_cluster_id || (d.window_id && d.zone_id)) return "/locks";
  if (d.room_id) return `/chat?room=${d.room_id}`;
  if (d.support_case) return "/orders?support=1";
  if (d.movement_id) return `/orders/${d.movement_id}`;
  if (d.group_id && item.type?.startsWith("collective")) {
    return `/groups?tab=mine&group=${d.group_id}&panel=collective`;
  }
  if (d.group_id) return `/groups?tab=mine&group=${d.group_id}`;
  if (d.list_id) return `/lists?list=${d.list_id}`;
  if (d.event_id) return `/events?event=${d.event_id}`;
  if (d.shipment_id || d.tracking_number) return "/tools?tab=shipments";
  return (
    NOTIFICATION_ROUTES[item.type] ||
    d.to ||
    (item.sender_handle ? `/p/${item.sender_handle}` : "/")
  );
}

function notificationRow(item, group) {
  return {
    key: `n:${item.id}`,
    notificationId: item.id,
    // The notification's own group IS its kind. It used to be flattened into
    // "requests" for a single-column list, which left the grouped feed with
    // nothing to group by — every notification arrived as the same kind.
    kind: GROUP_META[group] ? group : "account",
    waiting: WAITING_KEYS.has(group),
    icon: GROUP_ICON[group] || Inbox,
    title: item.title || "Notification",
    body: item.body || "",
    at: item.created_at,
    to: destinationFor(item),
    unread: !item.is_read,
  };
}

export default function InboxPage({ initialFilter = "all" }) {
  const activity = useOutsideStore((s) => s.activity);
  const activityStatus = useOutsideStore((s) => s.activityStatus);
  const loadActivity = useOutsideStore((s) => s.loadActivity);

  const rooms = useChatStore((s) => s.rooms);
  const fetchRooms = useChatStore((s) => s.fetchRooms);

  const movements = useStockStore((s) => s.movements);
  const fetchMovements = useStockStore((s) => s.fetchMovements);
  const memberHandle = useAuthStore((s) => s.vendor?.vendor_handle);
  const memberLocation = useAuthStore((s) => s.vendor?.physical_location);

  const [taskData, setTaskData] = useState(null);
  const [taskStatus, setTaskStatus] = useState("idle");
  const [taskError, setTaskError] = useState("");
  const loadTasks = useCallback(async () => {
    setTaskStatus("loading");
    try {
      const { data } = await corridorTaskAPI.inbox(7);
      setTaskData(data);
      setTaskError("");
    } catch (err) {
      setTaskError(apiError(err, "The work board could not be loaded."));
    } finally {
      setTaskStatus("ready");
    }
  }, []);

  const [jury, setJury] = useState([]);
  const [hiddenDeals, setHiddenDeals] = useState([]);
  const [disputeIds, setDisputeIds] = useState({});
  const [disputeReceipts, setDisputeReceipts] = useState([]);
  const loadSpottedInbox = useCallback(async () => {
    try { const [j, d] = await Promise.all([spottedDealAPI.jury(), spottedDealAPI.mine()]); setJury(j.data); setHiddenDeals(d.data); } catch { /* other inbox sections remain usable */ }
  }, []);
  const [paymentQueue, setPaymentQueue] = useState([]);
  const [paymentBusy, setPaymentBusy] = useState(null);
  // `initialFilter` is how /mail opens this page on conversations instead of
  // keeping a second component that did nothing else.
  const [filter, setFilter] = useState(initialFilter);
  // The question the page is answering. "waiting" is what needs a reply;
  // "activity" is everything else, including things you joined months ago.
  const [mode, setMode] = useState("all");
  const [agenda, setAgenda] = useState([]);
  const [agendaStatus, setAgendaStatus] = useState("idle");
  const [agendaError, setAgendaError] = useState("");
  const [openPass, setOpenPass] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);

  const loadAgenda = useCallback(async () => {
    setAgendaStatus("loading");
    try {
      const { data } = await outsideAPI.agenda();
      setAgenda(data.items || []);
      setAgendaError("");
    } catch (err) {
      setAgendaError(apiError(err, "Check your connection and try again."));
    } finally {
      setAgendaStatus("ready");
    }
  }, []);

  const [sharePrompts, setSharePrompts] = useState([]);
  const loadSharePrompts = useCallback(async () => {
    try {
      const { data } = await recurringRoutineAPI.mine();
      setSharePrompts(data?.share_prompts || []);
    } catch {
      // A missing routine list must never hide the rest of the Inbox.
      setSharePrompts([]);
    }
  }, []);

  useEffect(() => {
    loadSpottedInbox();
    receiptsAPI.ledger().then(r=>setDisputeReceipts(r.data.receipts || [])).catch(()=>{});
    eventAPI.paymentQueue().then(({ data }) => setPaymentQueue(data)).catch(() => {});
    loadActivity();
    loadAgenda();
    loadTasks();
    loadSharePrompts();
    fetchRooms({}).catch(() => {});
    fetchMovements({}).catch(() => {});
  }, [loadActivity, loadAgenda, loadTasks, loadSharePrompts, fetchRooms, fetchMovements, loadSpottedInbox]);

  const confirmTrade = async (item) => {
    setConfirmingId(item.id);
    try {
      await ledgerAPI.confirmCompletion(item.record_id);
      toast.success("Booking confirmed");
      await loadAgenda();
    } catch (err) {
      toast.error(apiError(err, "That booking could not be confirmed."));
    } finally {
      setConfirmingId(null);
    }
  };

  const rows = useMemo(() => {
    const notifications = (activity?.groups || []).flatMap((group) =>
      (group.items || []).map((item) => notificationRow(item, group.key)),
    );

    const messages = rooms.map((room) => ({
      key: `r:${room.id}`,
      kind: "messages",
      waiting: (room.unread_count || 0) > 0,
      icon: MessageSquare,
      title: room.name || "Conversation",
      body:
        room.last_message?.body ||
        (room.room_type === "direct" ? "Direct conversation" : `${room.room_type || "group"} conversation`),
      at: room.last_message_at || room.created_at,
      to: `/chat?room=${room.id}`,
      unread: (room.unread_count || 0) > 0,
    }));

    const trades = movements.map((movement) => ({
      key: `m:${movement.id}`,
      kind: "trades",
      waiting: ["requested", "confirmed", "pending"].includes(movement.status),
      icon: Package,
      title: movement.item_name || movement.listing_name || "Trade",
      body: `${String(movement.status || "in progress").replaceAll("_", " ")}${movement.counterparty_name ? ` · ${movement.counterparty_name}` : ""}`,
      at: movement.updated_at || movement.created_at,
      to: `/orders/${movement.id}`,
      unread: ["requested", "confirmed", "pending"].includes(movement.status),
    }));

    return [...messages, ...notifications, ...trades]
      .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
      .slice(0, 60);
  }, [activity, rooms, movements]);

  // One count per filter, computed from the same rows that are rendered below:
  // a chip cannot promise items the list then refuses to show.
  const counts = useMemo(() => {
    const byKind = { all: rows.filter((row) => row.unread).length };
    for (const key of Object.keys(GROUP_META)) {
      byKind[key] = rows.filter((row) => row.kind === key && row.unread).length;
    }
    return byKind;
  }, [rows]);

  const flagged = (row) => row.waiting ?? WAITING_KEYS.has(row.kind);
  const byMode = mode === "all" ? rows : rows.filter((row) => (mode === "waiting" ? flagged(row) : !flagged(row)));
  const shown = filter === "all" ? byMode : byMode.filter((row) => row.kind === filter);
  const loading = activityStatus === "loading" && rows.length === 0;

  // Old test ids, kept on purpose: these three tiles moved here from the
  // Activity screen and the specs that guard them should not have to change
  // name just because the page did.
  const statTestId = {
    conversations: "activity-rooms",
    events: "activity-attending",
    unread: "activity-unread",
  };

  // The three numbers Activity put at the top of the screen. They are the same
  // three the tab bar badges, read from the same store, so the two can never
  // disagree.
  const stats = [
    {
      key: "conversations",
      icon: MessageSquare,
      value: activity?.counts?.rooms_active_today ?? 0,
      label: "Conversations",
      hint: "active today",
      to: "/chat",
    },
    {
      key: "events",
      icon: CalendarDays,
      value: activity?.counts?.attending ?? 0,
      label: "Events",
      hint: "upcoming",
      to: "/events?tab=mine",
    },
    {
      key: "unread",
      icon: Bell,
      value: activity?.counts?.unread_notifications ?? 0,
      label: "Unread",
      hint: "notifications",
      to: null,
    },
  ];
  const taskDays = useMemo(
    () => (taskData?.days || []).filter((day) => day.available + day.claimed > 0).map((day) => day.date),
    [taskData],
  );
  const viewerRegion = regionFromPlace(memberLocation)?.slug || DEFAULT_REGION.slug;
  const viewerTown = String(memberLocation || "").split(",")[0].trim();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header>
        <p className="eyebrow">Now</p>
        <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-ink-1 sm:text-3xl">Inbox</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-3">
          Your week first, then the messages and trades that need a reply. Only a
          reply that is actually waiting carries a count.
        </p>
      </header>

      {/* Three numbers, one row, always all three: a count you have to swipe to
          see is a count that is not being shown. */}
      <ul
        className="mt-4 grid grid-cols-3 gap-2"
        data-testid="activity-stats"
        aria-label="Inbox at a glance"
      >
        {stats.map(({ key, icon: Icon, value, label, hint, to }) => {
          const body = (
            <>
              <span className="grid h-7 w-7 place-items-center rounded-[10px] bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                <Icon size={14} aria-hidden="true" />
              </span>
              <span className="mt-1 block text-2xl font-bold leading-none tabular-nums text-ink-1 max-[360px]:text-xl">
                {value}
              </span>
              <span className="mt-1 block text-2xs font-semibold leading-tight text-ink-2 hyphens-auto break-words max-[380px]:text-micro">
                {label}
              </span>
              <span className="block text-micro leading-tight text-ink-4">{hint}</span>
            </>
          );
          const cls = cn(
            "flex min-h-[104px] min-w-0 flex-col justify-center rounded-2xl border border-edge-1 bg-surface-1 p-2.5 shadow-xs",
            to && "transition-colors hover:border-edge-2 hover:bg-surface-2",
          );
          return (
            <li key={key} className="min-w-0" data-testid={statTestId[key]}>
              {to ? (
                <Link to={to} className={cn(cls, "h-full")}>
                  {body}
                </Link>
              ) : (
                <div className={cn(cls, "h-full")}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      <WatchesPanel />

      {jury.length > 0 && <section className="mt-5 space-y-2"><h2 className="font-bold">Corridor review</h2>{jury.map(a => <CorridorJuryCard key={a.assignment_id} assignment={a} onChanged={loadSpottedInbox} />)}</section>}
      {hiddenDeals.length > 0 && <section className="mt-5 space-y-2"><h2 className="font-bold">Your hidden spotted sales</h2>{hiddenDeals.map(d => <div key={d.id} className="rounded-xl border border-edge-1 p-3 text-sm space-y-2"><p>{d.title} · {d.status === "DISPUTED_REVIEW" ? "Hidden during review" : "Hidden after removal request"}</p>{d.status === "PAUSED_OPT_OUT" && <><p>Deadline: {new Date(d.opt_out_deadline).toLocaleString()}. A parsed receipt does not prove the advertised discount.</p><label>Your parsed receipt<select className="block w-full border rounded p-2" value={disputeIds[d.id] || ""} onChange={e=>setDisputeIds({...disputeIds,[d.id]:e.target.value})}><option value="">Select a receipt</option>{disputeReceipts.filter(r=>r.source === "qr" && r.status === "verified").map(r=><option key={r.id} value={r.id}>{r.merchant_name} · {r.issued_at ? new Date(r.issued_at).toLocaleDateString() : "date unavailable"}</option>)}</select></label><button disabled={!disputeIds[d.id]?.trim()} className="rounded bg-brand-700 text-white p-2 disabled:opacity-50" onClick={async()=>{try {await spottedDealAPI.dispute(d.id,disputeIds[d.id].trim()); await loadSpottedInbox(); toast.success("Submitted for review");}catch(e){toast.error(apiError(e));}}}>Submit parsed receipt for review</button></>}</div>)}</section>}
      {paymentQueue.length > 0 && <section className="mt-5 space-y-2"><h2 className="font-semibold">Payments awaiting confirmation</h2>{paymentQueue.map(row => <div key={row.registration_id} className="rounded-xl border border-edge-1 p-3 text-sm space-y-2"><p><strong>{row.business_name}</strong> · {row.event_title}</p>{row.cash_due ? <p>Cash booking · KSh {row.ticket_price}. The guest pays you directly; mark it received when you have the cash.</p> : <><p>User-declared M-Pesa note: {row.mpesa_code} · {row.mpesa_amount == null ? "amount not found" : `KSh ${row.mpesa_amount}`}</p>{row.amount_is_partial && <p className="text-amber-700">Amount is below ticket price (KSh {row.ticket_price}).</p>}{!row.mpesa_recipient_matched && <p className="text-amber-700">Recipient not matched. Verify independently.</p>}<details><summary>View declared SMS</summary><p>{row.mpesa_raw_note}</p></details></>}<button type="button" disabled={paymentBusy === row.registration_id} className="rounded-lg bg-brand-700 text-white px-3 py-2" onClick={async () => { setPaymentBusy(row.registration_id); try { await eventAPI.confirmPayment(row.event_id, row.registration_id); setPaymentQueue(q => q.filter(item => item.registration_id !== row.registration_id)); toast.success(row.cash_due ? "Cash marked received — pass unlocked" : "Payment confirmed"); } catch (err) { toast.error(apiError(err)); } finally { setPaymentBusy(null); } }}>{row.cash_due ? "Mark cash received" : "Confirm payment"}</button></div>)}</section>}
      <div className="mt-5">
        <InboxTimeline
          items={agenda}
          loading={agendaStatus === "loading" || agendaStatus === "idle"}
          error={agendaError}
          onRetry={loadAgenda}
          onOpenPass={setOpenPass}
          onConfirmTrade={confirmTrade}
          confirmingId={confirmingId}
          taskDays={taskDays}
          belowStrip={
            <>
              <RoutineSharePrompt prompts={sharePrompts} onShared={loadSharePrompts} />
              <CorridorTaskBoard
                data={taskData}
                onChanged={loadTasks}
                defaultRegion={viewerRegion}
                town={viewerTown}
              />
            </>
          }
        />
        {taskStatus === "ready" && taskError && (
          <p className="mt-1 px-1 text-2xs text-ink-4">{taskError}</p>
        )}
      </div>

      <div className="mt-4">
        <VoucherRedeemCard />
      </div>

      <div className="mt-7 border-t border-edge-1 pt-5">
        <p className="eyebrow">Everything else</p>
        <h2 className="mt-1 text-base font-extrabold tracking-tight text-ink-1">Waiting on a reply</h2>
      </div>

      {/* Two questions, kept apart: what needs an answer, and everything else
          that happened. "All" is the default so switching never hides anything
          unread — the tab only narrows, it never discards. */}
      <div
        className="mt-3 inline-flex rounded-xl border border-edge-1 bg-surface-1 p-1"
        role="tablist"
        aria-label="What to show"
      >
        {[
          { key: "all", label: "Everything", icon: Bell },
          { key: "waiting", label: "Waiting on you", icon: MessageSquare },
          { key: "activity", label: "Your activity", icon: CalendarDays },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            data-testid={`inbox-mode-${key}`}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-2xs font-bold transition-colors",
              mode === key
                ? "bg-brand-700 text-white"
                : "text-ink-3 hover:bg-surface-2 hover:text-ink-1",
            )}
          >
            <Icon size={13} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div
        className="mt-3 flex flex-nowrap gap-1.5 overflow-x-auto no-scrollbar"
        role="group"
        aria-label="Inbox filter"
        data-testid="activity-filters"
      >
        {FILTERS.map((item) => {
          const active = filter === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              aria-pressed={active}
              data-testid={`activity-group-${item.value}`}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-2xs font-bold transition-colors",
                active
                  ? "border-brand-700 bg-brand-700 text-white"
                  : "border-edge-1 bg-surface-1 text-ink-3 hover:border-edge-2 hover:text-ink-1",
              )}
            >
              {item.value === "all" ? "Everything" : item.label}
              {counts[item.value] > 0 && (
                <span
                  className={cn(
                    "ml-1.5 inline-grid min-w-4 place-items-center rounded-full px-1 text-micro tabular-nums",
                    active ? "bg-white/20 text-white" : "bg-surface-2 text-ink-3",
                  )}
                >
                  {counts[item.value] > 9 ? "9+" : counts[item.value]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <InboxFeed rows={[]} meta={GROUP_META} status="loading" onRetry={loadActivity} emptyBody="" />
      ) : shown.length === 0 && mode !== "all" ? (
        <div
          className="mt-6 rounded-2xl border border-edge-1 bg-surface-1 px-5 py-10 text-center"
          data-testid="inbox-mode-empty"
        >
          <CheckCircle2 size={22} className="mx-auto text-brand-600" aria-hidden="true" />
          <p className="mt-2 text-sm font-bold text-ink-1">
            {mode === "waiting" ? "Nothing is waiting on you." : "Nothing else has happened yet."}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-2xs leading-relaxed text-ink-3">
            {mode === "waiting"
              ? "No invitations, quotes or trades need an answer. Your other activity is under Your activity."
              : "When somebody replies, joins or moves a trade, it appears here."}
          </p>
          <Button size="xs" variant="secondary" className="mt-3" onClick={() => setMode("all")}>
            Show everything
          </Button>
        </div>
      ) : (
        <InboxFeed
          rows={shown}
          meta={GROUP_META}
          status={activityStatus === "error" ? "error" : "ready"}
          onRetry={loadActivity}
          emptyBody="Nothing is waiting on you. When somebody replies, asks for something or moves a trade, it lands here."
          actOn={(row) => {
            if (row.notificationId) ledgerAPI.markNotificationActed(row.notificationId).catch(() => {});
          }}
        />
      )}

      <p className="mt-6 text-center text-micro text-ink-4">
        Looking for something older?{" "}
        <Link to="/more" className="font-semibold text-ink-3 hover:underline">
          Settings & records
        </Link>{" "}
        keeps the full trade record.
      </p>

      <TradePassModal pass={openPass} memberHandle={memberHandle} onClose={() => setOpenPass(null)} />
    </div>
  );
}
