import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, ArrowUpRight, CheckCircle2, Eye, Package, Plus, RefreshCw, Share2,
  Sparkles, Store, TrendingUp, Users,
} from "lucide-react";
import GlobalSearch from "@/components/layout/GlobalSearch";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { SkeletonCard } from "@/components/ui/Skeleton";
import StockCard, { getStockVisibilityStatus } from "@/components/stock/StockCard";
import SourceDialog from "@/components/stock/SourceDialog";
import VendorCard from "@/components/vendor/VendorCard";
import MovementRow from "@/components/stock/MovementRow";
import SetupChecklist from "@/components/onboarding/SetupChecklist";
import { VENDOR_ROLES } from "@/config/constants";
import { useAuthStore } from "@/stores/authStore";
import { useStockStore, needsMyAction } from "@/stores/stockStore";
import { stockAPI, vendorAPI } from "@/lib/api";
import { currency } from "@/lib/formatters";
import { titleCase } from "@/lib/utils";

/**
 * Home serves two clear, separate purposes:
 *   1. Discover the network — find other vendors' available stock and suppliers.
 *   2. Access your own business — preview and share your published listings,
 *      manage enquiries and track trades.
 */
export default function HomeHub() {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const mine = useStockStore((s) => s.mine);
  const fetchMine = useStockStore((s) => s.fetchMine);
  const movements = useStockStore((s) => s.movements);
  const fetchMovements = useStockStore((s) => s.fetchMovements);

  const [fresh, setFresh] = useState(null);
  const [freshError, setFreshError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState(null);
  const [sourcing, setSourcing] = useState(null);

  useEffect(() => {
    let live = true;
    const safe = (request, update, onError) => {
      if (!request?.then) {
        if (live) onError?.();
        return;
      }
      request
        .then((response) => live && update(response.data))
        .catch(() => live && onError?.());
    };

    safe(
      stockAPI?.network?.({ limit: 8 }),
      (data) => {
        setFresh(Array.isArray(data) ? data : data?.items || []);
        setFreshError(false);
      },
      () => {
        setFresh([]);
        setFreshError(true);
      }
    );
    safe(stockAPI?.categories?.(), (data) => setCategories(Array.isArray(data) ? data : []), () => setCategories([]));
    safe(vendorAPI?.suggested?.(3), (data) => setSuppliers(Array.isArray(data) ? data : data?.vendors || []));
    fetchMine?.().catch(() => {});
    fetchMovements?.().catch(() => {});

    return () => {
      live = false;
    };
  }, [fetchMine, fetchMovements, reloadKey]);

  const actionable = movements.filter(needsMyAction);
  const recentTrades = movements
    .filter((movement) => ["received", "cancelled"].includes(movement.status))
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
    .slice(0, 3);
  const publishedMine = useMemo(
    () => (mine || []).filter((item) => getStockVisibilityStatus(item).isPublished),
    [mine]
  );

  const firstName = (vendor?.business_name || "").split(" ")[0];
  const role = VENDOR_ROLES.find((item) => item.value === vendor?.current_role) || VENDOR_ROLES.find((item) => item.value === "both");

  const headline = {
    sourcing: "Find the stock your business needs.",
    selling: "Put your stock in front of the network.",
    both: "A good market runs both ways.",
    dormant: "Your network is ready when you are.",
  }[role.value];

  const shareShop = async () => {
    if (!vendor?.vendor_handle) return;
    const url = `${window.location.origin}/@${vendor.vendor_handle}`;
    try {
      if (navigator.share) await navigator.share({ title: vendor.business_name, url });
      else {
        await navigator.clipboard?.writeText(url);
        toast.success("Shop link copied");
      }
    } catch {
      /* user dismissed share sheet */
    }
  };

  return (
    <div className="space-y-9 sm:space-y-11">
      {/* Search is the hero action; the market image gives the feed its own identity. */}
      <section
        aria-label="Ogallo trading network"
        className="relative isolate overflow-hidden rounded-[1.75rem] sm:rounded-[2rem] border border-edge-1 bg-ink-1 text-white shadow-md"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgb(8 31 23 / .93) 0%, rgb(8 31 23 / .81) 40%, rgb(8 31 23 / .34) 74%, rgb(8 31 23 / .16) 100%), url('/ogallo-market-hero.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center 56%",
        }}
      >
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-brand-950/20 via-transparent to-orchid-900/15" aria-hidden="true" />
        <div className="max-w-3xl px-5 py-7 sm:px-9 sm:py-10 lg:px-12 lg:py-12">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-brand-900 px-3 py-1 text-micro font-bold uppercase tracking-[0.12em] text-white">
              <Sparkles size={12} aria-hidden="true" /> Ogallo · the trade network
            </span>
            <Badge variant="purple" size="sm" className="!bg-white/15 !text-white !border !border-white/20">
              {role.emoji} Currently {role.label.toLowerCase()}
            </Badge>
          </div>
          <p className="mt-7 text-sm font-semibold text-brand-100 dark:text-brand-300">
            {firstName ? `Welcome back, ${firstName}` : "Welcome to your trading network"}
          </p>
          <h1 className="mt-2 max-w-2xl text-3xl sm:text-4xl lg:text-[2.8rem] leading-tight font-extrabold tracking-tight text-balance text-white">
            {headline}
          </h1>
          <p className="mt-3 max-w-xl text-sm sm:text-base leading-relaxed text-white/80 text-pretty">
            What are you looking for? Discover real stock, compare suppliers and start a trade with a fulfilment record you can see. Every price is stated by its vendor.
          </p>
          <GlobalSearch className="mt-6 max-w-2xl" size="lg" />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-micro font-bold uppercase tracking-[0.1em] text-white/65">Try</span>
            {["tomatoes", "sukuma wiki", "cooking oil", "kitenge", "rice"].map((term) => (
              <Link
                key={term}
                to={`/browse?search=${encodeURIComponent(term)}`}
                className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-2xs font-semibold text-white hover:bg-white/20 focus-visible:outline-white transition-colors"
              >
                {term}
              </Link>
            ))}
            <Link to="/browse" className="ml-auto inline-flex items-center gap-1 text-2xs font-bold text-white/90 hover:text-white">
              Browse all <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <span className="pointer-events-none absolute bottom-5 right-6 hidden text-right text-micro font-semibold uppercase tracking-[0.14em] text-white/75 lg:block">
          Local trade <span className="mx-1 text-accent-300">·</span> visible prices <span className="mx-1 text-accent-300">·</span> real fulfilment
        </span>
      </section>

      {/* New vendors get a small, dismissible checklist; existing traders see a live business pulse. */}
      <SetupChecklist />

      {categories.length > 0 && (
        <section aria-labelledby="home-categories">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-micro font-bold uppercase tracking-[0.14em] text-orchid-700 dark:text-orchid-300">Start with what moves</p>
              <h2 id="home-categories" className="mt-1 text-lg font-bold tracking-tight text-ink-1">Browse by category</h2>
            </div>
            <Link to="/browse" className="inline-flex shrink-0 items-center gap-1 text-2xs font-semibold text-brand-700 dark:text-brand-400 hover:underline underline-offset-2">
              All stock <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {categories.slice(0, 8).map((category) => (
              <Link
                key={category}
                to={`/browse?category=${encodeURIComponent(category)}`}
                className="shrink-0 rounded-full border border-edge-1 bg-surface-1 px-3.5 py-2 text-xs font-semibold text-ink-2 hover:border-brand-500/50 hover:bg-brand-50 dark:hover:bg-brand-500/10 hover:text-brand-800 dark:hover:text-brand-300 transition-colors"
              >
                {titleCase(category)}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* The home feed surfaces only the work that needs attention. */}
      {actionable.length > 0 && (
        <section aria-labelledby="needs-you">
          <SectionHeader
            as="h2"
            id="needs-you"
            title="Needs your action"
            description="Confirm, ship or receive. These are the next steps that keep a trade moving."
            to="/orders?needs=me"
            linkLabel="All orders"
          />
          <div className="space-y-3">
            {actionable.slice(0, 3).map((movement) => (
              <MovementRow key={movement.id} movement={movement} actionable />
            ))}
          </div>
          {actionable.length > 3 && (
            <Button className="mt-3" size="sm" variant="secondary" iconRight={ArrowRight} onClick={() => navigate("/orders?needs=me")}>
              {actionable.length - 3} more waiting on you
            </Button>
          )}
        </section>
      )}

      {recentTrades.length > 0 && (
        <section aria-labelledby="recent-trades">
          <SectionHeader
            as="h2"
            id="recent-trades"
            title="Recent trade activity"
            description="Pick up the thread or review what has already moved through your network."
            to="/orders"
            linkLabel="Order history"
          />
          <div className="space-y-3">
            {recentTrades.map((movement) => (
              <MovementRow key={movement.id} movement={movement} />
            ))}
          </div>
        </section>
      )}

      {/* ── Purpose 1: Discover other vendors' stock ─────────────────────── */}
      <section aria-labelledby="fresh-stock">
        <SectionHeader
          as="h2"
          id="fresh-stock"
          title="Fresh on the network"
          description="Products published by other vendors across Ogallo, ordered by availability. Your own shelf never appears here — use Your shop below to access your published listings."
          to="/browse"
          linkLabel="Browse all stock"
        />
        {fresh === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <SkeletonCard key={item} />)}
          </div>
        ) : fresh.length === 0 ? (
          <EmptyState
            icon={freshError ? RefreshCw : Users}
            title={freshError ? "Fresh stock didn't load" : "No stock is showing yet"}
            description={freshError
              ? "The network didn't answer. Check your connection and try again; vendor prices and records are unchanged."
              : "When other vendors make stock visible to the network, it appears here. Your own published products are accessible in Your shop below."}
            action={freshError
              ? <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => { setFresh(null); setReloadKey((key) => key + 1); }}>Try again</Button>
              : <Button size="sm" variant="secondary" onClick={() => navigate("/network")}>Meet suppliers</Button>}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {fresh.slice(0, 4).map((item) => (
              <StockCard key={item.id} item={item} mode="network" onSource={setSourcing} />
            ))}
          </div>
        )}
      </section>

      {/* ── Purpose 2: Access your own business & published shop ─────────── */}
      {vendor && (
        <section aria-labelledby="your-shop-heading" className="space-y-3" data-testid="home-your-shop">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
                Your business
              </p>
              <h2 id="your-shop-heading" className="mt-1 text-lg font-bold tracking-tight text-ink-1">
                Your shop
              </h2>
              <p className="text-2xs text-ink-3 mt-0.5">
                A shortcut to the stock you've published
              </p>
            </div>
            <Link
              to={`/@${vendor.vendor_handle}`}
              className="inline-flex shrink-0 items-center gap-1 text-2xs font-semibold text-brand-700 dark:text-brand-400 hover:underline underline-offset-2"
            >
              Open shop <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
          </div>

          <div className="rounded-3xl border border-edge-1 bg-surface-1 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="grid place-items-center w-11 h-11 rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 shrink-0">
                  <Store size={22} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink-1">Your published listings</p>
                  <p className="text-2xs text-ink-3">
                    Manage, preview and share your shop.{" "}
                    {mine?.length > 0 && (
                      <span className="font-semibold text-ink-2">
                        ({publishedMine.length} published of {mine.length} on your shelf)
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/stock?new=1"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-700 hover:bg-brand-800 px-3 py-2 text-xs font-semibold text-white transition-colors"
                >
                  <Plus size={14} aria-hidden="true" /> Add stock
                </Link>
                <Link
                  to="/stock"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-edge-2 bg-surface-0 hover:bg-surface-2 px-3 py-2 text-xs font-semibold text-ink-1 transition-colors"
                >
                  <Package size={14} aria-hidden="true" /> My shelf
                </Link>
              </div>
            </div>

            {mine?.length > 0 && (
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {mine.slice(0, 4).map((item) => {
                  const st = getStockVisibilityStatus(item);
                  return (
                    <Link
                      key={item.id}
                      to={`/listing/${item.id}`}
                      className="flex flex-col justify-between gap-1.5 rounded-2xl border border-edge-1 bg-surface-0 p-3 hover:border-brand-500/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-ink-1 truncate">{item.name}</span>
                        <Badge variant={st.variant} size="xs">{st.label}</Badge>
                      </div>
                      <p className="text-micro text-ink-4 tabular-nums">
                        {item.unit_price != null ? currency(item.unit_price) : "No price"} · {item.quantity_available ?? item.quantity_in_stock ?? 0} {item.unit_of_measure || "units"}
                      </p>
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <Link
                to={`/@${vendor.vendor_handle}`}
                className="flex items-center justify-center gap-2 rounded-xl border border-edge-1 bg-surface-0 hover:bg-surface-2 px-3 py-2.5 text-xs font-semibold text-ink-1 transition-colors"
              >
                <Eye size={15} className="text-brand-700 dark:text-brand-300" aria-hidden="true" />
                Preview shop
              </Link>
              <button
                type="button"
                onClick={shareShop}
                className="flex items-center justify-center gap-2 rounded-xl border border-edge-1 bg-surface-0 hover:bg-surface-2 px-3 py-2.5 text-xs font-semibold text-ink-1 transition-colors cursor-pointer"
              >
                <Share2 size={15} className="text-brand-700 dark:text-brand-300" aria-hidden="true" />
                Share shop
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Suppliers to meet ────────────────────────────────────────────── */}
      {suppliers?.length > 0 ? (
        <section aria-labelledby="supplier-picks">
          <SectionHeader
            as="h2"
            id="supplier-picks"
            title="Suppliers worth meeting"
            description="Suggested from your profile and recorded network activity—not paid placement."
            to="/network"
            linkLabel="See suppliers"
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {suppliers.slice(0, 3).map((supplier) => (
              <VendorCard key={supplier.id || supplier.vendor_id} vendor={supplier} reasons={supplier.reasons} />
            ))}
          </div>
        </section>
      ) : (
        <section aria-labelledby="suppliers-to-meet" className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 id="suppliers-to-meet" className="text-lg font-bold tracking-tight text-ink-1">
              Suppliers to meet
            </h2>
            <Link
              to="/network"
              className="inline-flex items-center gap-1 text-2xs font-semibold text-brand-700 dark:text-brand-400 hover:underline underline-offset-2"
            >
              View all <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
          <Link
            to="/network"
            className="flex items-center gap-3 rounded-2xl border border-edge-1 bg-surface-1 hover:bg-surface-2 p-4 transition-colors"
          >
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 shrink-0">
              <Users size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink-1">Find a supplier</p>
              <p className="text-2xs text-ink-3">Browse vendors and ask what they have available.</p>
            </div>
            <ArrowRight size={16} className="text-ink-4 shrink-0" aria-hidden="true" />
          </Link>
        </section>
      )}

      <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-edge-1 pt-5">
        {[
          { icon: CheckCircle2, text: "Counts come from live records" },
          { icon: TrendingUp, text: "Trust is earned from completed movements" },
          { icon: Sparkles, text: "Prices are vendor-stated and timestamped" },
        ].map(({ icon: Icon, text }) => (
          <span key={text} className="inline-flex items-center gap-2 text-2xs text-ink-3">
            <Icon size={14} className="text-brand-700 dark:text-brand-400 shrink-0" aria-hidden="true" />
            {text}
          </span>
        ))}
      </footer>

      <SourceDialog item={sourcing} open={!!sourcing} onClose={() => setSourcing(null)} onDone={() => navigate("/orders")} />
    </div>
  );
}
