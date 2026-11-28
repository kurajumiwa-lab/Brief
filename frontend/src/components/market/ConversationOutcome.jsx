import { useEffect, useState } from "react";
import { apiError, marketOpportunitiesAPI } from "@/lib/api";

/** Sale status is reported by the participants, not evidence of payment or delivery. */
export default function ConversationOutcome({ roomId, revision = 0 }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    setRecord(null); setError("");
    marketOpportunitiesAPI.conversation(roomId).then(({ data }) => { if (live) setRecord(data); })
      .catch((err) => { if (live && err?.response?.status !== 404) setError(apiError(err, "Could not load opportunity status.")); });
    return () => { live = false; };
  }, [roomId, revision, refresh]);
  const confirmed = record?.my_role === "buyer" ? record?.buyer_confirmed : record?.seller_confirmed;
  const both = record?.buyer_confirmed && record?.seller_confirmed;
  const update = async () => {
    setBusy(true); setError("");
    try { const { data } = confirmed ? await marketOpportunitiesAPI.withdrawSale(roomId) : await marketOpportunitiesAPI.confirmSale(roomId); setRecord(data); }
    catch (err) { setError(apiError(err, "Could not update the sale report.")); }
    finally { setBusy(false); }
  };
  if (!record && !error) return null;
  return <section className="border-b border-edge-1 bg-surface-1 px-4 py-3 text-xs" aria-label="Opportunity conversation">
    {record && <><p className="font-bold text-ink-1">Opportunity: {record.title}</p>
      <p className="mt-1 text-ink-3">{both ? "Both participants reported a sale." : confirmed ? "You reported a sale; waiting for the other participant." : record.buyer_confirmed || record.seller_confirmed ? "The other participant reported a sale. Confirm only if it happened." : "No sale reported."} This is not proof of payment or delivery.</p>
      <div className="mt-2 flex flex-wrap gap-4">{record.has_enquiry && <button disabled={busy} onClick={update} className="font-bold text-brand-700">{busy ? "Saving…" : confirmed ? "Withdraw my sale report" : "Report a completed sale"}</button>}<button onClick={() => setRefresh((n) => n + 1)} className="font-semibold text-ink-3">Refresh status</button></div>
    </>}{error && <p role="alert" className="text-danger">{error}</p>}
  </section>;
}
