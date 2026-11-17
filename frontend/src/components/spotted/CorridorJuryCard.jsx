import { useState } from "react";
import { apiError, spottedDealAPI } from "@/lib/api";
import { toast } from "@/components/ui/Toast";

export default function CorridorJuryCard({ assignment, onChanged }) {
  const [busy,setBusy]=useState(false);
  const vote=async decision=>{setBusy(true);try {await spottedDealAPI.vote(assignment.deal_id,decision); await onChanged(); toast.success("Vote recorded");} catch(e){toast.error(apiError(e));} finally {setBusy(false);} };
  return <article className="rounded-xl border border-edge-1 p-4 space-y-3 text-sm"><div className="font-bold">Corridor review · Hidden from public feed</div><div className="flex gap-3"><img src={assignment.deal_image_url} alt="Sale photo" className="w-20 h-20 object-cover rounded"/><div><strong>{assignment.title}</strong><p>{assignment.merchant_name} · {assignment.town}</p><p>{assignment.discount_summary}</p></div></div>
    <div className="rounded bg-surface-2 p-2 text-xs"><p>Parsed QR matched shop record: {assignment.redacted_receipt.merchant_record_matched ? "yes" : "no"}. Issued after request: {assignment.redacted_receipt.issued_after_opt_out ? "yes" : "no"}.</p><p className="mt-2">The parsed receipt is not KRA-verified. It does not prove a transaction occurred or that the advertised discount or banner remains active.</p></div>
    <p className="text-xs">Remove: {assignment.votes.uphold_opt_out}/2 · Restore: {assignment.votes.uphold_deal}/2 · Closes {new Date(assignment.review_deadline).toLocaleString()}</p>
    {assignment.my_decision ? <p>Your vote: {assignment.my_decision === "UPHOLD_DEAL" ? "Restore" : "Remove"}. Hidden until a decision.</p> : <div className="flex gap-2"><button disabled={busy} className="border rounded p-2" onClick={()=>vote("UPHOLD_OPT_OUT")}>Keep removed</button><button disabled={busy} className="bg-brand-700 text-white rounded p-2" onClick={()=>vote("UPHOLD_DEAL")}>Restore listing</button></div>}
  </article>;
}
