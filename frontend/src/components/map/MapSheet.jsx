import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, Store, MapPin, X, Navigation, Phone, Clock, Globe, ChevronRight,
  Map as MapIcon, Package, Users, Check,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import { mapAPI, marketsAPI, geoAPI, apiError } from "@/lib/api";
import { num, relativeTime } from "@/lib/formatters";
import { categoryLabel } from "@/lib/mapViewport";
import { toast } from "@/components/ui/Toast";

// ─────────────────────────────────────────────────────────────────────────────
// MapSheet — what a tapped pin becomes.
//
// A Leaflet popup inside the map is the wrong shape for a phone: it covers the
// pin, it is hard to dismiss, and it has to be rendered before the user asked
// for anything. This is a bottom sheet that starts with what the viewport call
// already returned (name, category, distance) and fetches the rest — phone,
// hours, stock, member counts — only once it is open.
//
// There are no images here on purpose. A map that pulls a photo per pin is a
// map that stops: 300 pins × 300 requests on mobile data is the bug we are
// fixing. When a vendor has media of their own it belongs on their profile.
// ─────────────────────────────────────────────────────────────────────────────

const LOADERS = {
  places: (id, opts) => mapAPI.place(id, opts).then((r) => r.data),
  vendors: (id, opts) => mapAPI.vendor(id, opts).then((r) => r.data),
  markets: (id, opts) => mapAPI.market(id, opts).then((r) => r.data),
};

const ICONS = { places: Building2, vendors: Store, markets: MapPin };

export default function MapSheet({ item, onClose, onFocus }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const kind = item?.kind;
  const id = item?.id;

  useEffect(() => {
    if (!kind || !id || !LOADERS[kind]) return undefined;
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    setDetail(null);
    LOADERS[kind](id, { signal: controller.signal })
      .then((d) => live && setDetail(d))
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (live) toast.error(apiError(e, "That pin's details could not be loaded"));
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
      controller.abort();
    };
  }, [kind, id]);

  if (!item) return null;

  const Icon = ICONS[kind] || MapPin;
  const distance = detail?.distance_km ?? item.distance_km;
  const directions = `https://www.openstreetmap.org/directions?to=${item.lat}%2C${item.lng}`;

  const claim = async () => {
    setBusy(true);
    try {
      const res = await geoAPI.claim(id);
      toast.success(res.data.changed ? "Linked to your account — add stock to make it live" : "Already linked to your account");
      setDetail((d) => (d ? { ...d, claimed: true, claimed_by_me: true } : d));
    } catch (e) {
      toast.error(apiError(e, "That claim was refused"));
    } finally {
      setBusy(false);
    }
  };

  const joinMarket = async () => {
    setBusy(true);
    try {
      const res = await marketsAPI.join(id);
      toast.success(res.data.note || `Registered for ${item.name}`);
      setDetail((d) => (d ? { ...d, members: (d.members || 0) + 1 } : d));
    } catch (e) {
      toast.error(apiError(e, "Registration was refused"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-[600] px-2 pb-2 animate-slide-up">
      <div className="glass-strong rounded-2xl p-3.5 shadow-[0_-8px_40px_-12px_rgba(0,0,0,0.8)]">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-surface-2 text-ink-2 flex items-center justify-center shrink-0">
            <Icon size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-ink-1 truncate">{item.name}</p>
              {kind === "places" && !detail?.claimed && (
                <Badge variant="outline" size="xs">unverified</Badge>
              )}
            </div>
            <p className="text-2xs text-ink-4 mt-0.5 truncate">
              {kind === "vendors" && `@${item.handle || "vendor"} · ${(item.categories || []).slice(0, 3).join(" · ") || "categories not stated"}`}
              {kind === "markets" && [item.city, item.country].filter(Boolean).join(", ")}
              {kind === "places" && categoryLabel(item.category || detail?.category)}
              {typeof distance === "number" && ` · ${distance} km away`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-ink-4 hover:text-ink-1 cursor-pointer shrink-0">
            <X size={15} />
          </button>
        </div>

        {loading && <Spinner size={14} className="py-3" label="Loading details…" />}

        {!loading && detail && (
          <div className="mt-2.5 space-y-1 text-2xs text-ink-3">
            {kind === "places" && (
              <>
                {detail.address && <Line icon={MapPin}>{detail.address}</Line>}
                {detail.phone && (
                  <Line icon={Phone}>
                    <a href={`tel:${detail.phone}`} className="hover:text-brand-600 dark:hover:text-brand-400">{detail.phone}</a>
                  </Line>
                )}
                {detail.opening_hours && <Line icon={Clock}>{detail.opening_hours}</Line>}
                {detail.website && (
                  <Line icon={Globe}>
                    <a href={detail.website} target="_blank" rel="noreferrer" className="hover:text-brand-600 dark:hover:text-brand-400 truncate">{detail.website}</a>
                  </Line>
                )}
                <Line icon={Building2}>
                  {detail.zone_name ? `${detail.zone_name} · ` : ""}public data, checked {detail.last_checked_at ? relativeTime(detail.last_checked_at) : "once"}
                  {detail.claimed_by_me && " · claimed by you"}
                </Line>
              </>
            )}

            {kind === "vendors" && (
              <>
                {detail.location && <Line icon={MapPin}>{detail.location}</Line>}
                <Line icon={Package}>
                  {num(detail.stock?.in_stock_lines || 0)} of {num(detail.stock?.lines || 0)} lines in stock
                  {detail.stock?.units_available ? ` · ${num(detail.stock.units_available)} units` : ""}
                </Line>
                {detail.role && <Line icon={Store}>{detail.role}</Line>}
              </>
            )}

            {kind === "markets" && (
              <>
                <Line icon={Users}>{num(detail.members)} vendors registered</Line>
                <Line icon={Building2}>
                  {num(detail.places)} places mapped · {num(detail.claimed)} claimed
                  {detail.places > 0 && detail.members === 0 ? " — an unworked market" : ""}
                </Line>
                {detail.welcome && <Line icon={MapIcon}>{detail.welcome}</Line>}
              </>
            )}
          </div>
        )}

        <div className="mt-3 flex gap-2 flex-wrap">
          {kind === "places" && (
            <>
              {!detail?.claimed_by_me ? (
                <Button size="sm" variant="secondary" loading={busy} onClick={claim} icon={Check}>
                  Claim this place
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => navigate("/stock")}>
                  Add your stock
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => window.open(directions, "_blank", "noreferrer")} icon={Navigation}>
                Directions
              </Button>
            </>
          )}
          {kind === "vendors" && (
            <>
              <Button size="sm" variant="secondary" onClick={() => navigate(`/@${item.handle}`)} icon={ChevronRight}>
                View shop
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/stock?tab=network")} icon={Package}>
                Their stock
              </Button>
            </>
          )}
          {kind === "markets" && (
            <>
              <Button size="sm" variant="secondary" loading={busy} onClick={joinMarket}>
                Register for this market
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/markets")} icon={ChevronRight}>
                Open market
              </Button>
            </>
          )}
          {onFocus && (
            <Button size="sm" variant="ghost" onClick={() => onFocus(item)} icon={MapIcon}>
              Centre
            </Button>
          )}
        </div>

        {kind === "places" && (
          <p className="mt-2 text-[10px] text-ink-4/80">Data © OpenStreetMap contributors (ODbL)</p>
        )}
      </div>
    </div>
  );
}

function Line({ icon: Icon, children }) {
  return (
    <p className="flex items-center gap-1.5 min-w-0">
      {Icon && <Icon size={10} className="shrink-0 opacity-70" />}
      <span className="truncate">{children}</span>
    </p>
  );
}
