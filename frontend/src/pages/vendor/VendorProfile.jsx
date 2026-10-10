import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  BadgeCheck, Box, Clock, CreditCard, Crown, Award, Layers, MapPin, MessageSquare,
  Package, Pencil, Plug, Search, Share2, ShieldCheck, Truck,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Stat from "@/components/ui/Stat";
import Tabs from "@/components/ui/Tabs";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import { SkeletonGrid } from "@/components/ui/Skeleton";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { TrustRow, ReliabilityMeter, vendorLevel } from "@/components/trust/TrustSignals";
import ParasitismBadge from "@/components/vendor/ParasitismBadge";
import ConnectionButton from "@/components/vendor/ConnectionButton";
import StockCard from "@/components/stock/StockCard";
import SourceDialog from "@/components/stock/SourceDialog";
import { Check } from "@/components/forms/GroupForm";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { vendorAPI, stockAPI, apiError } from "@/lib/api";
import { ROLE_BADGE, VENDOR_ROLES } from "@/config/constants";
import { currency, num } from "@/lib/formatters";
import { splitList } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   SHOP FRONT — /@handle
   ---------------------------------------------------------------------------
   WHAT CHANGED   The vendor page was a header card, four stats and a grid.
                  It is now a shop front: identity and trust above the fold,
                  the shelf as the main body, the trade record and the
                  business details behind tabs.
   WHY            This is the page a buyer lands on from every card, every
                  movement and every chat room. It has to answer "can I trust
                  them, and what can I buy" without scrolling.
   PRESERVED      Same endpoints (vendors/{handle}, vendors/me/profile,
                  network-stock?vendor_handle=, vendors/{handle}/performance),
                  the same edit drawer with the same fields, the same
                  ?edit=1 deep link, connect/message, and the same
                  SourceDialog — a buyer can still source straight from here.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function VendorProfile() {
  const { handle } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.vendor);
  const setMe = useAuthStore((s) => s.setVendor);
  const openDirect = useChatStore((s) => s.openDirect);

  const [vendor, setVendor] = useState(null);
  const [stock, setStock] = useState([]);
  const [profile, setProfile] = useState(null);
  const [perf, setPerf] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [sourcing, setSourcing] = useState(null);
  const [tab, setTab] = useState("shelf");
  const [q, setQ] = useState("");

  const own = me?.vendor_handle === handle;

  useEffect(() => {
    let alive = true;
    setVendor(null);
    setError(null);
    setStock([]);
    (async () => {
      try {
        const [{ data: v }, { data: items }] = await Promise.all([
          vendorAPI.byHandle(handle),
          stockAPI.network({ vendor_handle: handle, limit: 60 }).catch(() => ({ data: [] })),
        ]);
        if (!alive) return;
        setVendor(v);
        setStock(items);
        vendorAPI
          .performance(handle)
          .then(({ data }) => alive && setPerf(data))
          .catch(() => {});
        if (me?.vendor_handle === handle) {
          const { data: p } = await vendorAPI.profile();
          if (alive) setProfile(p);
        }
      } catch (e) {
        if (alive) setError(apiError(e, "Vendor not found"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [handle, me?.vendor_handle]);

  useEffect(() => {
    if (params.get("edit") && own) {
      setEditing(true);
      setParams({}, { replace: true });
    }
  }, [params, own, setParams]);

  const message = async () => {
    try {
      navigate(`/chat?room=${await openDirect(vendor.id)}`);
    } catch (e) {
      toast.error(apiError(e, "Couldn't open a direct room"));
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/@${handle}`;
    try {
      if (navigator.share) await navigator.share({ title: vendor.business_name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Shop link copied");
      }
    } catch {
      /* the user dismissed the sheet — nothing to report */
    }
  };

  const shelf = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return stock;
    return stock.filter((i) =>
      [i.name, i.category, i.subcategory, i.sku, ...(i.tags || [])].filter(Boolean).join(" ").toLowerCase().includes(needle)
    );
  }, [stock, q]);

  if (error)
    return (
      <ErrorState
        title={error}
        description={`No vendor answers to @${handle}. The handle may have changed, or the business may have left the network.`}
        action={
          <Button size="sm" onClick={() => navigate("/network")}>
            Back to the network
          </Button>
        }
      />
    );
  if (!vendor) return <PageSpinner label="Opening the shop front…" />;

  const role = VENDOR_ROLES.find((r) => r.value === vendor.current_role);
  const level = vendorLevel(vendor);
  const categories = vendor.business_categories || [];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Network", to: "/network" }, { label: `@${vendor.vendor_handle}` }]} />

      {/* ══ identity + trust, above the fold ═══════════════════════════ */}
      <header className="overflow-hidden rounded-3xl border border-edge-1 bg-surface-0">
        <div
          className="h-24 sm:h-32 w-full"
          style={{
            backgroundImage:
              "linear-gradient(135deg, rgb(var(--brand-600) / 0.92), rgb(var(--brand-500) / 0.65) 45%, rgb(var(--accent-500) / 0.5))",
          }}
          aria-hidden="true"
        />
        <div className="px-5 sm:px-7 pb-5 sm:pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-10 sm:-mt-12">
            <div className="rounded-3xl ring-4 ring-surface-0 w-fit">
              <Avatar name={vendor.business_name} size="xl" />
            </div>
            <div className="flex-1 min-w-0 sm:pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-ink-1 tracking-tight">{vendor.business_name}</h1>
                {vendor.is_verified && <BadgeCheck size={18} className="text-blue-600 dark:text-blue-400" aria-label="Identity verified" />}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-3">
                <span className="font-mono text-ink-4">@{vendor.vendor_handle}</span>
                {role && (
                  <Badge variant={ROLE_BADGE[role.value]} size="xs">
                    {role.emoji} {role.label}
                  </Badge>
                )}
                {vendor.physical_location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={12} aria-hidden="true" /> {vendor.physical_location}
                  </span>
                )}
              </div>
              <TrustRow vendor={vendor} className="mt-2.5" />
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:pb-1">
              {own ? (
                <>
                  <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                    Edit profile
                  </Button>
                  <Button size="sm" variant="ghost" icon={Share2} onClick={share} aria-label="Share your shop link">
                    Share
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="secondary" icon={MessageSquare} onClick={message}>
                    Message
                  </Button>
                  <ConnectionButton vendor={vendor} onChange={(c) => setVendor((v) => ({ ...v, connected: c }))} />
                  <Button size="icon" variant="ghost" icon={Share2} onClick={share} aria-label="Share this shop" />
                </>
              )}
            </div>
          </div>

          {vendor.business_description && (
            <p className="mt-4 text-sm text-ink-2 leading-relaxed max-w-3xl text-pretty">{vendor.business_description}</p>
          )}

          {categories.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <Link
                  key={c}
                  to={`/browse?category=${encodeURIComponent(c)}`}
                  className="rounded-full border border-edge-2 bg-surface-1 px-2.5 py-1 text-micro font-semibold text-ink-2 hover:border-ink-4 hover:text-ink-1 transition-colors"
                >
                  {c}
                </Link>
              ))}
            </div>
          )}

          {/* the four numbers a buyer actually judges on */}
          <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4">
              <ReliabilityMeter rate={vendor.fulfillment_rate} completed={vendor.movements_completed} />
            </div>
            <Stat label="Supplier level" value={level.label} hint={level.hint} tone="brand" icon={Award} />
            <Stat label="Network score" value={Number(vendor.network_score || 0).toFixed(1)} hint="earned, never entered" icon={Layers} />
            <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4 flex flex-col justify-between gap-2">
              <span className="text-micro uppercase tracking-[0.1em] font-bold text-ink-4">Give &amp; take</span>
              <ParasitismBadge index={vendor.parasitism_index} size="md" />
            </div>
          </div>
        </div>
      </header>

      {/* ══ the shelf is the body of the page ═════════════════════════ */}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "shelf", label: own ? "Visible shelf" : "Shelf", icon: Package, count: stock.length },
          { value: "record", label: "Trade record", icon: Truck },
          { value: "about", label: "About", icon: Box },
        ]}
      />

      {tab === "shelf" && (
        <section className="space-y-4">
          {stock.length > 6 && (
            <Input
              id="shop-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${stock.length} items on this shelf`}
              icon={Search}
              aria-label="Search this shelf"
              wrapperClassName="max-w-sm"
            />
          )}
          {stock.length === 0 ? (
            <EmptyState
              compact
              icon={Package}
              title={own ? "Nothing visible to the network" : "Nothing visible right now"}
              description={
                own
                  ? "Items are private until you mark them visible. A shelf nobody can see cannot be sourced from."
                  : "Stock may be off-network or fully reserved. Message them — most vendors will list something on request."
              }
              action={
                own ? (
                  <Button size="sm" onClick={() => navigate("/stock")}>
                    Open my shelf
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" icon={MessageSquare} onClick={message}>
                    Message {vendor.business_name}
                  </Button>
                )
              }
            />
          ) : shelf.length === 0 ? (
            <EmptyState compact icon={Search} title={`Nothing matches "${q}"`} description="Try a shorter word, or clear the search to see the whole shelf." action={<Button size="sm" variant="secondary" onClick={() => setQ("")}>Clear search</Button>} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shelf.map((item) => (
                <StockCard key={item.id} item={item} mode="network" onSource={own ? undefined : setSourcing} />
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "record" && (
        <section className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Supplied" value={num(vendor.total_supplied || 0)} hint="movements as supplier" />
            <Stat label="Sourced" value={num(vendor.total_sourced || 0)} hint="movements as buyer" />
            <Stat label="Units moved" value={num(vendor.total_stock_moved || 0)} />
            <Stat
              label="Trade value"
              value={perf?.total_trade_value ? currency(perf.total_trade_value) : "—"}
              hint="across completed movements"
            />
          </div>

          <div className="rounded-2xl border border-edge-1 bg-surface-0 p-5">
            <h2 className="text-sm font-bold text-ink-1">How this vendor performs</h2>
            <p className="text-2xs text-ink-3 mt-0.5">
              Every figure is computed from completed movements. A dash means there is no sample yet — not a zero.
            </p>
            <dl className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
              {[
                { label: "On-time delivery", value: perf?.on_time_delivery_rate, suffix: "%" },
                { label: "Order fulfilment", value: perf?.order_fulfillment_rate, suffix: "%" },
                { label: "Accepts sourcing requests", value: perf?.sourcing_acceptance_rate, suffix: "%" },
                { label: "Average time to fulfil", value: perf?.avg_fulfillment_hours, suffix: " h" },
                { label: "Average reply time", value: perf?.avg_response_hours, suffix: " h", icon: Clock },
                { label: "Disputes", value: perf?.dispute_rate, suffix: "%" },
              ].map(({ label, value, suffix, icon: Icon }) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-edge-1 pb-2 last:border-0">
                  <dt className="text-2xs text-ink-3 inline-flex items-center gap-1.5">
                    {Icon && <Icon size={13} aria-hidden="true" />}
                    {label}
                  </dt>
                  <dd className="text-xs font-bold text-ink-1 tabular-nums">
                    {value ? `${Number(value).toFixed(value < 10 && suffix === " h" ? 1 : 0)}${suffix}` : "—"}
                  </dd>
                </div>
              ))}
            </dl>
            {perf?.total_deals_completed > 0 && (
              <p className="mt-3 text-micro text-ink-4">
                Based on {num(perf.total_deals_completed)} completed deal{perf.total_deals_completed === 1 ? "" : "s"}.
              </p>
            )}
          </div>
        </section>
      )}

      {tab === "about" && (
        <section className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-edge-1 bg-surface-0 p-5 space-y-3">
            <h2 className="text-sm font-bold text-ink-1">The business</h2>
            <Detail label="Trades as" value={vendor.business_name} />
            <Detail label="Handle" value={`@${vendor.vendor_handle}`} mono />
            <Detail label="Based in" value={vendor.physical_location} />
            <Detail label="Categories" value={categories.join(", ")} />
            <Detail label="Current role" value={role ? `${role.emoji} ${role.label}` : null} />
            {vendor.finance_mode === "halal_sharia" && (
              <Badge variant="purple" size="xs">
                <ShieldCheck size={11} aria-hidden="true" /> Sharia-compliant trade only
              </Badge>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {vendor.is_patron && (
                <Badge variant="purple" size="xs">
                  <Crown size={11} aria-hidden="true" /> Patron — can verify other vendors' stock
                </Badge>
              )}
              {vendor.has_pos_connected && (
                <Badge variant="gray" size="xs">
                  <Plug size={11} aria-hidden="true" /> Stock syncs from their till
                </Badge>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-edge-1 bg-surface-0 p-5 space-y-3">
            <h2 className="text-sm font-bold text-ink-1">{own ? "What you trade" : "What they trade"}</h2>
            {own && profile ? (
              <>
                <Detail label="Stocks" value={profile.primary_goods?.join(", ")} />
                <Detail label="Sources" value={profile.sourcing_interests?.join(", ")} />
                <Detail label="Preferred regions" value={profile.preferred_regions?.join(", ")} />
                <Detail label="Minimum order" value={profile.min_order_value ? currency(profile.min_order_value) : null} />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {profile.accepts_bulk && (
                    <Badge variant="brand" size="xs">
                      <Layers size={11} aria-hidden="true" /> Accepts bulk
                    </Badge>
                  )}
                  {profile.offers_credit && (
                    <Badge variant="amber" size="xs">
                      <CreditCard size={11} aria-hidden="true" /> Offers trade credit
                    </Badge>
                  )}
                </div>
                <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(true)} className="mt-2">
                  Edit these details
                </Button>
              </>
            ) : (
              <p className="text-2xs text-ink-3 leading-relaxed">
                Trading preferences are shared between connected vendors. Connect with {vendor.business_name} to see what they stock, what
                they are looking for, and whether they accept bulk or offer credit.
              </p>
            )}
          </div>
        </section>
      )}

      {own && (
        <EditProfileDrawer
          open={editing}
          onClose={() => setEditing(false)}
          vendor={vendor}
          profile={profile}
          onSaved={(v, p) => {
            setVendor((cur) => ({ ...cur, ...v }));
            setMe(v);
            setProfile(p);
            setEditing(false);
          }}
        />
      )}
      {!own && <SourceDialog item={sourcing} open={!!sourcing} onClose={() => setSourcing(null)} onDone={() => navigate("/orders")} />}
    </div>
  );
}

function Detail({ label, value, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-edge-1 pb-2 last:border-0">
      <span className="text-2xs text-ink-4 shrink-0">{label}</span>
      <span className={`text-2xs font-semibold text-right ${value ? "text-ink-1" : "text-ink-4"} ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </span>
    </div>
  );
}

function EditProfileDrawer({ open, onClose, vendor, profile, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open)
      setForm({
        business_name: vendor.business_name || "",
        business_description: vendor.business_description || "",
        physical_location: vendor.physical_location || "",
        allow_direct_calls: !!vendor.allow_direct_calls,
        business_categories: (vendor.business_categories || []).join(", "),
        primary_goods: (profile?.primary_goods || []).join(", "),
        sourcing_interests: (profile?.sourcing_interests || []).join(", "),
        preferred_regions: (profile?.preferred_regions || []).join(", "),
        accepts_bulk: profile?.accepts_bulk ?? true,
        offers_credit: profile?.offers_credit ?? false,
      });
  }, [open, vendor, profile]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = async () => {
    if (!form.business_name?.trim()) return toast.error("Business name is required");
    setBusy(true);
    try {
      const [{ data: v }, { data: p }] = await Promise.all([
        vendorAPI.update({
          business_name: form.business_name.trim(),
          business_description: form.business_description.trim() || null,
          physical_location: form.physical_location.trim() || null,
          allow_direct_calls: !!form.allow_direct_calls,
          business_categories: splitList(form.business_categories),
        }),
        vendorAPI.updateProfile({
          primary_goods: splitList(form.primary_goods),
          sourcing_interests: splitList(form.sourcing_interests),
          preferred_regions: splitList(form.preferred_regions),
          accepts_bulk: !!form.accepts_bulk,
          offers_credit: !!form.offers_credit,
        }),
      ]);
      toast.success("Profile updated");
      onSaved(v, p);
    } catch (e) {
      toast.error(apiError(e, "Couldn't save the profile"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Edit profile"
      description="What you stock and what you source drives the network's suggestions."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Business name" required value={form.business_name || ""} onChange={set("business_name")} />
        <Textarea label="About" rows={3} value={form.business_description || ""} onChange={set("business_description")} hint="Two lines is plenty — what you sell and who you sell to." />
        <Input label="Location" value={form.physical_location || ""} onChange={set("physical_location")} />
        <Check checked={form.allow_direct_calls} onChange={set("allow_direct_calls")} label="Allow direct calls from order counterparties" />
        <p className="-mt-2 text-micro text-ink-4">Your number is shared only on an order with its other participant, and only while this setting is on. In-app chat stays available either way.</p>
        <Input label="Categories" value={form.business_categories || ""} onChange={set("business_categories")} hint="Comma separated" />
        <div className="pt-2 border-t border-edge-1 space-y-4">
          <Input label="What you stock (primary goods)" value={form.primary_goods || ""} onChange={set("primary_goods")} placeholder="sukuma, spinach, tomatoes" hint="Comma separated" />
          <Input label="What you source (interests)" value={form.sourcing_interests || ""} onChange={set("sourcing_interests")} placeholder="vegetables, cooking oil" hint="Comma separated" />
          <Input label="Preferred regions" value={form.preferred_regions || ""} onChange={set("preferred_regions")} placeholder="Nairobi, Kiambu" hint="Comma separated" />
          <Check checked={form.accepts_bulk} onChange={set("accepts_bulk")} label="Accepts bulk orders" />
          <Check checked={form.offers_credit} onChange={set("offers_credit")} label="Offers trade credit" />
        </div>
      </div>
    </Drawer>
  );
}
