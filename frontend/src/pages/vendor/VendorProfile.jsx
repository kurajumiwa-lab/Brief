import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Award, BadgeCheck, Box, Clock, CreditCard, Crown, ImagePlus,
  Layers, MapPin, MessageSquare, Package, Pencil, Plug, Plus, Search, Share2,
  ShieldCheck, Trash2, Truck, X,
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
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { TrustRow, ReliabilityMeter, vendorLevel } from "@/components/trust/TrustSignals";
import { VerifiedStrip } from "@/components/trust/VerifiedFacts";
import ParasitismBadge from "@/components/vendor/ParasitismBadge";
import ConnectionButton from "@/components/vendor/ConnectionButton";
import StockCard, { getStockVisibilityStatus } from "@/components/stock/StockCard";
import SourceDialog from "@/components/stock/SourceDialog";
import { Check } from "@/components/forms/GroupForm";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { vendorAPI, stockAPI, passportAPI, fileAPI, apiError } from "@/lib/api";
import { ROLE_BADGE, VENDOR_ROLES } from "@/config/constants";
import { currency, num } from "@/lib/formatters";
import { cn, splitList } from "@/lib/utils";

/**
 * Read a File into a URL: uploads through `/api/files/upload` when available,
 * and falls back to a local data URL so gallery selection works offline or in tests.
 */
export async function readGalleryPhoto(file) {
  try {
    const res = await fileAPI?.upload?.(file);
    if (res?.data?.url) return res.data.url;
  } catch {
    /* fall back to local data URL preview */
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image file"));
    reader.readAsDataURL(file);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHOP FRONT — /@handle
   ---------------------------------------------------------------------------
   Organizes the public shop into:
     1. Business identity & storefront header with direct Products, Verification,
        and Contact actions
     2. Available stock — published listings eligible for display, plus an
        owner-only visibility diagnostic when shelf items are Draft/Hidden/Unavailable
     3. Shop photo gallery — gallery photo addition (no URL links)
     4. Verification & trade record, and Contact & business details
   ═══════════════════════════════════════════════════════════════════════════ */

export default function VendorProfile() {
  const rawParams = useParams();
  const handle = String(
    rawParams.handle ||
    rawParams.rawHandle ||
    (typeof window !== "undefined" ? window.location.pathname.replace(/^\//, "") : "")
  ).replace(/^@/, "");
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.vendor);
  const setMe = useAuthStore((s) => s.setVendor);
  const openDirect = useChatStore((s) => s.openDirect);
  const openDeal = useChatStore((s) => s.openDeal);

  const [vendor, setVendor] = useState(null);
  const [passport, setPassport] = useState(null);
  const [stock, setStock] = useState([]);
  const [ownShelf, setOwnShelf] = useState([]);
  const [profile, setProfile] = useState(null);
  const [perf, setPerf] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [sourcing, setSourcing] = useState(null);
  const [tab, setTab] = useState("shelf");
  const [q, setQ] = useState("");
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const galleryInputRef = useRef(null);

  const own = me?.vendor_handle === handle;

  useEffect(() => {
    let alive = true;
    setVendor(null);
    setError(null);
    setStock([]);
    setOwnShelf([]);
    (async () => {
      try {
        const [{ data: v }, { data: items }] = await Promise.all([
          vendorAPI.byHandle(handle),
          stockAPI.network({ vendor_handle: handle, limit: 60 }).catch(() => ({ data: [] })),
        ]);
        if (!alive) return;
        setVendor(v);
        setStock(Array.isArray(items) ? items : []);

        passportAPI?.of?.(handle)
          ?.then(({ data }) => alive && setPassport(data))
          ?.catch(() => {});
        vendorAPI?.performance?.(handle)
          ?.then(({ data }) => alive && setPerf(data))
          ?.catch(() => {});

        if (me?.vendor_handle === handle) {
          stockAPI?.mine?.()
            ?.then(({ data: mineItems }) => {
              if (!alive) return;
              const list = Array.isArray(mineItems) ? mineItems : [];
              setOwnShelf(list);
            })
            ?.catch(() => {});
          vendorAPI?.profile?.()
            ?.then(({ data: p }) => alive && setProfile(p))
            ?.catch(() => {});
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

  const onEnquire = async (item) => {
    try {
      if (openDeal) {
        navigate(`/chat?room=${await openDeal(item.id)}`);
      } else {
        await message();
      }
    } catch (e) {
      toast.error(apiError(e, "Couldn't open enquiry room"));
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

  // Merge published stock from network endpoint and (for owner) published items from ownShelf
  const publishedStock = useMemo(() => {
    const map = new Map();
    for (const item of stock) {
      if (item?.id) map.set(item.id, item);
    }
    if (own) {
      for (const item of ownShelf) {
        if (item?.id && getStockVisibilityStatus(item).isPublished && !map.has(item.id)) {
          map.set(item.id, item);
        }
      }
    }
    return Array.from(map.values());
  }, [stock, own, ownShelf]);

  const unpublishedOwnItems = useMemo(() => {
    if (!own) return [];
    return ownShelf.filter((item) => !getStockVisibilityStatus(item).isPublished);
  }, [own, ownShelf]);

  const shelf = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return publishedStock;
    return publishedStock.filter((i) =>
      [i.name, i.category, i.subcategory, i.sku, ...(i.tags || [])].filter(Boolean).join(" ").toLowerCase().includes(needle)
    );
  }, [publishedStock, q]);

  const galleryPhotos = useMemo(() => {
    const fromProfile = profile?.portfolio_images || profile?.supply_capacity?.gallery_photos;
    const fromVendor = vendor?.portfolio_images;
    return Array.isArray(fromProfile) ? fromProfile : Array.isArray(fromVendor) ? fromVendor : [];
  }, [profile, vendor]);

  const handleAddGalleryPhotos = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadingGallery(true);
    try {
      const urls = await Promise.all(files.map((file) => readGalleryPhoto(file)));
      const nextGallery = [...galleryPhotos, ...urls.filter(Boolean)];
      const { data: updatedProfile } = await vendorAPI.updateProfile({
        portfolio_images: nextGallery,
      });
      setProfile((prev) => ({ ...(prev || {}), ...(updatedProfile || {}), portfolio_images: nextGallery }));
      setVendor((prev) => (prev ? { ...prev, portfolio_images: nextGallery } : prev));
      toast.success(files.length === 1 ? "Photo added to your shop gallery" : `${files.length} photos added to your shop gallery`);
    } catch (err) {
      toast.error(apiError(err, "Couldn't add photo from gallery"));
    } finally {
      setUploadingGallery(false);
      if (e.target) e.target.value = "";
    }
  };

  const handleRemoveGalleryPhoto = async (indexToRemove) => {
    const nextGallery = galleryPhotos.filter((_, idx) => idx !== indexToRemove);
    try {
      const { data: updatedProfile } = await vendorAPI.updateProfile({
        portfolio_images: nextGallery,
      });
      setProfile((prev) => ({ ...(prev || {}), ...(updatedProfile || {}), portfolio_images: nextGallery }));
      setVendor((prev) => (prev ? { ...prev, portfolio_images: nextGallery } : prev));
      toast.success("Photo removed from gallery");
    } catch (err) {
      toast.error(apiError(err, "Couldn't update gallery"));
    }
  };

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
  const avatarSrc = profile?.logo_url || vendor?.logo_url || profile?.avatar_url || vendor?.avatar_url || undefined;
  const bannerSrc = profile?.banner_url || vendor?.banner_url || undefined;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Network", to: "/network" }, { label: `@${vendor.vendor_handle}` }]} />

      {/* ══ identity + public storefront header, above the fold ═════════ */}
      <header className="overflow-hidden rounded-3xl border border-edge-1 bg-surface-0">
        <div
          className="h-24 sm:h-32 w-full bg-cover bg-center"
          style={{
            backgroundImage: bannerSrc
              ? `linear-gradient(180deg, rgb(0 0 0 / 0.15), rgb(0 0 0 / 0.45)), url('${bannerSrc}')`
              : "linear-gradient(135deg, rgb(var(--brand-600) / 0.92), rgb(var(--brand-500) / 0.65) 45%, rgb(var(--accent-500) / 0.5))",
          }}
          aria-hidden="true"
        />
        <div className="px-5 sm:px-7 pb-5 sm:pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-10 sm:-mt-12">
            <div className="rounded-3xl ring-4 ring-surface-0 w-fit bg-surface-0">
              <Avatar name={vendor.business_name} src={avatarSrc} size="xl" />
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
                {vendor.account_tier && (
                  <Badge variant={vendor.account_tier.is_free ? "amber" : "gray"} size="xs"
                    title={vendor.account_tier.verification_note}>
                    {vendor.account_tier.label}
                  </Badge>
                )}
                <span>Business profile and public storefront</span>
                {vendor.physical_location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={12} aria-hidden="true" /> {vendor.physical_location}
                  </span>
                )}
              </div>
              <TrustRow vendor={vendor} className="mt-2.5" />
              <VerifiedStrip
                headline={passport?.headline}
                facts={passport?.facts}
                className="mt-2"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:pb-1">
              {own ? (
                <>
                  <Button size="sm" icon={Plus} onClick={() => navigate("/stock?new=1")}>
                    Add stock
                  </Button>
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

          {/* ── Quick Shop Sections: Products · Verification · Contact ── */}
          <nav aria-label="Shop navigation" className="mt-5 grid grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => setTab("shelf")}
              className={cn(
                "flex flex-col sm:flex-row items-center justify-center gap-2 rounded-2xl border p-3 text-xs font-semibold transition-colors cursor-pointer",
                tab === "shelf"
                  ? "border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300"
                  : "border-edge-1 bg-surface-1 text-ink-2 hover:border-edge-2"
              )}
            >
              <Package size={16} aria-hidden="true" />
              <span>Products ({publishedStock.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("record")}
              className={cn(
                "flex flex-col sm:flex-row items-center justify-center gap-2 rounded-2xl border p-3 text-xs font-semibold transition-colors cursor-pointer",
                tab === "record"
                  ? "border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300"
                  : "border-edge-1 bg-surface-1 text-ink-2 hover:border-edge-2"
              )}
            >
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Verification</span>
            </button>
            <button
              type="button"
              onClick={() => (own ? setTab("about") : message())}
              className={cn(
                "flex flex-col sm:flex-row items-center justify-center gap-2 rounded-2xl border p-3 text-xs font-semibold transition-colors cursor-pointer",
                tab === "about"
                  ? "border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300"
                  : "border-edge-1 bg-surface-1 text-ink-2 hover:border-edge-2"
              )}
            >
              <MessageSquare size={16} aria-hidden="true" />
              <span>Contact</span>
            </button>
          </nav>

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

      {/* ══ Shop photo gallery (gallery photo addition, no URL links) ═══ */}
      {(galleryPhotos.length > 0 || own) && (
        <section aria-labelledby="shop-gallery-heading" className="rounded-3xl border border-edge-1 bg-surface-0 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="shop-gallery-heading" className="text-base font-bold text-ink-1">
                Shop &amp; product gallery
              </h2>
              <p className="text-2xs text-ink-3">
                Photos added directly from the business gallery so buyers can see the stall, warehouse or stock.
              </p>
            </div>
            {own && (
              <div>
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  aria-label="Add photos from gallery"
                  onChange={handleAddGalleryPhotos}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={ImagePlus}
                  loading={uploadingGallery}
                  onClick={() => galleryInputRef.current?.click()}
                >
                  Add from gallery
                </Button>
              </div>
            )}
          </div>

          {galleryPhotos.length === 0 ? (
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              className="w-full rounded-2xl border border-dashed border-edge-2 bg-surface-1 hover:bg-surface-2 p-5 text-center transition-colors cursor-pointer"
            >
              <ImagePlus size={22} className="mx-auto text-brand-700 dark:text-brand-300" aria-hidden="true" />
              <p className="mt-2 text-xs font-semibold text-ink-1">Add photos from your gallery</p>
              <p className="mt-0.5 text-micro text-ink-4">
                Select photos of your shop, stock or warehouse directly from your device — no links needed.
              </p>
            </button>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3" data-testid="shop-photo-gallery">
              {galleryPhotos.map((src, idx) => (
                <div key={`${src}-${idx}`} className="group relative aspect-[4/3] rounded-2xl overflow-hidden border border-edge-1 bg-surface-2">
                  <img src={src} alt={`${vendor.business_name} gallery ${idx + 1}`} className="w-full h-full object-cover" />
                  {own && (
                    <button
                      type="button"
                      onClick={() => handleRemoveGalleryPhoto(idx)}
                      aria-label={`Remove gallery photo ${idx + 1}`}
                      className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-ink-1/80 text-white grid place-items-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ══ the shelf is the body of the page ═════════════════════════ */}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "shelf", label: own ? "Visible shelf" : "Shelf", icon: Package, count: publishedStock.length },
          { value: "record", label: "Trade record", icon: Truck },
          { value: "about", label: "About", icon: Box },
        ]}
      />

      {tab === "shelf" && (
        <section aria-labelledby="available-stock-heading" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="available-stock-heading" className="text-lg font-bold text-ink-1">
                Available stock
              </h2>
              <p className="text-2xs text-ink-3 mt-0.5">
                Only published listings that are currently eligible for display should appear here.
              </p>
            </div>
            {publishedStock.length > 6 && (
              <Input
                id="shop-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${publishedStock.length} items on this shelf`}
                icon={Search}
                aria-label="Search this shelf"
                wrapperClassName="w-full sm:w-72"
              />
            )}
          </div>

          {/* Owner-only visibility diagnostic when some shelf items are Hidden/Draft/Unavailable */}
          {own && unpublishedOwnItems.length > 0 && (
            <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4 space-y-2.5" data-testid="shop-visibility-diagnostic">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold text-ink-1">
                  {publishedStock.length} published · {unpublishedOwnItems.length} item{unpublishedOwnItems.length === 1 ? "" : "s"} on your shelf not shown to buyers
                </p>
                <Link to="/stock" className="text-micro font-bold text-brand-700 dark:text-brand-400 hover:underline">
                  Manage in My shelf →
                </Link>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {unpublishedOwnItems.map((item) => {
                  const st = getStockVisibilityStatus(item);
                  return (
                    <div key={item.id} className="rounded-xl border border-edge-1 bg-surface-0 px-3 py-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink-1 truncate">{item.name}</p>
                        <p className="text-micro text-ink-4 mt-0.5 leading-snug">{st.reason}</p>
                      </div>
                      <Badge variant={st.variant} size="xs" className="shrink-0">{st.label}</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {publishedStock.length === 0 ? (
            <EmptyState
              compact
              icon={Package}
              title="Published products appear here"
              description={
                own
                  ? "Each listing shows a product name, photo, vendor-stated price, availability and a way to enquire. Items are private until you mark them visible with available stock."
                  : "Each listing shows a product name, photo, vendor-stated price, availability and a way to enquire. Message them to ask what is currently in stock."
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
              secondaryAction={
                own ? (
                  <Button size="sm" variant="secondary" icon={Plus} onClick={() => navigate("/stock?new=1")}>
                    Add stock
                  </Button>
                ) : undefined
              }
            />
          ) : shelf.length === 0 ? (
            <EmptyState
              compact
              icon={Search}
              title={`Nothing matches "${q}"`}
              description="Try a shorter word, or clear the search to see the whole shelf."
              action={<Button size="sm" variant="secondary" onClick={() => setQ("")}>Clear search</Button>}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shelf.map((item) => (
                <StockCard
                  key={item.id}
                  item={item}
                  mode="network"
                  onSource={own ? undefined : setSourcing}
                  onDeal={own ? undefined : onEnquire}
                />
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
            {!own && (
              <div className="pt-2">
                <Button size="sm" icon={MessageSquare} onClick={message}>
                  Contact {vendor.business_name}
                </Button>
              </div>
            )}
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
            setVendor((cur) => ({ ...cur, ...v, ...(p ? { logo_url: p.logo_url, avatar_url: p.avatar_url, portfolio_images: p.portfolio_images } : {}) }));
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

function GallerySinglePicker({ label, hint, value, onChange, testId }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const onSelectFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await readGalleryPhoto(file);
      onChange(url);
    } catch (err) {
      toast.error(apiError(err, "Could not load photo from gallery"));
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  return (
    <div className="space-y-1.5" data-testid={testId}>
      <span className="block text-xs font-medium text-ink-2">{label}</span>
      <div className="flex items-center gap-3 rounded-2xl border border-edge-2 bg-surface-1 p-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={label}
          onChange={onSelectFile}
        />
        {value ? (
          <img src={value} alt={label} className="w-12 h-12 rounded-xl object-cover border border-edge-1 shrink-0" />
        ) : (
          <span className="w-12 h-12 rounded-xl bg-brand-500/10 text-brand-700 dark:text-brand-300 grid place-items-center shrink-0">
            <ImagePlus size={18} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline text-left"
          >
            {uploading ? "Adding from gallery…" : value ? "Change photo from gallery" : "Choose photo from gallery"}
          </button>
          {hint && <p className="text-micro text-ink-4 mt-0.5">{hint}</p>}
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={`Remove ${label}`}
            className="p-1.5 rounded-lg text-ink-4 hover:text-red-600 hover:bg-surface-2 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function EditProfileDrawer({ open, onClose, vendor, profile, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const multiGalleryRef = useRef(null);

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
        logo_url: profile?.logo_url || vendor?.logo_url || "",
        avatar_url: profile?.avatar_url || profile?.chat_identity?.avatar_url || vendor?.avatar_url || "",
        portfolio_images: Array.isArray(profile?.portfolio_images)
          ? profile.portfolio_images
          : Array.isArray(vendor?.portfolio_images)
          ? vendor.portfolio_images
          : [],
        chat_mode: profile?.chat_identity?.mode || "combined",
        sender_name: profile?.chat_identity?.sender_name || "",
        sender_role: profile?.chat_identity?.sender_role || "Owner",
      });
  }, [open, vendor, profile]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const onAddGalleryFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadingGallery(true);
    try {
      const urls = await Promise.all(files.map((file) => readGalleryPhoto(file)));
      setForm((f) => ({
        ...f,
        portfolio_images: [...(f.portfolio_images || []), ...urls.filter(Boolean)],
      }));
    } catch (err) {
      toast.error(apiError(err, "Could not add gallery photos"));
    } finally {
      setUploadingGallery(false);
      if (e.target) e.target.value = "";
    }
  };

  const removeGalleryIndex = (idx) => {
    setForm((f) => ({
      ...f,
      portfolio_images: (f.portfolio_images || []).filter((_, i) => i !== idx),
    }));
  };

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
          logo_url: form.logo_url || "",
          avatar_url: form.avatar_url || "",
          portfolio_images: form.portfolio_images || [],
          ...(form.sender_name || form.logo_url || form.avatar_url
            ? {
                chat_identity: {
                  ...(profile?.chat_identity || {}),
                  mode: form.chat_mode || "combined",
                  sender_name: form.sender_name.trim(),
                  sender_role: form.sender_role || "Owner",
                  logo_url: form.logo_url || null,
                  avatar_url: form.avatar_url || null,
                },
              }
            : {}),
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

        {/* Brand, Gallery Photos & Chat Identity — Gallery Photo Addition only (no URL links) */}
        <div className="pt-2 border-t border-edge-1 space-y-3">
          <p className="text-xs font-semibold text-ink-1">Photos &amp; chat identity</p>
          <GallerySinglePicker
            label="Business logo"
            hint="Select your logo or storefront emblem from your gallery"
            value={form.logo_url || ""}
            onChange={(url) => setForm((f) => ({ ...f, logo_url: url }))}
            testId="gallery-picker-business-logo"
          />
          <GallerySinglePicker
            label="Personal profile photo"
            hint="Select your personal photo from your gallery"
            value={form.avatar_url || ""}
            onChange={(url) => setForm((f) => ({ ...f, avatar_url: url }))}
            testId="gallery-picker-personal-photo"
          />

          <div className="space-y-1.5" data-testid="gallery-picker-shop-photos">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-2">Shop gallery photos</span>
              <input
                ref={multiGalleryRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                aria-label="Upload shop gallery photos"
                onChange={onAddGalleryFiles}
              />
              <button
                type="button"
                onClick={() => multiGalleryRef.current?.click()}
                className="inline-flex items-center gap-1 text-2xs font-semibold text-brand-700 dark:text-brand-300 hover:underline"
              >
                <ImagePlus size={13} aria-hidden="true" />
                {uploadingGallery ? "Adding…" : "Add from gallery"}
              </button>
            </div>
            {(form.portfolio_images || []).length > 0 ? (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {(form.portfolio_images || []).map((src, idx) => (
                  <div key={`${src}-${idx}`} className="relative aspect-[4/3] rounded-xl overflow-hidden border border-edge-1 bg-surface-2">
                    <img src={src} alt={`Shop gallery ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeGalleryIndex(idx)}
                      aria-label={`Remove shop photo ${idx + 1}`}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-ink-1/80 text-white grid place-items-center"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-micro text-ink-4">No gallery photos added yet. Tap “Add from gallery” to select images from your device.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Input label="Sender name" value={form.sender_name || ""} onChange={set("sender_name")} placeholder="e.g. Amina" />
            <Input label="Sender role" value={form.sender_role || ""} onChange={set("sender_role")} placeholder="Owner" />
          </div>
        </div>
      </div>
    </Drawer>
  );
}
