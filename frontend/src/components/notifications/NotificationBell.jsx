import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, CheckCheck, ArrowDownToLine, HeartHandshake, Users, ClipboardList, ShoppingBasket, CalendarDays,
  PackageSearch, ShieldCheck, TrendingUp, Crown, Truck, Info,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { useNotificationStore } from "@/stores/notificationStore";
import { NOTIFICATION_ROUTES } from "@/config/constants";
import { relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const ICONS = {
  source: ArrowDownToLine,
  deal: HeartHandshake,
  group: Users,
  list: ClipboardList,
  collective: ShoppingBasket,
  event: CalendarDays,
  stock_low: PackageSearch,
  stock_verified: ShieldCheck,
  parasitism: TrendingUp,
  patron: Crown,
  shipment: Truck,
  system: Info,
};

const TONES = {
  source: "text-accent-600 dark:text-accent-400 bg-accent-500/10",
  deal: "text-brand-600 dark:text-brand-400 bg-brand-500/10",
  group: "text-purple-600 dark:text-purple-400 bg-purple-500/10",
  list: "text-brand-600 dark:text-brand-400 bg-brand-500/10",
  collective: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
  event: "text-purple-600 dark:text-purple-400 bg-purple-500/10",
  stock_low: "text-accent-600 dark:text-accent-400 bg-accent-500/10",
  stock_verified: "text-brand-600 dark:text-brand-400 bg-brand-500/10",
  parasitism: "text-brand-600 dark:text-brand-400 bg-brand-500/10",
  patron: "text-accent-600 dark:text-accent-400 bg-accent-500/10",
  shipment: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
  system: "text-ink-3 bg-surface-2",
};

const iconFor = (type = "") => {
  if (type.startsWith("source_")) return ICONS.source;
  if (type.startsWith("deal_")) return ICONS.deal;
  if (type.startsWith("group_")) return ICONS.group;
  if (type.startsWith("list_")) return ICONS.list;
  if (type.startsWith("collective")) return ICONS.collective;
  if (type.startsWith("event_")) return ICONS.event;
  if (type === "stock_low") return ICONS.stock_low;
  if (type === "stock_verified") return ICONS.stock_verified;
  if (type === "parasitism_milestone") return ICONS.parasitism;
  if (type === "patron_promotion") return ICONS.patron;
  if (type === "shipment_update") return ICONS.shipment;
  return ICONS.system;
};

const toneFor = (type = "") => {
  if (type.startsWith("source_")) return TONES.source;
  if (type.startsWith("deal_")) return TONES.deal;
  if (type.startsWith("group_")) return TONES.group;
  if (type.startsWith("list_")) return TONES.list;
  if (type.startsWith("collective")) return TONES.collective;
  if (type.startsWith("event_")) return TONES.event;
  if (type === "stock_low") return TONES.stock_low;
  if (type === "stock_verified") return TONES.stock_verified;
  if (type === "parasitism_milestone") return TONES.parasitism;
  if (type === "patron_promotion") return TONES.patron;
  if (type === "shipment_update") return TONES.shipment;
  return TONES.system;
};

/** Where a notification leads. Room-specific data wins over the type default. */
export function routeFor(n) {
  const d = n.data || {};
  if (d.market_lock_cluster_id || d.window_id && d.zone_id) return "/locks";
  if (d.room_id) return `/chat?room=${d.room_id}`;
  if (d.support_case) return "/orders?support=1";
  if (d.movement_id) return `/orders/${d.movement_id}`;
  if (d.group_id && n.type?.startsWith("collective")) return `/groups?tab=mine&group=${d.group_id}&panel=collective`;
  if (d.group_id) return `/groups?tab=mine&group=${d.group_id}`;
  if (d.list_id) return `/lists?list=${d.list_id}`;
  if (d.event_id) return `/events?event=${d.event_id}`;
  if (d.shipment_id || d.tracking_number) return "/tools?tab=shipments";
  return NOTIFICATION_ROUTES[n.type] || "/";
}

/**
 * Top-bar bell (v2.1, restyled v2.7). Polls the unread count, loads the list
 * when opened, marks a notification read when it is clicked and follows it.
 * v2.7: borderless glass panel, tinted icon tiles, pulsing count chip.
 */
export default function NotificationBell({ pollMs = 30_000 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, loaded, fetch, markRead, markAllRead, startPolling, stopPolling } =
    useNotificationStore();

  useEffect(() => {
    startPolling(pollMs);
    return () => stopPolling();
  }, [pollMs, startPolling, stopPolling]);

  useEffect(() => {
    if (open) fetch({ limit: 30 }).catch(() => {});
  }, [open, fetch]);

  // click-away / escape
  useEffect(() => {
    if (!open) return;
    const away = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const follow = (n) => {
    markRead(n.id);
    setOpen(false);
    navigate(routeFor(n));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative p-2 rounded-xl text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors",
          open && "bg-surface-2 text-ink-1"
        )}
        aria-label={unreadCount ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={open}
        title="Notifications"
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span
            className="absolute top-0.5 right-0.5 min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-brand-600 text-white text-micro font-bold flex items-center justify-center tabular-nums ring-2 ring-surface-0"
            data-testid="unread-badge"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] bg-surface-0 border border-edge-1 rounded-2xl shadow-xl z-50 overflow-hidden animate-scale-in origin-top-right"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-edge-1">
            <span className="text-xs font-semibold text-ink-1">
              Notifications {unreadCount > 0 && <span className="text-ink-4 font-normal">· {unreadCount} unread</span>}
            </span>
            <Button size="xs" variant="ghost" icon={CheckCheck} onClick={() => markAllRead().catch(() => {})} disabled={!unreadCount}>
              Mark all read
            </Button>
          </div>
          <ul className="max-h-[26rem] overflow-y-auto px-1.5 pb-1.5 space-y-0.5">
            {loading && !loaded ? (
              <li className="px-3 py-6 text-center text-xs text-ink-4">Loading…</li>
            ) : notifications.length === 0 ? (
              <li className="px-3 py-8 text-center text-xs text-ink-4">Quiet for now. Requests, deals and approvals land here.</li>
            ) : (
              notifications.map((n) => {
                const Icon = iconFor(n.type);
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => follow(n)}
                      className={cn(
                        "w-full text-left flex gap-3 px-2.5 py-2.5 rounded-xl transition-colors",
                        n.is_read ? "hover:bg-surface-2" : "bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/10 dark:hover:bg-brand-500/20"
                      )}
                    >
                      <span className={cn("mt-0.5 shrink-0 w-7 h-7 rounded-lg flex items-center justify-center", toneFor(n.type))}>
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-xs leading-snug", n.is_read ? "text-ink-2" : "text-ink-1 font-medium")}>{n.title}</span>
                        {n.body && <span className="block text-2xs text-ink-4 leading-snug mt-0.5 line-clamp-2">{n.body}</span>}
                        <span className="block text-2xs text-ink-4 mt-1">
                          {relativeTime(n.created_at)}
                          {n.sender_handle && <span className="font-mono"> · @{n.sender_handle}</span>}
                        </span>
                      </span>
                      {!n.is_read && (
                        <span className="mt-2 w-2 h-2 rounded-full bg-brand-500 shrink-0" aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
