import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe, Phone, Clock, MapPin, RefreshCw, Check, Building2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import SearchInput from "@/components/ui/SearchInput";
import { toast } from "@/components/ui/Toast";
import { geoAPI, apiError } from "@/lib/api";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC PLACES — the open-data directory (OpenStreetMap, ODbL).
//
// Every row answers for itself: source, OSM id, and when the source last
// confirmed it. Until a vendor claims a place it reads "unverified · public
// data" — the badge is the claim, not a checkbox the app flips. Stale rows
// (not re-confirmed in 30 days) turn amber; they are shown, never hidden.
// ─────────────────────────────────────────────────────────────────────────────

const CAT_LABEL = (c) => {
  if (!c) return "business";
  const [kind, val] = c.split(":");
  return val ? `${val}` : kind;
};

export default function PublicPlaces() {
  const [zones, setZones] = useState(null);
  const [zoneId, setZoneId] = useState("");
  const [places, setPlaces] = useState(null);
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState(null);

  const load = useCallback(() => {
    geoAPI.zones().then((r) => setZones(r.data.zones)).catch(() => setZones([]));
  }, []);

  const loadPlaces = useCallback(() => {
    geoAPI
      .publicPlaces({ zone_id: zoneId || undefined, category: category || undefined, q: search || undefined })
      .then((r) => {
        setPlaces(r.data.places);
        setCategories(r.data.categories || []);
      })
      .catch((e) => {
        setPlaces([]);
        toast.error(apiError(e, "The open-data list could not be loaded"));
      });
  }, [zoneId, category, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(loadPlaces, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadPlaces, search]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = zoneId ? await geoAPI.ingestZone(zoneId) : await geoAPI.ingestAll();
      if (zoneId) {
        toast.success(`${res.data.zone}: ${num(res.data.found)} places · ${num(res.data.new)} new to the app`);
      } else {
        toast.success(`${res.data.ok}/${res.data.zones} zones refreshed · ${num(res.data.new_places)} new places`);
      }
      load();
      loadPlaces();
    } catch (e) {
      toast.error(apiError(e, "The refresh was refused — try again in an hour"));
    } finally {
      setRefreshing(false);
    }
  };

  const claim = async (place) => {
    setClaimingId(place.id);
    try {
      const res = await geoAPI.claim(place.id);
      toast.success(res.data.changed
        ? `Linked to your account — add your stock to make it live`
        : "Already linked to your account");
      loadPlaces();
    } catch (e) {
      toast.error(apiError(e, "That claim was refused"));
    } finally {
      setClaimingId(null);
    }
  };

  const selectedZone = useMemo(() => zones?.find((z) => z.id === zoneId) || null, [zones, zoneId]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (places || []).filter(
      (p) => !q || `${p.name} ${p.category || ""} ${p.address || ""} ${p.zone_name || ""}`.toLowerCase().includes(q)
    );
  }, [places, search]);

  if (!places && !zones) return <PageSpinner label="Reading the open data…" />;

  return (
    <div className="space-y-4">
      {/* Zone chips + refresh */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setZoneId("")}
          className={cn("rounded-full px-3 h-8 text-xs font-medium transition-colors", !zoneId ? "bg-brand-500/20 text-brand-200" : "text-ink-4 hover:text-ink-2")}
        >
          All zones
        </button>
        {(zones || []).map((z) => (
          <button
            key={z.id}
            onClick={() => setZoneId(z.id)}
            className={cn("rounded-full px-3 h-8 text-xs font-medium transition-colors", zoneId === z.id ? "bg-brand-500/20 text-brand-200" : "text-ink-4 hover:text-ink-2")}
            title={z.located ? `${z.places} places · last ingest ${z.last_ingest_at ? relativeTime(z.last_ingest_at) : "never"}` : "not located yet"}
          >
            {z.name}
            <span className="ml-1.5 font-mono opacity-70">{z.places || "—"}</span>
            {!z.located && <span className="ml-1.5 opacity-60">· locating</span>}
          </button>
        ))}
        <Button size="sm" variant="secondary" icon={RefreshCw} loading={refreshing} onClick={refresh} className="ml-auto">
          Update data
        </Button>
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="Search the open data — name, category, street" className="sm:max-w-md" />

      {filtered.length === 0 ? (
        <EmptyState
          icon={Globe}
          title={places ? "No public places match" : "Nothing ingested yet"}
          description={places
            ? "Loosen the search or pick another zone."
            : "Press Update data — the app pulls named shops, markets and crafts from OpenStreetMap for each zone, with no manual entry."}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <div key={p.id} className="glass glass-hover rounded-2xl p-3.5 flex gap-3 animate-fade-in">
              <span className="w-9 h-9 rounded-xl bg-white/[0.05] text-ink-3 flex items-center justify-center shrink-0">
                <Building2 size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-ink-1 truncate">{p.name}</p>
                  <Badge variant="outline" size="xs">{CAT_LABEL(p.category)}</Badge>
                  {p.stale && <Badge variant="amber" size="xs">stale</Badge>}
                  {p.claimed_by_me && (
                    <Badge variant="brand" size="xs"><Check size={9} /> yours</Badge>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-ink-4">
                  {p.phone && <span className="inline-flex items-center gap-1"><Phone size={10} />{p.phone}</span>}
                  {p.opening_hours && <span className="inline-flex items-center gap-1 max-w-[16rem] truncate"><Clock size={10} />{p.opening_hours}</span>}
                  {p.address && <span className="inline-flex items-center gap-1"><MapPin size={10} />{p.address}</span>}
                </div>
                <p className="mt-1 text-2xs text-ink-4/80 font-mono truncate">
                  {p.zone_name ? `${p.zone_name} · ` : ""}OSM {p.external_id} · checked {p.checked_days_ago ?? "—"}d ago
                  {p.claimed_by_me ? "" : " · unverified"}
                </p>
              </div>
              {!p.claimed_by_me && (
                <Button size="sm" variant="secondary" loading={claimingId === p.id} onClick={() => claim(p)} className="shrink-0">
                  Claim
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setCategory("")} className={cn("rounded-full px-2.5 h-7 text-2xs font-medium", !category ? "bg-brand-500/20 text-brand-200" : "text-ink-4")}>
            All
          </button>
          {categories.map((c) => (
            <button key={c} onClick={() => setCategory(c === category ? "" : c)} className={cn("rounded-full px-2.5 h-7 text-2xs font-medium", category === c ? "bg-brand-500/20 text-brand-200" : "text-ink-4")}>
              {CAT_LABEL(c)}
            </button>
          ))}
        </div>
      )}

      <p className="text-2xs text-ink-4 px-1">
        Data © OpenStreetMap contributors (ODbL) · rows are unverified until a vendor claims them
      </p>
    </div>
  );
}
