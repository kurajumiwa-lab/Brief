import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import OpportunityCard from "@/components/market/OpportunityCard";
import { apiError, marketOpportunitiesAPI } from "@/lib/api";

const empty = { title: "", location: "", quantity: "", unit: "", price_kes: "" };
const fields = [
  ["title", "Opportunity", "Beans available"], ["location", "Market or town", "Busia"],
  ["quantity", "Quantity available", "100"], ["unit", "Unit (what the price buys)", "90 kg bag"],
  ["price_kes", "Asking price per unit (KSh)", "5000"],
];

export default function MarketOpportunitiesPage() {
  const [form, setForm] = useState(empty);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const { data } = await marketOpportunitiesAPI.list({ q: search }); setItems(data.items); setOffset(data.next_offset); }
    catch (err) { setError(apiError(err, "Couldn't load opportunities. Try again.")); }
    finally { setLoading(false); }
  }, [search]);
  useEffect(() => { load(); }, [load]);
  const publish = async (event) => {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try {
      await marketOpportunitiesAPI.create(form); setForm(empty); setNotice("Published. Your quote will appear for up to seven days, unless you close it.");
      if (search) { setSearch(""); setQuery(""); } else await load();
    } catch (err) { setError(apiError(err, "Couldn't publish. Check the fields and try again.")); }
    finally { setSaving(false); }
  };
  const close = async (id) => {
    try { await marketOpportunitiesAPI.close(id); setItems((rows) => rows.filter((row) => row.id !== id)); setNotice("Opportunity closed."); }
    catch (err) { setError(apiError(err, "Couldn't close this opportunity.")); }
  };
  const more = async () => {
    setLoading(true);
    try { const { data } = await marketOpportunitiesAPI.list({ q: search, offset }); setItems((old) => [...old, ...data.items]); setOffset(data.next_offset); }
    catch (err) { setError(apiError(err, "Couldn't load more.")); } finally { setLoading(false); }
  };
  return <main className="mx-auto max-w-2xl space-y-6 pb-10">
    <header><Link to="/" className="text-xs font-bold text-brand-700">← Home</Link><p className="ds-eyebrow mt-4">Market watch</p><h1 className="ds-display mt-1">Market opportunities</h1><p className="mt-2 text-sm text-ink-3">Recent seller quotes to help you decide where to enquire. Prices and availability are not independently verified.</p></header>
    <section className="rounded-2xl border border-edge-1 bg-surface-1 p-4"><h2 className="text-lg font-bold">Publish an opportunity</h2><p className="mt-1 text-xs text-ink-3">You are the seller and contact. Your name and Page will be shown to others if your Page is discoverable. Quotes disappear from discovery after seven days.</p>
      <form onSubmit={publish} className="mt-4 grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label, placeholder]) => <label key={key} className="text-xs font-bold text-ink-2">{label}<input required type={key === "quantity" || key === "price_kes" ? "number" : "text"} min={key === "quantity" || key === "price_kes" ? "0.01" : undefined} step={key === "quantity" || key === "price_kes" ? "0.01" : undefined} maxLength={key === "unit" ? 100 : 160} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} className="mt-1 block w-full rounded-xl border border-edge-2 bg-surface-0 px-3 py-2 text-sm text-ink-1" /></label>)}
        <button disabled={saving} className="self-end rounded-xl bg-brand-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{saving ? "Publishing…" : "Publish opportunity"}</button>
      </form>
    </section>
    {notice && <p role="status" className="text-sm text-brand-700">{notice}</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <section className="space-y-3"><div><h2 className="text-lg font-bold">Recent opportunities</h2><p className="text-xs text-ink-3">Showing active seller quotes from the last seven days.</p></div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); }}><label className="sr-only" htmlFor="market-search">Search by product or town</label><input id="market-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search product or town" className="min-w-0 flex-1 rounded-xl border border-edge-2 bg-surface-0 px-3 py-2 text-sm"/><button className="rounded-xl border border-edge-2 px-4 text-sm font-bold">Search</button></form>
      {loading && !items.length ? <p className="text-sm text-ink-3">Loading opportunities…</p> : !items.length && !error ? <p className="text-sm text-ink-3">No opportunities found. Try another search or publish the first one.</p> : null}
      {items.map((item) => <OpportunityCard key={item.id} item={item} onClose={close} />)}
      {offset !== null && <button disabled={loading} onClick={more} className="text-sm font-bold text-brand-700">{loading ? "Loading…" : "Load more"}</button>}
    </section>
  </main>;
}
