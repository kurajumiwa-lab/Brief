import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays, ChevronRight, Inbox, MessageSquare, Package, ShoppingBag, Users,
} from "lucide-react";
import { PageSpinner } from "@/components/ui/Spinner";
import { useOutsideStore } from "@/stores/outsideStore";
import { useChatStore } from "@/stores/chatStore";
import { useStockStore } from "@/stores/stockStore";
import { NOTIFICATION_ROUTES } from "@/config/constants";
import { relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * INBOX — what is waiting, in one list.
 *
 * Connect, Work, Mail and the notification bell were four names for one
 * question. This is the question, answered once: messages, requests and trades,
 * newest first, with a count only where a count means somebody is waiting on a
 * reply.
 *
 * The filters are four words, not seven categories. A person who wants the
 * long tail can use the search in the header.
 */

const FILTERS = [
  { value: "all", label: "All" },
  { value: "messages", label: "Messages" },
  { value: "requests", label: "Requests" },
  { value: "trades", label: "Trades" },
];

const GROUP_ICON = {
  invitations: Users,
  events: CalendarDays,
  replies: MessageSquare,
  trades: ShoppingBag,
  community: Users,
  account: Inbox,
};

function notificationRow(item, group) {
  return {
    key: `n:${item.id}`,
    kind: group === "replies" ? "messages" : group === "trades" ? "trades" : "requests",
    icon: GROUP_ICON[group] || Inbox,
    title: item.title || "Notification",
    body: item.body || "",
    at: item.created_at,
    to: NOTIFICATION_ROUTES[item.type] || "/inbox",
    unread: !item.is_read,
  };
}

export default function InboxPage() {
  const activity = useOutsideStore((s) => s.activity);
  const activityStatus = useOutsideStore((s) => s.activityStatus);
  const loadActivity = useOutsideStore((s) => s.loadActivity);

  const rooms = useChatStore((s) => s.rooms);
  const fetchRooms = useChatStore((s) => s.fetchRooms);

  const movements = useStockStore((s) => s.movements);
  const fetchMovements = useStockStore((s) => s.fetchMovements);

  const [filter, setFilter] = useState("all");

  useEffect(() => {
    loadActivity();
    fetchRooms({}).catch(() => {});
    fetchMovements({}).catch(() => {});
  }, [loadActivity, fetchRooms, fetchMovements]);

  const rows = useMemo(() => {
    const notifications = (activity?.groups || []).flatMap((group) =>
      (group.items || []).map((item) => notificationRow(item, group.key)),
    );

    const messages = rooms.map((room) => ({
      key: `r:${room.id}`,
      kind: "messages",
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

  const counts = useMemo(
    () => ({
      all: rows.filter((row) => row.unread).length,
      messages: rows.filter((row) => row.kind === "messages" && row.unread).length,
      requests: rows.filter((row) => row.kind === "requests" && row.unread).length,
      trades: rows.filter((row) => row.kind === "trades" && row.unread).length,
    }),
    [rows],
  );

  const shown = filter === "all" ? rows : rows.filter((row) => row.kind === filter);
  const loading = activityStatus === "loading" && rows.length === 0;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header>
        <p className="eyebrow">Waiting</p>
        <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-ink-1 sm:text-3xl">Inbox</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-3">
          Messages, requests and trades in one list. Only a reply that is actually
          waiting carries a count.
        </p>
      </header>

      <div className="mt-4 flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Inbox filter">
        {FILTERS.map((item) => {
          const active = filter === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              aria-pressed={active}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-2xs font-bold transition-colors",
                active
                  ? "border-brand-700 bg-brand-700 text-white"
                  : "border-edge-1 bg-surface-1 text-ink-3 hover:border-edge-2 hover:text-ink-1",
              )}
            >
              {item.label}
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
        <PageSpinner label="Loading what is waiting…" />
      ) : shown.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-5 py-12 text-center">
          <Inbox size={22} className="mx-auto text-ink-4" aria-hidden="true" />
          <p className="mt-2 text-sm font-bold text-ink-1">Nothing is waiting</p>
          <p className="mx-auto mt-1 max-w-xs text-2xs leading-relaxed text-ink-3">
            When somebody replies, asks for something or moves a trade, it lands
            here — and nowhere else.
          </p>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-edge-1">
          {shown.map((row) => {
            const Icon = row.icon;
            return (
              <li key={row.key}>
                <Link
                  to={row.to}
                  className="group flex items-start gap-3 py-3.5 px-1 -mx-1 rounded-xl hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <span className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2">
                    <Icon size={16} aria-hidden="true" />
                    {row.unread && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand-600 ring-2 ring-surface-1" aria-label="Unread" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cn("min-w-0 flex-1 truncate text-xs", row.unread ? "font-bold text-ink-1" : "font-semibold text-ink-2")}>
                        {row.title}
                      </span>
                      {row.at && (
                        <span className="shrink-0 text-micro text-ink-4">{relativeTime(row.at)}</span>
                      )}
                    </span>
                    {row.body && (
                      <span className="mt-0.5 line-clamp-1 block text-2xs text-ink-3">{row.body}</span>
                    )}
                  </span>
                  <ChevronRight size={15} className="mt-1 shrink-0 text-ink-4 group-hover:text-ink-1" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-center text-micro text-ink-4">
        Looking for something older?{" "}
        <Link to="/more" className="font-semibold text-ink-3 hover:underline">
          Settings & records
        </Link>{" "}
        keeps the full trade record.
      </p>
    </div>
  );
}
