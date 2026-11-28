import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import OpportunityCard from "@/components/market/OpportunityCard";
import { apiError, marketOpportunitiesAPI } from "@/lib/api";

const empty = { title: "", location: "", quantity: "", unit: "", price_kes: "" };
const fields = [
  ["title", "Opportunity", "Beans available"], ["location", "Market or town", "Busia"],
  ["quantity", "Quantity available", "100"], ["unit", "Unit (what the price buys)", "90 kg bag"],
  ["price_kes", "Asking price per unit (KSh)", "5000"],
];

export default function MarketOpportunitiesPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "mine" ? "mine" : "browse";
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("");
  const [search, setSearch] = useState({ q: "", market: "" });
  const [offset, setOffset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [renewing, setRenewing] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [metricsError, setMetricsError] = useState(false);
  useEffect(() => {
    if (view !== "mine") return;
    let live = true; setMetricsError(false); setMetrics(null);
    marketOpportunitiesAPI.metrics().then(({ data }) => { if (live) setMetrics(data.items); }).catch(() => { if (live) setMetricsError(true); });
    return () => { live = false; };
  }, [view]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data } = view === "mine" ? await marketOpportunitiesAPI.mine() : await marketOpportunitiesAPI.list(search);
      setItems(data.items); setOffset(data.next_offset);
    } catch (err) { setError(apiError(err, "Couldn't load opportunities. Try again.")); }
    finally { setLoading(false); }
  }, [view, search]);
  useEffect(() => { let live = true; setLoading(true); setItems([]); setError("");
    (view === "mine" ? marketOpportunitiesAPI.mine() : marketOpportunitiesAPI.list(search))
      .then(({ data }) => { if (live) { setItems(data.items); setOffset(data.next_offset); } })
      .catch((err) => { if (live) setError(apiError(err, "Couldn't load opportunities. Try again.")); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [view, search]);
  const publish = async (event) => {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try {
      const { data } = editing ? await marketOpportunitiesAPI.edit(editing.id, form) : await marketOpportunitiesAPI.create(form);
      setForm(empty); setEditing(null);
      setNotice(data.visible_to_others ? "Saved. Your quote is visible to others for seven days." : "Saved, but hidden from others. Check its status and your Page discovery setting.");
      if (view !== "mine") setParams({ view: "mine" }); else await load();
    } catch (err) { setError(apiError(err, "Couldn't save. Check the fields and try again.")); }
    finally { setSaving(false); }
  };
  const edit = (item) => { setEditing(item); setForm(Object.fromEntries(Object.keys(empty).map((key) => [key, String(item[key])] ))); setNotice(""); document.getElementById("opportunity-form")?.scrollIntoView?.({ behavior: "smooth" }); };
  const status = async (item, next) => {
    setError("");
    try { const { data } = await marketOpportunitiesAPI.status(item.id, next); setItems((rows) => rows.map((row) => row.id === item.id ? data : row)); setNotice(`Marked ${next}. The price confirmation date has not changed.`); }
    catch (err) { setError(apiError(err, "Couldn't change availability.")); }
  };
  const renew = async () => {
    setSaving(true); setError("");
    try { const { data } = await marketOpportunitiesAPI.renew(renewing.id); setItems((rows) => rows.map((row) => row.id === data.id ? data : row)); setRenewing(null); setNotice(data.visible_to_others ? "Confirmed and renewed for seven days." : "Renewed, but your Page is hidden from discovery."); }
    catch (err) { setError(apiError(err, "Couldn't renew. Try again.")); }
    finally { setSaving(false); }
  };
  const more = async () => {
    setLoading(true); setError("");
    try { const { data } = view === "mine" ? await marketOpportunitiesAPI.mine({ offset }) : await marketOpportunitiesAPI.list({ ...search, offset }); setItems((old) => [...old, ...data.items]); setOffset(data.next_offset); }
    catch (err) { setError(apiError(err, "Couldn't load more.")); } finally { setLoading(false); }
  };
  return <main className="mx-auto max-w-2xl space-y-6 pb-10">
    <header><Link to="/" className="text-xs font-bold text-brand-700">← Home</Link><p className="ds-eyebrow mt-4">Market watch</p><h1 className="ds-display mt-1">Market opportunities</h1><p className="mt-2 text-sm text-ink-3">Recent seller quotes to help you decide where to enquire. Prices and availability are not independently verified.</p></header>
    <section id="opportunity-form" className="rounded-2xl border border-edge-1 bg-surface-1 p-4"><h2 className="text-lg font-bold">{editing ? "Edit opportunity" : "Publish an opportunity"}</h2><p className="mt-1 text-xs text-ink-3">You are the seller and contact. Your name and Page will be shown to others if your Page is discoverable. Quotes expire from discovery after seven days. Saving confirms the details are current.</p>
      <form onSubmit={publish} className="mt-4 grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label, placeholder]) => <label key={key} className="text-xs font-bold text-ink-2">{label}<input required type={key === "quantity" || key === "price_kes" ? "number" : "text"} min={key === "quantity" || key === "price_kes" ? "0.01" : undefined} step={key === "quantity" || key === "price_kes" ? "0.01" : undefined} maxLength={key === "unit" ? 100 : 160} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} className="mt-1 block w-full rounded-xl border border-edge-2 bg-surface-0 px-3 py-2 text-sm text-ink-1" /></label>)}
        <button disabled={saving} className="self-end rounded-xl bg-brand-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{saving ? "Saving…" : editing ? "Save and confirm details" : "Publish opportunity"}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setForm(empty); }} className="text-sm font-bold text-ink-3">Cancel editing</button>}
      </form>
    </section>
    {notice && <p role="status" className="text-sm text-brand-700">{notice}</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {renewing && <section aria-label="Confirm renewal" className="rounded-xl border border-edge-2 p-4 space-y-2"><p className="text-sm font-semibold">Is {renewing.title} still available in {renewing.location}, with {Number(renewing.quantity).toLocaleString()} × {renewing.unit} at KSh {Number(renewing.price_kes).toLocaleString()} per {renewing.unit}?</p><p className="text-xs text-ink-3">Confirmation makes it available for seven more days. Edit first if the details changed.</p><div className="flex gap-4"><button disabled={saving} onClick={renew} className="text-sm font-bold text-brand-700">Yes, confirm and renew</button><button onClick={() => setRenewing(null)} className="text-sm font-bold">Cancel</button></div></section>}
    <section className="space-y-3"><div className="flex gap-3"><button aria-pressed={view === "browse"} onClick={() => setParams({})} className="text-sm font-bold text-brand-700">Browse opportunities</button><button aria-pressed={view === "mine"} onClick={() => setParams({ view: "mine" })} className="text-sm font-bold text-brand-700">My opportunities</button></div>
      <h2 className="text-lg font-bold">{view === "mine" ? "My opportunities" : "Recent opportunities"}</h2><p className="text-xs text-ink-3">{view === "mine" ? "Manage active, expired and unavailable quotes." : "Showing active seller quotes from the last seven days."}</p>
      {view === "browse" && <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setSearch({ q: query.trim(), market: market.trim() }); }}><label className="sr-only" htmlFor="market-search">Search by product or town</label><input id="market-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search product or town" className="min-w-0 flex-1 rounded-xl border border-edge-2 bg-surface-0 px-3 py-2 text-sm"/><label className="sr-only" htmlFor="market-filter">Filter by market or town</label><input id="market-filter" value={market} onChange={(e) => setMarket(e.target.value)} placeholder="Market or town" className="min-w-0 flex-1 rounded-xl border border-edge-2 bg-surface-0 px-3 py-2 text-sm"/><button className="rounded-xl border border-edge-2 px-4 text-sm font-bold">Search</button></form>}
      {loading && !items.length ? <p className="text-sm text-ink-3">Loading opportunities…</p> : !items.length && !error ? <p className="text-sm text-ink-3">No opportunities found. {view === "browse" ? "Try another search or publish the first one." : "Publish one above."}</p> : null}
      {view === "mine" && <p className="text-xs text-ink-3">Conversation counts are private to you. Sales are reported by both participants, not verified payments.</p>}
      {view === "mine" && metricsError && <p role="alert" className="text-xs text-danger">Conversation metrics could not be loaded.</p>}
      {items.map((item) => <div key={item.id}><OpportunityCard item={item} onEdit={edit} onRenew={setRenewing} onStatus={status} />
        {view === "mine" && metrics && (() => { const m = metrics.find((x) => x.opportunity_id === item.id) || {}; return <p className="px-2 py-2 text-xs text-ink-3">{m.enquiries || 0} sent enquiries · {m.replies || 0} replied · {m.confirmed_sales || 0} mutually reported sales · {m.messages || 0} messages</p>; })()}
      </div>)}
      {offset !== null && <button disabled={loading} onClick={more} className="text-sm font-bold text-brand-700">{loading ? "Loading…" : "Load more"}</button>}
    </section>
  </main>;
}
