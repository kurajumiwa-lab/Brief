import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  BadgeCheck,
  ChevronRight,
  Map as MapIcon,
  MapPin,
  Medal,
  Store,
  Users,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import DigitalNumber from "@/components/ui/DigitalNumber";
import MarketShelf from "@/components/markets/MarketShelf";
import { marketsAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { num, relativeTime } from "@/lib/formatters";

/**
 * A MARKET — where business happens, not a pin with a name.
 *
 * The screen is three layers, read top to bottom:
 *
 *   1  **activity** — traders selling *now*, listings, services, equipment.
 *      `registered` is shown underneath, never as the headline, because a
 *      market with a hundred sign-ups and an empty shelf helps nobody.
 *   2  **the doors** — Goods / People / Services / Equipment. Each one opens the
 *      shelf filtered to that kind, and each one is only offered when the
 *      server says something is behind it.
 *   3  **the shelf itself** — the members' own published records, joined here.
 *      Nothing was uploaded to this market; a vendor publishes once.
 *
 * Two product rules are visible in the copy rather than buried in the code:
 *
 *   · **"Join this market" is not "register to populate a void".** The button
 *     says what joining does for *the vendor* — puts their shelf on this
 *     market's shelf, and their name in front of buyers standing here.
 *   · **An empty market invites.** It never shows a row of zeroes; it says what
 *     claiming it would do, using the sentence the server produced.
 */

export default function MarketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [market, setMarket] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await marketsAPI.activity(id);
      setMarket(r.data);
      setError("");
    } catch (e) {
      setError(apiError(e, "That market could not be loaded"));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <EmptyState
        icon={Store}
        title="No such market"
        description={error}
        action={
          <Button size="sm" variant="secondary" onClick={() => navigate("/markets")}>
            Back to markets
          </Button>
        }
      />
    );
  }
  if (!market) return <PageSpinner label="Opening this market…" />;

  const isMember = Boolean(market.i_am_member);
  const trading = !market.empty;
  const shelfKind = params.get("shelf") || "goods";

  const toggle = async () => {
    setBusy("membership");
    try {
      if (isMember) {
        await marketsAPI.leave(market.id);
        toast.success(`Left ${market.name}`);
      } else {
        const r = await marketsAPI.join(market.id);
        toast.success(
          `Joined ${market.name}${r.data?.i_am_lead ? " — you're the lead patron" : ""} · your shelf is on it now`
        );
      }
      await load();
    } catch (e) {
      toast.error(apiError(e, "That could not be saved"));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <nav className="flex items-center gap-1.5 text-2xs text-ink-4" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-ink-2">Home</Link>
        <ChevronRight size={11} aria-hidden="true" />
        <Link to="/markets" className="hover:text-ink-2">Markets</Link>
        <ChevronRight size={11} aria-hidden="true" />
        <span className="truncate text-ink-2">{market.name}</span>
      </nav>

      {/* ── 1 · identity and activity ─────────────────────────────────── */}
      <section className="glass-strong space-y-3 rounded-3xl p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-500/12 text-brand-700 dark:text-brand-400">
            <Store size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="text-xl font-extrabold tracking-tight text-ink-1">{market.name}</h1>
              {trading ? (
                <Badge variant="brand" size="xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" /> Trading
                </Badge>
              ) : (
                <Badge variant="muted" size="xs">Inviting</Badge>
              )}
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-micro text-ink-3">
              <span className="inline-flex items-center gap-0.5">
                <MapPin size={10} aria-hidden="true" />
                {[market.city, market.country].filter(Boolean).join(" · ")}
              </span>
              {typeof market.distance_km === "number" && <span>· {market.distance_km} km away</span>}
            </p>
          </div>
          {isMember && (
            <Badge variant="brand" size="xs">
              <BadgeCheck size={10} /> Joined
            </Badge>
          )}
        </div>

        {/* Activity first. Registered underneath, quiet, because it is not the
            number a buyer can act on. */}
        {trading ? (
          <>
            <div className="grid grid-cols-3 gap-2" data-testid="market-stats">
              {[
                { label: "traders selling", value: market.active_vendors, tone: "brand" },
                { label: "listings", value: market.listings },
                { label: "services", value: market.services },
              ].map(({ label, value, tone }) => (
                <div key={label} className="rounded-2xl bg-surface-2 p-2.5 text-center">
                  <DigitalNumber
                    value={num(value)}
                    size="md"
                    className={tone === "brand" ? "text-brand-700 dark:text-brand-400" : undefined}
                  />
                  <p className="mt-1 text-micro leading-tight text-ink-4">{label}</p>
                </div>
              ))}
            </div>
            <p className="text-micro text-ink-4">
              {market.registered} registered
              {market.recent_vendors
                ? ` · ${market.recent_vendors} updated their shelf in the last ${30} days`
                : ""}
              {market.last_activity_at ? ` · last change ${relativeTime(market.last_activity_at)}` : ""}
            </p>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-edge-1 p-3">
            <p className="text-2xs leading-relaxed text-ink-2">{market.invitation}</p>
            {market.registered > 0 && (
              <p className="mt-1 text-micro text-ink-4">{market.registered} registered · nothing published yet</p>
            )}
          </div>
        )}

        {market.welcome && (
          <div className="rounded-2xl bg-surface-2 p-3">
            <p className="mb-1 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.2em] text-ink-4">
              <Medal size={11} aria-hidden="true" /> Market pace note
            </p>
            <p className="text-xs text-ink-2">{market.welcome}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy === "membership"} onClick={toggle}>
            {isMember ? "Leave this market" : trading ? "Join this market" : "Claim this market"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(`/map?focus=${market.id}`)}>
            <MapIcon size={13} aria-hidden="true" /> Show on the map
          </Button>
        </div>

        {/* What joining actually does — the answer to "why would I?". */}
        {!isMember && (
          <p className="text-micro leading-relaxed text-ink-4">
            {trading
              ? "Joining puts your shelf on this market's shelf, in front of buyers standing here — and your name beside the traders already selling."
              : "Joining makes you the first trader here: whatever you publish is what the market shows, and buyers looking it up find you."}
          </p>
        )}
      </section>

      {/* ── 2 · the doors ────────────────────────────────────────────── */}
      {trading && (
        <section aria-labelledby="market-doors" className="space-y-2">
          <h2 id="market-doors" className="px-1 text-xs font-bold tracking-tight text-ink-1">
            Explore this market
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {(market.explore || []).map((door) => {
              const active = shelfKind === door.key;
              return (
                <button
                  key={door.key}
                  type="button"
                  disabled={!door.available}
                  aria-pressed={active}
                  onClick={() => setParams({ shelf: door.key }, { replace: true })}
                  className={
                    "rounded-2xl border p-3 text-left transition-colors " +
                    (door.available
                      ? active
                        ? "border-brand-500/60 bg-brand-500/10"
                        : "border-edge-1 bg-surface-1 hover:border-brand-400/50 hover:bg-brand-500/5"
                      : "cursor-not-allowed border-edge-1 bg-surface-1/50 opacity-55")
                  }
                >
                  <p className="text-2xs font-bold text-ink-1">{door.label}</p>
                  <p className="mt-0.5 text-micro leading-tight text-ink-4">{door.blurb}</p>
                  <p className="mt-1 text-micro font-semibold text-ink-3">
                    {door.available ? `${door.count} on the shelf` : "nothing yet"}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 3 · the shelf ────────────────────────────────────────────── */}
      <MarketShelf marketId={market.id} kind={shelfKind} invitation={market.invitation} />

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-micro text-ink-4">
        <span className="inline-flex items-center gap-1">
          <Users size={10} aria-hidden="true" />
          Every listing here belongs to a trader who works in this market.
        </span>
      </p>
    </div>
  );
}
