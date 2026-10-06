import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Clock3, MapPin, Package, Plus, RefreshCw, ShoppingBasket, ShieldCheck, Store } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Spinner from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { locksAPI, apiError } from "@/lib/api";
import { currency, num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const EAT = "Africa/Nairobi";
const EAT_DATE = () => new Intl.DateTimeFormat("en-CA", { timeZone: EAT, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const timeLabel = (value) => value ? new Intl.DateTimeFormat("en-KE", { timeZone: EAT, hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";
const dateLabel = (value) => value ? new Intl.DateTimeFormat("en-KE", { timeZone: EAT, weekday: "short", day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00+03:00`)) : "—";
const stateBadge = { open: "brand", rolling: "amber", closed: "gray", collecting: "amber", bidding: "blue", locked: "brand", dissolved: "red" };
const readableState = (value = "") => value.replaceAll("_", " ");

function isAccepting(window, now) {
  return window && ["open", "rolling"].includes(window.status) && now >= new Date(window.opens_at) && now < new Date(window.closes_at);
}

export default function MarketLocks() {
  const [home, setHome] = useState(null);
  const [opsBoard, setOpsBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [zoneChoice, setZoneChoice] = useState("");
  const [zoneBusy, setZoneBusy] = useState(false);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [pickBusy, setPickBusy] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const { data } = await locksAPI.home();
      setHome(data);
      setZoneChoice(data.vendor_zone?.id || "");
      setProductId((current) => data.catalog?.some((item) => item.id === current) ? current : (data.catalog?.[0]?.id || ""));
      if (data.market_ops_role) {
        const { data: staffData } = await locksAPI.opsBoard();
        setOpsBoard(staffData);
      } else {
        setOpsBoard(null);
      }
    } catch (err) {
      setError(apiError(err, "Couldn't load the Market Locks desk"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const activeWindow = useMemo(() => {
    const now = new Date(clock);
    return home?.windows?.find((item) => isAccepting(item, now)) || null;
  }, [home, clock]);
  const selectedProduct = home?.catalog?.find((item) => item.id === productId);

  const assignZone = async (event) => {
    event.preventDefault();
    if (!zoneChoice) return toast.error("Choose a market zone");
    setZoneBusy(true);
    try {
      const { data } = await locksAPI.assignZone(zoneChoice);
      toast.success(data.message || "Market zone saved");
      await refresh(true);
    } catch (err) {
      toast.error(apiError(err, "Couldn't save the market zone"));
    } finally {
      setZoneBusy(false);
    }
  };

  const submitPick = async (event) => {
    event.preventDefault();
    if (!activeWindow) return toast.error("There isn't an open Daily Flash window right now");
    if (!productId || !(Number(quantity) > 0)) return toast.error("Choose a product and enter a quantity");
    setPickBusy(true);
    try {
      await locksAPI.submitPick(activeWindow.id, { product_id: productId, quantity: Number(quantity) });
      toast.success("Lock request saved — your quantity is in the zone total");
      setQuantity("");
      await refresh(true);
    } catch (err) {
      toast.error(apiError(err, "Couldn't submit the Lock request"));
    } finally {
      setPickBusy(false);
    }
  };

  const withdraw = async (pickId) => {
    try {
      await locksAPI.withdrawPick(pickId);
      toast.success("Lock request withdrawn");
      await refresh(true);
    } catch (err) {
      toast.error(apiError(err, "Couldn't withdraw that request"));
    }
  };

  if (loading && !home) return <Spinner className="py-16" />;
  if (!home && error) return <EmptyState icon={ShoppingBasket} title="Market Locks unavailable" description={error} action={<Button size="sm" onClick={() => refresh()}>Retry</Button>} />;

  const canChangeZone = Boolean(home?.can_change_zone);
  const zoneOptions = (home?.zones || []).map((zone) => ({ value: zone.id, label: `${zone.name} · ${zone.city}` }));

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShoppingBasket size={19} className="text-brand-400" />
            <h1 className="text-xl font-semibold tracking-tight text-ink-1">Market Locks</h1>
          </div>
          <p className="mt-1 text-xs text-ink-4">Pool tomorrow's wholesale demand with vendors in your named market zone.</p>
        </div>
        <Button size="sm" variant="secondary" icon={RefreshCw} loading={refreshing} onClick={() => refresh(true)}>Refresh</Button>
      </header>

      {error && <p className="rounded-lg bg-red-500/[0.08] ring-2 ring-red-500/20 px-3 py-2 text-xs text-red-200" role="alert">{error}</p>}

      <Card padding="p-4">
        <CardHeader>
          <CardTitle sub="Your zone keeps demand local; you can move once every 30 days">Choose your market</CardTitle>
          <Badge variant={home.vendor_zone ? "brand" : "amber"} size="xs"><MapPin size={10} />{home.vendor_zone?.name || "Set a zone"}</Badge>
        </CardHeader>
        {home.zones.length === 0 ? (
          <p className="text-xs text-ink-4">No market zones are open yet. A local market clerk will add the pilot zone.</p>
        ) : (
          <form onSubmit={assignZone} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Select
              label="Named market + 1 km walkable ring"
              value={zoneChoice}
              onChange={(event) => setZoneChoice(event.target.value)}
              options={zoneOptions}
              placeholder="Choose your market"
              disabled={!canChangeZone}
              wrapperClassName="flex-1"
            />
            <Button type="submit" size="sm" loading={zoneBusy} disabled={!canChangeZone || !zoneChoice || zoneChoice === home.vendor_zone?.id}>
              {home.vendor_zone ? "Change zone" : "Set my zone"}
            </Button>
          </form>
        )}
        {home.vendor_zone?.walkable_ring && <p className="mt-2 text-2xs text-ink-4">Zone boundary: {home.vendor_zone.walkable_ring}</p>}
        {!canChangeZone && home.zone_change_available_at && <p className="mt-2 text-2xs text-amber-300">Zone change available {dateLabel(home.zone_change_available_at.slice(0, 10))} (30-day rule).</p>}
      </Card>

      {!home.vendor_zone ? (
        <EmptyState icon={MapPin} title="Pick your market first" description="Locks only combine orders from your selected market zone. Set it above to see eligible products and the Daily Flash window." />
      ) : (
        <>
          <Card padding="p-4" className="bg-brand-500/[0.05]">
            <CardHeader>
              <CardTitle sub="Daily Flash · fixed market schedule">Current Lock window</CardTitle>
              {activeWindow && <Badge variant={stateBadge[activeWindow.status] || "gray"} size="xs">{readableState(activeWindow.status)}</Badge>}
            </CardHeader>
            {activeWindow ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
                  <span className="inline-flex items-center gap-1"><Clock3 size={13} />{timeLabel(activeWindow.opens_at)}–{timeLabel(activeWindow.closes_at)} EAT</span>
                  <span>Delivery target {timeLabel(activeWindow.delivery_at)} tomorrow</span>
                  {activeWindow.roll_count > 0 && <Badge variant="amber" size="xs">one-day roll</Badge>}
                </div>
                <form onSubmit={submitPick} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
                  <Select
                    label="Product"
                    value={productId}
                    onChange={(event) => setProductId(event.target.value)}
                    options={(home.catalog || []).map((product) => ({ value: product.id, label: `${product.name} · ${product.unit_of_measure}` }))}
                    placeholder="Choose a product"
                    disabled={!isAccepting(activeWindow, new Date(clock))}
                  />
                  <Input label={`Quantity${selectedProduct ? ` (${selectedProduct.unit_of_measure})` : ""}`} type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="e.g. 3" disabled={!isAccepting(activeWindow, new Date(clock))} />
                  <Button type="submit" loading={pickBusy} disabled={!isAccepting(activeWindow, new Date(clock)) || !home.catalog.length} icon={ArrowRight}>Lock request</Button>
                </form>
                {selectedProduct && <p className="text-2xs text-ink-4">Your zone has {selectedProduct.supplier_count} supplier price-sheet{selectedProduct.supplier_count === 1 ? "" : "s"}; the lowest configured 85% MOQ threshold is {num(selectedProduct.minimum_to_bid)} {selectedProduct.unit_of_measure}. Bids are collected only at the cluster's actual volume.</p>}
                {!home.catalog.length && <p className="text-xs text-amber-200">The spotter hasn't entered any supplier MOQs for this zone yet.</p>}
              </div>
            ) : (
              <p className="text-xs text-ink-4">No pick window is open right now. Daily Flash normally runs 3–8 PM East Africa Time. You can still review the latest zone totals below.</p>
            )}
          </Card>

          {(home.windows || []).map((flash) => (
            <section key={flash.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink-1">{dateLabel(flash.local_date)} · {flash.status === "open" || flash.status === "rolling" ? "Daily Flash" : "Previous Flash"}</h2>
                <Badge variant={stateBadge[flash.status] || "gray"} size="xs">{readableState(flash.status)}</Badge>
              </div>
              {flash.clusters.length ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {flash.clusters.map((cluster) => {
                    const myPick = cluster.my_pick;
                    const canWithdraw = myPick && cluster.status === "collecting" && ["open", "rolling"].includes(flash.status) && clock < new Date(flash.closes_at).getTime();
                    return (
                      <Card key={cluster.id} padding="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="truncate text-xs font-semibold text-ink-1">{cluster.product?.name}</h3>
                            <p className="mt-1 text-2xs text-ink-4">{num(cluster.quantity)} {cluster.product?.unit_of_measure} · {cluster.vendor_count} vendor{cluster.vendor_count === 1 ? "" : "s"}</p>
                          </div>
                          <Badge variant={stateBadge[cluster.status] || "gray"} size="xs">{readableState(cluster.status)}</Badge>
                        </div>
                        {cluster.status === "collecting" && (
                          <p className="mt-2 text-2xs text-ink-4">
                            {cluster.minimum_to_bid ? `${cluster.eligible_supplier_count} supplier${cluster.eligible_supplier_count === 1 ? "" : "s"} reachable at ≥ ${num(cluster.minimum_to_bid)} units.` : "Waiting for verified supplier MOQs."}
                            {cluster.roll_count > 0 && " One extension remains open."}
                          </p>
                        )}
                        {cluster.status === "bidding" && <p className="mt-2 text-2xs text-blue-200">Threshold met. A market negotiator is collecting prices for exactly {num(cluster.bid_quantity)} {cluster.product?.unit_of_measure}.</p>}
                        {cluster.status === "locked" && cluster.locked && <p className="mt-2 text-xs text-brand-200">{num(cluster.locked.quantity)} at {currency(cluster.locked.unit_price)} / {cluster.product?.unit_of_measure} · @{cluster.locked.supplier_handle}</p>}
                        {cluster.status === "dissolved" && <p className="mt-2 text-2xs text-ink-4">{cluster.dissolved_reason || "The threshold was not reached after the one-day roll."}</p>}
                        {myPick && <div className="mt-2 flex items-center justify-between border-t border-edge-1 pt-2 text-2xs"><span className="text-brand-300">Your Lock: {num(myPick.quantity)} {cluster.product?.unit_of_measure}</span>{canWithdraw && <Button size="xs" variant="ghost" onClick={() => withdraw(myPick.id)}>Withdraw</Button>}</div>}
                      </Card>
                    );
                  })}
                </div>
              ) : <p className="rounded-lg bg-white/[0.03] p-3 text-center text-2xs text-ink-4">No product requests in this window yet.</p>}
            </section>
          ))}
        </>
      )}

      {home.market_ops_role && <OperationsDesk role={home.market_ops_role} board={opsBoard} onRefresh={() => refresh(true)} />}
    </div>
  );
}

function OperationsDesk({ role, board, onRefresh }) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState("");
  const [zoneForm, setZoneForm] = useState({ name: "", city: "Nairobi", walkable_ring: "" });
  const [productForm, setProductForm] = useState({ name: "", category: "", unit_of_measure: "crates" });
  const [offerForm, setOfferForm] = useState({ supplier_handle: "", zone_id: "", product_id: "", minimum_order_quantity: "", notes: "" });
  const [windowZone, setWindowZone] = useState("");
  const [windowDate, setWindowDate] = useState(EAT_DATE());

  useEffect(() => {
    if (!board) return;
    setOfferForm((form) => ({
      ...form,
      supplier_handle: form.supplier_handle || board.vendors?.[0]?.vendor_handle || "",
      zone_id: form.zone_id || board.zones?.find((zone) => zone.is_active)?.id || "",
      product_id: form.product_id || board.products?.find((product) => product.is_active)?.id || "",
    }));
    setWindowZone((current) => current || board.zones?.find((zone) => zone.is_active)?.id || "");
  }, [board]);

  const perform = async (key, work, success) => {
    setBusy(key);
    try {
      await work();
      toast.success(success);
      await onRefresh();
      return true;
    } catch (err) {
      toast.error(apiError(err, "Market desk action failed"));
      return false;
    } finally {
      setBusy("");
    }
  };

  if (!board) return <Card><Spinner /></Card>;
  const canCatalog = role === "admin";
  const canSpot = role === "admin" || role === "spotter";
  const canWindow = role === "admin" || role === "clerk";
  const canNegotiate = role === "admin" || role === "negotiator";
  const canClose = canWindow || canNegotiate;

  const createZone = (event) => {
    event.preventDefault();
    perform("zone", () => locksAPI.createZone(zoneForm), "Market zone added").then((ok) => { if (ok) setZoneForm({ name: "", city: "Nairobi", walkable_ring: "" }); });
  };
  const createProduct = (event) => {
    event.preventDefault();
    perform("product", () => locksAPI.createProduct(productForm), "Product added").then((ok) => { if (ok) setProductForm({ name: "", category: "", unit_of_measure: "crates" }); });
  };
  const saveOffer = (event) => {
    event.preventDefault();
    if (!(Number(offerForm.minimum_order_quantity) > 0)) return toast.error("Enter a positive supplier MOQ");
    perform("offer", () => locksAPI.upsertOffer({ ...offerForm, minimum_order_quantity: Number(offerForm.minimum_order_quantity) }), "Supplier MOQ saved");
  };
  const createWindow = (event) => {
    event.preventDefault();
    if (!windowZone || !windowDate) return toast.error("Choose a zone and date");
    perform("window", () => locksAPI.createWindow({ zone_id: windowZone, local_date: windowDate }), "Daily Flash window scheduled");
  };
  const toggleOffer = (offer) => perform(`offer-status-${offer.id}`, () => locksAPI.updateOffer(offer.id, !offer.is_active), `Supplier MOQ ${offer.is_active ? "deactivated" : "reactivated"}`);
  const toggleProduct = (product) => perform(`product-status-${product.id}`, () => locksAPI.updateProduct(product.id, !product.is_active), `Product ${product.is_active ? "deactivated" : "reactivated"}`);
  const toggleZone = (zone) => perform(`zone-status-${zone.id}`, () => locksAPI.updateZone(zone.id, { is_active: !zone.is_active }), `Market zone ${zone.is_active ? "deactivated" : "reactivated"}`);

  return (
    <Card padding="p-4" className="bg-amber-500/[0.04]">
      <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <div>
          <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-amber-300" /><h2 className="text-sm font-semibold text-ink-1">Market operations desk</h2><Badge variant="amber" size="xs">{role}</Badge></div>
          <p className="mt-1 text-xs text-ink-4">Supplier price sheets, daily windows and cluster bidding. No payments are collected here.</p>
        </div>
        <span className="text-xs text-ink-4">{open ? "Hide" : "Open"}</span>
      </button>

      {open && <div className="mt-4 space-y-4">
        {canCatalog && <div className="grid gap-3 lg:grid-cols-2">
          <form onSubmit={createZone} className="space-y-2 rounded-lg border border-edge-1 bg-surface-2 p-3">
            <h3 className="text-xs font-semibold text-ink-1">Add a market zone</h3>
            <Input label="Market name" required value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} placeholder="Gikomba A" />
            <Input label="City" required value={zoneForm.city} onChange={(e) => setZoneForm({ ...zoneForm, city: e.target.value })} />
            <Input label="Boundary note" value={zoneForm.walkable_ring} onChange={(e) => setZoneForm({ ...zoneForm, walkable_ring: e.target.value })} placeholder="Gikomba A + 1 km walkable ring" />
            <Button size="sm" type="submit" loading={busy === "zone"} icon={Plus}>Add zone</Button>
          </form>
          <form onSubmit={createProduct} className="space-y-2 rounded-lg border border-edge-1 bg-surface-2 p-3">
            <h3 className="text-xs font-semibold text-ink-1">Add a canonical product</h3>
            <Input label="Product" required value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} placeholder="Tomatoes" />
            <div className="grid grid-cols-2 gap-2">
              <Input label="Family" value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} placeholder="Produce" />
              <Input label="Unit" required value={productForm.unit_of_measure} onChange={(e) => setProductForm({ ...productForm, unit_of_measure: e.target.value })} placeholder="crates" />
            </div>
            <Button size="sm" type="submit" loading={busy === "product"} icon={Package}>Add product</Button>
          </form>
        </div>}

        {canCatalog && <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-edge-1 bg-surface-2 p-3"><h3 className="mb-2 text-xs font-semibold text-ink-1">Manage market zones</h3>
            <div className="space-y-1.5">{board.zones.map((zone) => <div key={zone.id} className="flex items-center justify-between gap-2 rounded-md border border-edge-1 px-2 py-1.5 text-xs"><span>{zone.name} <span className="text-ink-4">· {zone.city}</span></span><Button size="xs" variant="ghost" loading={busy === `zone-status-${zone.id}`} onClick={() => toggleZone(zone)}>{zone.is_active ? "Deactivate" : "Activate"}</Button></div>)}</div>
          </div>
          <div className="rounded-lg border border-edge-1 bg-surface-2 p-3"><h3 className="mb-2 text-xs font-semibold text-ink-1">Manage products</h3>
            <div className="space-y-1.5">{board.products.map((product) => <div key={product.id} className="flex items-center justify-between gap-2 rounded-md border border-edge-1 px-2 py-1.5 text-xs"><span>{product.name} <span className="text-ink-4">· {product.unit_of_measure}</span></span><Button size="xs" variant="ghost" loading={busy === `product-status-${product.id}`} onClick={() => toggleProduct(product)}>{product.is_active ? "Deactivate" : "Activate"}</Button></div>)}</div>
          </div>
        </div>}

        {canSpot && <form onSubmit={saveOffer} className="space-y-2 rounded-lg border border-edge-1 bg-surface-2 p-3">
          <div className="flex items-center gap-2"><Store size={14} className="text-brand-300" /><h3 className="text-xs font-semibold text-ink-1">Supplier price-sheet MOQ</h3></div>
          <p className="text-2xs text-ink-4">Enter the supplier's real MOQ by product and zone. The bid threshold is calculated, not hand-entered.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="Supplier" value={offerForm.supplier_handle} onChange={(e) => setOfferForm({ ...offerForm, supplier_handle: e.target.value })} options={board.vendors.map((vendor) => ({ value: vendor.vendor_handle, label: `${vendor.business_name} · @${vendor.vendor_handle}` }))} placeholder="Choose supplier" />
            <Select label="Market zone" value={offerForm.zone_id} onChange={(e) => setOfferForm({ ...offerForm, zone_id: e.target.value })} options={board.zones.filter((zone) => zone.is_active).map((zone) => ({ value: zone.id, label: `${zone.name} · ${zone.city}` }))} placeholder="Choose zone" />
            <Select label="Product" value={offerForm.product_id} onChange={(e) => setOfferForm({ ...offerForm, product_id: e.target.value })} options={board.products.filter((product) => product.is_active).map((product) => ({ value: product.id, label: `${product.name} · ${product.unit_of_measure}` }))} placeholder="Choose product" />
            <Input label="Supplier MOQ" type="number" min="1" step="1" required value={offerForm.minimum_order_quantity} onChange={(e) => setOfferForm({ ...offerForm, minimum_order_quantity: e.target.value })} placeholder="40" />
          </div>
          <div className="flex flex-wrap items-end gap-2"><Input label="Spotter note / source" value={offerForm.notes} onChange={(e) => setOfferForm({ ...offerForm, notes: e.target.value })} placeholder="Supplier sheet checked today" wrapperClassName="min-w-[16rem] flex-1" /><Button size="sm" type="submit" loading={busy === "offer"}>Save MOQ</Button></div>
        </form>}

        {canWindow && <form onSubmit={createWindow} className="flex flex-col gap-2 rounded-lg border border-edge-1 bg-surface-2 p-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1"><h3 className="text-xs font-semibold text-ink-1">Schedule a Daily Flash</h3><p className="mb-2 text-2xs text-ink-4">Default timing: 3–8 PM EAT, delivery next day 5 AM. One window per zone per date.</p>
            <div className="grid grid-cols-2 gap-2"><Select label="Zone" value={windowZone} onChange={(e) => setWindowZone(e.target.value)} options={board.zones.filter((zone) => zone.is_active).map((zone) => ({ value: zone.id, label: zone.name }))} placeholder="Choose zone" /><Input label="Local date" type="date" value={windowDate} onChange={(e) => setWindowDate(e.target.value)} /></div>
          </div>
          <Button type="submit" size="sm" loading={busy === "window"} icon={Clock3}>Schedule</Button>
        </form>}

        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-ink-1">Windows & supplier clusters</h3>
          {board.windows.length === 0 ? <p className="text-xs text-ink-4">No windows created yet. Active zones get a Daily Flash window automatically from the scheduler; use Schedule to set up a future date.</p> : board.windows.map((flash) => (
            <OpsWindow key={flash.id} window={flash} canClose={canClose} canNegotiate={canNegotiate} busy={busy} perform={perform} />
          ))}
        </div>

        {canSpot && <div className="overflow-x-auto rounded-lg border border-edge-1">
          <table className="w-full min-w-[36rem] text-xs"><thead className="bg-surface-2 text-2xs uppercase text-ink-4"><tr><th className="p-2 text-left">Supplier</th><th className="p-2 text-left">Zone</th><th className="p-2 text-left">Product</th><th className="p-2 text-right">MOQ</th><th className="p-2 text-right">Bid from</th><th className="p-2 text-left">Status</th><th className="p-2 text-right">Action</th></tr></thead>
            <tbody>{board.offers.map((offer) => <tr key={offer.id} className="border-t border-edge-1"><td className="p-2">{offer.supplier_business} <span className="text-ink-4">@{offer.supplier_handle}</span></td><td className="p-2">{offer.zone_name}</td><td className="p-2">{offer.product_name}</td><td className="p-2 text-right">{num(offer.minimum_order_quantity)}</td><td className="p-2 text-right font-semibold text-brand-300">{num(offer.minimum_to_bid)}</td><td className="p-2"><Badge size="xs" variant={offer.is_active ? "brand" : "gray"}>{offer.is_active ? "active" : "inactive"}</Badge></td><td className="p-2 text-right"><Button size="xs" variant="ghost" loading={busy === `offer-status-${offer.id}`} onClick={() => toggleOffer(offer)}>{offer.is_active ? "Deactivate" : "Activate"}</Button></td></tr>)}</tbody>
          </table>
        </div>}
      </div>}
    </Card>
  );
}

function OpsWindow({ window: flash, canClose, canNegotiate, busy, perform }) {
  const close = () => perform(`close-${flash.id}`, () => locksAPI.closeWindow(flash.id), "Window evaluated");
  return (
    <Card padding="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h4 className="text-xs font-semibold text-ink-1">{flash.zone?.name} · {dateLabel(flash.local_date)}</h4><Badge size="xs" variant={stateBadge[flash.status] || "gray"}>{readableState(flash.status)}</Badge><span className="text-2xs text-ink-4">{timeLabel(flash.opens_at)}–{timeLabel(flash.closes_at)} EAT · roll {flash.roll_count}/1</span></div>
        {canClose && ["open", "rolling"].includes(flash.status) && <Button size="xs" variant="secondary" loading={busy === `close-${flash.id}`} onClick={close}>Evaluate now</Button>}
      </div>
      {flash.clusters.length === 0 ? <p className="mt-2 text-2xs text-ink-4">No demand entered for this window.</p> : <div className="mt-3 space-y-2">{flash.clusters.map((cluster) => <OpsCluster key={cluster.id} cluster={cluster} canNegotiate={canNegotiate} busy={busy} perform={perform} />)}</div>}
    </Card>
  );
}

function OpsCluster({ cluster, canNegotiate, busy, perform }) {
  const [supplierMoqId, setSupplierMoqId] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const eligibleOffers = cluster.supplier_offers?.filter((offer) => offer.eligible) || [];
  useEffect(() => {
    setSupplierMoqId((current) => current || eligibleOffers[0]?.id || "");
  }, [eligibleOffers]);
  const addQuote = (event) => {
    event.preventDefault();
    if (!supplierMoqId || price === "" || Number(price) < 0) return toast.error("Choose an eligible supplier and enter the quote");
    perform(`quote-${cluster.id}`, () => locksAPI.addQuote(cluster.id, {
      supplier_moq_id: supplierMoqId, quoted_quantity: cluster.bid_quantity, unit_price: Number(price), notes: notes.trim() || null,
    }), "Supplier quote recorded").then(() => { setPrice(""); setNotes(""); });
  };
  const offers = (cluster.quotes || []).filter((quote) => quote.status === "offered");
  const bestPrice = Math.min(...offers.map((quote) => quote.unit_price), Number.POSITIVE_INFINITY);

  return (
    <div className="rounded-lg border border-edge-1 bg-surface-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h5 className="text-xs font-semibold text-ink-1">{cluster.product?.name} · {num(cluster.quantity)} {cluster.product?.unit_of_measure} · {cluster.vendor_count} vendors</h5>
          <p className="mt-1 text-2xs text-ink-4">Status: {readableState(cluster.status)}{cluster.bid_quantity ? ` · bid volume ${num(cluster.bid_quantity)} ${cluster.product?.unit_of_measure}` : ""}{cluster.minimum_to_bid ? ` · nearest eligible floor ${num(cluster.minimum_to_bid)}` : ""}</p></div>
        <Badge size="xs" variant={stateBadge[cluster.status] || "gray"}>{readableState(cluster.status)}</Badge>
      </div>
      {cluster.dissolved_reason && <p className="mt-2 text-2xs text-amber-200">Reason: {cluster.dissolved_reason}</p>}
      {cluster.supplier_offers?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{cluster.supplier_offers.map((offer) => <span key={offer.id} className={cn("rounded-md border px-2 py-1 text-2xs", offer.eligible ? "border-brand-900/60 bg-brand-950/30 text-brand-200" : "border-edge-1 text-ink-4")}>@{offer.supplier_handle} · MOQ {num(offer.minimum_order_quantity)} · bid ≥ {num(offer.minimum_to_bid)} {offer.eligible ? "✓" : ""}</span>)}</div>}

      {cluster.status === "bidding" && canNegotiate && <form onSubmit={addQuote} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_auto] sm:items-end">
        <Select label="Supplier" value={supplierMoqId} onChange={(event) => setSupplierMoqId(event.target.value)} options={eligibleOffers.map((offer) => ({ value: offer.id, label: `${offer.supplier_business} · MOQ ${offer.minimum_order_quantity}` }))} placeholder="Eligible suppliers" />
        <Input label={`Exact volume · ${cluster.product?.unit_of_measure}`} value={cluster.bid_quantity} disabled />
        <Input label="Quoted price / unit" type="number" min="0" step="any" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="2600" />
        <Button type="submit" size="sm" loading={busy === `quote-${cluster.id}`}>Record quote</Button>
        <Input label="Negotiator note" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Supplier confirmed by call / SMS" wrapperClassName="sm:col-span-4" />
      </form>}

      {cluster.quotes?.length > 0 && <div className="mt-3 space-y-1.5">
        {cluster.quotes.map((quote) => <div key={quote.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-edge-1 bg-surface-1 px-2.5 py-2 text-xs">
          <span><strong className="text-ink-1">{quote.supplier_business}</strong><span className="ml-1 text-ink-4">@{quote.supplier_handle}</span><span className="ml-2 font-mono text-brand-200">{currency(quote.unit_price)} / unit</span><span className="ml-2 text-ink-4">for exactly {num(quote.quoted_quantity)}</span>{quote.notes && <span className="ml-2 text-ink-4">· {quote.notes}</span>}</span>
          <span className="inline-flex items-center gap-2"><Badge size="xs" variant={quote.status === "selected" ? "brand" : quote.status === "passed" ? "gray" : "blue"}>{quote.status}</Badge>{cluster.status === "bidding" && canNegotiate && quote.status === "offered" && <><span className={cn("text-2xs", quote.unit_price > bestPrice ? "text-amber-200" : "text-brand-200")}>{quote.unit_price > bestPrice ? "Above lowest" : "Lowest price"}</span><Button size="xs" variant="secondary" loading={busy === `select-${cluster.id}-${quote.id}`} onClick={() => perform(`select-${cluster.id}-${quote.id}`, () => locksAPI.selectQuote(cluster.id, quote.id), "Supplier quote selected at the cluster volume")}>Select bid</Button></>}</span>
        </div>)}
      </div>}
      {cluster.status === "locked" && <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-200"><Check size={13} />Locked at {currency(cluster.locked?.unit_price)} / unit · {num(cluster.locked?.quantity)} units</p>}
      {cluster.status === "collecting" && !cluster.supplier_offers?.length && <p className="mt-2 inline-flex items-center gap-1 text-2xs text-amber-200"><AlertTriangle size={12} />No verified supplier MOQ is available for this cluster.</p>}
    </div>
  );
}
