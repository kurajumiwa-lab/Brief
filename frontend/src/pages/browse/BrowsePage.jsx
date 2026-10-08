import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Globe, Package, SlidersHorizontal, Sparkles, X } from "lucide-react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Select from "@/components/ui/Select";
import SearchInput from "@/components/ui/SearchInput";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Badge from "@/components/ui/Badge";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import { SkeletonGrid } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import StockCard from "@/components/stock/StockCard";
import SourceDialog from "@/components/stock/SourceDialog";
import StockCompareModal from "@/components/stock/StockCompareModal";
import { useStockStore } from "@/stores/stockStore";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { stockAPI, apiError } from "@/lib/api";
import { num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   BROWSE — the discovery surface, promoted out of a tab.
   ---------------------------------------------------------------------------
   WHAT CHANGED   `/stock?tab=network` is now `/browse`, a destination with its
                  own URL, filters, sort and result count. The old URL still
                  resolves and redirects here.
   WHY            This is the first half of the core loop and it was two clicks
                  deep behind a tab inside the seller's own stock screen.
   PRESERVED      Identical call: `stockAPI.network({ search, category })`.
                  Identical actions: source · compare · deal room ·
                  patron-verify. Nothing about the mechanics moved.
   NEW (UI only)  Client-side sort over the rows the API already returned, and
                  an "in stock only" toggle driven by the existing
                  `min_quantity` parameter.
   ═══════════════════════════════════════════════════════════════════════════ */

const SORTS = [
  { value: "recommended", label: "Recommended" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "available", label: "Most available" },
  { value: "reliable", label: "Best fulfilment" },
  { value: "recent", label: "Recently restated" },
];

const QUALITY_FILTERS = [
  { value: "", label: "Any quality" },
  { value: "self_declared", label: "Declared or better" },
  { value: "patron_verified", label: "Patron-verified" },
  { value: "lab_certified", label: "Lab-certified" },
];

const QUALITY_RANK = { unverified: 0, self_declared: 1, patron_verified: 2, lab_certified: 3 };

export default function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const search = params.get("search") || "";
  const category = params.get("category") || "";
  const sort = SORTS.some((s) => s.value === params.get("sort")) ? params.get("sort") : "recommended";
  const quality = params.get("quality") || "";
  const inStock = params.get("stock") !== "all";

  const { network, networkLoading, categories, fetchNetwork, fetchCategories, replaceItem } = useStockStore();
  const openDeal = useChatStore((s) => s.openDeal);
  const isPatron = useAuthStore((s) => !!s.vendor?.is_patron);

  const [error, setError] = useState("");
  const [sourcing, setSourcing] = useState(null);
  const [comparing, setComparing] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const setParam = useCallback(
    (patch) => {
      const next = new URLSearchParams(params);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  useEffect(() => {
    fetchCategories().catch(() => {});
  }, [fetchCategories]);

  const load = useCallback(() => {
    setError("");
    return fetchNetwork({ search, category, min_quantity: inStock ? 1 : 0 })
      .catch((e) => setError(apiError(e, "Network stock could not be loaded")))
      .finally(() => setLoaded(true));
  }, [fetchNetwork, search, category, inStock]);

  useEffect(() => {
    load();
  }, [load]);

  const results = useMemo(() => {
    let rows = network;
    if (quality) rows = rows.filter((i) => (QUALITY_RANK[i.quality_status] ?? 0) >= (QUALITY_RANK[quality] ?? 0));
    const price = (i) => (i.unit_price == null ? Infinity : i.unit_price);
    const sorted = [...rows];
    if (sort === "price_asc") sorted.sort((a, b) => price(a) - price(b));
    if (sort === "price_desc") sorted.sort((a, b) => (price(b) === Infinity ? -1 : price(b)) - (price(a) === Infinity ? -1 : price(a)));
    if (sort === "available") sorted.sort((a, b) => (b.quantity_available || 0) - (a.quantity_available || 0));
    if (sort === "reliable") sorted.sort((a, b) => (b.vendor_fulfillment_rate ?? -1) - (a.vendor_fulfillment_rate ?? -1));
    if (sort === "recent") sorted.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    return sorted;
  }, [network, quality, sort]);

  const onDeal = async (item) => {
    try {
      navigate(`/chat?room=${await openDeal(item.id)}`);
    } catch (e) {
      toast.error(apiError(e, "Couldn't open a deal room"));
    }
  };

  const onPatronVerify = async (item) => {
    if (
      !(await confirm({
        title: `Verify ${item.name}?`,
        message: `You vouch for @${item.vendor_handle}'s provenance on this item. It shows as patron-verified until they change the batch or origin.`,
        confirmLabel: "Verify",
      }))
    )
      return;
    try {
      const { data } = await stockAPI.patronVerify(item.id);
      const updated = data?.item || data;
      if (updated?.id) replaceItem(updated);
      else load();
      toast.success("Marked patron-verified");
    } catch (e) {
      toast.error(apiError(e, "Couldn't verify this item"));
    }
  };

  const activeFilters = [category && "category", quality && "quality", !inStock && "stock"].filter(Boolean).length;
  const clearAll = () => setParams(search ? new URLSearchParams({ search }) : new URLSearchParams(), { replace: true });

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Browse stock" }]} />

      {/* ── header ──────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink-1 tracking-tight">
              {search ? `“${search}”` : category ? category : "Everything on the network's shelves"}
            </h1>
            <p className="text-2xs text-ink-3 mt-1">
              {networkLoading && !loaded ? (
                "Reading the shelves…"
              ) : (
                <>
                  <strong className="text-ink-1 tabular-nums">{num(results.length)}</strong> item
                  {results.length === 1 ? "" : "s"} you can source right now. Your own shelf is never listed here.
                </>
              )}
            </p>
          </div>
          <SearchInput
            value={search}
            onChange={(v) => setParam({ search: v })}
            placeholder="Search network stock"
            className="w-full sm:w-72"
            aria-label="Search network stock"
          />
        </div>

        {/* ── category rail ─────────────────────────────────────────── */}
        {categories.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-0.5">
            <Chip size="sm" active={!category} onClick={() => setParam({ category: "" })}>
              All categories
            </Chip>
            {categories.map((c) => (
              <Chip key={c} size="sm" active={category === c} onClick={() => setParam({ category: category === c ? "" : c })}>
                {c}
              </Chip>
            ))}
          </div>
        )}

        {/* ── filter bar ────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 py-2 border-y border-edge-1">
          <Button
            size="sm"
            variant={activeFilters ? "subtle" : "secondary"}
            icon={SlidersHorizontal}
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
          >
            Filters
            {activeFilters > 0 && (
              <Badge variant="brand" size="xs" className="ml-1">
                {activeFilters}
              </Badge>
            )}
          </Button>

          <Chip size="sm" active={inStock} onClick={() => setParam({ stock: inStock ? "all" : "" })}>
            In stock only
          </Chip>

          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="browse-sort" className="text-2xs text-ink-4 font-semibold hidden sm:block">
              Sort
            </label>
            <Select
              id="browse-sort"
              value={sort}
              onChange={(e) => setParam({ sort: e.target.value === "recommended" ? "" : e.target.value })}
              options={SORTS}
              className="h-9 w-48"
            />
          </div>
        </div>

        {filtersOpen && (
          <div className="grid gap-3 sm:grid-cols-3 p-4 rounded-2xl border border-edge-1 bg-surface-1 animate-slide-down">
            <Select
              label="Provenance"
              value={quality}
              onChange={(e) => setParam({ quality: e.target.value })}
              options={QUALITY_FILTERS}
              hint="Filters on the quality ladder the vendor has actually reached"
            />
            <Select
              label="Availability"
              value={inStock ? "in" : "all"}
              onChange={(e) => setParam({ stock: e.target.value === "in" ? "" : "all" })}
              options={[
                { value: "in", label: "Only what can ship now" },
                { value: "all", label: "Include sold-out lines" },
              ]}
            />
            <div className="flex items-end">
              <Button size="sm" variant="ghost" icon={X} onClick={clearAll} disabled={!activeFilters}>
                Clear filters
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* ── results ─────────────────────────────────────────────────── */}
      {error ? (
        <ErrorState description={error} onRetry={load} />
      ) : networkLoading && !network.length ? (
        <SkeletonGrid count={8} />
      ) : results.length === 0 ? (
        <EmptyState
          icon={search || activeFilters ? Package : Globe}
          tone="brand"
          title={search || activeFilters ? "Nothing matches those filters" : "No network stock yet"}
          description={
            search || activeFilters
              ? "Widen the search, drop a filter, or include sold-out lines — vendors restate prices through the day."
              : "Nobody is showing stock you can source right now. Connect with more vendors; anything they make visible lands here."
          }
          action={
            search || activeFilters ? (
              <Button size="sm" onClick={clearAll}>
                Clear filters
              </Button>
            ) : (
              <Button size="sm" icon={Sparkles} onClick={() => navigate("/network?tab=suggested")}>
                Find suppliers
              </Button>
            )
          }
          secondaryAction={
            <Button size="sm" variant="secondary" onClick={() => navigate("/stock")}>
              Add your own stock
            </Button>
          }
        />
      ) : (
        <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
          {results.map((item) => (
            <StockCard
              key={item.id}
              item={item}
              mode="network"
              onSource={setSourcing}
              onDeal={onDeal}
              onCompare={setComparing}
              canPatronVerify={isPatron}
              onPatronVerify={onPatronVerify}
            />
          ))}
        </div>
      )}

      <SourceDialog item={sourcing} open={!!sourcing} onClose={() => setSourcing(null)} onDone={() => navigate("/orders")} />
      <StockCompareModal
        item={comparing}
        open={!!comparing}
        onClose={() => setComparing(null)}
        onSource={(alt) => {
          setComparing(null);
          setSourcing(alt);
        }}
      />
    </div>
  );
}
