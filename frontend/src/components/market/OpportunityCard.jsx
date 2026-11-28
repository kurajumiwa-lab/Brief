import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiError, marketOpportunitiesAPI } from "@/lib/api";

export function enquiryDraft(item) {
  return `Hello, I saw your offer: ${item.title} in ${item.location}, ${Number(item.quantity).toLocaleString()} × ${item.unit}, at KSh ${Number(item.price_kes).toLocaleString()} per ${item.unit}. Is it still available?`;
}

export default function OpportunityCard({ item, onEdit, onRenew, onStatus }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enquiry = async () => {
    setBusy(true); setError("");
    try {
      // Recheck availability server-side; draft uses the current quote, not a stale card snapshot.
      const { data } = await marketOpportunitiesAPI.enquiry(item.id);
      navigate(`/chat?room=${encodeURIComponent(data.room_id)}`, { state: { opportunityDraft: { roomId: data.room_id, text: enquiryDraft(data.opportunity) } } });
    } catch (err) { setError(apiError(err, "Could not open the conversation. Try again.")); }
    finally { setBusy(false); }
  };
  const date = new Date(item.updated_at);
  const status = item.status || "available";
  return <article className="rounded-2xl border border-edge-1 bg-surface-1 p-4 space-y-2" data-testid="market-opportunity-card">
    <p className="text-2xs font-bold uppercase tracking-wide text-brand-700">Market opportunity · Seller-reported</p>
    <h3 className="text-base font-extrabold text-ink-1">{item.title}</h3>
    <p className="text-sm text-ink-2">{item.location} · {Number(item.quantity).toLocaleString()} × {item.unit}</p>
    <p className="font-bold text-ink-1">KSh {Number(item.price_kes).toLocaleString()} <span className="text-xs font-normal text-ink-3">per {item.unit} · asking price</span></p>
    <p className="text-xs text-ink-3">Source: <Link className="underline" to={`/p/${encodeURIComponent(item.seller.handle)}`}>{item.seller.name || `@${item.seller.handle}`}</Link> · Updated {Number.isNaN(date.valueOf()) ? "unknown" : date.toLocaleString()}</p>
    <p className="text-xs font-semibold text-ink-3">{status === "reserved" ? "Reserved" : status === "unavailable" ? "Unavailable" : "Available"}{item.stale ? " · Expired" : ""}{item.is_owner && item.visible_to_others === false ? " · Hidden from other users" : ""}</p>
    <p className="text-2xs text-ink-4">Seller quote, not independently verified. Confirm availability and price.{item.is_owner && item.expires_at && !item.stale ? ` Expires ${new Date(item.expires_at).toLocaleString()}.` : ""}</p>
    {item.is_owner ? <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-bold text-brand-700">
      <button type="button" onClick={() => onEdit ? onEdit(item) : navigate("/market-opportunities?view=mine")}>Edit</button>
      <button type="button" onClick={() => onRenew ? onRenew(item) : navigate("/market-opportunities?view=mine")}>Confirm & renew</button>
      {status !== "unavailable" && <button type="button" onClick={() => onStatus ? onStatus(item, status === "reserved" ? "available" : "reserved") : navigate("/market-opportunities?view=mine")}>{status === "reserved" ? "Mark available" : "Mark reserved"}</button>}
      {status !== "unavailable" && <button type="button" onClick={() => onStatus ? onStatus(item, "unavailable") : navigate("/market-opportunities?view=mine")}>Mark unavailable</button>}
    </div> : <button type="button" disabled={busy || status !== "available" || item.stale} onClick={enquiry} className="text-sm font-bold text-brand-700 disabled:opacity-50">{busy ? "Opening conversation…" : status === "reserved" ? "Reserved — enquiries unavailable" : "Enquire in chat →"}</button>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </article>;
}
