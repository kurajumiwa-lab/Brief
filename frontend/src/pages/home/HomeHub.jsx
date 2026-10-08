import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, Bell, CheckCircle2, Package, Sparkles, TrendingUp, Users,
} from "lucide-react";
import GlobalSearch from "@/components/layout/GlobalSearch";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import StockCard from "@/components/stock/StockCard";
import SourceDialog from "@/components/stock/SourceDialog";
import VendorCard from "@/components/vendor/VendorCard";
import MovementRow from "@/components/stock/MovementRow";
import { DISCOVERY_NAV } from "@/config/navigation";
import { useAuthStore } from "@/stores/authStore";
import { useStockStore, needsMyAction } from "@/stores/stockStore";
import {
  newsAPI, squadAPI, marketsAPI, mapAPI, nearbyAPI, stockAPI, vendorAPI,
} from "@/lib/api";
import { num, relativeTime } from "@/lib/formatters";
import { formatCount } from "@/lib/mapViewport";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   HOME — a marketplace, not a tile wall.
   ---------------------------------------------------------------------------
   v2's home was ten equal-weight tiles. The app's own UI report called it
   correctly: "eight equal-weight tiles is a wall, not a shelf — nothing is
   signposted" (docs/UI-UX-REPORT.md §2.2).

   v3 keeps every single door (all ten are still here, still counting real
   rows, still rendering "—" for zero) but gives the screen a spine:

     1  search            — the fastest path to the core action
     2  needs your action — the reason to open the app at all
     3  the doors         — now a rail, not a wall
     4  fresh on the network — real listings, straight into the loop
     5  suppliers to meet — discovery, already ranked by the API

   Nothing is decided on this screen; every block opens the surface that owns
   the detail. That hub-and-secondary-screen rule from v2 is unchanged.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function HomeHub() {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const movements = useStockStore((s) => s.movements);
  const fetchMovements = useStockStore((s) => s.fetchMovements);

  const [board, setBoard] = useState(null);
  const [extras, setExtras] = useState({ calls: null, markets: null, places: null, nearby: null });
  const [fresh, setFresh] = useState(null);
  const [suppliers, setSuppliers] = useState(null);
  const [sourcing, setSourcing] = useState(null);

  useEffect(() => {
    let live = true;
    const safe = (p, then) => p?.then?.((r) => live && then(r))?.catch?.(() => {});

    safe(newsAPI?.feed?.(7), (r) => setBoard(r.data));
    safe(squadAPI?.calls?.(), (r) => setExtras((x) => ({ ...x, calls: r.data.calls.length })));
    safe(marketsAPI?.mine?.(), (r) => setExtras((x) => ({ ...x, markets: r.data.markets.length })));
    safe(mapAPI?.counts?.(), (r) => setExtras((x) => ({ ...x, places: r.data.places })));
    safe(nearbyAPI?.list?.({ radius_km: 5, limit: 1 }), (r) => setExtras((x) => ({ ...x, nearby: r.data.total })));
    safe(stockAPI?.network?.({ limit: 8 }), (r) => setFresh(r.data || []));
    safe(vendorAPI?.suggested?.(3), (r) => setSuppliers(r.data || []));
    fetchMovements?.().catch(() => {});

    return () => {
      live = false;
    };
  }, [fetchMovements]);

  const counts = board?.counts ?? null;
  const countFor = (key) =>
    ({
      nearby: extras.nearby,
      places: extras.places,
      markets: extras.markets,
      calls: extras.calls,
      news: counts?.news,
      suppliers: counts?.suppliers,
      stock: counts?.stock,
      rentals: counts?.rentals,
      groups: counts?.groups,
      events: counts?.events,
    }[key]);

  const actionable = movements.filter(needsMyAction);
  const firstName = (vendor?.business_name || "").split(" ")[0];

  return (
    <div className="space-y-10">
      {/* ══ 1 · the fastest path to the core action ═══════════════════ */}
      <section className="relative overflow-hidden rounded-3xl border border-edge-1 bg-surface-1 px-6 py-8 sm:px-10 sm:py-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            backgroundImage:
              "radial-gradient(620px 240px at 8% -20%, rgb(var(--brand-500) / 0.14), transparent 65%), radial-gradient(520px 220px at 102% 0%, rgb(var(--accent-500) / 0.10), transparent 60%)",
          }}
          aria-hidden="true"
        />
        <div className="relative max-w-2xl">
          <p className="text-2xs font-bold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-400">
            {firstName ? `Welcome back, ${firstName}` : "The trade network with receipts"}
          </p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold text-ink-1 tracking-tight text-balance">
            What do you need on the shelf today?
          </h1>
          <p className="mt-2.5 text-sm text-ink-3 max-w-xl text-pretty">
            Source from vendors whose fulfilment record you can actually see. Prices are vendor-stated and timestamped — never a computed
            market rate.
          </p>
          <GlobalSearch className="mt-6 max-w-xl" size="lg" />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-micro font-bold uppercase tracking-[0.1em] text-ink-4">Popular</span>
            {["tomatoes", "sukuma wiki", "cooking oil", "kitenge", "rice"].map((term) => (
              <Link
                key={term}
                to={`/browse?search=${encodeURIComponent(term)}`}
                className="rounded-full border border-edge-2 bg-surface-0 px-3 py-1 text-micro font-semibold text-ink-2 hover:border-ink-4 hover:text-ink-1 transition-colors"
              >
                {term}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 2 · the reason to open the app ════════════════════════════ */}
      {actionable.length > 0 && (
        <section aria-labelledby="needs-you">
          <SectionHeader
            as="h2"
            title="Needs your action"
            description="Confirm, ship or receive — these are the only steps that move stock and score either side."
            to="/orders?needs=me"
            linkLabel="All orders"
          />
          <div className="space-y-3">
            {actionable.slice(0, 3).map((m) => (
              <MovementRow key={m.id} movement={m} actionable />
            ))}
          </div>
          {actionable.length > 3 && (
            <Button className="mt-3" size="sm" variant="secondary" iconRight={ArrowRight} onClick={() => navigate("/orders?needs=me")}>
              {actionable.length - 3} more waiting on you
            </Button>
          )}
        </section>
      )}

      {/* ══ 3 · the ten doors ════════════════════════════════════════ */}
      <section aria-labelledby="doors">
        <SectionHeader
          as="h2"
          title="Your shelf of doors"
          description="Each one opens the screen that owns the detail. A count is live rows — zero reads as a dash, never as a padded number."
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {DISCOVERY_NAV.map(({ to, label, icon: Icon, countKey }) => {
            const count = countFor(countKey);
            const has = typeof count === "number" && count > 0;
            const unknown = count === null || count === undefined;
            return (
              <button
                key={label}
                type="button"
                onClick={() => navigate(to)}
                aria-label={`${label} — ${has ? num(count) : "none yet"}`}
                className={cn(
                  "group rounded-2xl border border-edge-1 bg-surface-0 p-4 text-left shadow-xs",
                  "glass-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="w-9 h-9 rounded-xl bg-surface-2 grid place-items-center text-ink-2 group-hover:bg-brand-50 group-hover:text-brand-700 dark:group-hover:bg-brand-500/15 dark:group-hover:text-brand-300 transition-colors">
                    <Icon size={17} aria-hidden="true" />
                  </span>
                  <span className={cn("text-base font-bold tabular-nums", has ? "text-ink-1" : "text-ink-4")}>
                    {unknown ? <span className="inline-block w-6 h-3 rounded skeleton align-middle" /> : has ? formatCount(count) : "—"}
                  </span>
                </div>
                <p className="mt-3 text-xs font-semibold text-ink-1 flex items-center gap-1">
                  {label}
                  <ArrowRight size={12} className="text-ink-4 opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all" aria-hidden="true" />
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* ══ 4 · real listings, straight into the loop ════════════════ */}
      <section aria-labelledby="fresh">
        <SectionHeader
          as="h2"
          title="Fresh on the network"
          description="Visible stock from other vendors, most available first. Your own shelf never appears here."
          to="/browse"
          linkLabel="Browse all"
        />
        {fresh === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : fresh.length === 0 ? (
          <EmptyState
            compact
            icon={Package}
            tone="brand"
            title="No network stock yet"
            description="When vendors you can reach make stock visible, it lands here. Connecting with more suppliers is the fastest way to fill it."
            action={
              <Button size="sm" icon={Users} onClick={() => navigate("/network?tab=suggested")}>
                Find suppliers
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {fresh.slice(0, 4).map((item) => (
              <StockCard key={item.id} item={item} mode="network" onSource={setSourcing} />
            ))}
          </div>
        )}
      </section>

      {/* ══ 5 · discovery, already ranked by the API ═════════════════ */}
      {suppliers?.length > 0 && (
        <section aria-labelledby="suppliers">
          <SectionHeader
            as="h2"
            title="Suppliers worth meeting"
            description="Ranked on complementarity, reciprocity, trade evidence, proximity, graph distance and reputation."
            to="/network"
            linkLabel="See the network"
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {suppliers.slice(0, 3).map((v) => (
              <VendorCard key={v.id || v.vendor_id} vendor={v} reasons={v.reasons} />
            ))}
          </div>
        </section>
      )}

      {/* ══ the honesty line — the brand, in one sentence ════════════ */}
      <footer className="rounded-2xl border border-edge-1 bg-surface-1 px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        {[
          { icon: CheckCircle2, text: "Counts are live rows" },
          { icon: TrendingUp, text: "Scores are earned from completed movements, never entered" },
          { icon: Sparkles, text: "Prices are vendor-stated, shown with when they were stated" },
        ].map(({ icon: Icon, text }) => (
          <span key={text} className="inline-flex items-center gap-2 text-micro text-ink-3">
            <Icon size={14} className="text-brand-600 dark:text-brand-400 shrink-0" aria-hidden="true" />
            {text}
          </span>
        ))}
        {board && (
          <Badge variant="gray" size="xs" className="ml-auto">
            <Bell size={10} aria-hidden="true" /> board read {relativeTime(board.generated_at)}
          </Badge>
        )}
      </footer>

      <SourceDialog item={sourcing} open={!!sourcing} onClose={() => setSourcing(null)} onDone={() => navigate("/orders")} />
    </div>
  );
}
