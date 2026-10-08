import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Radar, MapPin, Store, Users, Trophy, Plus, Check, X, Search, Navigation, Medal, Pencil, ChevronRight,
} from "lucide-react";
import Tabs from "@/components/ui/Tabs";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { marketsAPI, geoAPI, apiError } from "@/lib/api";
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

const RADII = [
  { value: 50, label: "50 km" },
  { value: 150, label: "150 km" },
  { value: 300, label: "300 km" },
  { value: 500, label: "500 km" },
];

function PatronTag({ zo }) {
  if (!zo.lead_patron) return <span className="text-2xs text-ink-4">no patron yet</span>;
  return (
    <span className="text-2xs text-ink-3 flex items-center gap-1">
      <Medal size={11} className="text-brand-300" />
      {zo.lead_patron.name} · {zo.patron_count} patron{zo.patron_count === 1 ? "" : "s"} / {zo.patron_slots} seat{zo.patron_slots === 1 ? "" : "s"}
    </span>
  );
}

function MarketRow({ m, onJoin, joining, selectable, selected, onSelect, withData }) {
  return (
    <div className="glass glass-hover rounded-2xl p-3.5 flex gap-3 items-center animate-fade-in">
      <span className="w-10 h-10 rounded-xl bg-brand-500/12 text-brand-300 flex items-center justify-center shrink-0">
        <Store size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={`/markets/${m.id}`} className="text-sm font-medium text-ink-1 truncate hover:text-brand-300">{m.name}</Link>
          <span className="text-2xs text-ink-4">{m.city}{m.country ? ` · ${m.country}` : ""}</span>
          {typeof m.distance_km === "number" && (
            <span className="digital text-2xs text-brand-300">{m.distance_km} km</span>
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
              selected ? "bg-brand-500/25 text-brand-200" : "bg-white/[0.06] text-ink-3 hover:text-ink-1")}
          >
            {selected ? <Check size={11} /> : <Plus size={11} />} {selected ? "picked" : "pick"}
          </button>
        )}
        <button
          type="button"
          onClick={onJoin}
          disabled={joining}
          className="rounded-full px-3 h-7 text-2xs font-semibold bg-brand-500/20 text-brand-200 hover:bg-brand-500/30 disabled:opacity-50 cursor-pointer"
        >
          {joining ? "…" : "register"}
        </button>
      </div>
    </div>
  );
}

// ── Near-me scan ─────────────────────────────────────────────────────────────
function NearMe() {
  const [radius, setRadius] = useState(150);
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [place, setPlace] = useState("");
  const [needLocation, setNeedLocation] = useState(false);
  const [locating, setLocating] = useState(false);
  const [customGeo, setCustomGeo] = useState(null);

  const scan = useCallback(async (geo) => {
    setScanning(true);
    setNeedLocation(false);
    try {
      const params = { radius_km: radius, limit: 15 };
      if (geo) { params.lat = geo.lat; params.lng = geo.lng; }
      const r = await marketsAPI.scan(params);
      setResult(r.data);
    } catch (e) {
      if (String(e?.response?.status) === "400") {
        setNeedLocation(true);
        setResult(null);
      } else {
        toast.error(apiError(e, "The scan failed"));
      }
    } finally {
      setScanning(false);
    }
  }, [radius]);

  const locateAndScan = async () => {
    if (!place.trim()) return;
    setLocating(true);
    try {
      const { data: g } = await geoAPI.geocode(place.trim());
      const geo = { lat: g.lat, lng: g.lng };
      setCustomGeo(geo);
      scan(geo);
    } catch (e) {
      toast.error(apiError(e, "No match for that place"));
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-xs text-ink-4 flex-1">Scan the nearest markets in your surrounding towns.</p>
        <Select value={String(radius)} onChange={(e) => setRadius(Number(e.target.value))} options={RADII} />
        <Button size="sm" icon={Radar} loading={scanning} onClick={() => scan(customGeo)}>
          {scanning ? "Scanning…" : "Scan"}
        </Button>
      </div>

      {needLocation && (
        <div className="glass rounded-2xl p-3.5 space-y-2">
          <p className="text-xs text-ink-3">Set a point to scan from — a town or market name.</p>
          <div className="flex gap-2">
            <Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Nakuru" wrapperClassName="flex-1" />
            <Button size="sm" loading={locating} onClick={locateAndScan}><Navigation size={13} /> Locate</Button>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <p className="text-2xs text-ink-4">{result.found} markets within {result.radius_km} km of {customGeo ? "your point" : "your shop"}</p>
          {result.markets.length === 0 ? (
            <EmptyState icon={Radar} title="No markets in that radius" description="Widen the radius, or set a point in a different town." />
          ) : result.markets.map((m) => (
            <MarketRow key={m.id} m={m} onJoin={async () => {
              try { const r = await marketsAPI.join(m.id); toast.success(`Registered for ${m.name}${r.data.i_am_lead ? " — you're the lead patron" : r.data.i_am_patron ? " — you're a patron" : ""}`); }
              catch (e) { toast.error(apiError(e)); }
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── All markets + multi-select data ─────────────────────────────────────────
function AllMarkets() {
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

  const markets = useMemo(() => (data?.markets || []).filter((m) => !country || m.country === country), [data, country]);
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
        <button onClick={() => setCountry("")} className={cn("shrink-0 rounded-full px-3 h-8 text-xs", !country ? "bg-brand-500/20 text-brand-200" : "text-ink-4")}>All</button>
        {(data.countries || []).map((c) => (
          <button key={c} onClick={() => setCountry(c === country ? "" : c)} className={cn("shrink-0 rounded-full px-3 h-8 text-xs", country === c ? "bg-brand-500/20 text-brand-200" : "text-ink-4")}>{c}</button>
        ))}
      </div>

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
            <Link to={`/markets/${m.id}`} className="text-base font-semibold text-ink-1 hover:text-brand-300">{m.name}</Link>
            <span className="text-2xs text-ink-4">{m.city}{m.country ? ` · ${m.country}` : ""}</span>
            {m.i_am_lead ? <Badge variant="brand" size="xs"><Medal size={9} /> Lead patron</Badge>
              : m.i_am_patron ? <Badge variant="outline" size="xs" className="text-brand-300">Patron</Badge>
                : <span className="text-2xs text-ink-4">{m.member_count} registered · you joined #{m.my_join_rank}</span>}
          </div>

          {m.i_am_lead && (
            <div className="rounded-2xl bg-white/[0.04] p-3 space-y-2">
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
            <div className="rounded-2xl bg-white/[0.04] p-3">
              <p className="text-2xs uppercase tracking-[0.2em] text-ink-4 font-bold mb-1">Market pace note</p>
              <p className="text-xs text-ink-2">{m.welcome}</p>
            </div>
          )}

          {m.lead_patron && <PatronTag zo={m} />}
          <div className="flex justify-end gap-2">
            <Link
              to={`/markets/${m.id}`}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-xl text-xs font-medium bg-white/[0.06] text-ink-2 hover:text-ink-1"
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
  const [tab, setTab] = useState("near");
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Markets</h2>
        <p className="text-xs text-ink-4 mt-0.5">East Africa's high-density town markets — scan what's near, pick 1–N, get each one's real data.</p>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "near" && <NearMe />}
      {tab === "all" && <AllMarkets />}
      {tab === "mine" && <MyMarkets />}
    </div>
  );
}
