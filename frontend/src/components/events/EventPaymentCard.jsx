import { useState } from "react";
import { Copy, ShieldCheck, Users } from "lucide-react";

export default function EventPaymentCard({ event, registration, onBook, onSubmitMpesa }) {
  const [sms, setSms] = useState("");
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const copy = async (value, field) => {
    try { await navigator.clipboard.writeText(value); setCopied(field); }
    catch { setError("Could not copy. Please select the number manually."); }
  };
  const capacity = event.max_vendors;
  const occupied = (event.confirmed_count || 0) + (event.active_holds || 0);
  const full = capacity && occupied >= capacity;
  const state = registration?.booking_status;
  const labels = { TILL: "Buy Goods Till", PAYBILL: "Paybill", POCHI: "Pochi", SEND_MONEY: "Send Money" };
  const cash = event.payment_method === "CASH";
  const priced = Number(event.entry_fee || 0) > 0;
  const blocked = priced && event.payment_ready === false;
  return <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4 space-y-3">
    {capacity > 0 && <div><div className="flex justify-between text-xs font-semibold"><span className="flex gap-1"><Users size={14} />{event.confirmed_count || 0}/{capacity} confirmed</span><span>{full ? `Full · ${event.waitlist_count || 0} waiting` : `${capacity - occupied} spots left`}</span></div><div className="h-2 rounded-full bg-surface-3 mt-2"><div className="h-2 rounded-full bg-brand-700" style={{ width: `${Math.min(100, occupied / capacity * 100)}%` }} /></div><p className="text-xs text-ink-4 mt-1">{event.active_holds || 0} held pending payment</p></div>}
    {cash && <div className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2"><strong>Cash · KSh {event.entry_fee}</strong><p className="mt-1 text-xs text-ink-3">Pay the organiser{event.payment_recipient_name ? ` (${event.payment_recipient_name})` : ""} directly. They mark it received; Wasta does not hold the money.</p></div>}
    {blocked && <p role="alert" className="rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-xs font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">The organiser has set a price but no payment method yet. Booking is closed until they add one.</p>}
    {labels[event.payment_method] && <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700"><strong>M-Pesa {labels[event.payment_method]} · KSh {event.entry_fee}</strong><div className="flex justify-between items-center mt-2"><span>{event.payment_number} · {event.payment_recipient_name}</span><button type="button" onClick={() => copy(event.payment_number, "number")}><Copy size={15} /> {copied === "number" ? "Copied" : "Copy"}</button></div>{event.payment_method === "PAYBILL" && event.payment_account && <div>Account: {event.payment_account} <button type="button" onClick={() => copy(event.payment_account, "account")} className="underline">{copied === "account" ? "Copied" : "Copy"}</button></div>}</div>}
    {(!registration || ["EXPIRED", "CANCELLED"].includes(state)) && <button type="button" onClick={onBook} disabled={blocked} className="w-full rounded-xl bg-brand-700 p-3 text-white font-semibold disabled:opacity-40">{blocked ? "Booking closed" : full ? "Join waiting list" : "Reserve spot"}</button>}
    {state === "PENDING_PAYMENT" && cash && <div className="space-y-2"><p className="text-xs text-ink-3">Spot held until {registration.hold_expires_at ? new Date(registration.hold_expires_at + "Z").toLocaleString() : "expiry"}. Pay KSh {event.entry_fee} in cash to the organiser; they will mark it received.</p></div>}
    {state === "PENDING_PAYMENT" && !cash && <div className="space-y-2"><p className="text-xs text-ink-3">Spot held until {registration.hold_expires_at ? new Date(registration.hold_expires_at + "Z").toLocaleString() : "expiry"}. Paste your M-Pesa SMS or code. This is a user-declared note, not verified proof.</p><textarea aria-label="M-Pesa message" value={sms} onChange={e => setSms(e.target.value)} className="w-full rounded-xl border border-edge-1 p-2 text-sm" /><button type="button" disabled={!sms.trim()} onClick={() => onSubmitMpesa(sms)} className="rounded-xl bg-brand-700 px-4 py-2 text-white disabled:opacity-40">Submit note</button></div>}
    {state === "PAYMENT_SUBMITTED" && <p className="text-sm">Payment noted ({registration.mpesa_code}). Waiting for the organiser to confirm.</p>}
    {state === "WAITLISTED" && <p className="text-sm">You are #{registration.waitlist_position} on the waiting list. We'll notify you if a spot opens.</p>}
    {state === "CONFIRMED" && <p className="flex gap-2 text-brand-700 text-sm"><ShieldCheck size={16} /> Confirmed · <a href="/inbox" className="underline">Open pass</a></p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
