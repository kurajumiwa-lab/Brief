import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowDownToLine, CalendarClock, FileText, Globe, HeartHandshake, MapPin,
  MessageSquare, Package, Pencil, Plug, Scale, ShieldCheck, Truck,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import QuantityStepper from "@/components/ui/QuantityStepper";
import Textarea from "@/components/ui/Textarea";
import Input from "@/components/ui/Input";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton, { SkeletonText } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import QualityBadge from "@/components/stock/QualityBadge";
import StockThumb from "@/components/stock/StockThumb";
import StockCard from "@/components/stock/StockCard";
import SourceDialog from "@/components/stock/SourceDialog";
import { LevelBadge, ReliabilityMeter, TrustRow } from "@/components/trust/TrustSignals";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useStockStore } from "@/stores/stockStore";
import { stockAPI, vendorAPI, apiError } from "@/lib/api";
import { currency, num, relativeTime, shortDate } from "@/lib/formatters";
import { numOrNull } from "@/lib/utils";
import { QUALITY_STATUSES } from "@/config/constants";

/* ═══════════════════════════════════════════════════════════════════════════
   LISTING — the page the product never had.
   ---------------------------------------------------------------------------
   WHAT CHANGED   Sourcing used to happen in a modal launched from a card. It
                  now has a canonical, linkable page: `/listing/:id`.
   WHY            This is the highest-intent moment in the whole product and it
                  had no room for the evidence a buyer needs (provenance, the
                  supplier's record, alternatives, terms) and no URL to share.
   PRESERVED      The modal still exists and is still used from cards and
                  shelves. This page calls the SAME endpoint with the SAME
                  payload: POST /stock/{id}/source { quantity, proposed_price,
                  notes }. The state machine it starts is untouched.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function ListingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.vendor);
  const sourceStock = useStockStore((s) => s.source);
  const openDeal = useChatStore((s) => s.openDeal);
  const openDirect = useChatStore((s) => s.openDirect);

  const [item, setItem] = useState(null);
  const [vendor, setVendor] = useState(null);
  const [alternatives, setAlternatives] = useState([]);
  const [error, setError] = useState("");
  const [sourcingAlt, setSourcingAlt] = useState(null);

  // order panel
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    setItem(null);
    try {
      const { data } = await stockAPI.get(id);
      setItem(data);
      setQuantity(data.min_order_quantity || 1);
      vendorAPI
        .byHandle(data.vendor_handle)
        .then((r) => setVendor(r.data))
        .catch(() => {});
      stockAPI
        .alternatives(id, 8)
        .then((r) => setAlternatives(r.data.filter((a) => a.id !== id)))
        .catch(() => setAlternatives([]));
    } catch (e) {
      setError(apiError(e, "That listing is not available"));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const own = !!item && me?.vendor_handle === item.vendor_handle;
  const available = item?.quantity_available ?? 0;
  const min = item?.min_order_quantity || 1;
  const out = available <= 0;
  const unit = price !== "" ? Number(price) : item?.unit_price ?? 0;
  const total = useMemo(() => Number(quantity || 0) * Number(unit || 0), [quantity, unit]);
  const qualityMeta = QUALITY_STATUSES.find((q) => q.value === item?.quality_status);

  const submit = async (e) => {
    e.preventDefault();
    if (!item || out) return;
    setBusy(true);
    try {
      const res = await sourceStock(item.id, {
        quantity: Number(quantity),
        proposed_price: numOrNull(price),
        notes: notes.trim() || null,
      });
      toast.success(`Request sent to @${item.vendor_handle} · ${currency(res?.total_value ?? total)}`);
      navigate("/orders?direction=incoming");
    } catch (err) {
      toast.error(apiError(err, "Couldn't create the sourcing request"));
    } finally {
      setBusy(false);
    }
  };

  const message = async () => {
    try {
      navigate(`/chat?room=${await openDirect(item.vendor_id)}`);
    } catch (e) {
      toast.error(apiError(e, "Couldn't open a direct room"));
    }
  };

  const negotiate = async () => {
    try {
      navigate(`/chat?room=${await openDeal(item.id)}`);
    } catch (e) {
      toast.error(apiError(e, "Couldn't open a deal room"));
    }
  };

  if (error) {
    return (
      <ErrorState
        title="Listing unavailable"
        description={error}
        action={
          <Button size="sm" onClick={() => navigate("/browse")}>
            Back to browse
          </Button>
        }
      />
    );
  }

  if (!item) return <ListingSkeleton />;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Home", to: "/" },
          { label: "Browse", to: "/browse" },
          ...(item.category ? [{ label: item.category, to: `/browse?category=${encodeURIComponent(item.category)}` }] : []),
          { label: item.name },
        ]}
      />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem] gap-6 items-start">
        {/* ══ left: the evidence ══════════════════════════════════════ */}
        <div className="space-y-6 min-w-0">
          <header className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <QualityBadge status={item.quality_status} showUnverified />
              {item.source === "pos_sync" && (
                <Badge variant="blue" size="sm">
                  <Plug size={11} aria-hidden="true" /> Live from till
                </Badge>
              )}
              {out && (
                <Badge variant="red" size="sm">
                  Sold out
                </Badge>
              )}
            </div>
            <h1 className="text-3xl font-bold text-ink-1 tracking-tight text-balance">{item.name}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-4">
              {item.category && <span className="font-semibold uppercase tracking-[0.08em]">{item.category}</span>}
              {item.sku && <span className="font-mono">SKU {item.sku}</span>}
              {item.updated_at && <span>restated {relativeTime(item.updated_at)}</span>}
            </div>
          </header>

          <StockThumb item={item} ratio="aspect-[2/1]" rounded="rounded-2xl border border-edge-1" />

          {item.description && <p className="text-sm text-ink-2 leading-relaxed max-w-2xl text-pretty">{item.description}</p>}

          {/* facts */}
          <section aria-labelledby="facts-heading">
            <h2 id="facts-heading" className="text-lg font-bold text-ink-1 mb-3">
              The line, in numbers
            </h2>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Fact label="Available now" value={num(available)} sub={item.unit_of_measure || "units"} tone={out ? "red" : "default"} />
              <Fact label="Reserved" value={num(item.quantity_reserved || 0)} sub="held by open requests" />
              <Fact label="Minimum order" value={num(min)} sub={item.unit_of_measure || "units"} />
              <Fact
                label="Wholesale"
                value={item.wholesale_price != null ? currency(item.wholesale_price) : "—"}
                sub={item.wholesale_price != null ? "bulk rate" : "not stated"}
              />
            </dl>
            <p className="mt-2 text-micro text-ink-4">
              Available is in-stock minus everything currently reserved by pending requests — it is what can actually ship.
            </p>
          </section>

          {/* provenance */}
          <section aria-labelledby="prov-heading" className="rounded-2xl border border-edge-1 bg-surface-1 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="prov-heading" className="text-lg font-bold text-ink-1">
                  Provenance
                </h2>
                <p className="text-2xs text-ink-3 mt-0.5">{qualityMeta?.hint || "No provenance on file"}</p>
              </div>
              <QualityBadge status={item.quality_status} showUnverified size="md" />
            </div>
            {item.batch_number || item.origin_country || item.expiry_date || item.spec_sheet_url ? (
              <dl className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-3">
                {item.batch_number && <Row icon={Package} label="Batch / lot" value={item.batch_number} mono />}
                {item.origin_country && <Row icon={Globe} label="Origin" value={item.origin_country} />}
                {item.expiry_date && (
                  <Row
                    icon={CalendarClock}
                    label="Expires"
                    value={shortDate(item.expiry_date)}
                    danger={new Date(item.expiry_date) < Date.now()}
                  />
                )}
                {item.verified_at && <Row icon={ShieldCheck} label="Verified" value={relativeTime(item.verified_at)} />}
                {item.spec_sheet_url && (
                  <div className="sm:col-span-2">
                    <a
                      href={item.spec_sheet_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 dark:text-brand-400 hover:underline"
                    >
                      <FileText size={14} aria-hidden="true" /> Open the spec sheet
                    </a>
                  </div>
                )}
              </dl>
            ) : (
              <p className="mt-4 text-xs text-ink-4">
                This vendor has not declared a batch, origin or expiry for this line. Nothing is hidden — there is simply nothing on file.
              </p>
            )}
          </section>

          {item.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((t) => (
                <Link key={t} to={`/browse?search=${encodeURIComponent(t)}`}>
                  <Badge variant="outline" size="md">
                    {t}
                  </Badge>
                </Link>
              ))}
            </div>
          )}

          {/* alternatives — the compare mechanic, inline */}
          <section aria-labelledby="alt-heading">
            <div className="flex items-end justify-between gap-3 mb-3">
              <div>
                <h2 id="alt-heading" className="text-lg font-bold text-ink-1 inline-flex items-center gap-2">
                  <Scale size={18} className="text-ink-4" aria-hidden="true" /> Compare alternatives
                </h2>
                <p className="text-2xs text-ink-3 mt-0.5">
                  Same category, from other vendors, cheapest network price first — the mechanic that makes a second supplier worth having.
                </p>
              </div>
            </div>
            {alternatives.length === 0 ? (
              <p className="text-xs text-ink-4 rounded-2xl border border-dashed border-edge-1 bg-surface-1 p-5">
                Nobody else on the network is showing this category right now. That is a gap, not an error.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {alternatives.slice(0, 6).map((alt) => (
                  <StockCard key={alt.id} item={alt} mode="network" onSource={setSourcingAlt} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ══ right: the order panel ══════════════════════════════════ */}
        <aside className="lg:sticky lg:top-[calc(var(--header-h)+var(--rail-h)+1rem)] space-y-4">
          <div className="rounded-2xl border border-edge-1 bg-surface-0 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-edge-1">
              <p className="text-micro uppercase tracking-[0.1em] font-bold text-ink-4">
                {item.unit_price != null ? "Vendor's stated price" : "No price stated"}
              </p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-ink-1 tabular-nums">
                  {item.unit_price != null ? currency(item.unit_price) : "Ask"}
                </span>
                <span className="text-xs text-ink-4 font-medium">/ {item.unit_of_measure || "unit"}</span>
              </p>
              {item.updated_at && <p className="mt-1 text-micro text-ink-4">stated {relativeTime(item.updated_at)} · never a computed market price</p>}
            </div>

            {own ? (
              <div className="p-5 space-y-3">
                <p className="text-xs text-ink-3">This is your own line. The network sees it {item.visible_to_network ? "right now" : "only when you make it visible"}.</p>
                <Button fullWidth icon={Pencil} onClick={() => navigate("/stock")}>
                  Manage on my shelf
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="p-5 space-y-4">
                <div>
                  <label htmlFor="qty" className="block text-2xs font-semibold text-ink-2 mb-1.5">
                    How much do you need?
                  </label>
                  <QuantityStepper
                    id="qty"
                    value={Number(quantity) || min}
                    onChange={setQuantity}
                    min={min}
                    max={Math.max(min, available)}
                    unit={item.unit_of_measure}
                    disabled={out}
                    className="w-full"
                  />
                  <p className="mt-1.5 text-micro text-ink-4">
                    min {num(min)} · {num(available)} available
                  </p>
                </div>

                <Input
                  label="Counter-offer per unit"
                  type="number"
                  min="0"
                  step="any"
                  prefix="KES"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  hint="Leave blank to accept their stated price"
                  disabled={out}
                />

                <Textarea
                  label="Note for the supplier"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Pickup Saturday morning, cash on collection…"
                  disabled={out}
                />

                <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-3">
                  <span className="text-2xs font-semibold text-ink-3">Estimated total</span>
                  <output className="text-base font-bold text-ink-1 tabular-nums">{currency(total)}</output>
                </div>

                <Button type="submit" size="lg" fullWidth icon={ArrowDownToLine} loading={busy} disabled={out}>
                  {out ? "Sold out" : "Send sourcing request"}
                </Button>
                <Button type="button" size="lg" variant="secondary" fullWidth icon={HeartHandshake} onClick={negotiate}>
                  Negotiate in a deal room
                </Button>
                <p className="text-micro text-ink-4 leading-relaxed">
                  Sending a request reserves {num(Number(quantity) || min)} {item.unit_of_measure || "units"} on their shelf until they confirm
                  or the hold expires. You are not charged here — payment terms are agreed between you.
                </p>
              </form>
            )}
          </div>

          {/* the supplier */}
          <div className="rounded-2xl border border-edge-1 bg-surface-0 shadow-xs p-5">
            <div className="flex items-start gap-3">
              <Link to={`/@${item.vendor_handle}`}>
                <Avatar name={item.vendor_business} size="md" />
              </Link>
              <div className="min-w-0 flex-1">
                <Link to={`/@${item.vendor_handle}`} className="block text-sm font-semibold text-ink-1 hover:underline underline-offset-2 truncate">
                  {item.vendor_business}
                </Link>
                <p className="text-2xs text-ink-4 font-mono truncate">@{item.vendor_handle}</p>
              </div>
            </div>

            <div className="mt-3">
              <TrustRow
                vendor={{
                  fulfillment_rate: item.vendor_fulfillment_rate,
                  movements_completed: vendor?.movements_completed ?? (item.vendor_fulfillment_rate != null ? 3 : 0),
                  is_patron: item.vendor_is_patron,
                  is_verified: vendor?.is_verified,
                  has_pos_connected: item.source === "pos_sync",
                }}
              />
            </div>

            <ReliabilityMeter
              className="mt-4"
              rate={item.vendor_fulfillment_rate}
              completed={vendor?.movements_completed ?? vendor?.total_supplied}
            />

            {vendor?.physical_location && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-2xs text-ink-3">
                <MapPin size={13} aria-hidden="true" /> {vendor.physical_location}
              </p>
            )}

            {!own && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button size="sm" variant="secondary" icon={MessageSquare} onClick={message}>
                  Message
                </Button>
                <Button size="sm" variant="secondary" onClick={() => navigate(`/@${item.vendor_handle}`)}>
                  Shop front
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4">
            <h2 className="text-2xs font-bold text-ink-1 inline-flex items-center gap-1.5">
              <Truck size={14} className="text-ink-4" aria-hidden="true" /> How the order runs
            </h2>
            <ol className="mt-2.5 space-y-1.5 text-micro text-ink-3">
              {["You request — stock is reserved", "Supplier confirms", "Supplier ships", "You mark it received"].map((step, i) => (
                <li key={step} className="flex gap-2">
                  <span className="w-4 h-4 shrink-0 rounded-full bg-surface-3 text-ink-2 grid place-items-center font-bold text-[0.5625rem]">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-2.5 text-micro text-ink-4">Only a received movement scores either side.</p>
          </div>
        </aside>
      </div>

      <SourceDialog item={sourcingAlt} open={!!sourcingAlt} onClose={() => setSourcingAlt(null)} onDone={() => navigate("/orders")} />
    </div>
  );
}

function Fact({ label, value, sub, tone = "default" }) {
  return (
    <div className="rounded-xl border border-edge-1 bg-surface-1 px-3.5 py-3">
      <dt className="text-micro uppercase tracking-[0.1em] font-bold text-ink-4">{label}</dt>
      <dd className={tone === "red" ? "text-xl font-bold text-red-600 dark:text-red-400 tabular-nums mt-1" : "text-xl font-bold text-ink-1 tabular-nums mt-1"}>
        {value}
      </dd>
      {sub && <p className="text-micro text-ink-4">{sub}</p>}
    </div>
  );
}

function Row({ icon: Icon, label, value, mono, danger }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={15} className="text-ink-4 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-micro uppercase tracking-[0.1em] font-bold text-ink-4">{label}</dt>
        <dd className={`text-xs font-semibold ${danger ? "text-red-600 dark:text-red-400" : "text-ink-1"} ${mono ? "font-mono" : ""}`}>{value}</dd>
      </div>
    </div>
  );
}

function ListingSkeleton() {
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem] gap-6" role="status" aria-label="Loading listing">
      <div className="space-y-5">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-64 w-full" rounded="rounded-2xl" />
        <SkeletonText lines={3} />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-xl" />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-80 w-full" rounded="rounded-2xl" />
        <Skeleton className="h-44 w-full" rounded="rounded-2xl" />
      </div>
    </div>
  );
}
