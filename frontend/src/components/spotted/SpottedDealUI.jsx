import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Modal from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { receiptsAPI } from "@/lib/receiptsApi";
import { apiError, fileAPI, spottedDealAPI } from "@/lib/api";

export function SpottedDealCard({ deal, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState("");
  const [value, setValue] = useState("");
  const [all, setAll] = useState(false);
  const [receipts, setReceipts] = useState([]);
  useEffect(() => { if (open === "receipt") receiptsAPI.ledger().then(r => setReceipts(r.data.receipts || [])).catch(e => toast.error(apiError(e))); }, [open]);
  const act = async (fn) => { setBusy(true); try { await fn(); setOpen(""); await onChanged(); toast.success("Updated"); } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); } };
  return <article className="h-full overflow-hidden rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/20 text-ink-1">
    <div className="relative aspect-[4/3] bg-surface-2"><img src={deal.image_url} alt="Shopfront or sale" className="w-full h-full object-cover" loading="lazy" /><span className="absolute left-2 top-2 rounded bg-amber-400 p-1 text-[10px] font-bold text-stone-950">Spotted in Town • Public Sale</span></div>
    <div className="p-3 space-y-2"><h3 className="text-sm font-bold">{deal.title}</h3><p className="text-xs text-ink-3">{deal.merchant_name} · {deal.town}</p>{deal.discount_summary && <p className="text-xs font-semibold">{deal.discount_summary}</p>}
      {deal.status === "RECEIPT_LINKED" && <p className="text-xs text-brand-700 font-bold">Parsed Receipt Linked</p>}
      <p className="text-[11px] text-ink-3">{deal.status === "RECEIPT_LINKED" ? "A separate shopper scanned a parsed receipt for this shop after this post. Not KRA-verified; awards no standing credit. It does not verify the discount." : "Seen in store is an unverified neighbour tap, not proof or standing credit."}</p>
      <p className="text-[11px] text-ink-4">Ends {new Date(deal.expires_at).toLocaleString()}</p>
      <div className="flex flex-wrap gap-2 text-xs"><button disabled={busy || deal.user_has_seen} onClick={() => act(() => spottedDealAPI.seen(deal.id))} className="underline">Seen in store ({deal.seen_in_store_count})</button>{deal.status === "LIVE_UNVERIFIED" && <button onClick={() => setOpen("receipt")} className="underline">Link receipt</button>}<button onClick={() => setOpen("flag")} className="underline">Flag</button><button onClick={() => setOpen("shop")} className="underline">Shop owner?</button></div>
    </div>
    <Modal open={Boolean(open)} onClose={() => setOpen("")} title={open === "shop" ? "Manage this listing" : open === "flag" ? "Report this sale" : "Link a parsed receipt"}>
      {open === "receipt" && <div className="space-y-3 text-sm"><p>Use a receipt you scanned after this sale was posted. A parsed QR is not KRA verification and awards no standing.</p><label className="block">Your parsed receipt<select className="w-full rounded border p-2" value={value} onChange={e=>setValue(e.target.value)}><option value="">Select a receipt</option>{receipts.filter(r=>r.source === "qr" && r.status === "verified").map(r=><option key={r.id} value={r.id}>{r.merchant_name} · {r.issued_at ? new Date(r.issued_at).toLocaleDateString() : "date unavailable"}</option>)}</select></label><Link to="/receipts" className="underline">Find or scan a receipt</Link><button disabled={!value.trim() || busy} className="block rounded bg-brand-700 p-2 text-white disabled:opacity-50" onClick={() => act(() => spottedDealAPI.link(deal.id,value.trim()))}>Link receipt</button></div>}
      {open === "flag" && <div className="space-y-2 text-sm"><p>Only eligible members can report misleading listings.</p>{[["DEAL_ENDED","Deal ended"],["FALSE_PRICE","Wrong price"],["WRONG_SHOP","Wrong shop"],["SPAM","Spam"]].map(([type,label])=><button key={type} disabled={busy} className="block rounded border border-edge-1 p-2 w-full text-left" onClick={() => act(() => spottedDealAPI.flag(deal.id,type))}>{label}</button>)}</div>}
      {open === "shop" && <div className="space-y-3 text-sm"><p>Shop representatives can request immediate hiding. Claimed owners may also block future spotted sales.</p><Link to={deal.claim_url} className="block underline">Claim this shop</Link><label className="block"><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)} /> Block future spotted sales (claimed owners only)</label><button disabled={busy} className="rounded border border-rose-300 p-2 text-rose-700" onClick={() => act(() => spottedDealAPI.optOut(deal.id,{opt_out_all_future:all}))}>Remove / request removal</button></div>}
    </Modal>
  </article>;
}

export function SpotDealModal({ region, open, onClose, onCreated }) {
  const [shops,setShops]=useState([]); const [form,setForm]=useState({merchant_id:"",town:"",title:"",discount_summary:""}); const [file,setFile]=useState(null); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  useEffect(()=>{ if(open) spottedDealAPI.shops(region).then(r=>setShops(r.data)).catch(e=>setError(apiError(e))); },[open,region]);
  const submit=async e=>{ e.preventDefault(); setBusy(true); try { const uploaded=await fileAPI.upload(file); await spottedDealAPI.create({...form,region_slug:region,image_url:uploaded.data.url,capture_signals:{capture_mode:"camera_or_upload",client_submitted_at:new Date().toISOString()}}); toast.success("Spotted sale posted"); onClose(); await onCreated(); } catch(err) { setError(apiError(err)); } finally { setBusy(false); } };
  return <Modal open={open} onClose={onClose} title="Spot a window sale"><form onSubmit={submit} className="space-y-3 text-sm">
    <p>Public sale • expires in 72 hours. Photo and receipt signals are unverified and award no standing.</p>{error && <p role="alert" className="text-rose-700">{error}</p>}
    <label className="block">Shop<select required value={form.merchant_id} onChange={e=>setForm({...form,merchant_id:e.target.value})} className="w-full border rounded p-2"><option value="">Select a shop</option>{shops.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {!shops.length && <p>No shop records found in this region yet. A shop must have a receipt record before a sale can be posted.</p>}
    {[["town","Town",64],["title","Offer headline",140],["discount_summary","Discount summary",80]].map(([key,label,max])=><label key={key} className="block">{label}<input required={key!=="discount_summary"} maxLength={max} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} className="w-full border rounded p-2" /></label>)}
    <label className="block">Take shopfront photo<input type="file" accept="image/*" capture="environment" onChange={e=>setFile(e.target.files?.[0] || null)} className="block w-full" /></label><label className="block">Or upload an existing photo<input type="file" accept="image/*" onChange={e=>setFile(e.target.files?.[0] || null)} className="block w-full" /></label><p className="text-xs">Capture source and timing cannot be verified.</p><button disabled={busy || !file || !form.merchant_id} className="rounded bg-brand-700 p-2 text-white disabled:opacity-50">Publish spotted sale</button>
  </form></Modal>;
}
