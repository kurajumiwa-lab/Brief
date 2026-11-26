import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, Settings } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import InboxTabs from "@/components/inbox/InboxTabs";
import InboxChats from "@/components/inbox/InboxChats";
import InboxNotifications from "@/components/inbox/InboxNotifications";
import TradePassModal from "@/components/inbox/TradePassModal";
import { useOutsideStore } from "@/stores/outsideStore";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { apiError, notificationAPI } from "@/lib/api";
import { NOTIFICATION_ROUTES } from "@/config/constants";

/**
 * INBOX — Chats and Notifications, and nothing else.
 *
 * This screen was a dashboard. Opening it to read one reply meant scrolling
 * past three summary tiles, a neighbourhood-watches panel, a corridor review,
 * a week timeline, a work board, a voucher card, three mode tabs and a
 * seven-value filter row before reaching a message. Every one of those was a
 * real feature; none of them was the Inbox, and together they made a messaging
 * screen that was not usable for messaging.
 *
 * What is here now is the brief's design: a title with search and settings, two
 * permanent tabs carrying their own unread counts, and the list.
 *
 *   Chats          every conversation, newest first: who, what was last said,
 *                  when, how many unread. Opens `/chat?room=<id>`.
 *   Notifications  one chronological list, one line each. No seven-way
 *                  grouping, no explanatory blurb under each heading.
 *
 * WHERE THE OTHER THINGS WENT — nothing was deleted, only relocated to the
 * screen that owns it:
 *
 *   your week / rounds & RSVPs   → Home, beside upcoming events
 *   Find work + its earnings     → Home (it was already a work board; Home is
 *                                  where "what is on this week" lives)
 *   weekly routines              → Home, with Find work
 *   neighbourhood watches         → Settings & records, next to the rest of the
 *                                  account's controls
 *   corridor review / spotted     → Settings & records (operator-facing work)
 *   payments awaiting confirmation→ Settings & records → Orders & trades
 *
 * READ SEMANTICS. Opening a notification marks that one read, via
 * `notificationAPI.markRead`. Nothing marks all, nothing marks on a timer, and
 * opening a chat never touches notifications. The brief is explicit about this
 * and the old screen got it wrong in the subtler direction: it never marked
 * anything read at all, so the unread count could only ever grow.
 */

/**
 * WHERE A NOTIFICATION OPENS.
 *
 * The payload wins over the type, because "a group invite" is less useful than
 * "this group". Order runs from the most specific record to the least; the
 * type-to-route table is the fallback and the sender's page is the last resort,
 * so a notification can never open on the Inbox it is displayed in — landing
 * back on the list you tapped from reads as a failure, not as navigation.
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
  // The type table is the fallback, not the first resort: the payload above is
  // more precise because the backend already knows which record it is writing
  // about. Dropping this line sent every notification without a payload field
  // to `/`, which is the Inbox's own neighbourhood — the exact failure this
  // ordering exists to prevent.
  return (
    NOTIFICATION_ROUTES[item.type] ||
    d.to ||
    (item.sender_handle ? `/p/${item.sender_handle}` : "/")
  );
}

/** A notification record, flattened to the five things a row shows. */
function notificationRow(item) {
  return {
    key: `n:${item.id}`,
    notificationId: item.id,
    title: item.title || "Notification",
    body: item.body || "",
    at: item.created_at,
    to: destinationFor(item),
    unread: !item.is_read,
  };
}

export default function InboxPage() {
  const activity = useOutsideStore((s) => s.activity);
  const activityStatus = useOutsideStore((s) => s.activityStatus);
  const loadActivity = useOutsideStore((s) => s.loadActivity);

  const rooms = useChatStore((s) => s.rooms);
  const fetchRooms = useChatStore((s) => s.fetchRooms);

  const memberHandle = useAuthStore((s) => s.vendor?.vendor_handle);

  // The tab is a URL parameter, not component state, so the screen survives a
  // reload, a back button and a shared link. /mail has always opened the
  // conversation list; it now lands on the tab that still exists.
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "notifications" ? "notifications" : "chats";

  const [roomsStatus, setRoomsStatus] = useState("idle");
  const [roomsError, setRoomsError] = useState("");
  const [openPass, setOpenPass] = useState(null);

  const loadRooms = useCallback(async () => {
    setRoomsStatus("loading");
    try {
      await fetchRooms({});
      setRoomsError("");
    } catch (err) {
      setRoomsError(apiError(err, "Check your connection and try again."));
    } finally {
      setRoomsStatus("ready");
    }
  }, [fetchRooms]);

  useEffect(() => {
    loadActivity();
    loadRooms();
  }, [loadActivity, loadRooms]);

  const notifications = useMemo(
    () => (activity?.groups || []).flatMap((group) => (group.items || []).map(notificationRow)),
    [activity],
  );

  // Newest first, across every group. The old screen sorted inside groups and
  // then ordered the groups, which is why a reply from an hour ago could sit
  // below an invitation from last week.
  const chronological = useMemo(
    () =>
      [...notifications].sort(
        (a, b) => new Date(b.at || 0) - new Date(a.at || 0),
      ),
    [notifications],
  );

  const unreadChats = rooms.reduce(
    (total, room) => total + (Number(room.unread_count) || 0),
    0,
  );
  const unreadNotifications = notifications.filter((row) => row.unread).length;

  const selectTab = (next) => {
    const params = new URLSearchParams(window.location.search);
    if (next === "chats") params.delete("tab");
    else params.set("tab", next);
    setParams(params, { replace: true });
  };

  /**
   * Mark ONE notification read, then reflect it locally.
   *
   * Optimistic, because a tap that waits on a round trip to remove a dot feels
   * broken; and single-record, because marking the list read because one row
   * was opened is exactly the behaviour the brief forbids. A failure puts the
   * dot back and says so — a count that silently stays wrong is worse than one
   * that visibly fails.
   */
  const openNotification = (row) => {
    if (!row.unread || !row.notificationId) return;
    const store = useOutsideStore.getState();
    const snapshot = store.activity;

    store.markNotificationReadLocal(row.notificationId);
    notificationAPI.markRead(row.notificationId).catch(() => {
      useOutsideStore.setState({ activity: snapshot });
      toast.error("Could not mark that notification read.");
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Title and the two utilities the brief asks for. No eyebrow, no
          introductory sentence: the screen is called Inbox and the tabs say
          what is in it. */}
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-1">Inbox</h1>
        <div className="flex items-center gap-1">
          <Link
            to="/regions?focus=search"
            aria-label="Search"
            className="grid h-11 w-11 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <Search size={20} aria-hidden="true" />
          </Link>
          <Link
            to="/more"
            aria-label="Settings"
            className="grid h-11 w-11 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <Settings size={20} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className="mt-4">
        <InboxTabs
          value={tab}
          onChange={selectTab}
          chats={unreadChats}
          notifications={unreadNotifications}
        />
      </div>

      {/* One divider, then the list. No card wrapper: the brief asks for a
          compact list, and a border around every row is what made the old
          screen look like a dashboard of tiles. */}
      <div className="mt-1 border-t border-edge-1 pt-1">
        {tab === "chats" ? (
          <InboxChats
            rooms={rooms}
            loading={roomsStatus === "loading" && rooms.length === 0}
            error={roomsError}
            onRetry={loadRooms}
          />
        ) : (
          <InboxNotifications
            rows={chronological}
            loading={activityStatus === "loading" && chronological.length === 0}
            error={activityStatus === "error" ? "Check your connection and try again." : ""}
            onRetry={loadActivity}
            onOpen={openNotification}
          />
        )}
      </div>

      <p className="mt-6 text-center text-micro text-ink-4">
        Older trades are in{" "}
        <Link to="/orders/records" className="font-semibold text-ink-3 hover:underline">
          Records & receipts
        </Link>
        .
      </p>

      <TradePassModal pass={openPass} memberHandle={memberHandle} onClose={() => setOpenPass(null)} />
    </div>
  );
}
