import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Package, Network, MessageSquare, ArrowRight, Sparkles, Activity, Users, Leaf, Layers } from "lucide-react";
import Stat from "@/components/ui/Stat";
import Button from "@/components/ui/Button";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import VendorCard from "@/components/vendor/VendorCard";
import ParasitismBadge, { parasitismTier } from "@/components/vendor/ParasitismBadge";
import MovementRow from "@/components/stock/MovementRow";
import { useAuthStore } from "@/stores/authStore";
import { useVendorStore } from "@/stores/vendorStore";
import { useStockStore } from "@/stores/stockStore";
import { VENDOR_ROLES } from "@/config/constants";
import { num } from "@/lib/formatters";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function Dashboard() {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const { stats, suggested, connections, fetchStats, fetchSuggested, fetchConnections } = useVendorStore();
  const { mine, movements, fetchMine, fetchMovements, actionable } = useStockStore();

  useEffect(() => {
    fetchStats().catch(() => {});
    fetchSuggested(3).catch(() => {});
    fetchConnections().catch(() => {});
    fetchMine().catch(() => {});
    fetchMovements().catch(() => {});
  }, [fetchStats, fetchSuggested, fetchConnections, fetchMine, fetchMovements]);

  if (!vendor) return null;
  const role = VENDOR_ROLES.find((r) => r.value === vendor.current_role);
  const todo = actionable();
  const recent = movements.slice(0, 5);
  const visible = mine.filter((i) => i.visible_to_network).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs text-ink-4">{greeting()}</p>
          <h2 className="text-2xl font-semibold text-ink-1 tracking-tight">{vendor.business_name}</h2>
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Network score" value={Number(vendor.network_score || 0).toFixed(1)} icon={Activity} tone="brand" hint="Grows with every received movement" />
        <Stat label="Parasitism index" value={Math.round(vendor.parasitism_index || 0)} icon={Leaf} hint={parasitismTier(vendor.parasitism_index).label} />
        <Stat label="Connections" value={num(connections.length)} icon={Users} onClick={() => navigate("/network?tab=connections")} />
        <Stat label="On your shelf" value={num(mine.length)} icon={Layers} hint={`${visible} visible to the network · ${num(vendor.total_stock_moved || 0)} units moved`} onClick={() => navigate("/stock")} />
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3" padding="p-0">
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <CardTitle sub={todo.length ? `${todo.length} waiting on you` : "Nothing waiting on you"}>Movements</CardTitle>
            <Link to="/stock?tab=movements" className="text-xs text-brand-400 hover:text-brand-300 inline-flex items-center gap-1">
              All movements <ArrowRight size={12} />
            </Link>
          </div>
          <div className="px-4 pb-4 space-y-2">
            {recent.length === 0 ? (
              <EmptyState compact icon={Package} title="No movements yet" description="Source something from the network, or make your shelf visible so vendors can source from you." action={<Button size="sm" onClick={() => navigate("/stock?tab=network")}>Browse network stock</Button>} />
            ) : (
              (todo.length ? todo : recent).slice(0, 4).map((m) => <MovementRow key={m.id} movement={m} />)
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2 flex flex-col" padding="p-4">
          <CardHeader>
            <CardTitle sub="Everyone here trades">Network pulse</CardTitle>
          </CardHeader>
          {stats ? (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold font-mono text-ink-1">{num(stats.vendors)}</span>
                <span className="text-xs text-ink-4">vendors · {num(stats.connections)} connections</span>
              </div>
              <div className="space-y-1.5">
                {VENDOR_ROLES.map((r) => {
                  const n = stats.by_role?.[r.value] || 0;
                  const pct = stats.vendors ? Math.round((n / stats.vendors) * 100) : 0;
                  return (
                    <div key={r.value} className="flex items-center gap-2 text-xs">
                      <span className="w-20 text-ink-3">
                        {r.emoji} {r.label}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                        <div className="h-full bg-brand-600 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-8 text-right font-mono text-ink-4">{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink-4">Loading…</p>
          )}
          <div className="mt-auto pt-4 flex items-center justify-between">
            <ParasitismBadge index={vendor.parasitism_index || 0} />
            <span className="text-2xs text-ink-4">
              {num(vendor.total_supplied || 0)} supplied · {num(vendor.total_sourced || 0)} sourced
            </span>
          </div>
        </Card>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink-1 inline-flex items-center gap-2">
            <Sparkles size={14} className="text-brand-400" /> Vendors who complement you
          </h3>
          <Link to="/network" className="text-xs text-brand-400 hover:text-brand-300 inline-flex items-center gap-1">
            Open the network <ArrowRight size={12} />
          </Link>
        </div>
        {suggested.length === 0 ? (
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
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {suggested.map((v) => (
              <VendorCard key={v.vendor_id} vendor={v} compact reasons={v.reasons} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
