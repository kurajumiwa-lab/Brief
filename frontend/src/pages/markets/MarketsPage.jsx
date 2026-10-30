import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Radar, Store, Users, Plus, Check, X, Medal, Pencil, ChevronRight,
} from "lucide-react";
import Tabs from "@/components/ui/Tabs";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import SearchInput from "@/components/ui/SearchInput";
import Select from "@/components/ui/Select";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { marketsAPI, apiError } from "@/lib/api";
import MarketActivityCard from "@/components/markets/MarketActivityCard";
import { toast } from "@/components/ui/Toast";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// MARKETS — the East-African market catalog.
//
// Scan the nearest markets in your surrounding towns, pick 1..N, and get each
// one's real data (suppliers nearby, public places, open call-ups, its patron).
// Register for a market: early registrants and active members earn patron
// standing — the lead patron is the market's onboarding admin / pace-setter.
//
// Every number is a row or a true distance. A market with no data yet says so.
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { value: "near", label: "Near me", icon: Radar },
  { value: "all", label: "All markets", icon: Store },
  { value: "mine", label: "My markets", icon: Users },
];

// A walk, a matatu ride, a day's travel. The old list started at 50 km and
// defaulted to 150, which is a region, not "around you".
const RADII = [
  { value: 25, label: "25 km" },
  { value: 50, label: "50 km" },
  { value: 150, label: "150 km" },
  { value: 500, label: "500 km" },
];

function PatronTag({ zo }) {
  if (!zo.lead_patron) return <span className="text-2xs text-ink-4">no patron yet</span>;
  return (
    <span className="text-2xs text-ink-3 flex items-center gap-1">
      <Medal size={11} className="text-brand-600 dark:text-brand-400" />
      {zo.lead_patron.name} · {zo.patron_count} patron{zo.patron_count === 1 ? "" : "s"} / {zo.patron_slots} seat{zo.patron_slots === 1 ? "" : "s"}
    </span>
  );
}

function MarketRow({ m, onJoin, joining, selectable, selected, onSelect, withData }) {
  return (
    <div className="glass glass-hover rounded-2xl p-3.5 flex gap-3 items-center animate-fade-in">
      <span className="w-10 h-10 rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0">
        <Store size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={`/markets/${m.id}`} className="text-sm font-medium text-ink-1 truncate hover:text-brand-600 dark:hover:text-brand-400">{m.name}</Link>
          <span className="text-2xs text-ink-4">{m.city}{m.country ? ` · ${m.country}` : ""}</span>
          {typeof m.distance_km === "number" && (
            <span className="digital text-2xs text-brand-600 dark:text-brand-400">{m.distance_km} km</span>
          )}
        </div>
        <p className="text-2xs text-ink-4 mt-0.5">
          {num(m.member_count)} registered · {m.located ? "" : "locating "}
          {m.last_ingest_at ? `data checked ${relativeTime(m.last_ingest_at)}` : "no data yet"}
        </p>
        {"lead_patron" in m && <p className="mt-0.5"><PatronTag zo={m} /></p>}
        {withData && (
          <p className="text-2xs text-ink-3 mt-1">
            {num(withData.public_places)} public places · {num(withData.suppliers_nearby)} suppliers nearby · {num(withData.open_calls_nearby)} open call-ups
            {withData.sample_places?.length ? ` · ${withData.sample_places.map((p) => p.name).join(", ")}` : ""}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        {selectable && (
          <button
            type="button"
            onClick={onSelect}
            className={cn("rounded-full px-3 h-7 text-2xs font-semibold flex items-center gap-1 cursor-pointer",
              selected ? "bg-brand-500/25 text-brand-600 dark:text-brand-400" : "bg-surface-2 text-ink-3 hover:text-ink-1")}
          >
            {selected ? <Check size={11} /> : <Plus size={11} />} {selected ? "picked" : "pick"}
          </button>
        )}
        <button
          type="button"
          onClick={onJoin}
          disabled={joining}
          className="rounded-full px-3 h-7 text-2xs font-semibold bg-brand-500/20 text-brand-600 dark:text-brand-400 hover:bg-brand-500/30 disabled:opacity-50 cursor-pointer"
        >
          {joining ? "…" : "register"}
        </button>
      </div>
    </div>
  );
}

// ── Near me ──────────────────────────────────────────────────────────────────
//
// This used to be a **Scan** button over a radius menu whose smallest option was
// 50 km and whose default was 150. Two problems with that: the reader had to
// press something before the screen would tell them anything, and a 150 km ring
// around Kisumu contains most of western Kenya, ranked by nothing.
//
// It now loads itself at a walking radius (25 km), ranks by activity on the
// server, and widens only when asked.
function NearMe() {
  const [radius, setRadius] = useState(25);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (r) => {
    setLoading(true);
    setError(null);
    try {
      const res = await marketsAPI.around({ radius_km: r, limit: 20, include_empty: true });
      setResult(res.data);
    } catch (e) {
      setError(e);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(radius);
  }, [load, radius]);

  if (loading && !result) return <PageSpinner label="Finding the markets around you…" />;
  if (error) {
    return (
      <EmptyState
        icon={Radar}
        title="The markets didn't load"
        description="Check your connection — nothing was changed."
        action={<Button size="sm" variant="secondary" onClick={() => load(radius)}>Try again</Button>}
      />
    );
  }

  const markets = result?.markets || [];
  const active = markets.filter((m) => !m.empty);
  const inviting = markets.filter((m) => m.empty);
  const widen = RADII.find((r) => r.value > radius);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-ink-4">
          {active.length > 0
            ? `${active.length} market${active.length === 1 ? "" : "s"} trading within ${radius} km, busiest first.`
            : `Nothing within ${radius} km has a shelf yet.`}
        </p>
        <Select
          value={String(radius)}
          onChange={(e) => setRadius(Number(e.target.value))}
          options={RADII.map((r) => ({ value: String(r.value), label: r.label }))}
          aria-label="Search radius"
        />
      </div>

      {active.map((m) => (
        <MarketActivityCard key={m.id} market={m} />
      ))}

      {inviting.length > 0 && (
        <>
          <p className="pt-1 text-micro font-bold uppercase tracking-[0.14em] text-ink-4">
            {active.length > 0 ? "Waiting for a first trader" : "Nearest markets"}
          </p>
          {inviting.map((m) => (
            <MarketActivityCard key={m.id} market={m} />
          ))}
        </>
      )}

      {widen && (
        <button
          type="button"
          onClick={() => setRadius(widen.value)}
          className="inline-flex items-center gap-1 text-micro font-semibold text-ink-3 underline-offset-2 hover:text-ink-1 hover:underline"
        >
          Look further out ({widen.label}) <ChevronRight size={11} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ── All markets + multi-select data ─────────────────────────────────────────
function AllMarkets({ searchQuery, onSearchChange }) {
  const [data, setData] = useState(null);
  const [country, setCountry] = useState("");
  const [selected, setSelected] = useState({});
  const [joining, setJoining] = useState(null);
  const [fetched, setFetched] = useState(null); // {zone_id: dataBlock}
  const [loadingData, setLoadingData] = useState(false);

  const load = useCallback(() => {
    marketsAPI.list().then((r) => setData(r.data)).catch((e) => toast.error(apiError(e, "The catalog could not be loaded")));
  }, []);
  useEffect(load, [load]);

  const markets = useMemo(() => (data?.markets || []).filter((market) => {
    const matchesCountry = !country || market.country === country;
    const haystack = `${market.name || ""} ${market.city || ""} ${market.country || ""}`.toLocaleLowerCase();
    return matchesCountry && (!searchQuery || haystack.includes(searchQuery.trim().toLocaleLowerCase()));
  }), [data, country, searchQuery]);
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));

  const getData = async () => {
    if (!selectedIds.length) return;
    setLoadingData(true);
    try {
      const r = await marketsAPI.data(selectedIds);
      const map = {};
      r.data.markets.forEach((m) => { map[m.id] = m.data; });
      setFetched(map);
    } catch (e) {
      toast.error(apiError(e, "The market data could not be loaded"));
    } finally {
      setLoadingData(false);
    }
  };

  const join = async (id) => {
    setJoining(id);
    try {
      const r = await marketsAPI.join(id);
      toast.success(`Registered for that market${r.data.i_am_lead ? " — you're the lead patron" : r.data.i_am_patron ? " — you're a patron" : ""}`);
    } catch (e) {
      toast.error(apiError(e, "You may already be registered"));
    } finally {
      setJoining(null);
    }
  };

  if (!data) return <PageSpinner label="Loading the market catalog…" />;

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button onClick={() => setCountry("")} className={cn("shrink-0 rounded-full px-3 h-8 text-xs", !country ? "bg-brand-500/20 text-brand-600 dark:text-brand-400" : "text-ink-4")}>All</button>
        {(data.countries || []).map((c) => (
          <button key={c} onClick={() => setCountry(c === country ? "" : c)} className={cn("shrink-0 rounded-full px-3 h-8 text-xs", country === c ? "bg-brand-500/20 text-brand-600 dark:text-brand-400" : "text-ink-4")}>{c}</button>
        ))}
      </div>

      <SearchInput value={searchQuery} onChange={onSearchChange} placeholder="Search markets, towns or countries" className="sm:max-w-sm" />

      {selectedIds.length > 0 && (
        <div className="sticky top-0 z-10 glass-strong rounded-2xl p-3 flex items-center gap-2">
          <p className="text-xs text-ink-2 flex-1">{selectedIds.length} selected</p>
          <Button size="sm" variant="ghost" onClick={() => setSelected({})}><X size={12} /> Clear</Button>
          <Button size="sm" loading={loadingData} onClick={getData}>Get data</Button>
        </div>
      )}

      {markets.length === 0 ? (
        <EmptyState icon={Store} title="No markets in that country yet" description="More East-African markets are added to the catalog regularly." />
      ) : markets.map((m) => (
        <MarketRow
          key={m.id}
          m={m}
          selectable
          selected={!!selected[m.id]}
          onSelect={() => toggle(m.id)}
          onJoin={() => join(m.id)}
          joining={joining === m.id}
          withData={fetched?.[m.id]}
        />
      ))}
    </div>
  );
}

// ── My markets + patron standing ───────────────────────────────────────────
function MyMarkets() {
  const [data, setData] = useState(null);
  const [leaving, setLeaving] = useState(null);
  const [welcome, setWelcome] = useState({});
  const [savingWelcome, setSavingWelcome] = useState(null);

  const load = useCallback(() => {
    marketsAPI.mine().then((r) => setData(r.data)).catch((e) => toast.error(apiError(e, "Your markets could not be loaded")));
  }, []);
  useEffect(load, [load]);

  if (!data) return <PageSpinner label="Loading your markets…" />;

  const saveWelcome = async (id) => {
    setSavingWelcome(id);
    try {
      await marketsAPI.welcome(id, welcome[id]);
      toast.success("Pace note saved — members will see it");
      load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSavingWelcome(null);
    }
  };

  return (
    <div className="space-y-3">
      {data.markets.length === 0 ? (
        <EmptyState icon={Users} title="No markets yet" description="Register for a market from All markets. Early registrants and active members earn patron standing." />
      ) : data.markets.map((m) => (
        <div key={m.id} className="glass-strong rounded-3xl p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={`/markets/${m.id}`} className="text-base font-semibold text-ink-1 hover:text-brand-600 dark:hover:text-brand-400">{m.name}</Link>
            <span className="text-2xs text-ink-4">{m.city}{m.country ? ` · ${m.country}` : ""}</span>
            {m.i_am_lead ? <Badge variant="brand" size="xs"><Medal size={9} /> Lead patron</Badge>
              : m.i_am_patron ? <Badge variant="outline" size="xs" className="text-brand-600 dark:text-brand-400">Patron</Badge>
                : <span className="text-2xs text-ink-4">{m.member_count} registered · you joined #{m.my_join_rank}</span>}
          </div>

          {m.i_am_lead && (
            <div className="rounded-2xl bg-surface-2 p-3 space-y-2">
              <p className="text-2xs uppercase tracking-[0.2em] text-ink-4 font-bold flex items-center gap-1.5"><Pencil size={11} /> Your pace note for this market</p>
              <textarea
                value={welcome[m.id] ?? m.welcome ?? ""}
                onChange={(e) => setWelcome((w) => ({ ...w, [m.id]: e.target.value }))}
                rows={2}
                placeholder="Welcome newcomers, set the pace: what's moving, who's reliable, what to watch."
                className="w-full px-3 py-2 rounded-xl bg-surface-0 text-xs text-ink-1 focus:outline-none focus:ring-1 focus:ring-brand-500/50 resize-none"
              />
              <div className="flex justify-end">
                <Button size="sm" loading={savingWelcome === m.id} disabled={(welcome[m.id] ?? m.welcome ?? "").trim().length < 3} onClick={() => saveWelcome(m.id)}>Save pace note</Button>
              </div>
            </div>
          )}
          {!m.i_am_lead && m.welcome && (
            <div className="rounded-2xl bg-surface-2 p-3">
              <p className="text-2xs uppercase tracking-[0.2em] text-ink-4 font-bold mb-1">Market pace note</p>
              <p className="text-xs text-ink-2">{m.welcome}</p>
            </div>
          )}

          {m.lead_patron && <PatronTag zo={m} />}
          <div className="flex justify-end gap-2">
            <Link
              to={`/markets/${m.id}`}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-xl text-xs font-medium bg-surface-2 text-ink-2 hover:text-ink-1"
            >
              Open <ChevronRight size={12} />
            </Link>
            <Button size="sm" variant="ghost" loading={leaving === m.id} onClick={async () => {
              setLeaving(m.id);
              try { await marketsAPI.leave(m.id); toast.success(`Left ${m.name}`); load(); }
              catch (e) { toast.error(apiError(e)); } finally { setLeaving(null); }
            }}>Leave</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MarketsPage() {
  const [params, setParams] = useSearchParams();
  const searchQuery = params.get("search") || "";
  const tab = TABS.some((item) => item.value === params.get("tab"))
    ? params.get("tab")
    : searchQuery ? "all" : "near";

  const setTab = (value) => {
    const next = new URLSearchParams(params);
    if (value === "near") next.delete("tab");
    else next.set("tab", value);
    if (value !== "all") next.delete("search");
    setParams(next, { replace: true });
  };

  const setSearchQuery = (value) => {
    const next = new URLSearchParams(params);
    if (value) {
      next.set("search", value);
      next.set("tab", "all");
    } else {
      next.delete("search");
    }
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Markets</h2>
        <p className="text-xs text-ink-4 mt-0.5">
          Markets near you, ranked by who is trading today — not by who signed up.
        </p>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "near" && <NearMe />}
      {tab === "all" && <AllMarkets searchQuery={searchQuery} onSearchChange={setSearchQuery} />}
      {tab === "mine" && <MyMarkets />}
    </div>
  );
}
