import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MapPin, RefreshCw, Truck } from "lucide-react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { apiError, ordersAPI } from "@/lib/api";
import { num, parseApiDate } from "@/lib/formatters";
import { titleCase } from "@/lib/utils";

export default function DeliveryQuoteInbox() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [quotes, setQuotes] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await ordersAPI.deliveryInbox();
      setRequests(data || []);
    } catch (err) {
      setError(apiError(err, "Delivery quote requests could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateQuote = (id, patch) => setQuotes((current) => ({
    ...current,
    [id]: { price_ksh: "", eta_text: "", note: "", ...current[id], ...patch },
  }));

  const submit = async (event, request) => {
    event.preventDefault();
    const form = quotes[request.id] || {};
    const price = Number(form.price_ksh);
    if (!Number.isSafeInteger(price) || price < 0) {
      toast.error("Enter the whole-KES delivery amount you can honour.");
      return;
    }
    setBusy(request.id);
    try {
      await ordersAPI.answerDeliveryQuote(request.id, {
        price_ksh: price,
        eta_text: form.eta_text?.trim() || null,
        note: form.note?.trim() || null,
      });
      toast.success("Quote sent to the customer");
      setRequests((current) => current.filter((row) => row.id !== request.id));
    } catch (err) {
      toast.error(apiError(err, "Delivery quote could not be sent"));
      await load();
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 sm:p-5" aria-labelledby="delivery-inbox-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"><Truck size={17} aria-hidden="true" /></span><div><h2 id="delivery-inbox-heading" className="text-sm font-bold text-ink-1">Delivery quote requests</h2><p className="mt-1 text-2xs text-ink-3">Respond only with a price and timing you can actually honour. Customers compare these before travel or payment.</p></div></div>
        <Button size="xs" variant="outline" icon={RefreshCw} onClick={load} loading={loading}>Refresh</Button>
      </div>
      {error ? <div className="mt-4"><ErrorState description={error} onRetry={load} /></div> : loading && requests.length === 0 ? <div role="status" className="py-8 text-center text-xs text-ink-4">Loading recorded requests…</div> : requests.length === 0 ? <div className="mt-3"><EmptyState icon={Truck} title="No open delivery requests" description="New customer requests for your supplier-delivery or registered courier service will appear here." /></div> : (
        <div className="mt-4 space-y-3">
          {requests.map((request) => {
            const form = quotes[request.id] || { price_ksh: "", eta_text: "", note: "" };
            return <article key={request.id} className="rounded-xl border border-edge-1 bg-surface-1 p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold text-ink-1">{request.stock_name} · {num(request.quantity)} {request.unit_of_measure}</p><p className="mt-0.5 text-micro text-ink-4">Requested by {request.buyer_business || "customer"}{request.buyer_handle ? ` · @${request.buyer_handle}` : ""} · {titleCase(request.provider_type.replaceAll("_", " "))}</p></div>{request.provider_type === "supplier_delivery" && <Link to={`/orders/${request.movement_id}`} className="text-micro font-semibold text-brand-700 underline">Open order</Link>}</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2"><p className="flex items-start gap-1.5 text-2xs text-ink-3"><MapPin size={13} className="mt-0.5 shrink-0" aria-hidden="true" /><span><strong className="text-ink-2">Pickup:</strong> {request.pickup_address || "Not confirmed yet"}</span></p><p className="flex items-start gap-1.5 text-2xs text-ink-3"><MapPin size={13} className="mt-0.5 shrink-0" aria-hidden="true" /><span><strong className="text-ink-2">Destination:</strong> {request.destination_address}</span></p></div>
              {request.customer_note && <p className="mt-2 rounded-lg bg-surface-0 px-3 py-2 text-2xs text-ink-3"><strong className="text-ink-2">Customer instructions:</strong> {request.customer_note}</p>}
              {request.scheduled_start && <p className="mt-2 text-micro text-ink-4">Requested window: {parseApiDate(request.scheduled_start)?.toLocaleString() || request.scheduled_start}{request.scheduled_end ? ` – ${parseApiDate(request.scheduled_end)?.toLocaleTimeString() || request.scheduled_end}` : ""}</p>}
              <form onSubmit={(event) => submit(event, request)} className="mt-3 grid gap-3 border-t border-edge-1 pt-3 sm:grid-cols-2">
                <Input label="Delivery amount (KES)" type="number" min="0" max="100000000" step="1" required value={form.price_ksh} onChange={(event) => updateQuote(request.id, { price_ksh: event.target.value })} hint="Whole shillings; enter the actual amount." />
                <Input label="Estimated timing" maxLength={160} value={form.eta_text} onChange={(event) => updateQuote(request.id, { eta_text: event.target.value })} hint="Use a realistic estimate, not a guarantee." />
                <Textarea label="Quote note (optional)" rows={2} maxLength={1000} value={form.note} onChange={(event) => updateQuote(request.id, { note: event.target.value })} wrapperClassName="sm:col-span-2" />
                <div className="sm:col-span-2"><Button size="sm" type="submit" loading={busy === request.id}>Send delivery quote</Button></div>
              </form>
            </article>;
          })}
        </div>
      )}
    </section>
  );
}
