import { useCallback, useEffect, useState } from "react";
import { Fish, Package, RefreshCw, Store, Truck } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { locksAPI, apiError } from "@/lib/api";
import { currency, num } from "@/lib/formatters";

const PAYMENTS = [
  { value: "advance_mpesa", label: "Advance — M-Pesa before buying" },
  { value: "advance_cash", label: "Advance — cash before buying" },
  { value: "cash_on_delivery", label: "Cash on delivery" },
  { value: "mpesa_on_delivery", label: "M-Pesa on delivery" },
  { value: "shop_backed_collection", label: "Shop-backed collection (pay at the shop)" },
];
const qty = (v) => (Number.isInteger(Number(v)) ? num(v) : Number(v).toFixed(1));

export default function MarketRunsSection({ currentHandle }) {
  const [templates, setTemplates] = useState([]);
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [ledger, setLedger] = useState(null);
  const [busy, setBusy] = useState("");
  const [runForm, setRunForm] = useState({
    title: "", market_name: "", market_city: "Nairobi", run_kind: "consolidated_supply",
    run_date: "", order_deadline: "", funding_model: "mixed_open", cold_chain_plan: "",
  });
  const [orderForm, setOrderForm] = useState({
    product_name: "", unit_of_measure: "kg", package_size: "", quantity: "",
    participant_type: "family", payment_method: "cash_on_delivery",
    delivery_mode: "collect_at_hub", collection_point_handle: "", delivery_area: "",
    estimated_unit_price: "", delivery_fee_kes: "", handling_fee_kes: "", repack_fee_kes: "",
    repack_required: false, wholesale_package: false,
  });
  const [purchaseForm, setPurchaseForm] = useState({
    product_name: "", unit_of_measure: "kg", quantity_purchased: "", actual_unit_price: "",
    receipt_ref: "", supplier_name: "", weight_loss_quantity: "", rejected_quantity: "",
  });
  const [expenseForm, setExpenseForm] = useState({ kind: "transport", amount_kes: "", receipt_ref: "", note: "" });
  const [payDraft, setPayDraft] = useState({}); // orderId -> amount

  const loadLedger = useCallback(async (runId) => {
    if (!runId) { setLedger(null); return; }
    const res = await locksAPI.runLedger(runId);
    setLedger(res.data);
  }, []);

  const load = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([locksAPI.runTemplates(), locksAPI.runs()]);
      setTemplates(t.data.templates || []);
      setRuns(r.data || []);
      setSelectedId((prev) => prev || r.data?.[0]?.id || "");
    } catch (err) {
      toast.error(apiError(err, "Could not load market runs"));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadLedger(selectedId).catch(() => {}); }, [selectedId, loadLedger]);

  const act = async (key, fn, ok) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await load();
      if (selectedId) await loadLedger(selectedId);
    } catch (err) {
      toast.error(apiError(err, "That did not work"));
    } finally {
      setBusy("");
    }
  };

  const applyTemplate = (t) => setRunForm({
    title: t.title, market_name: t.market_name, market_city: t.market_city,
    run_kind: t.run_kind, run_date: runForm.run_date, order_deadline: runForm.order_deadline,
    funding_model: "mixed_open", cold_chain_plan: t.cold_chain_plan || "",
  });

  const createRun = (e) => {
    e.preventDefault();
    act("run", () => locksAPI.createRun({
      ...runForm,
      cold_chain_required: runForm.run_kind === "fresh_market",
      order_deadline: runForm.order_deadline ? new Date(runForm.order_deadline).toISOString() : undefined,
    }).then((res) => setSelectedId(res.data.id)), "Market run created — ordering is open");
  };

  const createOrder = (e) => {
    e.preventDefault();
    act("order", () => locksAPI.createRunOrder(selectedId, {
      product_name: orderForm.product_name,
      unit_of_measure: orderForm.unit_of_measure,
      package_size: orderForm.package_size || undefined,
      wholesale_package: orderForm.wholesale_package,
      repack_required: orderForm.repack_required,
      participant_type: orderForm.participant_type,
      quantity: Number(orderForm.quantity),
      payment_method: orderForm.payment_method,
      delivery_mode: orderForm.delivery_mode,
      collection_point_handle: orderForm.collection_point_handle || undefined,
      delivery_area: orderForm.delivery_area || undefined,
      estimated_unit_price: orderForm.estimated_unit_price === "" ? undefined : Number(orderForm.estimated_unit_price),
      delivery_fee_kes: Number(orderForm.delivery_fee_kes || 0),
      handling_fee_kes: Number(orderForm.handling_fee_kes || 0),
      repack_fee_kes: Number(orderForm.repack_fee_kes || 0),
    }), "Request saved — confirm it to join the buying list");
  };

  const run = ledger || runs.find((r) => r.id === selectedId);
  const isManager = run && currentHandle && (run.buyer_handle === currentHandle);
  const products = ledger?.ledger?.products || [];
  const totals = ledger?.ledger?.totals;
  const fulfilment = ledger?.ledger?.fulfilment;

  return (
    <Card padding="p-4" className="space-y-4">
      <CardHeader>
        <CardTitle sub="Scheduled buying runs — Ruiru Fresh · Githurai Sukari · Daraja Mbili consolidated. Open ordering: your registered zone and walkable ring never block an order.">
          Market Runs
        </CardTitle>
        <Button size="xs" variant="secondary" icon={RefreshCw} loading={busy === "load"} onClick={load}>Refresh</Button>
      </CardHeader>

      {/* Templates */}
      <div className="grid gap-2 md:grid-cols-3">
        {templates.map((t) => (
          <div key={t.key} className="rounded-xl border border-edge-1 bg-surface-2 p-3 space-y-1.5">
            <p className="text-xs font-bold text-ink-1 flex items-center gap-1.5">
              {t.run_kind === "fresh_market" ? <Fish size={13} /> : t.run_kind === "bulk_dry_goods" ? <Package size={13} /> : <Store size={13} />}
              {t.title}
            </p>
            <div className="flex flex-wrap gap-1">
              <Badge variant="brand" size="xs">{t.schedule_label}</Badge>
              <Badge variant="gray" size="xs">{t.audience}</Badge>
              {t.cold_chain_required && <Badge variant="amber" size="xs">Cold chain</Badge>}
            </div>
            <p className="text-2xs text-ink-3">Products: {t.products.join(", ")}.</p>
            <p className="text-2xs text-ink-4">{t.funding_note}</p>
            <Button size="xs" variant="outline" onClick={() => applyTemplate(t)}>Use this run</Button>
          </div>
        ))}
      </div>

      {/* Create run */}
      <form onSubmit={createRun} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 rounded-xl border border-edge-1 p-3">
        <Input label="Run title" required value={runForm.title} onChange={(e) => setRunForm({ ...runForm, title: e.target.value })} placeholder="Run A — Ruiru Fresh Market" />
        <Input label="Market" required value={runForm.market_name} onChange={(e) => setRunForm({ ...runForm, market_name: e.target.value })} placeholder="Daraja Mbili" />
        <Select label="Run type" value={runForm.run_kind} onChange={(e) => setRunForm({ ...runForm, run_kind: e.target.value })}
          options={[{ value: "fresh_market", label: "Fresh market (morning buying)" }, { value: "bulk_dry_goods", label: "Bulk dry goods" }, { value: "consolidated_supply", label: "Consolidated supply" }]} />
        <Select label="Who funds the purchase?" value={runForm.funding_model} onChange={(e) => setRunForm({ ...runForm, funding_model: e.target.value })}
          options={[
            { value: "mixed_open", label: "Open — each order records its own funding" },
            { value: "customer_advance", label: "Model 1 — customers fund in advance" },
            { value: "buyer_capital", label: "Model 2 — buyer's own working capital" },
            { value: "supplier_credit", label: "Supplier credit" },
            { value: "shop_consolidated", label: "Model 3 — shops consolidate & fund" },
            { value: "pooled", label: "Pooled contributions" },
          ]} />
        <Input label="Run date" type="date" required value={runForm.run_date} onChange={(e) => setRunForm({ ...runForm, run_date: e.target.value })} />
        <Input label="Order deadline" type="datetime-local" required value={runForm.order_deadline} onChange={(e) => setRunForm({ ...runForm, order_deadline: e.target.value })} />
        {runForm.run_kind === "fresh_market" && (
          <Input label="Cold-chain plan (required for fresh)" required value={runForm.cold_chain_plan}
            onChange={(e) => setRunForm({ ...runForm, cold_chain_plan: e.target.value })}
            placeholder="Insulated boxes with ice; fish allocated first" wrapperClassName="sm:col-span-2" />
        )}
        <div className="flex items-end"><Button type="submit" size="sm" loading={busy === "run"}>Create run</Button></div>
      </form>

      {/* Run picker */}
      {runs.length > 0 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Market runs">
          {runs.map((r) => (
            <button key={r.id} type="button" role="tab" aria-selected={r.id === selectedId} onClick={() => setSelectedId(r.id)}
              className={`rounded-xl border px-3 py-2 text-left text-xs ${r.id === selectedId ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-edge-1 bg-surface-0"}`}>
              <span className="font-semibold text-ink-1">{r.title}</span>
              <span className="block text-2xs text-ink-3">{r.market_name} · {r.run_date} · {r.status} · funds: {r.funding_model.replaceAll("_", " ")}</span>
            </button>
          ))}
        </div>
      )}

      {run && (
        <div className="space-y-4">
          <p className="text-2xs text-ink-3 flex items-start gap-1.5">
            <Truck size={13} className="mt-0.5 shrink-0" />
            Buyer: {run.buyer_handle ? `@${run.buyer_handle}` : "—"} · {run.funding_note || "Each order records its own funding and payment choice."}
            {run.cold_chain_required && <> · Cold chain: {run.cold_chain_plan}</>}
          </p>

          {/* Order form — the customer decides */}
          {run.status === "open" && (
            <form onSubmit={createOrder} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 rounded-xl border border-edge-1 p-3">
              <Input label="Product" required value={orderForm.product_name} onChange={(e) => setOrderForm({ ...orderForm, product_name: e.target.value })} placeholder="Sugar / Fish / Chicken" />
              <Input label="Quantity" type="number" min="0.1" step="any" required value={orderForm.quantity} onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })} placeholder="2" />
              <Select label="Unit" value={orderForm.unit_of_measure} onChange={(e) => setOrderForm({ ...orderForm, unit_of_measure: e.target.value })}
                options={[{ value: "kg", label: "kg" }, { value: "bag", label: "bags" }, { value: "carton", label: "cartons" }, { value: "units", label: "units" }, { value: "crates", label: "crates" }]} />
              <Select label="I am ordering as" value={orderForm.participant_type} onChange={(e) => setOrderForm({ ...orderForm, participant_type: e.target.value })}
                options={[{ value: "family", label: "Family / household" }, { value: "shop", label: "Shop" }]} />
              <Input label="Package size" value={orderForm.package_size} onChange={(e) => setOrderForm({ ...orderForm, package_size: e.target.value })} placeholder="50 kg bag · 2 kg packet · whole chicken" />
              <Select label="How will you pay? (your choice)" value={orderForm.payment_method} onChange={(e) => setOrderForm({ ...orderForm, payment_method: e.target.value })} options={PAYMENTS} />
              <Select label="Receive goods" value={orderForm.delivery_mode} onChange={(e) => setOrderForm({ ...orderForm, delivery_mode: e.target.value })}
                options={[{ value: "collect_at_hub", label: "Collect at the market hub" }, { value: "collect_at_shop", label: "Collect at a participating shop" }, { value: "home_delivery", label: "Delivery (route & fee shown)" }]} />
              <Input label="Collection shop @handle (if shop-backed)" value={orderForm.collection_point_handle} onChange={(e) => setOrderForm({ ...orderForm, collection_point_handle: e.target.value })} placeholder="duka_moJa" />
              <Input label="Delivery area (outside the ring is fine)" value={orderForm.delivery_area} onChange={(e) => setOrderForm({ ...orderForm, delivery_area: e.target.value })} placeholder="Migosi, Kisumu" />
              <Input label="Expected price / unit (KSh)" type="number" min="0" step="any" value={orderForm.estimated_unit_price} onChange={(e) => setOrderForm({ ...orderForm, estimated_unit_price: e.target.value })} />
              <Input label="Delivery fee (KSh)" type="number" min="0" value={orderForm.delivery_fee_kes} onChange={(e) => setOrderForm({ ...orderForm, delivery_fee_kes: e.target.value })} />
              <Input label="Repack fee (KSh)" type="number" min="0" value={orderForm.repack_fee_kes} onChange={(e) => setOrderForm({ ...orderForm, repack_fee_kes: e.target.value })} />
              <label className="flex items-center gap-2 text-2xs text-ink-2">
                <input type="checkbox" checked={orderForm.repack_required} onChange={(e) => setOrderForm({ ...orderForm, repack_required: e.target.checked })} />
                Repack into smaller retail quantity
              </label>
              <label className="flex items-center gap-2 text-2xs text-ink-2">
                <input type="checkbox" checked={orderForm.wholesale_package} onChange={(e) => setOrderForm({ ...orderForm, wholesale_package: e.target.checked })} />
                Full wholesale package
              </label>
              <div className="flex items-end"><Button type="submit" size="sm" loading={busy === "order"}>Place request</Button></div>
              <p className="text-2xs text-ink-4 sm:col-span-2 lg:col-span-4">
                A request is not a confirmed order: confirm it below to join the buying list. No payment
                method is forced — advance, on delivery and shop-backed all stay open, with the fees
                for your choice shown on the order. Large on-delivery orders get a deposit
                recommendation, never a block.
              </p>
            </form>
          )}

          {/* Ledger: three figures */}
          {products.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-edge-1">
              <table className="w-full min-w-[40rem] text-xs">
                <thead className="bg-surface-2 text-2xs uppercase text-ink-4">
                  <tr><th className="p-2 text-left">Product</th><th className="p-2 text-right">Pooled demand</th><th className="p-2 text-right">Confirmed (buying list)</th><th className="p-2 text-right">Wholesale threshold</th><th className="p-2 text-left">Purchase</th></tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.product_name} className="border-t border-edge-1">
                      <td className="p-2 font-medium text-ink-1">{p.product_name} <span className="text-ink-4">fam {qty(p.family_quantity)} · shop {qty(p.shop_quantity)}</span></td>
                      <td className="p-2 text-right">{qty(p.total_pooled_demand)} {p.unit_of_measure}</td>
                      <td className="p-2 text-right font-semibold">{qty(p.confirmed_purchasing_demand)} {p.unit_of_measure}</td>
                      <td className="p-2 text-right">{p.wholesale_threshold ? `${qty(p.wholesale_threshold)} ${p.unit_of_measure}` : "—"} {p.threshold_reached && <Badge variant="brand" size="xs">reached</Badge>}</td>
                      <td className="p-2">{p.purchase ? `${qty(p.purchase.quantity_purchased)} ${p.unit_of_measure} @ ${currency(p.purchase.actual_unit_price)} · usable ${qty(p.purchase.usable_quantity)} · ${p.purchase.receipt_ref || "no receipt ref"}` : "Not bought yet"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Orders */}
          {ledger?.orders?.length > 0 && (
            <ul className="divide-y divide-edge-1 rounded-xl border border-edge-1">
              {ledger.orders.map((o) => {
                const mine = o.vendor_handle === currentHandle;
                return (
                  <li key={o.id} className="p-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="min-w-40 flex-1">
                      <span className="font-semibold text-ink-1">{o.product_name}</span>{" "}
                      {qty(o.quantity_allocated ?? o.quantity)} {o.unit_of_measure}
                      {o.package_size && <span className="text-ink-4"> · {o.package_size}</span>}
                      <span className="block text-2xs text-ink-3">
                        @{o.vendor_handle} · {o.participant_type} · {o.status} · {o.payment_method.replaceAll("_", " ")} · money: {o.money_responsibility}
                        {o.collection_point_handle && ` · collect @${o.collection_point_handle}`}
                        {o.delivery_area && ` · ${o.delivery_area}`}
                        {o.repack_required && " · repacked"}
                      </span>
                      {o.deposit_recommended && <span className="block text-2xs text-accent-600">Deposit recommended for this large on-delivery order — your choice, not a requirement.</span>}
                    </span>
                    <span className="text-right">
                      <span className="block font-semibold text-ink-1">{currency(o.final_amount_kes)}</span>
                      <span className="block text-2xs text-ink-3">paid {currency(o.amount_paid_kes)} · due {currency(o.balance_due_kes)} · {o.payment_status}</span>
                    </span>
                    {mine && o.status === "requested" && (
                      <Button size="xs" loading={busy === `confirm-${o.id}`} onClick={() => act(`confirm-${o.id}`, () => locksAPI.confirmRunOrder(o.id), "Order confirmed — it is on the buying list")}>Confirm order</Button>
                    )}
                    {(isManager || o.collection_point_handle === currentHandle) && ["confirmed", "purchased", "allocated"].includes(o.status) && (
                      <>
                        <Input aria-label="Allocated quantity" type="number" min="0" step="any" placeholder="Alloc qty"
                          value={payDraft[`q-${o.id}`] ?? ""} onChange={(e) => setPayDraft({ ...payDraft, [`q-${o.id}`]: e.target.value })} wrapperClassName="w-24" />
                        <Button size="xs" variant="outline" onClick={() => act(`alloc-${o.id}`, () => locksAPI.allocateRunOrder(o.id, { quantity_allocated: Number(payDraft[`q-${o.id}`] || 0) }), "Allocation recorded")}>Allocate</Button>
                        <Button size="xs" variant="outline" onClick={() => act(`hand-${o.id}`, () => locksAPI.handoverRunOrder(o.id, o.delivery_mode === "home_delivery" ? "delivered" : "collected"), "Handed over")}>Hand over</Button>
                      </>
                    )}
                    {(isManager || mine || o.collection_point_handle === currentHandle) && o.balance_due_kes > 0 && o.status !== "cancelled" && (
                      <>
                        <Input aria-label="Payment amount" type="number" min="1" placeholder="KSh paid"
                          value={payDraft[o.id] ?? ""} onChange={(e) => setPayDraft({ ...payDraft, [o.id]: e.target.value })} wrapperClassName="w-24" />
                        <Button size="xs" loading={busy === `pay-${o.id}`} onClick={() => act(`pay-${o.id}`, () => locksAPI.recordRunPayment(o.id, { amount_kes: Number(payDraft[o.id] || 0), note: `Recorded via ${o.payment_method.replaceAll("_", " ")}` }), "Payment recorded (recorded, not held by the platform)")}>Record payment</Button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Manager: purchase + expenses + totals */}
          {isManager && run.status !== "completed" && (
            <div className="grid gap-2 lg:grid-cols-2">
              <form onSubmit={(e) => { e.preventDefault(); act("purchase", () => locksAPI.recordRunPurchase(selectedId, { ...purchaseForm, quantity_purchased: Number(purchaseForm.quantity_purchased), actual_unit_price: Number(purchaseForm.actual_unit_price), weight_loss_quantity: Number(purchaseForm.weight_loss_quantity || 0), rejected_quantity: Number(purchaseForm.rejected_quantity || 0) }), "Purchase recorded with receipt"); }} className="grid gap-2 sm:grid-cols-2 rounded-xl border border-edge-1 p-3">
                <p className="text-xs font-bold text-ink-1 sm:col-span-2">Record the supplier purchase</p>
                <Input label="Product" required value={purchaseForm.product_name} onChange={(e) => setPurchaseForm({ ...purchaseForm, product_name: e.target.value })} />
                <Input label="Supplier" value={purchaseForm.supplier_name} onChange={(e) => setPurchaseForm({ ...purchaseForm, supplier_name: e.target.value })} />
                <Input label="Quantity purchased" type="number" min="0.1" step="any" required value={purchaseForm.quantity_purchased} onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity_purchased: e.target.value })} />
                <Input label="Actual price / unit (KSh)" type="number" min="0" step="any" required value={purchaseForm.actual_unit_price} onChange={(e) => setPurchaseForm({ ...purchaseForm, actual_unit_price: e.target.value })} />
                <Input label="Receipt reference" value={purchaseForm.receipt_ref} onChange={(e) => setPurchaseForm({ ...purchaseForm, receipt_ref: e.target.value })} placeholder="Receipt book / photo" />
                <Input label="Weight loss / rejected Quantity" value={`${purchaseForm.weight_loss_quantity}/${purchaseForm.rejected_quantity}`}
                  onChange={(e) => { const [w, r] = e.target.value.split("/"); setPurchaseForm({ ...purchaseForm, weight_loss_quantity: w || "", rejected_quantity: r || "" }); }} placeholder="0.5/1" />
                <div className="sm:col-span-2"><Button type="submit" size="sm" loading={busy === "purchase"}>Save purchase</Button></div>
              </form>
              <form onSubmit={(e) => { e.preventDefault(); act("expense", () => locksAPI.recordRunExpense(selectedId, { ...expenseForm, amount_kes: Number(expenseForm.amount_kes) }), "Expense recorded"); }} className="grid gap-2 sm:grid-cols-2 rounded-xl border border-edge-1 p-3">
                <p className="text-xs font-bold text-ink-1 sm:col-span-2">Record a run cost</p>
                <Select label="Kind" value={expenseForm.kind} onChange={(e) => setExpenseForm({ ...expenseForm, kind: e.target.value })}
                  options={[{ value: "transport", label: "Transport" }, { value: "handling", label: "Handling" }, { value: "repacking", label: "Repacking" }, { value: "cold_chain", label: "Cold chain (ice/boxes)" }, { value: "market_fees", label: "Market fees" }, { value: "other", label: "Other" }]} />
                <Input label="Amount (KSh)" type="number" min="0" required value={expenseForm.amount_kes} onChange={(e) => setExpenseForm({ ...expenseForm, amount_kes: e.target.value })} />
                <Input label="Receipt reference" value={expenseForm.receipt_ref} onChange={(e) => setExpenseForm({ ...expenseForm, receipt_ref: e.target.value })} />
                <Input label="Note" value={expenseForm.note} onChange={(e) => setExpenseForm({ ...expenseForm, note: e.target.value })} />
                <div className="sm:col-span-2 flex flex-wrap gap-2 items-center">
                  <Button type="submit" size="sm" loading={busy === "expense"}>Save cost</Button>
                  <Select aria-label="Run status" value={run.status} onChange={(e) => act("status", () => locksAPI.setRunStatus(selectedId, e.target.value), "Run status updated")}
                    options={[{ value: "open", label: "Open" }, { value: "buying", label: "Buying" }, { value: "allocating", label: "Allocating" }, { value: "delivering", label: "Delivering" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }]} wrapperClassName="w-36" />
                </div>
              </form>
            </div>
          )}

          {totals && (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 text-center">
              <RunStat label="Revenue" value={currency(totals.selling_revenue_kes)} />
              <RunStat label="Supplier cost" value={currency(totals.supplier_cost_kes)} />
              <RunStat label="Run expenses" value={currency(totals.run_expenses_kes)} />
              <RunStat label="Collected" value={currency(totals.amount_collected_kes)} />
              <RunStat label="Outstanding" value={currency(totals.balance_outstanding_kes)} />
              <RunStat label="Est. profit" value={currency(totals.estimated_profit_kes)} />
              <p className="text-2xs text-ink-4 sm:col-span-3 lg:col-span-6 text-left">
                {totals.profit_formula} Received-and-paid rate: {fulfilment?.received_and_paid_rate ?? "—"}% · {ledger.ledger.money_note}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function RunStat({ label, value }) {
  return (
    <div className="rounded-xl border border-edge-1 bg-surface-0 p-3">
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <p className="text-sm font-extrabold text-ink-1 mt-0.5">{value}</p>
    </div>
  );
}
