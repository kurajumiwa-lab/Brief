import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Store, Users, Building2, BadgeCheck, ChevronRight, Map as MapIcon, Radar, Medal } from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import DigitalNumber from "@/components/ui/DigitalNumber";
import { mapAPI, marketsAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { num, relativeTime } from "@/lib/formatters";

// ─────────────────────────────────────────────────────────────────────────────
// MARKET — one market's own screen.
//
// The markets hub lists markets; every action on them used to live inline in
// that list (register, data, pace note, leave), which made the list the only
// screen in the section. Cloning the home pattern gives each market a
// secondary screen: the numbers that make a market worth working, the pace
// note, and the two doors out — the map and the catalog.
//
// "An unworked market" is a real number here: mapped public places with no
// registered members. That is the row a vendor acts on, so it is shown as one.
// ─────────────────────────────────────────────────────────────────────────────

export default function MarketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [market, setMarket] = useState(null);
  const [mine, setMine] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    let live = true;
    mapAPI.market(id).then((r) => live && setMarket(r.data))
      .catch((e) => live && setError(apiError(e, "That market could not be loaded")));
    marketsAPI.mine().then((r) => live && setMine(r.data.markets)).catch(() => {});
    return () => { live = false; };
  }, [id]);

  useEffect(load, [load]);

  if (error) {
    return (
      <EmptyState
        icon={Store}
        title="No such market"
        description={error}
        action={<Button size="sm" variant="secondary" onClick={() => navigate("/markets")}>Back to markets</Button>}
      />
    );
  }
  if (!market) return <PageSpinner label="Opening this market…" />;

  const mineRow = (mine || []).find((m) => m.id === market.id);
  const isMember = Boolean(mineRow);
  const unworked = market.places > 0 && market.members === 0;

  const toggle = async () => {
    setBusy("membership");
    try {
      if (isMember) {
        await marketsAPI.leave(market.id);
        toast.success(`Left ${market.name}`);
      } else {
        await marketsAPI.join(market.id);
        toast.success(`Registered for ${market.name}`);
      }
      load();
    } catch (e) {
      toast.error(apiError(e, "That could not be saved"));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <nav className="flex items-center gap-1.5 text-2xs text-ink-4" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-ink-2">Home</Link>
        <ChevronRight size={11} />
        <Link to="/markets" className="hover:text-ink-2">Markets</Link>
        <ChevronRight size={11} />
        <span className="text-ink-2 truncate">{market.name}</span>
      </nav>

      <div className="glass-strong rounded-3xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="w-12 h-12 rounded-2xl bg-brand-500/12 text-brand-300 flex items-center justify-center shrink-0">
            <Store size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-ink-1 tracking-tight">{market.name}</h2>
            <p className="text-xs text-ink-4 mt-0.5">
              {[market.city, market.country, market.distance_km != null && `${market.distance_km} km away`]
                .filter(Boolean).join(" · ")}
            </p>
          </div>
          {isMember && <Badge variant="brand" size="xs"><BadgeCheck size={10} /> Registered</Badge>}
          {unworked && <Badge variant="muted" size="xs"><Radar size={10} /> Unworked</Badge>}
        </div>

        {/* The three numbers a vendor acts on */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "registered", value: market.members, icon: Users, tone: "" },
            { label: "mapped places", value: market.places, icon: Building2, tone: "" },
            { label: "claimed", value: market.claimed, icon: BadgeCheck, tone: "" },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-2xl bg-white/[0.04] p-3 text-center">
              <Icon size={13} className="mx-auto text-ink-4 mb-1.5" />
              <DigitalNumber value={num(value)} size="md" />
              <p className="text-2xs text-ink-4 mt-1">{label}</p>
            </div>
          ))}
        </div>

        {market.welcome && (
          <div className="rounded-2xl bg-white/[0.04] p-3">
            <p className="text-2xs uppercase tracking-[0.2em] text-ink-4 font-bold mb-1 flex items-center gap-1.5">
              <Medal size={11} /> Market pace note
            </p>
            <p className="text-xs text-ink-2">{market.welcome}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" loading={busy === "membership"} onClick={toggle}>
            {isMember ? "Leave this market" : "Register here"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(`/map?focus=${market.id}`)}>
            <MapIcon size={13} /> Show on the map
          </Button>
          {mineRow?.i_am_lead && (
            <Button size="sm" variant="secondary" onClick={() => navigate("/markets")}>
              <Medal size={13} /> Write the pace note
            </Button>
          )}
        </div>
      </div>

      <p className="text-2xs text-ink-4 px-1">
        {market.last_ingest_at
          ? `Directory for this market checked ${relativeTime(market.last_ingest_at)}${market.last_ingest_count ? ` · ${num(market.last_ingest_count)} rows then` : ""}`
          : "No directory data for this market yet — scan it from the markets hub."}
        {" · OpenStreetMap (ODbL)"}
      </p>
    </div>
  );
}
