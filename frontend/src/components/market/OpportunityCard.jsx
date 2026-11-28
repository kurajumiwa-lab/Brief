import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiError, chatAPI } from "@/lib/api";

export default function OpportunityCard({ item, onClose }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enquiry = async () => {
    setBusy(true); setError("");
    try {
      const { data } = await chatAPI.directRoom(item.seller.id);
      navigate(`/chat?room=${encodeURIComponent(data.room_id)}`);
    } catch (err) { setError(apiError(err, "Could not open the conversation. Try again.")); }
    finally { setBusy(false); }
  };
  const date = new Date(item.updated_at);
  return <article className="rounded-2xl border border-edge-1 bg-surface-1 p-4 space-y-2" data-testid="market-opportunity-card">
    <p className="text-2xs font-bold uppercase tracking-wide text-brand-700">Market opportunity · Seller-reported</p>
    <h3 className="text-base font-extrabold text-ink-1">{item.title}</h3>
    <p className="text-sm text-ink-2">{item.location} · {Number(item.quantity).toLocaleString()} × {item.unit}</p>
    <p className="font-bold text-ink-1">KSh {Number(item.price_kes).toLocaleString()} <span className="text-xs font-normal text-ink-3">per {item.unit} · asking price</span></p>
    <p className="text-xs text-ink-3">Source: <Link className="underline" to={`/p/${encodeURIComponent(item.seller.handle)}`}>{item.seller.name || `@${item.seller.handle}`}</Link> · Updated {Number.isNaN(date.valueOf()) ? "unknown" : date.toLocaleString()}</p>
    <p className="text-2xs text-ink-4">Seller quote, not independently verified. Confirm availability and price.</p>
    {item.is_owner ? <button type="button" onClick={() => onClose?.(item.id)} className="text-sm font-bold text-brand-700">Close opportunity</button> : <button type="button" disabled={busy} onClick={enquiry} className="text-sm font-bold text-brand-700">{busy ? "Opening conversation…" : "Enquire in chat →"}</button>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </article>;
}
