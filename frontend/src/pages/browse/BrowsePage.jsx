import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Globe, Package, SlidersHorizontal, Sparkles, X, Megaphone, Map as MapIcon,
  MapPin, Newspaper, Network, Users,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Select from "@/components/ui/Select";
import SearchInput from "@/components/ui/SearchInput";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Badge from "@/components/ui/Badge";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import { SkeletonGrid } from "@/components/ui/Skeleton";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import StockCard from "@/components/stock/StockCard";
import SourceDialog from "@/components/stock/SourceDialog";
import StockCompareModal from "@/components/stock/StockCompareModal";
import ResultCard from "@/components/discovery/ResultCard";
import RequestComposer from "@/components/requests/RequestComposer";
import RequestCard from "@/components/requests/RequestCard";
import { JOB_TILES } from "@/config/navigation";
import { useStockStore } from "@/stores/stockStore";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { stockAPI, toolAPI, squadAPI, requestsAPI, apiError } from "@/lib/api";
import { num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   BROWSE — the business action center (v2.9 IA).
   ---------------------------------------------------------------------------
   WHAT CHANGED   Browse is no longer "the stock list". It is organised around
                  what a business is trying to DO: find stock, find people,
                  move goods, get equipment — one search, one results system.
                  The map, markets and news stay as context views of the same
                  results, not competing doors. And when the directory cannot
                  answer, one reusable flow takes over: post a request.
   PRESERVED      The entire goods pipeline: stockAPI.network, category rail,
                  sort, provenance filters, StockCard, source, compare, deal
                  rooms, patron-verify. Nothing about the mechanics moved.
   THE CONTRACT   Every result answers five questions without a tap: can they
                  help me · are they available · what will it cost · can I
                  trust them · what can I do now (with the primary action
                  specific to the kind — Hire · Check dates · Book · Request
                  quote).
   ═══════════════════════════════════════════════════════════════════════════ */

const TYPES = ["goods", "people", "services", "equipment"];

const TYPE_TABS = [
  ...JOB_TILES.map(({ type, label, icon: Icon }) => ({ value: type, label, icon: Icon })),
];

/* ── the action-center root ──────────────────────────────────────────────────── */

function ActionCenter({ search, onSearch, onPost, onPosted, goType, refreshKey }) {
  const vendor = useAuthStore((s) => s.vendor);
  const [requests, setRequests] = useState(null);
  const [requestsError, setRequestsError] = useState("");

  const load = useCallback(() => {
    setRequestsError("");
    return requestsAPI.list({ scope: "open", limit: 6 })
      .then((r) => setRequests(r.data))
      .catch((e) => setRequestsError(apiError(e, "Open requests could not be loaded")));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const where = vendor?.physical_location || vendor?.market_zone?.name || "your area";

  return (
    <>
      {/* ── the ask: what does your business need today? ──────────────── */}
      <section className="rounded-3xl border border-edge-1 bg-surface-1 p-4 sm:p-5 space-y-3">
        <div>
          <p className="text-2xs font-semibold tracking-wide text-ink-4 uppercase">{where} · Kenya</p>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-1 tracking-tight mt-1">
            What does your business need today?
          </h1>
        </div>
        <SearchInput value={search} onChange={onSearch}
          placeholder="Search goods, people or services" className="w-full" />
        <div className="grid grid-cols-2 gap-2">
          {JOB_TILES.map(({ type, label, blurb, icon: Icon, tint }) => (
            <button key={type} type="button" onClick={() => goType(type)}
              className={cn("rounded-2xl p-3 text-left space-y-1.5 cursor-pointer transition-transform active:scale-[0.985]", tint)}>
              <Icon size={22} aria-hidden="true" />
              <span className="block text-sm font-bold">{label}</span>
              <span className="block text-2xs opacity-80">{blurb}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={onPost}
          className="w-full rounded-2xl border border-edge-2 bg-surface-0 p-3 flex items-center gap-2.5 text-left cursor-pointer hover:border-brand-500/50 transition-colors">
          <span className="w-8 h-8 rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300 flex items-center justify-center shrink-0">
            <Megaphone size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink-1">Post a business request</span>
            <span className="block text-2xs text-ink-4">Tell nearby businesses what you need — stock, hands, transport or tools.</span>
          </span>
          <Sparkles size={14} className="text-brand-700 dark:text-brand-300 shrink-0" />
        </button>
      </section>

      {/* ── requests near you: the network's live needs ─────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-1">Requests near you</h2>
          <span className="text-2xs text-ink-4">Answer one — it is a lead</span>
        </div>
        {requestsError ? (
          <p className="text-2xs text-ink-4">{requestsError}</p>
        ) : !requests ? (
          <PageSpinner label="Reading open requests…" />
        ) : requests.length === 0 ? (
          <p className="text-2xs text-ink-4 px-1">
            Nothing open right now. Post yours — it stays visible until it is fulfilled.
          </p>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {requests.map((r) => <RequestCard key={r.id} request={r} mode="open" onChange={load} />)}
          </div>
        )}
      </section>

      {/* ── context: same results, other views ──────────────────────────── */}
      <section className="flex flex-wrap gap-2">
        <ContextLink to="/map" icon={MapIcon}>Map view</ContextLink>
        <ContextLink to="/markets" icon={MapPin}>Markets</ContextLink>
        <ContextLink to="/network" icon={Network}>Suppliers</ContextLink>
        <ContextLink to="/nearby" icon={Globe}>Around you</ContextLink>
        <ContextLink to="/news" icon={Newspaper}>Market news</ContextLink>
      </section>
    </>
  );
}

function ContextLink({ to, icon: Icon, children }) {
  const navigate = useNavigate();
  return (
    <button type="button"
      onClick={() => navigate(to)}
      className="h-8 px-3 rounded-full border border-edge-2 text-2xs font-semibold text-ink-3 hover:text-ink-1 hover:border-edge-3 inline-flex items-center gap-1.5 cursor-pointer">
      <Icon size={12} /> {children}
    </button>
  );
}

/* ── goods: the preserved pipeline ───────────────────────────────────────────── */

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

function GoodsResults({ search, onSearch }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const confirm = useConfirm();

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

  useEffect(() => { load(); }, [load]);

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
    <>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink-1 tracking-tight">
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
          <SearchInput value={search} onChange={onSearch} placeholder="Search network stock"
            className="w-full sm:w-72" aria-label="Search network stock" />
        </div>

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

        <div className="flex flex-wrap items-center gap-2 py-2 border-y border-edge-1">
          <Button size="sm" variant={activeFilters ? "subtle" : "secondary"} icon={SlidersHorizontal}
            onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
            Filters
            {activeFilters > 0 && <Badge variant="brand" size="xs" className="ml-1">{activeFilters}</Badge>}
          </Button>
          <Chip size="sm" active={inStock} onClick={() => setParam({ stock: inStock ? "all" : "" })}>
            In stock only
          </Chip>
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="browse-sort" className="text-2xs text-ink-4 font-semibold hidden sm:block">Sort</label>
            <Select id="browse-sort" value={sort}
              onChange={(e) => setParam({ sort: e.target.value === "recommended" ? "" : e.target.value })}
              options={SORTS} className="h-9 w-48" />
          </div>
        </div>

        {filtersOpen && (
          <div className="grid gap-3 sm:grid-cols-3 p-4 rounded-2xl border border-edge-1 bg-surface-1 animate-slide-down">
            <Select label="Provenance" value={quality} onChange={(e) => setParam({ quality: e.target.value })}
              options={QUALITY_FILTERS} hint="Filters on the quality ladder the vendor has actually reached" />
            <Select label="Availability" value={inStock ? "in" : "all"}
              onChange={(e) => setParam({ stock: e.target.value === "in" ? "" : "all" })}
              options={[
                { value: "in", label: "Only what can ship now" },
                { value: "all", label: "Include sold-out lines" },
              ]} />
            <div className="flex items-end">
              <Button size="sm" variant="ghost" icon={X} onClick={clearAll} disabled={!activeFilters}>
                Clear filters
              </Button>
            </div>
          </div>
        )}
      </header>

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
              : "Nobody is showing stock you can source right now. Post a request and let suppliers come to you."
          }
          action={
            search || activeFilters ? (
              <Button size="sm" onClick={clearAll}>Clear filters</Button>
            ) : (
              <Button size="sm" icon={Sparkles} onClick={() => setParams(new URLSearchParams({ request: "1", type: "goods" }), { replace: true })}>
                Post a request
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
            <StockCard key={item.id} item={item} mode="network"
              onSource={setSourcing} onDeal={onDeal} onCompare={setComparing}
              canPatronVerify={isPatron} onPatronVerify={onPatronVerify} />
          ))}
        </div>
      )}

      <SourceDialog item={sourcing} open={!!sourcing} onClose={() => setSourcing(null)} onDone={() => navigate("/orders")} />
      <StockCompareModal item={comparing} open={!!comparing} onClose={() => setComparing(null)}
        onSource={(alt) => { setComparing(null); setSourcing(alt); }} />
    </>
  );
}

/* ── people: open job calls, then specialist suppliers ───────────────────────── */

function PeopleResults({ search, onSearch, onPost }) {
  const navigate = useNavigate();
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    return squadAPI.calls(search ? { skill: undefined } : {})
      .then((r) => setCalls((r.data?.calls || []).filter(
        (c) => !search || (c.title || "").toLowerCase().includes(search.toLowerCase())
              || (c.skill || "").toLowerCase().includes(search.toLowerCase())
              || (c.location || "").toLowerCase().includes(search.toLowerCase())
      )))
      .catch((e) => setError(apiError(e, "Open job calls could not be loaded")));
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const accept = async (_action, call) => {
    try {
      await squadAPI.accept(call.id);
      toast.success("Accepted — check Work for the contract");
      load();
    } catch (e) {
      toast.error(apiError(e, "The job call could not be accepted"));
    }
  };

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink-1 tracking-tight">People ready to work</h1>
          <p className="text-2xs text-ink-3 mt-1">
            Open job calls near you — fundis, loaders, casuals and specialists. Post your own from Work.
          </p>
        </div>
        <SearchInput value={search} onChange={onSearch} placeholder="Search a skill or a place"
          className="w-full sm:w-72" aria-label="Search people" />
      </div>
      {error ? (
        <ErrorState description={error} onRetry={load} />
      ) : !calls ? (
        <SkeletonGrid count={4} />
      ) : calls.length === 0 ? (
        <EmptyState icon={Users} tone="brand" title="No open calls right now"
          description="Post a worker request and let people come to you — or find specialist suppliers on the network."
          action={<Button size="sm" icon={Sparkles} onClick={onPost}>Post a request</Button>}
          secondaryAction={<Button size="sm" variant="secondary" onClick={() => navigate("/network")}>Find suppliers</Button>} />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {calls.map((call) => <ResultCard key={call.id} kind="people" item={call} onAction={accept} />)}
        </div>
      )}
    </header>
  );
}

/* ── services & equipment: tool and transport listings ───────────────────────── */

function ListingsResults({ kind, search, onSearch, onPost }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const category = kind === "services" ? "transport" : "equipment";

  const load = useCallback(() => {
    setError("");
    return toolAPI.browse({ category, search: search || undefined })
      .then((r) => setRows(r.data))
      .catch((e) => setError(apiError(e, "Listings could not be loaded")));
  }, [category, search]);

  useEffect(() => { load(); }, [load]);

  const onAction = (action, item) => {
    // The booking flow lives on the Tools screen with the calendar; the card
    // hands over with the item already in the search.
    navigate(`/tools?search=${encodeURIComponent(item.title || "")}`);
  };

  const titles = {
    services: { h: "Move goods", sub: "Riders, pickups, couriers and transport — booked by the trip." },
    equipment: { h: "Equipment for hire", sub: "Tools and machinery by the day, with deposits and terms up front." },
  }[kind];

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink-1 tracking-tight">{titles.h}</h1>
          <p className="text-2xs text-ink-3 mt-1">{titles.sub}</p>
        </div>
        <SearchInput value={search} onChange={onSearch} placeholder={`Search ${kind}`}
          className="w-full sm:w-72" aria-label={`Search ${kind}`} />
      </div>
      {error ? (
        <ErrorState description={error} onRetry={load} />
      ) : !rows ? (
        <SkeletonGrid count={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon={kind === "services" ? Package : SlidersHorizontal} tone="brand"
          title={search ? "Nothing matches that search" : "Nothing listed here yet"}
          description={search ? "Try a shorter word — or post a request and let operators come to you." : "Post a request: nearby operators see it and answer with a rate."}
          action={<Button size="sm" icon={Sparkles} onClick={onPost}>Post a request</Button>} />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {rows.map((item) => <ResultCard key={item.id} kind={kind} item={item} onAction={onAction} />)}
        </div>
      )}
    </header>
  );
}

/* ── the page ────────────────────────────────────────────────────────────────── */

export default function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const [composerOpen, setComposerOpen] = useState(params.get("request") === "1");
  const [composerType, setComposerType] = useState("stock");
  const [refreshKey, setRefreshKey] = useState(0);

  const rawType = params.get("type") || "";
  const type = TYPES.includes(rawType) ? rawType : "";
  const search = params.get("search") || "";

  const setParam = useCallback(
    (patch) => {
      const next = new URLSearchParams(params);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const openComposer = useCallback((requestType = "stock") => {
    setComposerType(requestType);
    setComposerOpen(true);
  }, []);

  const onPosted = useCallback(() => {
    setRefreshKey((k) => k + 1);   // the root re-reads its request feed
  }, []);

  // The composer is a first-class route state (?request=1) so empty states and
  // other screens can deep-link straight into it.
  useEffect(() => {
    setComposerOpen(params.get("request") === "1");
  }, [params]);

  const closeComposer = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("request");
    setParams(next, { replace: true });
    setComposerOpen(false);
  }, [params, setParams]);

  return (
    <div className="space-y-5" data-refresh={refreshKey}>
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: type ? `Browse ${type}` : "Browse" }]} />

      {!type ? (
        <ActionCenter
          search={search}
          onSearch={(v) => setParam({ search: v })}
          onPost={() => openComposer("stock")}
          onPosted={onPosted}
          goType={(t) => setParam({ type: t })}
          refreshKey={refreshKey}
        />
      ) : (
        <div className="space-y-3">
          {/* the four jobs, always one tap away */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 py-0.5">
            {TYPE_TABS.map(({ value, label, icon: Icon }) => (
              <Chip key={value} size="sm" active={type === value}
                onClick={() => setParam({ type: type === value ? "" : value })}>
                <Icon size={12} className="inline mr-1 -mt-0.5" />
                {label}
              </Chip>
            ))}
          </div>
          {type === "goods" && (
            <GoodsResults search={search} onSearch={(v) => setParam({ search: v })} />
          )}
          {type === "people" && (
            <PeopleResults search={search} onSearch={(v) => setParam({ search: v })}
              onPost={() => openComposer("worker")} />
          )}
          {(type === "services" || type === "equipment") && (
            <ListingsResults key={type} kind={type} search={search}
              onSearch={(v) => setParam({ search: v })} onPost={() => openComposer(type === "services" ? "delivery" : "rental")} />
          )}
        </div>
      )}

      <RequestComposer open={composerOpen} onClose={closeComposer}
        defaultType={composerType} onPosted={onPosted} />
    </div>
  );
}
