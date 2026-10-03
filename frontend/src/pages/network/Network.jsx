import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Users, Compass, Sparkles, Link2, SlidersHorizontal, Globe } from "lucide-react";
import Tabs from "@/components/ui/Tabs";
import SearchInput from "@/components/ui/SearchInput";
import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import { PageSpinner } from "@/components/ui/Spinner";
import VendorCard from "@/components/vendor/VendorCard";
import PublicPlaces from "@/components/network/PublicPlaces";
import { useVendorStore } from "@/stores/vendorStore";
import { useAuthStore } from "@/stores/authStore";
import { VENDOR_ROLES } from "@/config/constants";
import { num } from "@/lib/formatters";

const TABS = [
  { value: "discover", label: "Discover", icon: Compass },
  { value: "public", label: "Public data", icon: Globe },
  { value: "connections", label: "Connections", icon: Link2 },
  { value: "suggested", label: "Suggested", icon: Sparkles },
];

export default function Network() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "discover";
  const search = params.get("search") || "";
  const role = params.get("role") || "";
  const location = params.get("location") || "";
  const me = useAuthStore((s) => s.vendor);
  const { network, connections, discovered, discoverWeights, stats, loading, fetchNetwork, fetchConnections, fetchDiscover, fetchDiscoverWeights, fetchStats } = useVendorStore();

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  useEffect(() => {
    fetchStats().catch(() => {});
  }, [fetchStats]);

  useEffect(() => {
    if (tab === "discover") fetchNetwork({ search, role, location }).catch(() => {});
    if (tab === "connections") fetchConnections().catch(() => {});
    if (tab === "suggested") {
      fetchDiscover({ limit: 12 }).catch(() => {});
      fetchDiscoverWeights().catch(() => {});
    }
  }, [tab, search, role, location, fetchNetwork, fetchConnections, fetchDiscover, fetchDiscoverWeights]);

  const others = network.filter((v) => v.id !== me?.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Suppliers</h2>
          <p className="text-xs text-ink-4">Connect with the vendors you trade with. Connections make your stock — and theirs — easier to find.</p>
        </div>
        {stats && (
          <div className="flex items-center gap-4 text-xs text-ink-4">
            <span>
              <span className="font-mono text-ink-1">{num(stats.vendors)}</span> vendors
            </span>
            <span>
              <span className="font-mono text-ink-1">{num(stats.connections)}</span> connections
            </span>
            {VENDOR_ROLES.slice(0, 3).map((r) => (
              <span key={r.value} className="hidden sm:inline">
                {r.emoji} <span className="font-mono text-ink-2">{stats.by_role?.[r.value] || 0}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <Tabs tabs={TABS.map((t) => (t.value === "connections" && connections.length ? { ...t, count: connections.length } : t))} value={tab} onChange={(v) => setParam({ tab: v })} />

      {tab === "discover" && (
        <>
          <div className="grid sm:grid-cols-[1fr_10rem_12rem] gap-2">
            <SearchInput value={search} onChange={(v) => setParam({ search: v })} placeholder="Business, handle or category" />
            <Select value={role} onChange={(e) => setParam({ role: e.target.value })} placeholder="Any role" options={VENDOR_ROLES.map((r) => ({ value: r.value, label: `${r.emoji} ${r.label}` }))} />
            <Input value={location} onChange={(e) => setParam({ location: e.target.value })} placeholder="Location" />
          </div>
          {loading && others.length === 0 ? (
            <PageSpinner />
          ) : others.length === 0 ? (
            <EmptyState icon={Users} title="No vendors match" description="Loosen the filters — or invite the vendors you already trade with." />
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {others.map((v) => (
                <VendorCard key={v.id} vendor={v} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "public" && <PublicPlaces />}

      {tab === "connections" &&
        (connections.length === 0 ? (
          <EmptyState icon={Link2} title="No connections yet" description="Connect with vendors from Discover. The pair score between you grows with every completed movement." />
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {connections.map((c) => (
              <VendorCard key={c.vendor_id} vendor={{ ...c, id: c.vendor_id, connected: true, parasitism_index: c.parasitism_score }} compact footer={<p className="text-2xs text-ink-4 font-mono">pair score {Number(c.parasitism_score || 0).toFixed(0)} · {c.connection_type}</p>} />
            ))}
          </div>
        ))}

      {tab === "suggested" &&
        (discovered.length === 0 ? (
          <EmptyState icon={Sparkles} title="Nothing to suggest yet" description="Suggestions come from your profile: what you stock and what you source. Fill it in from your profile page." />
        ) : (
          <>
            {discoverWeights && (
              <div className="flex flex-wrap items-center gap-1.5 text-2xs text-ink-4">
                <Badge variant="outline" size="xs">
                  <SlidersHorizontal size={9} /> scoring
                </Badge>
                {Object.entries(discoverWeights).map(([k, v]) => (
                  <span key={k} className="rounded bg-surface-3 px-1.5 py-0.5 font-mono">
                    {k} {v}
                  </span>
                ))}
              </div>
            )}
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {discovered.map((v) => (
                <VendorCard
                  key={v.vendor_id}
                  vendor={v}
                  compact
                  reasons={v.reasons}
                  footer={
                    <div className="flex items-center justify-between gap-2 text-2xs text-ink-4 font-mono">
                      <span>match {Number(v.score || 0).toFixed(0)}/100</span>
                      {v.distance_km != null && <span>{Number(v.distance_km).toFixed(1)} km</span>}
                    </div>
                  }
                />
              ))}
            </div>
          </>
        ))}
    </div>
  );
}
