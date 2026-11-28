import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import OpportunityCard from "@/components/market/OpportunityCard";
import { marketOpportunitiesAPI } from "@/lib/api";

export default function MarketBriefing() {
  const [state, setState] = useState({ status: "loading", items: [] });
  useEffect(() => {
    let active = true;
    marketOpportunitiesAPI.list({ limit: 3 }).then(({ data }) => {
      if (active) setState({ status: "ready", items: data.items });
    }).catch(() => { if (active) setState({ status: "error", items: [] }); });
    return () => { active = false; };
  }, []);
  return <section className="space-y-3" aria-labelledby="market-brief-heading">
    <div className="flex items-end justify-between gap-3"><div><p className="ds-eyebrow">Your business world, updated</p><h2 id="market-brief-heading" className="text-xl font-extrabold text-ink-1">Today’s briefing</h2><p className="text-xs text-ink-3">Recent opportunities across the network.</p></div><Link to="/market-opportunities" className="shrink-0 text-xs font-bold text-brand-700">View market watch →</Link></div>
    {state.status === "loading" && <p className="text-sm text-ink-3">Loading market watch…</p>}
    {state.status === "error" && <p className="text-sm text-ink-3">Market watch is unavailable. <Link className="underline" to="/market-opportunities">Try again</Link>.</p>}
    {state.status === "ready" && !state.items.length && <div className="rounded-xl border border-edge-1 p-4 text-sm text-ink-3">No recent opportunities yet. <Link className="font-bold text-brand-700" to="/market-opportunities">Publish a seller quote →</Link></div>}
    {state.items.map((item) => <OpportunityCard key={item.id} item={item} />)}
  </section>;
}
