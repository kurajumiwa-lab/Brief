import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { useChatStore } from "@/stores/chatStore";
import { campaignsAPI, apiError } from "@/lib/api";

const blank = { title: "", brief: "", location: "", budget_kes: "" };
const money = (n) => `KES ${Number(n).toLocaleString("en-KE")}`;

export default function CampaignMarketplacePage() {
  const navigate = useNavigate();
  const openDirect = useChatStore((s) => s.openDirect);
  const [campaigns, setCampaigns] = useState([]);
  const [mine, setMine] = useState([]);
  const [offset, setOffset] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(blank);
  const [offer, setOffer] = useState({ message: "", price_kes: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const [browse, sent] = await Promise.all([campaignsAPI.browse(), campaignsAPI.myOffers()]);
    setCampaigns(browse.data.items); setOffset(browse.data.next_offset); setMine(sent.data.items);
  }, []);
  useEffect(() => { let live = true; load().catch((e) => live && setError(apiError(e, "Could not load campaigns"))).finally(() => live && setLoading(false)); return () => { live = false; }; }, [load]);
  async function show(id) {
    setError("");
    try { const { data } = await campaignsAPI.detail(id); setSelected(data); setOffer({ message: "", price_kes: "" }); }
    catch (e) { setError(apiError(e, "Could not load this campaign")); }
  }
  async function perform(action, success) {
    if (busy) return;
    setBusy(true); setError("");
    let completed = false;
    try { await action(); completed = true; await load(); if (success) await success(); }
    catch (e) { setError(completed ? "Action saved, but the page could not refresh. Reload to see the latest state." : apiError(e, "Action could not be confirmed. Reload to check its status before retrying.")); }
    finally { setBusy(false); }
  }
  const current = selected?.campaign;
  return <main className="mx-auto max-w-3xl space-y-5 p-4">
    <header><h1 className="text-2xl font-bold">Marketing marketplace</h1><p className="mt-1 text-sm text-ink-3">Post a campaign or offer your services. No event is required. Reach claims are self-reported; payment and delivery are agreed directly.</p><Link className="text-sm underline" to="/rate-card">Create or edit your public rate card</Link></header>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <Card className="space-y-3 p-4"><h2 className="font-bold">Post a campaign</h2><p className="text-xs text-ink-3">Your brief and budget are visible to signed-in members. Do not include private information.</p>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); perform(async () => { const { data } = await campaignsAPI.create({ ...form, budget_kes: Number(form.budget_kes) }); setForm(blank); await show(data.id); }); }}>
        <Input label="Campaign title" required maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Textarea label="What do you need?" required maxLength={2000} value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} />
        <Input label="Location or online" required maxLength={160} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        <Input label="Budget (KES)" type="number" required min="1" max="100000000" step="1" value={form.budget_kes} onChange={(e) => setForm({ ...form, budget_kes: e.target.value })} />
        <Button type="submit" disabled={busy}>Post campaign</Button>
      </form></Card>
    <Card className="space-y-3 p-4"><h2 className="font-bold">Campaigns</h2>{loading ? <p role="status">Loading…</p> : campaigns.length === 0 ? <p className="text-sm">No campaigns yet.</p> : <ul className="space-y-2">{campaigns.map((item) => <li key={item.id} className="rounded-xl border border-edge-1 p-3"><button type="button" onClick={() => show(item.id)} className="font-bold underline">{item.title}</button><p className="text-sm text-ink-3">{item.location} · Budget {money(item.budget_kes)} · {item.status}{item.is_owner ? " · Yours" : ` · ${item.owner.name}`}</p></li>)}</ul>}
      {offset !== null && <Button type="button" variant="secondary" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const { data } = await campaignsAPI.browse(offset); setCampaigns((old) => [...old, ...data.items]); setOffset(data.next_offset); } catch (e) { setError(apiError(e, "Could not load more campaigns")); } finally { setBusy(false); } }}>Load more</Button>}
    </Card>
    {mine.length > 0 && <Card className="space-y-2 p-4"><h2 className="font-bold">My offers</h2><ul>{mine.map(({ campaign, offer: item }) => <li key={item.id} className="text-sm"><button type="button" className="underline" onClick={() => show(campaign.id)}>{campaign.title}</button> · {item.status} · {money(item.price_kes)}</li>)}</ul></Card>}
    {current && <Card className="space-y-3 p-4"><h2 className="text-xl font-bold">{current.title}</h2><p className="whitespace-pre-line text-sm">{current.brief}</p><p className="text-sm">{current.location} · Budget {money(current.budget_kes)} · {current.status}</p><p className="text-sm">Posted by <Link className="underline" to={`/p/${encodeURIComponent(current.owner.handle)}`}>{current.owner.name}</Link></p>
      {current.is_owner && <><h3 className="font-bold">Private offers</h3>{selected.offers.length === 0 && <p className="text-sm">No offers yet.</p>}{selected.offers.map((item) => <div key={item.id} className="rounded-xl border border-edge-1 p-3 text-sm"><p><Link className="underline" to={`/rate-card/${encodeURIComponent(item.vendor.handle)}`}>{item.vendor.name} · rate card</Link> · {money(item.price_kes)} · {item.status}</p><p className="whitespace-pre-line">{item.message}</p><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => perform(async () => navigate(`/chat?room=${await openDirect(item.vendor.id)}`))}>Message creator</Button>{current.status === "open" && item.status === "submitted" && <Button type="button" size="sm" disabled={busy} onClick={() => { if (window.confirm("Accept this offer? This closes the campaign. Payment and delivery must be agreed directly.")) perform(() => campaignsAPI.action(current.id, item.id, "accept"), () => show(current.id)); }}>Accept offer</Button>}</div>)}{current.status === "open" && <Button type="button" variant="secondary" disabled={busy} onClick={() => { if (window.confirm("Close this campaign without choosing an offer?")) perform(() => campaignsAPI.close(current.id), () => show(current.id)); }}>Close campaign</Button>}</>}
      {!current.is_owner && selected.offers.length > 0 && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => perform(async () => navigate(`/chat?room=${await openDirect(current.owner.id)}`))}>Message campaign owner</Button>}
      {!current.is_owner && selected.offers.length > 0 && selected.offers.map((item) => <div key={item.id} className="text-sm"><p>Your offer: {money(item.price_kes)} · {item.status}</p><p className="whitespace-pre-line">{item.message}</p><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => perform(async () => navigate(`/chat?room=${await openDirect(item.vendor.id)}`))}>Message creator</Button>{current.status === "open" && item.status === "submitted" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => perform(() => campaignsAPI.action(current.id, item.id, "withdraw"), () => show(current.id))}>Withdraw offer</Button>}</div>)}
      {!current.is_owner && current.status === "open" && selected.offers.length === 0 && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); perform(() => campaignsAPI.offer(current.id, { message: offer.message, price_kes: Number(offer.price_kes) }), () => show(current.id)); }}><h3 className="font-bold">Send a private offer</h3><Textarea label="Proposal and deliverables" required maxLength={2000} value={offer.message} onChange={(e) => setOffer({ ...offer, message: e.target.value })} /><Input label="Your price (KES)" type="number" min="1" max="100000000" step="1" required value={offer.price_kes} onChange={(e) => setOffer({ ...offer, price_kes: e.target.value })} /><Button type="submit" disabled={busy}>Send offer</Button></form>}
      <p className="text-xs text-ink-3">Accepting an offer records a selection, not a payment, completed delivery or verified reach. Contact the other party to agree details.</p>
    </Card>}
  </main>;
}
