import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, Coins, MessageSquare, Minus, Package, Scale, TrendingUp, Users,
} from "lucide-react";
import Stat from "@/components/ui/Stat";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import Tabs from "@/components/ui/Tabs";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import ParasitismBadge from "@/components/vendor/ParasitismBadge";
import { useAnalyticsStore } from "@/stores/analyticsStore";
import { useAuthStore } from "@/stores/authStore";
import { apiError } from "@/lib/api";
import { compactNum, currency, num, relativeTime, shortDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/Toast";

const RANGES = [
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
  { value: 180, label: "6m" },
  { value: 365, label: "1y" },
];

const POSITION_TONE = { below: "brand", above: "red", "in line": "gray" };

/**
 * Trade analytics dashboard (v2.1 §3.5) — what actually moved, to whom, at what
 * price, and where the vendor's shelf sits against the rest of the network.
 */
export default function Analytics() {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const { overview, counterparty, weights, loading, loadingCounterparty, fetch, fetchWeights, fetchCounterparty, clearCounterparty } =
    useAnalyticsStore();
  const [days, setDays] = useState(90);

  useEffect(() => {
    fetch(days).catch((e) => toast.error(apiError(e, "Couldn't load analytics")));
  }, [days, fetch]);
  useEffect(() => {
    fetchWeights().catch(() => {});
  }, [fetchWeights]);

  const summary = overview?.summary;
  const trend = overview?.trend || [];
  const maxTrend = useMemo(() => Math.max(1, ...trend.map((t) => t.value)), [trend]);

  if (!overview && loading) return <PageSpinner label="Crunching your trade history…" />;

  const openCount = summary?.open_movements_total || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Trade analytics</h2>
          <p className="text-xs text-ink-4">
            Settled movements only — pending holds aren't revenue and cancellations aren't history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs
            variant="pill"
            size="sm"
            tabs={RANGES}
            value={days}
            onChange={(d) => setDays(Number(d))}
          />
          {weights && (
            <Badge variant="outline" size="xs" title={Object.entries(weights).map(([k, v]) => `${k}: ${v}%`).join(" · ")}>
              weighted discovery
            </Badge>
          )}
        </div>
      </div>

      {!summary || summary.movements_settled + openCount === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No settled trade in this window"
          description="Once movements are received, the value, counterparties, price position and trends show up here."
          action={<Button size="sm" onClick={() => navigate("/stock?tab=network")}>Browse the network</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Trade value" value={currency(summary.trade_value)} icon={Coins} tone="brand"
                  hint={`${num(summary.movements_settled)} settled · ${compactNum(summary.units_moved)} units`} />
            <Stat label="Supplied" value={currency(summary.supplied_value)} icon={ArrowUpRight} tone="amber"
                  hint={`${num(summary.supplied_units)} units sold out`} />
            <Stat label="Sourced" value={currency(summary.sourced_value)} icon={ArrowDownRight} tone="blue"
                  hint={`${num(summary.sourced_units)} units bought in`} />
            <Stat label="Counterparties" value={num(summary.counterparties)} icon={Users}
                  hint={overview.network ? `${overview.share_of_network_pct}% of network trade` : undefined} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Avg movement" value={currency(summary.avg_movement_value)} icon={Scale} />
            <Stat label="Open work" value={num(openCount)} icon={Package} onClick={() => navigate("/stock?tab=movements")}
                  hint={Object.entries(summary.open_movements || {}).map(([k, v]) => `${v} ${k}`).join(" · ") || "nothing in flight"} />
            <Stat label="Cancelled" value={num(summary.movements_cancelled)} icon={Minus} />
            <Stat label="On-time shipment" value={summary.on_time_shipment_rate != null ? `${summary.on_time_shipment_rate}%` : "—"}
                  icon={Activity} hint={summary.avg_hours_to_ship != null ? `avg ${summary.avg_hours_to_ship}h to ship` : "no timed shipments yet"} />
          </div>

          <Card padding="p-4">
            <CardHeader>
              <CardTitle sub={`bucketed by ${trend[0]?.bucket || "week"} · supplied above the line, sourced below`}>Trade over time</CardTitle>
              {overview.network && (
                <span className="text-2xs text-ink-4">
                  network: {currency(overview.network.trade_value)} over {overview.network.days}d
                </span>
              )}
            </CardHeader>
            {trend.length === 0 ? (
              <p className="text-xs text-ink-4 py-6 text-center">Nothing settled in this window.</p>
            ) : (
              <div className="flex items-end gap-2 h-40 overflow-x-auto pb-1">
                {trend.map((t) => (
                  <div key={t.period} className="flex-1 min-w-[36px] flex flex-col items-center gap-1" title={`${t.movements} movements · ${currency(t.value)}`}>
                    <div className="w-full flex flex-col justify-end gap-0.5 h-32">
                      <div className="w-full rounded-t bg-amber-500/70" style={{ height: `${(t.supplied_value / maxTrend) * 100}%` }} />
                      <div className="w-full rounded-b bg-blue-500/70" style={{ height: `${(t.sourced_value / maxTrend) * 100}%` }} />
                    </div>
                    <span className="text-2xs text-ink-4 font-mono whitespace-nowrap">{shortDate(t.period).replace(/ \d{4}$/, "")}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card padding="p-4">
              <CardHeader>
                <CardTitle sub="share of your settled value">Categories</CardTitle>
              </CardHeader>
              {(overview.categories || []).length === 0 ? (
                <p className="text-xs text-ink-4 py-4 text-center">No categorised trade yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {overview.categories.map((c) => (
                    <div key={c.category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-ink-2 truncate">{c.category}</span>
                        <span className="font-mono text-ink-4">{currency(c.trade_value)} · {c.share_pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                        <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(2, c.share_pct)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card padding="p-4">
              <CardHeader>
                <CardTitle sub="your shelf vs the network's, by category">Price position</CardTitle>
              </CardHeader>
              {(overview.price_position || []).length === 0 ? (
                <p className="text-xs text-ink-4 py-4 text-center">
                  List something visible to the network and your price position appears here.
                </p>
              ) : (
                <div className="space-y-2">
                  {overview.price_position.map((p) => (
                    <div key={p.category} className="rounded-lg border border-edge-1 bg-surface-1 p-2.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-ink-1 truncate">{p.category}</span>
                        <Badge variant={POSITION_TONE[p.position] || "gray"} size="xs">{p.position}</Badge>
                      </div>
                      <div className="flex items-center justify-between text-2xs font-mono text-ink-4">
                        <span>you {currency(p.my_avg_price)}</span>
                        <span className={cn(p.delta_pct > 0 ? "text-red-400" : p.delta_pct < 0 ? "text-brand-400" : "text-ink-4")}>
                          {p.delta_pct > 0 ? "+" : ""}{p.delta_pct}%
                        </span>
                        <span>network {currency(p.network_avg_price)} · {p.network_vendors} vendor{p.network_vendors === 1 ? "" : "s"}</span>
                      </div>
                      {p.price_hint && <p className="text-2xs text-ink-4">{p.price_hint}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card padding="p-4">
            <CardHeader
              action={
                <Button size="xs" variant="ghost" icon={Users} onClick={() => navigate("/network?tab=connections")}>
                  All connections
                </Button>
              }
            >
              <CardTitle sub="ranked by settled value — open one for the full history">Counterparties</CardTitle>
            </CardHeader>
            {(overview.counterparties || []).length === 0 ? (
              <p className="text-xs text-ink-4 py-4 text-center">No settled counterparties in this window.</p>
            ) : (
              <div className="space-y-2">
                {overview.counterparties.map((c) => (
                  <button
                    key={c.vendor_id}
                    onClick={() => fetchCounterparty(c.vendor_handle, days).catch((e) => toast.error(apiError(e)))}
                    className="w-full flex items-center justify-between gap-3 rounded-lg border border-edge-1 bg-surface-1 px-3 py-2 hover:border-edge-2 hover:bg-surface-2/60 transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-ink-1 truncate">
                        {c.business_name} <span className="font-mono text-ink-4">@{c.vendor_handle}</span>
                      </p>
                      <p className="text-2xs text-ink-4">
                        {c.balance_label} · {c.movements} movements · last {c.last_trade_at ? relativeTime(c.last_trade_at) : "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <ParasitismBadge index={c.parasitism_score} />
                      <span className="text-xs font-mono text-ink-1">{currency(c.trade_value)}</span>
                      <TrendingUp size={13} className="text-ink-4" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      <Drawer
        open={!!counterparty || loadingCounterparty}
        onClose={clearCounterparty}
        title={counterparty ? `@${counterparty.vendor_handle}` : "Counterparty"}
        description={counterparty ? `${counterparty.business_name} · last ${counterparty.days} days` : undefined}
      >
        {loadingCounterparty || !counterparty ? (
          <PageSpinner />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="You sold" value={currency(counterparty.you_sold.value)} hint={`${counterparty.you_sold.movements} movements`} tone="amber" />
              <Stat label="You bought" value={currency(counterparty.you_bought.value)} hint={`${counterparty.you_bought.movements} movements`} tone="blue" />
              <Stat label="Net position" value={currency(counterparty.net_position)} icon={Scale} />
              <Stat label="Pair score" value={Number(counterparty.parasitism_score || 0).toFixed(1)} icon={Activity} hint="parasitism index with them" />
            </div>

            <div>
              <p className="text-2xs uppercase tracking-wider text-ink-4 mb-2">By month</p>
              {counterparty.history.length === 0 ? (
                <p className="text-xs text-ink-4">No settled trade in this window.</p>
              ) : (
                <div className="space-y-1.5">
                  {counterparty.history.map((h) => (
                    <div key={h.period} className="flex items-center justify-between text-xs rounded-lg border border-edge-1 bg-surface-1 px-3 py-1.5">
                      <span className="text-ink-3 font-mono">{shortDate(h.period).replace(/^\d+ /, "")}</span>
                      <span className="font-mono text-ink-1">
                        <span className="text-amber-400">+{currency(h.sold_value)}</span>
                        <span className="text-ink-4"> / </span>
                        <span className="text-blue-400">-{currency(h.bought_value)}</span>
                      </span>
                      <span className="text-2xs text-ink-4">{h.movements} movements</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-2xs uppercase tracking-wider text-ink-4 mb-2">Top items</p>
              {counterparty.top_items.length === 0 ? (
                <p className="text-xs text-ink-4">Nothing yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {counterparty.top_items.map((i) => (
                    <div key={i.name} className="flex items-center justify-between text-xs rounded-lg border border-edge-1 bg-surface-1 px-3 py-1.5">
                      <span className="text-ink-2 truncate">{i.name}</span>
                      <span className="font-mono text-ink-4">{num(i.units)} units · {currency(i.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button size="sm" variant="secondary" icon={MessageSquare} onClick={() => navigate("/chat")}>
              Message them
            </Button>
          </div>
        )}
      </Drawer>
    </div>
  );
}
