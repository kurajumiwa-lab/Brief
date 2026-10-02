import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Package, Network, MessageSquare, ArrowRight, Activity, Users, Gauge, Layers, Radio, Bell } from "lucide-react";
import Stat from "@/components/ui/Stat";
import Button from "@/components/ui/Button";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import Badge from "@/components/ui/Badge";
import DigitalNumber from "@/components/ui/DigitalNumber";
import Shelf, { ShelfItem } from "@/components/ui/Shelf";
import VendorCard from "@/components/vendor/VendorCard";
import MovementRow from "@/components/stock/MovementRow";
import { routeFor } from "@/components/notifications/NotificationBell";
import { useAuthStore } from "@/stores/authStore";
import { useVendorStore } from "@/stores/vendorStore";
import { useStockStore } from "@/stores/stockStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { VENDOR_ROLES } from "@/config/constants";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

/** Popup screens behind each shelf number. */
function NumberPopup({ which, onClose, data }) {
  const { vendor, stats, connections, mine, visible } = data;
  const navigate = useNavigate();
  const go = (to) => {
    onClose();
    navigate(to);
  };
  const inner = (
    <>
      {which === "score" && (
        <>
          <div className="flex items-baseline gap-3">
            <DigitalNumber value={Number(vendor.network_score || 0).toFixed(1)} tone="brand" size="3xl" />
            <span className="text-xs text-ink-4">network score</span>
          </div>
          <p className="text-xs text-ink-3 mt-3 leading-relaxed">
            Grows with every movement you receive — the network's simple measure of how much value moves through you.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/[0.05] p-3">
              <DigitalNumber value={num(vendor.total_supplied || 0)} size="md" />
              <p className="text-2xs text-ink-4 mt-1.5">units supplied</p>
            </div>
            <div className="rounded-xl bg-white/[0.05] p-3">
              <DigitalNumber value={num(vendor.total_sourced || 0)} size="md" />
              <p className="text-2xs text-ink-4 mt-1.5">units sourced</p>
            </div>
          </div>
        </>
      )}
      {which === "fulfillment" && (
        <>
          <div className="flex items-baseline gap-3">
            {vendor.fulfillment_rate != null ? (
              <DigitalNumber value={`${Number(vendor.fulfillment_rate).toFixed(0)}%`} size="3xl" />
            ) : (
              <DigitalNumber value="--" size="3xl" />
            )}
            <span className="text-xs text-ink-4">of confirmed movements delivered</span>
          </div>
          <p className="text-xs text-ink-3 mt-3 leading-relaxed">
            Your fulfilment rate — how reliably moves you confirm actually get delivered. It feeds your reliability and how the network ranks you.
          </p>
          <div className="mt-4 rounded-xl bg-white/[0.05] p-3">
            <DigitalNumber value={num(vendor.movements_completed || 0)} size="md" />
            <p className="text-2xs text-ink-4 mt-1.5">movements completed{vendor.movements_completed < 3 ? " — complete a few more to set a rate" : ""}</p>
          </div>
        </>
      )}
      {which === "connections" && (
        <>
          <div className="flex items-baseline gap-3">
            <DigitalNumber value={num(connections.length)} tone="blue" size="3xl" />
            <span className="text-xs text-ink-4">vendors connected to you</span>
          </div>
          <ul className="mt-4 space-y-1.5">
            {connections.slice(0, 5).map((c) => (
              <li key={c.vendor_id} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2">
                <span className="text-xs text-ink-2 truncate">{c.business_name}</span>
                <span className="text-2xs font-mono text-ink-4">@{c.vendor_handle}</span>
              </li>
            ))}
            {connections.length === 0 && <li className="text-xs text-ink-4 py-2">No connections yet.</li>}
          </ul>
        </>
      )}
      {which === "shelf" && (
        <>
          <div className="flex items-baseline gap-3">
            <DigitalNumber value={num(mine.length)} size="3xl" />
            <span className="text-xs text-ink-4">lines on your shelf</span>
          </div>
          <p className="text-2xs text-ink-4 mt-2">
            {visible} visible to the network · {num(vendor.total_stock_moved || 0)} units moved all-time
          </p>
          <ul className="mt-4 space-y-1.5">
            {mine.slice(0, 6).map((i) => (
              <li key={i.id} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-xs">
                <span className="text-ink-2 truncate">{i.name}</span>
                <span className="digital text-ink-3">{num(i.quantity_available ?? i.quantity_in_stock ?? 0)} {i.unit_of_measure}</span>
              </li>
            ))}
            {mine.length === 0 && <li className="text-xs text-ink-4 py-2">Your shelf is empty.</li>}
          </ul>
        </>
      )}
      {which === "vendors" && (
        <>
          <div className="flex items-baseline gap-3">
            <DigitalNumber value={num(stats?.vendors || 0)} tone="amber" size="3xl" />
            <span className="text-xs text-ink-4">vendors in the network · {num(stats?.connections || 0)} connections</span>
          </div>
          <div className="mt-4 space-y-2">
            {VENDOR_ROLES.map((r) => {
              const n = stats?.by_role?.[r.value] || 0;
              const pct = stats?.vendors ? Math.round((n / stats.vendors) * 100) : 0;
              return (
                <div key={r.value} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-ink-3">
                    {r.emoji} {r.label}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300 shadow-[0_0_8px_rgba(245, 158, 11,0.6)]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right digital text-ink-4">{n}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
  const titles = {
    score: { title: "Network score", description: "Your standing in the network" },
    fulfillment: { title: "Fulfilment", description: "How reliably you deliver" },
    connections: { title: "Connections", description: "Vendors you're linked with" },
    shelf: { title: "On your shelf", description: "What you're offering" },
    vendors: { title: "Network pulse", description: "Everyone here trades" },
  };
  return (
    <Modal open onClose={onClose} {...titles[which]} footer={<Button size="sm" variant="secondary" onClick={() => go(which === "vendors" ? "/network" : which === "connections" ? "/network?tab=connections" : which === "shelf" ? "/stock" : "/analytics")}>Open {which === "vendors" ? "network" : which === "connections" ? "connections" : which === "shelf" ? "stock room" : "analytics"}</Button>}>
      {inner}
    </Modal>
  );
}

/** The home feed — a social stream mixing network movements and notifications. */
function Feed({ movements, todo, notifications, onOpenMovement, onOpenNotification, onBrowse }) {
  const items = useMemo(() => {
    const ms = (todo.length ? todo : movements).slice(0, 6).map((m) => ({ kind: "movement", at: m.created_at || m.updated_at, m }));
    const ns = notifications.slice(0, 8).map((n) => ({ kind: "notification", at: n.created_at, n }));
    return [...ms, ...ns].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 9);
  }, [movements, todo, notifications]);

  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={Radio}
        title="The network is quiet"
        description="Source something, or make your shelf visible — every movement and ping lands here first."
        action={<Button size="sm" onClick={onBrowse}>Browse network stock</Button>}
      />
    );
  }

  return (
    <ul className="space-y-2">
      {items.map(({ kind, m, n }) =>
        kind === "movement" ? (
          <li key={`m-${m.id}`} className="animate-fade-in">
            <MovementRow movement={m} />
          </li>
        ) : (
          <li key={`n-${n.id}`}>
            <button
              onClick={() => onOpenNotification(n)}
              className={cn(
                "w-full text-left glass rounded-xl p-3 flex gap-3 transition-all duration-200 glass-hover",
                n.is_read && "opacity-80"
              )}
            >
              <span className="w-9 h-9 rounded-lg bg-brand-500/10 text-brand-300 flex items-center justify-center shrink-0">
                <Bell size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn("text-sm truncate", n.is_read ? "text-ink-3" : "text-ink-1 font-medium")}>{n.title}</span>
                  {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-brand-400 shrink-0 shadow-[0_0_6px_rgba(251, 191, 36,0.9)]" />}
                </span>
                {n.body && <span className="block text-xs text-ink-4 mt-0.5 line-clamp-2">{n.body}</span>}
                <span className="block text-2xs text-ink-4/70 mt-1">{relativeTime(n.created_at)}</span>
              </span>
            </button>
          </li>
        )
      )}
    </ul>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const { stats, suggested, connections, fetchStats, fetchSuggested, fetchConnections } = useVendorStore();
  const { mine, movements, fetchMine, fetchMovements, actionable } = useStockStore();
  const { notifications, unreadCount, fetch: fetchNotifications } = useNotificationStore();

  const [popup, setPopup] = useState(null);

  useEffect(() => {
    fetchStats().catch(() => {});
    fetchSuggested(4).catch(() => {});
    fetchConnections().catch(() => {});
    fetchMine().catch(() => {});
    fetchMovements().catch(() => {});
    fetchNotifications({ limit: 12 }).catch(() => {});
  }, [fetchStats, fetchSuggested, fetchConnections, fetchMine, fetchMovements, fetchNotifications]);

  if (!vendor) return null;
  const role = VENDOR_ROLES.find((r) => r.value === vendor.current_role);
  const todo = actionable();
  const visible = mine.filter((i) => i.visible_to_network).length;

  const feedData = { vendor, stats, connections, mine, visible };
  const popups = {
    score: <NumberPopup which="score" data={feedData} onClose={() => setPopup(null)} />,
    fulfillment: <NumberPopup which="fulfillment" data={feedData} onClose={() => setPopup(null)} />,
    connections: <NumberPopup which="connections" data={feedData} onClose={() => setPopup(null)} />,
    shelf: <NumberPopup which="shelf" data={feedData} onClose={() => setPopup(null)} />,
    vendors: <NumberPopup which="vendors" data={feedData} onClose={() => setPopup(null)} />,
  };

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs text-ink-4">{greeting()} · {new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}</p>
          <h2 className="text-2xl font-semibold text-ink-1 tracking-tight mt-0.5">{vendor.business_name}</h2>
          <p className="text-sm text-ink-3 mt-1">
            You're <span className={role?.color}>{role?.emoji} {role?.label.toLowerCase()}</span> · {role?.hint.toLowerCase()}. Switch roles from the sidebar any time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={Package} onClick={() => navigate("/stock?new=1")}>
            Add stock
          </Button>
          <Button size="sm" variant="secondary" icon={Network} onClick={() => navigate("/network")}>
            Find vendors
          </Button>
          <Button size="sm" icon={MessageSquare} onClick={() => navigate("/chat")}>
            Chat
          </Button>
        </div>
      </div>

      {/* The shelf — your numbers, swipe to browse, tap a number to pop it open */}
      <Shelf
        title="Your numbers"
        sub="Swipe the shelf · tap a number for the full picture"
        action={
          <Link to="/analytics" className="text-xs text-brand-300 hover:text-brand-200 inline-flex items-center gap-1 transition-colors">
            Analytics <ArrowRight size={12} />
          </Link>
        }
      >
        <ShelfItem index={0} className="w-44 sm:w-48">
          <Stat label="Network score" value={Number(vendor.network_score || 0).toFixed(1)} icon={Activity} tone="brand" hint="Grows with every received movement" onClick={() => setPopup("score")} />
        </ShelfItem>
        <ShelfItem index={1} className="w-44 sm:w-48">
          <Stat
            label="Fulfilment"
            value={vendor.fulfillment_rate != null ? `${Number(vendor.fulfillment_rate).toFixed(0)}%` : "--"}
            icon={Gauge}
            tone={vendor.fulfillment_rate != null && vendor.fulfillment_rate >= 90 ? "brand" : "blue"}
            hint={vendor.fulfillment_rate != null ? "of confirmed movements delivered" : "complete movements to set your rate"}
            onClick={() => setPopup("fulfillment")}
          />
        </ShelfItem>
        <ShelfItem index={2} className="w-44 sm:w-48">
          <Stat label="Connections" value={num(connections.length)} icon={Users} tone="blue" hint="vendors linked with you" onClick={() => setPopup("connections")} />
        </ShelfItem>
        <ShelfItem index={3} className="w-44 sm:w-48">
          <Stat label="On your shelf" value={num(mine.length)} icon={Layers} hint={`${visible} visible to the network · ${num(vendor.total_stock_moved || 0)} units moved`} onClick={() => setPopup("shelf")} />
        </ShelfItem>
        <ShelfItem index={4} className="w-44 sm:w-48">
          <Stat label="Vendors" value={num(stats?.vendors || 0)} icon={Radio} tone="amber" hint={`${num(stats?.connections || 0)} connections network-wide`} onClick={() => setPopup("vendors")} />
        </ShelfItem>
      </Shelf>

      {/* The feed — dashboard activity + social pings in one stream */}
      <Card padding="p-4 sm:p-5" className="animate-fade-in">
        <CardHeader
          action={
            <div className="flex items-center gap-3">
              {unreadCount > 0 && (
                <Badge variant="brand" size="xs" dot>
                  {unreadCount} new
                </Badge>
              )}
              <Link to="/stock?tab=movements" className="text-xs text-brand-300 hover:text-brand-200 inline-flex items-center gap-1 transition-colors">
                All movements <ArrowRight size={12} />
              </Link>
            </div>
          }
        >
          <CardTitle sub={todo.length ? `${todo.length} waiting on you` : "Nothing waiting on you — this is the pulse"}>Network feed</CardTitle>
        </CardHeader>
        <Feed
          movements={movements}
          todo={todo}
          notifications={notifications}
          onOpenNotification={(n) => {
            if (!n.is_read) useNotificationStore.getState().markRead(n.id);
            navigate(routeFor(n));
          }}
          onBrowse={() => navigate("/stock?tab=network")}
        />
      </Card>

      {/* Vendors who complement you — another moving shelf */}
      <Shelf
        title="Vendors who complement you"
        sub="The network's matching for your profile"
        action={
          <Link to="/network" className="text-xs text-brand-300 hover:text-brand-200 inline-flex items-center gap-1 transition-colors">
            Open the network <ArrowRight size={12} />
          </Link>
        }
      >
        {suggested.length === 0 ? (
          <ShelfItem index={0} className="w-full">
            <EmptyState
              compact
              icon={Network}
              title="No suggestions yet"
              description="Tell the network what you stock and what you source — suggestions come from your profile."
              action={
                <Button size="sm" variant="secondary" onClick={() => navigate(`/@${vendor.vendor_handle}?edit=1`)}>
                  Complete your profile
                </Button>
              }
            />
          </ShelfItem>
        ) : (
          suggested.map((v, i) => (
            <ShelfItem key={v.vendor_id} index={i} className="w-72 sm:w-80">
              <VendorCard vendor={v} compact reasons={v.reasons} />
            </ShelfItem>
          ))
        )}
      </Shelf>

      {popup && popups[popup]}
    </div>
  );
}
