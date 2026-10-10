import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, Clock3, Copy,
  HelpCircle, MapPin, MessageCircle, PackageCheck, Phone, ShieldCheck, Truck, XCircle,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import ErrorState from "@/components/ui/ErrorState";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import Textarea from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useAuthStore } from "@/stores/authStore";
import { apiError, chatAPI, ordersAPI, stockAPI, toolAPI } from "@/lib/api";
import { currency, num, parseApiDate } from "@/lib/formatters";
import { cn, titleCase } from "@/lib/utils";

const DISPUTE_CATEGORIES = [
  ["missing_goods", "Goods missing"],
  ["incorrect_quantity", "Incorrect quantity"],
  ["damaged_goods", "Damaged goods"],
  ["cancellation", "Cancellation problem"],
  ["payment_problem", "Payment problem"],
  ["delivery_failure", "Delivery failure"],
  ["other", "Other"],
];

const PROGRESS = [
  { key: "pending", label: "Requested" },
  { key: "confirmed", label: "Confirmed" },
  { key: "shipped", label: "Handed over / ready" },
  { key: "received", label: "Receipt confirmed" },
];

const labelFor = (value = "") => ({
  self_pickup: "Self pickup",
  supplier_delivery: "Supplier delivery",
  courier: "Courier",
  errand: "Delivery service",
  scheduled: "Scheduled delivery",
  pending_approval: "Needs support approval",
  not_started: "Not started",
  not_applicable: "Not applicable",
  unavailable: "Unavailable in this deployment",
  blocked_by_dispute: "Blocked by an open support case",
  refund_pending: "Refund processing",
  refund_processing: "Refund processing",
  partially_refunded: "Partially refunded",
  failed: "Failed",
  processing: "Waiting for provider verification",
  paid: "Paid · provider verified",
  unpaid: "Not paid",
  refunded: "Refunded · provider verified",
  settled: "Settled",
  pending: "Pending",
  received: "Received",
  cancelled: "Cancelled",
}[value] || titleCase(value.replaceAll("_", " ")));

function when(value) {
  if (!value) return null;
  const date = parseApiDate(value);
  return !date ? null : date.toLocaleString(undefined, {
    dateStyle: "medium", timeStyle: "short",
  });
}

function showMoney(value) {
  return value === null || value === undefined ? "Not set" : currency(Number(value));
}

function statusTone(status) {
  if (["received", "paid", "settled", "refunded"].includes(status)) return "brand";
  if (["cancelled", "failed", "blocked_by_dispute"].includes(status)) return "red";
  if (["pending", "processing", "refund_pending", "refund_processing", "pending_approval", "unavailable"].includes(status)) return "amber";
  return "blue";
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const vendor = useAuthStore((state) => state.vendor);
  const confirm = useConfirm();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [pickupDirty, setPickupDirty] = useState(false);
  const [pickup, setPickup] = useState({ address: "", pickup_hours: "", instructions: "", ready_for_collection: false });
  const [deliveryMode, setDeliveryMode] = useState("supplier_delivery");
  const [couriers, setCouriers] = useState([]);
  const [couriersLoading, setCouriersLoading] = useState(false);
  const [courierId, setCourierId] = useState("");
  const [destination, setDestination] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [phone, setPhone] = useState("");
  const [receiptCode, setReceiptCode] = useState("");
  const [receiptExpires, setReceiptExpires] = useState("");
  const [providerCode, setProviderCode] = useState("");
  const [trackingForm, setTrackingForm] = useState({ status: "picked_up", note: "", tracking_reference: "", tracking_url: "" });
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [dispute, setDispute] = useState({ category: "other", description: "" });

  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setError("");
    }
    try {
      const { data } = await ordersAPI.get(id);
      setOrder(data);
      if (!pickupDirty) {
        setPickup({
          address: data.pickup?.address || "",
          pickup_hours: data.pickup?.hours || "",
          instructions: data.pickup?.instructions || "",
          ready_for_collection: !!data.pickup?.ready_for_collection,
        });
      }
      const lastTrackingStatus = data.tracking?.updates?.at(-1)?.status;
      const nextTrackingStatus = ({
        picked_up: "in_transit",
        in_transit: "out_for_delivery",
        out_for_delivery: "out_for_delivery",
        delivery_issue: "in_transit",
      })[lastTrackingStatus] || "picked_up";
      setTrackingForm((current) => ({ ...current, status: nextTrackingStatus }));
    } catch (err) {
      if (!quiet) setError(apiError(err, "This order could not be loaded"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [id, pickupDirty]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const isBuyer = order?.direction === "incoming";
  const isSupplier = order?.direction === "outgoing";
  const isParticipant = isBuyer || isSupplier;
  const selectedQuote = useMemo(
    () => order?.delivery_quotes?.find((quote) => quote.id === order.selected_quote_id) || null,
    [order],
  );
  const isFulfiller = !!selectedQuote && selectedQuote.provider_vendor_id === vendor?.id;
  const orderOpen = order && ["pending", "confirmed", "shipped"].includes(order.status);
  const paymentLocked = order && ["processing", "paid", "refund_processing", "partially_refunded", "refunded"].includes(order.payment?.status);
  const paymentNeedsSupport = order && ["processing", "paid", "refund_processing", "partially_refunded"].includes(order.payment?.status);
  const cancellationNeedsSupport = paymentNeedsSupport || order?.status === "shipped" && selectedQuote?.provider_type !== "self_pickup";

  useEffect(() => {
    if (!isBuyer || order?.status !== "confirmed") return;
    let active = true;
    setCouriersLoading(true);
    toolAPI.couriers()
      .then(({ data }) => {
        if (!active) return;
        setCouriers(data || []);
        setCourierId((current) => current || data?.[0]?.id || "");
      })
      .catch(() => active && setCouriers([]))
      .finally(() => active && setCouriersLoading(false));
    return () => { active = false; };
  }, [isBuyer, order?.status]);

  const act = async (label, action, { quiet = false } = {}) => {
    setBusy(label);
    try {
      await action();
      if (!quiet) toast.success(label);
      await load(true);
      return true;
    } catch (err) {
      toast.error(apiError(err, `Couldn't ${label.toLowerCase()}`));
      return false;
    } finally {
      setBusy("");
    }
  };

  const savePickup = async (event) => {
    event.preventDefault();
    await act("Pickup details saved", async () => {
      await ordersAPI.setPickup(id, pickup);
      setPickupDirty(false);
    });
  };

  const requestQuote = async (event) => {
    event.preventDefault();
    const data = {
      provider_type: deliveryMode,
      courier_registration_id: deliveryMode === "supplier_delivery" ? null : courierId,
      destination_address: destination.trim(),
      customer_note: customerNote.trim() || null,
    };
    await act("Quote request sent", async () => {
      await ordersAPI.requestDeliveryQuote(id, data);
      setCustomerNote("");
    });
  };

  const chooseQuote = async (quoteId) => {
    await act("Fulfilment option confirmed", async () => {
      const { data } = await ordersAPI.selectDeliveryQuote(id, quoteId);
      setOrder(data);
    });
  };

  const pay = async (event) => {
    event.preventDefault();
    const sent = await act("Payment request sent — waiting for provider verification", async () => {
      await ordersAPI.pay(id, { phone: phone.trim() || null, provider: "MPESA" });
    }, { quiet: true });
    if (sent) toast.success("Payment request sent. Paid status changes only after the provider verifies it.");
  };

  const openChat = async () => {
    setBusy("Opening conversation");
    try {
      const { data } = await chatAPI.orderRoom(id);
      navigate(`/chat?room=${data.room_id}`);
    } catch (err) {
      toast.error(apiError(err, "Order conversation could not be opened"));
    } finally {
      setBusy("");
    }
  };

  const cancelOrder = async () => {
    if (cancellationNeedsSupport) {
      setDispute({ category: "cancellation", description: "I want to cancel this order. Please review the recorded provider and payment state before cancellation." });
      setDisputeOpen(true);
      return;
    }
    if (!(await confirm({
      title: "Cancel this order?",
      message: "Cancellation releases the stock reservation. If a payment is processing or verified, the platform will require support to reconcile it first.",
      confirmLabel: "Cancel order",
      danger: true,
    }))) return;
    await act("Order cancelled", () => stockAPI.advance(id, "cancel"));
  };

  const confirmOrder = async () => act("Order confirmed", () => stockAPI.advance(id, "confirm"));

  const createCode = async () => {
    setBusy("Creating receipt code");
    try {
      const { data } = await ordersAPI.createReceiptCode(id);
      setReceiptCode(data.receipt_code);
      setReceiptExpires(data.expires_at);
      toast.success("One-time receipt code created. Share it with the selected fulfilment provider when the goods arrive.");
      await load(true);
    } catch (err) {
      toast.error(apiError(err, "Receipt code could not be created"));
    } finally {
      setBusy("");
    }
  };

  const confirmReceipt = async (event) => {
    event.preventDefault();
    await act("Receipt confirmed", async () => {
      await ordersAPI.receive(id, providerCode.trim());
      setProviderCode("");
      setReceiptCode("");
    });
  };

  const updateTracking = async (event) => {
    event.preventDefault();
    await act("Delivery tracking updated", () => ordersAPI.tracking(id, {
      ...trackingForm,
      note: trackingForm.note.trim() || null,
      tracking_reference: trackingForm.tracking_reference.trim() || null,
      tracking_url: trackingForm.tracking_url.trim() || null,
    }));
  };

  const updateCourierStatus = async (shipment, status) => {
    const note = status === "failed" ? window.prompt("Briefly explain the delivery issue") : null;
    if (status === "failed" && !note?.trim()) return;
    await act("Tracking updated", () => toolAPI.shipmentStatus(shipment.id, status, note?.trim()));
  };

  const submitDispute = async (event) => {
    event.preventDefault();
    setBusy("Sending support case");
    try {
      await ordersAPI.openDispute(id, dispute);
      setDisputeOpen(false);
      setDispute({ category: "other", description: "" });
      toast.success("Support case recorded. It does not automatically freeze or reverse a payment.");
      await load(true);
    } catch (err) {
      toast.error(apiError(err, "Support case could not be opened"));
    } finally {
      setBusy("");
    }
  };

  const shareCode = async () => {
    try {
      await navigator.clipboard.writeText(receiptCode);
      toast.success("Receipt code copied");
    } catch {
      toast.error("Copy is unavailable here. Select and copy the code manually.");
    }
  };

  if (loading && !order) return <Spinner label="Loading order record…" className="py-20" />;
  if (error && !order) return <ErrorState description={error} onRetry={() => load()} />;
  if (!order) return null;

  const amountTotal = order.terms?.total_amount_ksh;
  const buyerName = order.buyer?.business_name || "Buyer";
  const supplierName = order.supplier?.business_name || "Supplier";
  const codeCanBeCreated = isBuyer && order.status === "shipped" && !!selectedQuote;
  const canEnterReceiptCode = isFulfiller && order.status === "shipped";
  const canSetPickup = isSupplier && ["pending", "confirmed"].includes(order.status);
  const canRequestDelivery = isBuyer && order.status === "confirmed";
  const canPay = isBuyer && order.status === "confirmed" && !!selectedQuote;
  const isSupplierDelivery = isFulfiller && selectedQuote?.provider_type === "supplier_delivery";
  const canCancel = isParticipant && orderOpen;
  const canContactSupport = isParticipant || isFulfiller && order.status !== "received";
  const activeSupportCase = (order.disputes || []).some((entry) => ["open", "in_review"].includes(entry.status));
  const disputeCategories = isFulfiller && !isParticipant
    ? DISPUTE_CATEGORIES.filter(([value]) => value === "delivery_failure")
    : order.status === "cancelled"
      ? DISPUTE_CATEGORIES.filter(([value]) => ["cancellation", "payment_problem", "other"].includes(value))
      : DISPUTE_CATEGORIES;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Orders", to: "/orders" }, { label: order.stock_name || "Order" }]} />

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-edge-1 pb-5">
        <div className="min-w-0">
          <Link to="/orders" className="inline-flex items-center gap-1 text-2xs font-semibold text-ink-4 hover:text-ink-1">
            <ArrowLeft size={13} aria-hidden="true" /> All orders
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-ink-1">{order.stock_name}</h1>
            <Badge variant={statusTone(order.status)} size="sm" dot>{labelFor(order.status)}</Badge>
          </div>
          <p className="mt-1 text-xs text-ink-3">
            {num(order.quantity)} {order.unit_of_measure} · {isBuyer ? `supplied by ${supplierName}` : isSupplier ? `requested by ${buyerName}` : `delivery for ${buyerName}`}
            {order.created_at && ` · requested ${when(order.created_at)}`}
          </p>
          <p className="mt-1 font-mono text-micro text-ink-4">Order {order.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isParticipant && <Button size="sm" variant="secondary" icon={MessageCircle} loading={busy === "Opening conversation"} onClick={openChat}>Order chat</Button>}
          {isBuyer && order.supplier?.call_phone && <a className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-edge-2 px-3 text-xs font-semibold text-ink-2 hover:bg-surface-2" href={`tel:${order.supplier.call_phone}`} aria-label={`Call ${supplierName}`}><Phone size={14} aria-hidden="true" /> Call supplier</a>}
          {isSupplier && order.buyer?.call_phone && <a className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-edge-2 px-3 text-xs font-semibold text-ink-2 hover:bg-surface-2" href={`tel:${order.buyer.call_phone}`} aria-label={`Call ${buyerName}`}><Phone size={14} aria-hidden="true" /> Call buyer</a>}
          {canContactSupport && <Button size="sm" variant="outline" icon={HelpCircle} onClick={() => { if (isFulfiller && !isParticipant) setDispute((current) => ({ ...current, category: "delivery_failure" })); else if (order.status === "cancelled") setDispute((current) => ({ ...current, category: "cancellation" })); setDisputeOpen(true); }} disabled={activeSupportCase}>{activeSupportCase ? "Support case open" : isFulfiller && !isParticipant ? "Report delivery issue" : "Platform support"}</Button>}
          {canCancel && <Button size="sm" variant="dangerGhost" icon={XCircle} onClick={cancelOrder}>{cancellationNeedsSupport ? "Request cancellation help" : "Cancel order"}</Button>}
        </div>
      </header>

      <OrderProgress status={order.status} mode={selectedQuote?.provider_type} />

      {error && <p role="status" className="rounded-xl border border-accent-300 bg-accent-50 px-4 py-3 text-xs text-accent-800">The page may be out of date. {error} <button className="ml-2 underline" onClick={() => load()}>Refresh</button></p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(290px,0.8fr)]">
        <div className="space-y-4">
          <AmountCard order={order} selectedQuote={selectedQuote} amountTotal={amountTotal} />
          <FulfilmentCard
            order={order}
            vendor={vendor}
            selectedQuote={selectedQuote}
            isBuyer={isBuyer}
            isSupplier={isSupplier}
            isFulfiller={isFulfiller}
            canSetPickup={canSetPickup}
            canRequestDelivery={canRequestDelivery}
            pickup={pickup}
            setPickup={(next) => { setPickup(next); setPickupDirty(true); }}
            pickupDirty={pickupDirty}
            savePickup={savePickup}
            deliveryMode={deliveryMode}
            setDeliveryMode={setDeliveryMode}
            couriers={couriers}
            couriersLoading={couriersLoading}
            courierId={courierId}
            setCourierId={setCourierId}
            destination={destination}
            setDestination={setDestination}
            customerNote={customerNote}
            setCustomerNote={setCustomerNote}
            requestQuote={requestQuote}
            chooseQuote={chooseQuote}
            busy={busy}
            paymentLocked={paymentLocked}
            onConfirm={confirmOrder}
          />
          <TrackingCard
            order={order}
            isFulfiller={isFulfiller}
            isSupplierDelivery={isSupplierDelivery}
            trackingForm={trackingForm}
            setTrackingForm={setTrackingForm}
            updateTracking={updateTracking}
            updateCourierStatus={updateCourierStatus}
            busy={busy}
          />
          <ActivityCard events={order.events || []} />
        </div>

        <aside className="space-y-4">
          <PaymentCard
            order={order}
            isBuyer={isBuyer}
            canPay={canPay}
            phone={phone}
            setPhone={setPhone}
            pay={pay}
            busy={busy}
          />
          <ReceiptCard
            order={order}
            isBuyer={isBuyer}
            canCreate={codeCanBeCreated}
            canEnter={canEnterReceiptCode}
            receiptCode={receiptCode}
            receiptExpires={receiptExpires}
            providerCode={providerCode}
            setProviderCode={setProviderCode}
            createCode={createCode}
            confirmReceipt={confirmReceipt}
            shareCode={shareCode}
            busy={busy}
          />
          <SettlementCard settlement={order.settlement} />
          <DisputesCard disputes={order.disputes || []} />
          <ContactCard order={order} isBuyer={isBuyer} isSupplier={isSupplier} buyerName={buyerName} supplierName={supplierName} />
          <p className="rounded-xl border border-edge-1 bg-surface-1 px-3.5 py-3 text-micro leading-relaxed text-ink-4">
            Cancellation stays available before receipt. A support report records a case but does not itself freeze or reverse funds. Only provider-verified callbacks change payment and refund status.
          </p>
        </aside>
      </div>

      <Modal
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        title="Contact platform support"
        description={isFulfiller && !isParticipant ? "Report a delivery failure to platform support. Do not include buyer payment details; the buyer's one-time receipt code remains required." : "Platform support handles platform-wide payment, fulfilment and account issues. The supplier owns the commercial conversation, which stays in order chat."}
        footer={<><Button variant="ghost" onClick={() => setDisputeOpen(false)}>Cancel</Button><Button type="submit" form="order-dispute-form" loading={busy === "Sending support case"}>Send case</Button></>}
      >
        <form id="order-dispute-form" onSubmit={submitDispute} className="space-y-4">
          <label className="block text-2xs font-semibold text-ink-2" htmlFor="dispute-category">Issue type</label>
          <select id="dispute-category" value={dispute.category} onChange={(event) => setDispute((current) => ({ ...current, category: event.target.value }))} className="h-10 w-full rounded-xl border border-edge-2 bg-surface-0 px-3 text-sm text-ink-1 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15">
            {disputeCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Textarea label="What happened?" required minLength={8} maxLength={3000} rows={4} value={dispute.description} onChange={(event) => setDispute((current) => ({ ...current, description: event.target.value }))} hint="Keep it factual. Do not include passwords, PINs or full payment credentials." />
          <p className="flex items-start gap-2 rounded-lg bg-accent-50 px-3 py-2 text-micro text-accent-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> Opening a case does not automatically freeze funds or cancel this order.</p>
        </form>
      </Modal>
    </div>
  );
}

function OrderProgress({ status, mode }) {
  if (status === "cancelled") return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800" role="status">This order was cancelled. The stock reservation was released.</div>;
  const current = Math.max(0, PROGRESS.findIndex((step) => step.key === status));
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label={`Order progress: ${labelFor(status)}`}>
      {PROGRESS.map((step, index) => {
        const complete = index < current || status === "received" && index === current;
        const active = index === current && status !== "received";
        const title = step.key === "shipped" ? (mode === "self_pickup" ? "Ready for collection" : "Dispatched") : step.label;
        return (
          <li key={step.key} className="min-w-0">
            <div className={cn("h-1 rounded-full", complete || active ? "bg-brand-500" : "bg-edge-2")} aria-hidden="true" />
            <p className={cn("mt-2 text-micro font-semibold", complete ? "text-brand-700 dark:text-brand-300" : active ? "text-ink-1" : "text-ink-4")}>{title}</p>
          </li>
        );
      })}
    </ol>
  );
}

function AmountCard({ order, selectedQuote, amountTotal }) {
  const provider = order.direction === "fulfillment";
  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 sm:p-5" aria-labelledby="amount-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="amount-heading" className="text-sm font-bold text-ink-1">Recorded order amounts</h2>
          <p className="mt-1 text-2xs text-ink-3">Amounts come from this order's price snapshot and the selected provider quote.</p>
        </div>
        <Badge variant="gray" size="xs">KES</Badge>
      </div>
      <dl className="mt-4 space-y-2.5">
        <AmountRow label={`Product · ${num(order.quantity)} ${order.unit_of_measure} × ${showMoney(order.unit_price)}`} value={order.product_total_ksh} />
        {selectedQuote ? <AmountRow label={`Delivery · ${labelFor(selectedQuote.provider_type)}`} value={order.terms.delivery_amount_ksh} /> : <p className="text-2xs text-ink-4">Delivery amount is not set until a current pickup or delivery quote is selected.</p>}
        {!provider && <AmountRow label="Platform fee" value={order.terms.platform_fee_ksh} />}
      </dl>
      {amountTotal !== null && amountTotal !== undefined && !provider ? (
        <div className="mt-4 flex items-end justify-between border-t border-edge-1 pt-3">
          <span className="text-xs font-bold text-ink-2">Total due under selected terms</span>
          <strong className="text-xl font-extrabold tabular-nums text-ink-1">{currency(amountTotal)}</strong>
        </div>
      ) : (
        <p className="mt-3 border-t border-edge-1 pt-3 text-2xs text-ink-4">The total is shown after the customer confirms an option. No delivery fee is estimated or hidden.</p>
      )}
      {order.payment?.amount_ksh != null && !provider && <p className="mt-3 text-2xs text-ink-3">Most recent payment attempt: <strong className="text-ink-1">{currency(order.payment.amount_ksh)}</strong> · status follows the provider record.</p>}
    </section>
  );
}

function AmountRow({ label, value }) {
  return <div className="flex items-baseline justify-between gap-4"><dt className="text-xs text-ink-3">{label}</dt><dd className="text-sm font-semibold tabular-nums text-ink-1">{showMoney(value)}</dd></div>;
}

function FulfilmentCard(props) {
  const {
    order, selectedQuote, isBuyer, isSupplier, isFulfiller, canSetPickup, canRequestDelivery,
    pickup, setPickup, pickupDirty, savePickup, deliveryMode, setDeliveryMode, couriers,
    couriersLoading, courierId, setCourierId, destination, setDestination, customerNote,
    setCustomerNote, requestQuote, chooseQuote, busy, paymentLocked, onConfirm,
  } = props;
  const [quoteBusy, setQuoteBusy] = useState("");
  const currentQuotes = (order.delivery_quotes || []).filter((quote) => ["offered", "selected"].includes(quote.status));
  const courierHandoff = ["courier", "errand", "scheduled"].includes(selectedQuote?.provider_type);
  const dispatchLabel = selectedQuote?.provider_type === "self_pickup"
    ? "Mark ready for collection"
    : courierHandoff ? "Confirm hand-off to courier" : "Mark supplier delivery dispatched";
  const dispatchHelp = selectedQuote?.provider_type === "self_pickup"
    ? "This tells the buyer the goods are ready; receipt still needs the buyer's one-time code."
    : courierHandoff
      ? "Only confirm after the courier physically collects the goods. This creates tracking, not proof of delivery."
      : "This records the supplier's dispatch. Add tracking updates as the delivery progresses.";

  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 sm:p-5" aria-labelledby="fulfilment-heading">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"><Truck size={17} aria-hidden="true" /></span>
        <div>
          <h2 id="fulfilment-heading" className="text-sm font-bold text-ink-1">Pickup or delivery</h2>
          <p className="mt-1 text-2xs leading-relaxed text-ink-3">Confirm the exact pickup point or compare a real delivery quote before anyone sets out.</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-edge-1 bg-surface-1 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="text-xs font-bold text-ink-1">Supplier-confirmed pickup</h3>{order.supplier?.is_verified && <p className="mt-0.5 text-micro text-brand-700 dark:text-brand-300">Supplier account verified</p>}</div>
          {order.pickup?.ready_for_collection ? <Badge variant="brand" size="xs" dot>Ready for collection / hand-off</Badge> : <Badge variant="amber" size="xs">Not marked ready</Badge>}
        </div>
        {order.pickup?.address ? <p className="mt-2 flex items-start gap-2 text-xs text-ink-2"><MapPin size={14} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" /><span>{order.pickup.address}</span></p> : <p className="mt-2 text-xs text-ink-4">The supplier has not entered an exact pickup address yet.</p>}
        {order.pickup?.hours && <p className="mt-1 text-2xs text-ink-3">Hours: {order.pickup.hours}</p>}
        {order.pickup?.instructions && <p className="mt-1 text-2xs text-ink-3">Instructions: {order.pickup.instructions}</p>}
        {order.pickup?.ready_at && <p className="mt-1 text-micro text-ink-4">Ready confirmed {when(order.pickup.ready_at)}</p>}
      </div>

      {isSupplier && order.status === "pending" && <div className="mt-3"><Button size="sm" icon={Check} loading={busy === "Order confirmed"} onClick={onConfirm}>Confirm sourcing request</Button></div>}

      {canSetPickup && (
        <form onSubmit={savePickup} className="mt-4 space-y-3 border-t border-edge-1 pt-4">
          <h3 className="text-xs font-bold text-ink-1">{order.pickup?.address ? "Update pickup details" : "Set pickup details"}</h3>
          <Input label="Exact pickup address" required minLength={8} maxLength={500} value={pickup.address} onChange={(event) => setPickup({ ...pickup, address: event.target.value })} hint="Include the market, building, stall or other precise landmark." />
          <Input label="Collection hours or window" maxLength={300} value={pickup.pickup_hours} onChange={(event) => setPickup({ ...pickup, pickup_hours: event.target.value })} />
          <Textarea label="Collection / hand-off instructions" rows={2} maxLength={1000} value={pickup.instructions} onChange={(event) => setPickup({ ...pickup, instructions: event.target.value })} />
          <label className="flex items-start gap-2.5 text-xs text-ink-2">
            <input className="mt-0.5 h-4 w-4 rounded border-edge-3 text-brand-600 focus:ring-brand-500" type="checkbox" checked={pickup.ready_for_collection} onChange={(event) => setPickup({ ...pickup, ready_for_collection: event.target.checked })} />
            <span><strong>Ready for collection / carrier hand-off.</strong><span className="mt-0.5 block text-2xs text-ink-4">Only mark ready when the displayed details are accurate and the goods are prepared.</span></span>
          </label>
          {pickupDirty && <p className="text-micro text-accent-700 dark:text-accent-300">Changing pickup details withdraws earlier quotes and asks the customer to review again.</p>}
          <Button size="sm" type="submit" loading={busy === "Pickup details saved"} disabled={paymentLocked || !pickupDirty}>Save pickup details</Button>
        </form>
      )}

      {(isBuyer || isSupplier) && <div className="mt-4 border-t border-edge-1 pt-4">
        <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-bold text-ink-1">Available options</h3><span className="text-micro text-ink-4">{currentQuotes.length} current quote{currentQuotes.length === 1 ? "" : "s"}</span></div>
        {currentQuotes.length ? <div className="mt-3 grid gap-2">
          {currentQuotes.map((quote) => {
            const selected = quote.id === order.selected_quote_id;
            const ready = !!quote.ready_for_collection;
            const expiry = quote.expires_at && new Date(quote.expires_at) <= new Date();
            const total = Number(order.terms.product_amount_ksh || 0) + Number(order.terms.platform_fee_ksh || 0) + Number(quote.price_ksh || 0);
            return <article key={quote.id} className={cn("rounded-xl border p-3", selected ? "border-brand-500/50 bg-brand-50/50 dark:bg-brand-500/5" : "border-edge-1 bg-surface-0")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="text-xs font-bold text-ink-1">{labelFor(quote.provider_type)} · {quote.provider_name}</p>{quote.provider_verified && <Badge className="mt-1" variant="brand" size="xs"><ShieldCheck size={11} aria-hidden="true" /> Verified provider</Badge>}<p className="mt-0.5 text-micro text-ink-4">Pickup: {quote.pickup_address || "Not confirmed"}</p>{quote.destination_address && <p className="mt-0.5 text-micro text-ink-4">To: {quote.destination_address}</p>}</div>
                <div className="text-right"><strong className="text-sm tabular-nums text-ink-1">{currency(quote.price_ksh)}</strong>{quote.eta_text && <p className="text-micro text-ink-4">{quote.eta_text}</p>}</div>
              </div>
              {quote.note && <p className="mt-2 text-2xs text-ink-3">{quote.note}</p>}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-micro text-ink-4">{ready ? "Supplier marked ready" : "Supplier has not marked ready"}{quote.expires_at ? ` · expires ${when(quote.expires_at)}` : ""}</p>
                {isBuyer && order.status === "confirmed" && <Button size="xs" variant={selected ? "subtle" : "secondary"} disabled={selected || !ready || expiry || paymentLocked} loading={quoteBusy === quote.id} onClick={async () => { setQuoteBusy(quote.id); try { await chooseQuote(quote.id); } finally { setQuoteBusy(""); } }}>{selected ? "Selected" : "Confirm option"}</Button>}
              </div>
              {isBuyer && !selected && ready && <p className="mt-2 border-t border-edge-1 pt-2 text-micro text-ink-3">If selected, recorded order total: <strong className="text-ink-1">{currency(total)}</strong> (product + platform fee + this quote).</p>}
            </article>;
          })}
        </div> : <p className="mt-2 text-2xs text-ink-4">No current options yet. Self pickup appears after the supplier confirms a pickup point; delivery quotes are requested below.</p>}
      </div>}

      {canRequestDelivery && <form onSubmit={requestQuote} className="mt-4 space-y-3 border-t border-edge-1 pt-4">
        <h3 className="text-xs font-bold text-ink-1">Request a real delivery quote</h3>
        {!order.pickup?.ready_for_collection && <p className="rounded-lg bg-accent-50 px-3 py-2 text-2xs text-accent-800">Wait for the supplier to confirm the pickup point and ready state before requesting or selecting a delivery option.</p>}
        <label className="block text-2xs font-semibold text-ink-2" htmlFor="delivery-kind">Delivery option</label>
        <select id="delivery-kind" className="h-10 w-full rounded-xl border border-edge-2 bg-surface-0 px-3 text-sm text-ink-1" value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value)}>
          <option value="supplier_delivery">Supplier delivery</option><option value="courier">Registered courier</option><option value="errand">Delivery service / errand</option>
        </select>
        {deliveryMode !== "supplier_delivery" && <>
          <label className="block text-2xs font-semibold text-ink-2" htmlFor="delivery-courier">Provider</label>
          <select id="delivery-courier" className="h-10 w-full rounded-xl border border-edge-2 bg-surface-0 px-3 text-sm text-ink-1" value={courierId} onChange={(event) => setCourierId(event.target.value)} disabled={couriersLoading || couriers.length === 0} required>
            <option value="">{couriersLoading ? "Loading registered providers…" : couriers.length ? "Choose a provider" : "No providers are listed yet"}</option>
            {couriers.map((courier) => <option key={courier.id} value={courier.id}>{courier.courier_name} · @{courier.vendor_handle}{courier.is_verified ? " · verified" : ""}</option>)}
          </select>
        </>}
        <Input label="Delivery destination" required minLength={4} maxLength={500} value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Enter the delivery address" />
        <Textarea label="Instructions for the provider" rows={2} maxLength={1000} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} />
        <Button size="sm" type="submit" loading={busy === "Quote request sent"} disabled={!order.pickup?.ready_for_collection || deliveryMode !== "supplier_delivery" && !courierId}>Request quote</Button>
      </form>}

      {order.delivery_requests?.length > 0 && (isBuyer || isSupplier) && <div className="mt-4 border-t border-edge-1 pt-4">
        <h3 className="text-xs font-bold text-ink-1">Quote requests</h3>
        <ul className="mt-2 space-y-2">{order.delivery_requests.map((request) => <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 text-2xs"><span>{labelFor(request.provider_type)} to {request.destination_address}</span><Badge size="xs" variant={request.status === "quoted" ? "brand" : "gray"}>{labelFor(request.status)}</Badge></li>)}</ul>
      </div>}

      {order.status === "confirmed" && isSupplier && !selectedQuote && <p className="mt-4 border-t border-edge-1 pt-3 text-2xs text-ink-4">Dispatch stays locked until the customer selects a current pickup or delivery option.</p>}
      {selectedQuote && order.status === "confirmed" && isSupplier && <div className="mt-4 border-t border-edge-1 pt-4"><Button size="sm" icon={Truck} loading={busy === "Order dispatched"} disabled={!order.pickup?.ready_for_collection || order.payment?.status === "processing"} onClick={() => { setQuoteBusy("dispatch"); setBusy("Order dispatched"); stockAPI.advance(order.id, "ship").then(() => { toast.success(dispatchLabel); load(true); }).catch((error) => toast.error(apiError(error, "Could not dispatch this order"))).finally(() => { setBusy(""); setQuoteBusy(""); }); }}>{dispatchLabel}</Button><p className="mt-1.5 text-micro text-ink-4">{dispatchHelp}{courierHandoff && " A tracking number is created from the selected quote."}</p></div>}

      {isFulfiller && order.status === "confirmed" && <p className="mt-3 text-2xs text-ink-4">The selected provider can dispatch after the supplier marks this order ready.</p>}
      {selectedQuote?.provider_type === "self_pickup" && isBuyer && <p className="mt-3 text-2xs text-ink-4">Do not travel until the supplier shows “Ready for collection” and the pickup point above matches your plan.</p>}
    </section>
  );
}

function TrackingCard({ order, isFulfiller, isSupplierDelivery, trackingForm, setTrackingForm, updateTracking, updateCourierStatus, busy }) {
  const shipments = order.tracking?.shipments || [];
  const updates = order.tracking?.updates || [];
  const shipment = shipments[0];
  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 sm:p-5" aria-labelledby="tracking-heading">
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"><MapPin size={17} aria-hidden="true" /></span><div><h2 id="tracking-heading" className="text-sm font-bold text-ink-1">Delivery tracking</h2><p className="mt-1 text-2xs text-ink-3">Tracking reflects provider updates and recorded order milestones.</p></div></div>
      {shipment && <div className="mt-4 rounded-xl border border-edge-1 bg-surface-1 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold text-ink-1">{shipment.courier_name || "Courier"} · {shipment.tracking_number}</p><p className="mt-0.5 text-micro text-ink-4">{shipment.origin || "Pickup"} → {shipment.destination || "Destination"}</p></div><Badge variant={statusTone(shipment.status)} size="xs" dot>{labelFor(shipment.status)}</Badge></div>
        <ol className="mt-3 space-y-2 border-l border-edge-2 pl-3">{(shipment.status_history || []).map((entry, index) => <li key={`${entry.status}-${entry.at}-${index}`} className="relative text-2xs"><span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-surface-1" aria-hidden="true" /><strong className="text-ink-1">{labelFor(entry.status)}</strong><span className="ml-2 text-ink-4">{when(entry.at)}</span>{entry.note && <p className="mt-0.5 text-ink-3">{entry.note}</p>}</li>)}</ol>
        {isFulfiller && order.status === "shipped" && shipment.status !== "delivered" && shipment.status !== "failed" && <div className="mt-3 flex flex-wrap gap-2 border-t border-edge-1 pt-3">{shipment.status === "picked_up" && <Button size="xs" variant="secondary" onClick={() => updateCourierStatus(shipment, "in_transit")}>Mark in transit</Button>}{["picked_up", "in_transit"].includes(shipment.status) && <Button size="xs" variant="secondary" onClick={() => updateCourierStatus(shipment, "out_for_delivery")}>Out for delivery</Button>}<Button size="xs" variant="ghost" className="text-red-600" onClick={() => updateCourierStatus(shipment, "failed")}>Report delivery issue</Button></div>}
        {shipment.status === "delivered" && order.status !== "received" && <p className="mt-3 text-2xs text-ink-3">Courier marked delivery. The order still needs the buyer's receipt code before stock or settlement is finalized.</p>}
      </div>}
      {updates.length > 0 && <ol className="mt-4 space-y-2">{updates.map((update, index) => <li key={`${update.created_at}-${index}`} className="rounded-lg bg-surface-1 px-3 py-2 text-2xs"><strong className="text-ink-1">{labelFor(update.status)}</strong><span className="ml-2 text-ink-4">{when(update.created_at)}</span>{update.note && <p className="mt-1 text-ink-3">{update.note}</p>}{update.tracking_reference && <p className="mt-1 text-ink-3">Reference: {update.tracking_reference}</p>}{update.tracking_url && <a href={update.tracking_url} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold text-brand-700 underline">Open provider tracking</a>}</li>)}</ol>}
      {order.status === "shipped" && isFulfiller && isSupplierDelivery && <form onSubmit={updateTracking} className="mt-4 space-y-3 border-t border-edge-1 pt-4"><h3 className="text-xs font-bold text-ink-1">Update supplier-delivery progress</h3><label className="block text-2xs font-semibold text-ink-2" htmlFor="tracking-status">Status</label><select id="tracking-status" className="h-10 w-full rounded-xl border border-edge-2 bg-surface-0 px-3 text-sm" value={trackingForm.status} onChange={(event) => setTrackingForm({ ...trackingForm, status: event.target.value })}><option value="picked_up">Picked up</option><option value="in_transit">In transit</option><option value="out_for_delivery">Out for delivery</option><option value="delivery_issue">Delivery issue</option></select><Textarea label="Update note" rows={2} maxLength={500} value={trackingForm.note} onChange={(event) => setTrackingForm({ ...trackingForm, note: event.target.value })} /><Input label="Tracking reference (optional)" maxLength={100} value={trackingForm.tracking_reference} onChange={(event) => setTrackingForm({ ...trackingForm, tracking_reference: event.target.value })} /><Input label="HTTPS tracking link (optional)" type="url" maxLength={500} value={trackingForm.tracking_url} onChange={(event) => setTrackingForm({ ...trackingForm, tracking_url: event.target.value })} /><Button size="sm" type="submit" loading={busy === "Delivery tracking updated"}>Save tracking update</Button></form>}
      {!shipment && updates.length === 0 && order.status !== "shipped" && <p className="mt-3 text-2xs text-ink-4">Tracking starts after the supplier hands the goods over or marks them ready.</p>}
      {!shipment && updates.length === 0 && order.status === "shipped" && <p className="mt-3 rounded-lg bg-surface-1 px-3 py-2 text-2xs text-ink-3">The dispatch is recorded. The selected provider has not added a separate tracking update yet.</p>}
    </section>
  );
}

function PaymentCard({ order, isBuyer, canPay, phone, setPhone, pay, busy }) {
  const payment = order.payment || {};
  const unavailable = payment.availability && !payment.availability.enabled;
  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 sm:p-5" aria-labelledby="payment-heading">
      <div className="flex items-start justify-between gap-3"><div><h2 id="payment-heading" className="text-sm font-bold text-ink-1">Payment verification</h2><p className="mt-1 text-2xs text-ink-3">A button cannot mark an order paid. The server waits for a verified provider callback.</p></div><Badge variant={statusTone(payment.status)} size="xs">{labelFor(payment.status || "unpaid")}</Badge></div>
      {payment.intent_id && <dl className="mt-3 space-y-1.5 text-2xs"><div className="flex justify-between gap-3"><dt className="text-ink-4">Recorded attempt</dt><dd className="font-semibold tabular-nums text-ink-1">{showMoney(payment.amount_ksh)}</dd></div>{payment.reference && <div className="flex justify-between gap-3"><dt className="text-ink-4">Provider reference</dt><dd className="max-w-[65%] truncate font-mono text-ink-2">{payment.reference}</dd></div>}{payment.receipt && <div className="flex justify-between gap-3"><dt className="text-ink-4">Provider receipt</dt><dd className="font-mono text-ink-2">{payment.receipt}</dd></div>}{payment.verified_at && <div className="flex justify-between gap-3"><dt className="text-ink-4">Verified at</dt><dd className="text-right text-ink-2">{when(payment.verified_at)}</dd></div>}{payment.failure_reason && <p className="text-red-700">{payment.failure_reason}</p>}</dl>}
      {payment.refunded_amount_ksh > 0 && <p className="mt-2 text-2xs text-ink-3">Provider-confirmed refund: {currency(payment.refunded_amount_ksh)}{payment.refund_pending_amount_ksh ? ` · processing ${currency(payment.refund_pending_amount_ksh)}` : ""}</p>}
      {unavailable && <p className="mt-3 rounded-lg border border-edge-1 bg-surface-1 px-3 py-2 text-2xs text-ink-3">{payment.availability.reason} No client-side or mock payment is shown as real money movement.</p>}
      {canPay && isBuyer && ["unpaid", "failed"].includes(payment.status) && !unavailable && <form onSubmit={pay} className="mt-4 space-y-3 border-t border-edge-1 pt-4"><p className="text-2xs text-ink-3">Pay the reviewed total of <strong className="text-ink-1">{showMoney(order.terms.total_amount_ksh)}</strong>.</p><Input label="M-Pesa number for this payment" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} hint="Used for this payment request; saved contact details are not required." /><Button size="sm" type="submit" loading={busy === "Payment request sent — waiting for provider verification"}>{payment.status === "failed" ? "Retry M-Pesa payment request" : "Request M-Pesa payment"}</Button></form>}
      {payment.status === "processing" && <p className="mt-3 flex items-start gap-2 rounded-lg bg-accent-50 px-3 py-2 text-2xs text-accent-800"><Clock3 size={13} className="mt-0.5 shrink-0" aria-hidden="true" />Waiting for the payment provider. Refreshing this page will not mark it paid.</p>}
      {!isBuyer && order.direction !== "fulfillment" && <p className="mt-3 text-micro text-ink-4">The customer starts a payment request after confirming pickup or delivery.</p>}
    </section>
  );
}

function ReceiptCard({ order, isBuyer, canCreate, canEnter, receiptCode, receiptExpires, providerCode, setProviderCode, createCode, confirmReceipt, shareCode, busy }) {
  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 sm:p-5" aria-labelledby="receipt-heading">
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><PackageCheck size={17} aria-hidden="true" /></span><div><h2 id="receipt-heading" className="text-sm font-bold text-ink-1">Proof of receipt</h2><p className="mt-1 text-2xs text-ink-3">The buyer creates a one-time code; the selected provider enters it at hand-off.</p></div></div>
      {canCreate && <div className="mt-4 space-y-3">{receiptCode ? <div className="rounded-xl border border-brand-300 bg-brand-50 p-3"><p className="text-micro font-bold uppercase tracking-wide text-brand-800">Share this code with the selected provider</p><div className="mt-2 flex items-center justify-between gap-3"><code className="text-2xl font-extrabold tracking-[0.25em] text-brand-900">{receiptCode}</code><Button size="xs" variant="secondary" icon={Copy} onClick={shareCode}>Copy</Button></div>{receiptExpires && <p className="mt-1 text-micro text-brand-800">Expires {when(receiptExpires)}</p>}</div> : <p className="text-2xs text-ink-3">Create the code when the goods are physically with you. Only the buyer can view it here.</p>}<Button size="sm" variant={receiptCode ? "secondary" : "primary"} loading={busy === "Creating receipt code"} onClick={createCode}>{receiptCode ? "Replace one-time code" : "Create receipt code"}</Button></div>}
      {canEnter && <form onSubmit={confirmReceipt} className="mt-4 space-y-3"><p className="text-2xs text-ink-3">Ask the buyer to share their current six-digit code only when the goods have arrived.</p><Input label="Buyer receipt code" required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={providerCode} onChange={(event) => setProviderCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /><Button size="sm" type="submit" icon={CheckCircle2} loading={busy === "Receipt confirmed"}>Verify code and confirm receipt</Button></form>}
      {order.status === "shipped" && !canCreate && !canEnter && <p className="mt-3 text-2xs text-ink-4">The buyer must share their code with the selected fulfilment provider. Receipt is not final until that code is verified.</p>}
      {order.status === "received" && <p className="mt-3 flex items-start gap-2 text-2xs text-emerald-800"><CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Receipt confirmed with the buyer's one-time code{order.completed_at ? ` at ${when(order.completed_at)}` : ""}.</p>}
      {order.status !== "shipped" && order.status !== "received" && <p className="mt-3 text-micro text-ink-4">Available after the supplier dispatches or marks the order ready.</p>}
    </section>
  );
}

function SettlementCard({ settlement }) {
  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 sm:p-5" aria-labelledby="settlement-heading">
      <div className="flex items-start justify-between gap-3"><div><h2 id="settlement-heading" className="text-sm font-bold text-ink-1">Settlement</h2><p className="mt-1 text-2xs text-ink-3">Supplier and delivery payouts depend on verified payment, receipt and provider callbacks.</p></div><Badge variant={statusTone(settlement?.status)} size="xs">{labelFor(settlement?.status || "not_started")}</Badge></div>
      {settlement?.status === "unavailable" && <p className="mt-3 rounded-lg bg-accent-50 px-3 py-2 text-2xs text-accent-800">A suitable provider-managed settlement account is not configured for this deployment. The platform does not hold order funds in an ordinary operating account.</p>}
      {settlement?.payouts?.length > 0 ? <ul className="mt-3 space-y-2">{settlement.payouts.map((payout) => <li key={payout.id} className="flex items-start justify-between gap-3 rounded-lg bg-surface-1 px-3 py-2 text-2xs"><div><p className="font-semibold text-ink-1">{payout.type === "movement_delivery" ? "Delivery provider" : "Supplier"} · {currency(payout.amount_ksh)}</p>{payout.failure_reason && <p className="mt-1 text-red-700">{payout.failure_reason}</p>}</div><Badge size="xs" variant={statusTone(payout.status)}>{labelFor(payout.status)}</Badge></li>)}</ul> : <p className="mt-3 text-2xs text-ink-4">No payout is recorded yet.</p>}
    </section>
  );
}

function ActivityCard({ events }) {
  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 sm:p-5" aria-labelledby="activity-heading">
      <h2 id="activity-heading" className="text-sm font-bold text-ink-1">Recorded activity</h2>
      <p className="mt-1 text-2xs text-ink-3">Order history is read from saved events, not a progress animation.</p>
      {events.length ? <ol className="mt-4 space-y-3">{[...events].reverse().map((event) => <li key={event.id} className="flex gap-3"><span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-3"><Clock3 size={12} aria-hidden="true" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-ink-1">{eventTitle(event.type)}</p><p className="mt-0.5 text-micro text-ink-4">{when(event.created_at)}</p>{event.payload?.amount_ksh != null && <p className="mt-0.5 text-micro text-ink-3">{currency(event.payload.amount_ksh)}</p>}{event.payload?.reason && <p className="mt-0.5 text-micro text-ink-3">{event.payload.reason}</p>}</div></li>)}</ol> : <p className="mt-3 text-2xs text-ink-4">No extra activity has been recorded yet.</p>}
    </section>
  );
}

function eventTitle(type = "") {
  const labels = {
    order_requested: "Order requested",
    supplier_confirmed: "Supplier confirmed",
    pickup_details_confirmed: "Pickup details confirmed",
    delivery_quote_requested: "Delivery quote requested",
    delivery_quote_received: "Delivery quote received",
    delivery_selected: "Pickup or delivery selected",
    dispatch_marked: "Order handed over / ready",
    delivery_tracking_created: "Courier tracking created",
    tracking_update: "Delivery tracking update",
    receipt_code_issued: "One-time receipt code issued",
    order_received: "Receipt confirmed",
    payment_requested: "Payment requested",
    payment_verified: "Payment verified by provider",
    payment_failed: "Payment failed",
    payment_refunded: "Refund verified by provider",
    dispute_opened: "Platform support case opened",
    dispute_resolved: "Support case resolved",
    dispute_refund_completed: "Dispute refund verified",
    refund_failed: "Provider refund failed",
    payout_failed: "Settlement payout failed",
    supplier_payout_queued: "Supplier payout queued",
    supplier_settled: "Settlement completed",
    order_cancelled: "Order cancelled",
  };
  return labels[type] || titleCase(type.replaceAll("_", " "));
}

function DisputesCard({ disputes }) {
  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 sm:p-5" aria-labelledby="cases-heading">
      <h2 id="cases-heading" className="text-sm font-bold text-ink-1">Support cases</h2>
      {disputes.length ? <ul className="mt-3 space-y-3">{disputes.map((entry) => <li key={entry.id} className="border-t border-edge-1 pt-3 first:border-0 first:pt-0"><div className="flex items-center justify-between gap-2"><strong className="text-xs text-ink-1">{labelFor(entry.category)}</strong><Badge size="xs" variant={statusTone(entry.status)}>{labelFor(entry.status)}</Badge></div><p className="mt-1 text-2xs text-ink-3">{entry.description}</p>{entry.resolution_note && <p className="mt-1 text-micro text-ink-4">Support note: {entry.resolution_note}</p>}<p className="mt-1 text-micro text-ink-4">Opened {when(entry.created_at)}{entry.resolved_at ? ` · updated ${when(entry.resolved_at)}` : ""}</p></li>)}</ul> : <p className="mt-2 text-2xs text-ink-4">No support case has been recorded.</p>}
    </section>
  );
}

function ContactCard({ order, isBuyer, isSupplier, buyerName, supplierName }) {
  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 sm:p-5" aria-labelledby="people-heading">
      <h2 id="people-heading" className="text-sm font-bold text-ink-1">Order participants</h2>
      <div className="mt-3 space-y-3">
        <Person name={supplierName} handle={order.supplier?.handle} location={order.supplier?.location} verified={order.supplier?.is_verified} label="Supplier" />
        <Person name={buyerName} handle={order.buyer?.handle} location={order.buyer?.location} verified={order.buyer?.is_verified} label="Buyer" />
      </div>
      {(isBuyer || isSupplier) && <p className="mt-3 border-t border-edge-1 pt-3 text-micro leading-relaxed text-ink-4">The supplier leads commercial discussions. Direct phone numbers are shown only when the owner has opted in; the order chat remains available.</p>}
    </section>
  );
}

function Person({ name, handle, location, verified, label }) {
  return <div className="flex items-start justify-between gap-3"><div><p className="text-micro font-bold uppercase tracking-wide text-ink-4">{label}</p><p className="mt-0.5 text-xs font-semibold text-ink-1">{name}</p>{handle && <p className="font-mono text-micro text-ink-4">@{handle}</p>}{location && <p className="mt-0.5 text-micro text-ink-4">{location}</p>}</div>{verified && <Badge variant="brand" size="xs"><ShieldCheck size={11} aria-hidden="true" /> Verified</Badge>}</div>;
}
