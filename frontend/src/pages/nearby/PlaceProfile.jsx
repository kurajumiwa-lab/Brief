import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Building2, Phone, Clock, Globe, MapPinned, ChevronRight, Navigation,
  BadgeCheck, Info, Map as MapIcon,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { mapAPI, geoAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { categoryLabel } from "@/lib/mapViewport";
import { relativeTime } from "@/lib/formatters";

// ─────────────────────────────────────────────────────────────────────────────
// PLACE — one open-data business, on its own screen.
//
// This screen did not exist. Tapping a row on the near-you list used to send
// you to the map, which is a dead end: the map shows you where something IS,
// never what it is. Where the hub→secondary-screen pattern "was not
// applicable" — a public business has no shop front of its own — the fitting
// capability is this screen, not a bounce to another surface.
//
// The row is OpenStreetMap-derived (ODbL), so it says so, and it carries the
// last time the source confirmed it. Unclaimed rows offer the one real action
// available: claim it, which moves the row into the network.
// ─────────────────────────────────────────────────────────────────────────────

export default function PlaceProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [place, setPlace] = useState(null);
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    let live = true;
    setPlace(null);
    setError("");
    mapAPI
      .place(id)
      .then((r) => live && setPlace(r.data))
      .catch((e) => live && setError(apiError(e, "That place could not be loaded")));
    return () => { live = false; };
  }, [id]);

  const claim = async () => {
    setClaiming(true);
    try {
      await geoAPI.claim(place.id);
      toast.success(`${place.name} is yours on the network`);
      setPlace((p) => ({ ...p, claimed: true, claimed_by_me: true, status: "claimed" }));
    } catch (e) {
      toast.error(apiError(e, "That place could not be claimed"));
    } finally {
      setClaiming(false);
    }
  };

  if (error) {
    return (
      <EmptyState
        icon={Building2}
        title="No such place"
        description={error}
        action={<Button size="sm" variant="secondary" onClick={() => navigate("/nearby")}>Back to Around you</Button>}
      />
    );
  }
  if (!place) return <PageSpinner label="Opening this place…" />;

  const rows = [
    place.phone && { icon: Phone, label: "Phone", value: place.phone, href: `tel:${place.phone.replace(/\s+/g, "")}` },
    place.opening_hours && { icon: Clock, label: "Hours", value: place.opening_hours },
    place.website && { icon: Globe, label: "Website", value: place.website.replace(/^https?:\/\//, ""), href: place.website },
    place.address && { icon: MapPinned, label: "Address", value: place.address },
  ].filter(Boolean);

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <nav className="flex items-center gap-1.5 text-2xs text-ink-4" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-ink-2">Home</Link>
        <ChevronRight size={11} />
        <Link to="/nearby" className="hover:text-ink-2">Around you</Link>
        <ChevronRight size={11} />
        <span className="text-ink-2 truncate">{place.name}</span>
      </nav>

      <div className="glass-strong rounded-3xl p-5 space-y-3">
        <div className="flex items-start gap-3">
          <span className="w-12 h-12 rounded-2xl bg-white/[0.05] flex items-center justify-center shrink-0">
            <Building2 size={20} className="text-blue-300" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-ink-1 tracking-tight">{place.name}</h2>
            <p className="text-xs text-ink-4 mt-0.5">
              {[categoryLabel(place.category), place.zone_name, place.distance_km != null && `${place.distance_km} km away`]
                .filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {place.claimed_by_me ? (
            <Badge variant="brand" size="xs"><BadgeCheck size={10} className="mr-1" /> Claimed by you</Badge>
          ) : place.claimed ? (
            <Badge variant="brand" size="xs">Claimed</Badge>
          ) : (
            <Badge variant="muted" size="xs">Unverified · public data</Badge>
          )}
          {place.detail?.vendor_hint && <Badge variant="muted" size="xs">{place.detail.vendor_hint}</Badge>}
        </div>

        {/* Actions — the reason this screen exists instead of a bounce to /map */}
        <div className="flex flex-wrap gap-2 pt-1">
          {place.phone && (
            <Button size="sm" onClick={() => { window.location.href = `tel:${place.phone.replace(/\s+/g, "")}`; }}>
              <Phone size={13} /> Call
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate(`/map?focus=${place.id}`)}
          >
            <MapIcon size={13} /> Show on the map
          </Button>
          <a
            href={`https://www.openstreetmap.org/directions?to=${place.lat}%2C${place.lng}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium bg-white/[0.06] text-ink-2 hover:text-ink-1"
          >
            <Navigation size={13} /> Directions
          </a>
          {!place.claimed && (
            <Button size="sm" variant="secondary" loading={claiming} onClick={claim}>
              <BadgeCheck size={13} /> This is my business
            </Button>
          )}
        </div>
      </div>

      {/* What the source actually gave us */}
      <div className="glass rounded-3xl divide-y divide-white/[0.06]">
        {rows.length === 0 ? (
          <p className="p-4 text-xs text-ink-4">The source gave us a name and a location, and nothing else.</p>
        ) : (
          rows.map(({ icon: Icon, label, value, href }) => (
            <div key={label} className="flex items-start gap-3 p-4">
              <Icon size={14} className="text-ink-4 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-2xs uppercase tracking-wider text-ink-4">{label}</p>
                {href ? (
                  <a href={href} target={href.startsWith("tel:") ? undefined : "_blank"} rel="noreferrer" className="text-sm text-brand-300 hover:text-brand-200 break-words">
                    {value}
                  </a>
                ) : (
                  <p className="text-sm text-ink-1 break-words">{value}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <p className="text-2xs text-ink-4 px-1 flex items-start gap-1.5">
        <Info size={11} className="mt-0.5 shrink-0" />
        <span>
          {place.attribution} · first seen {place.first_seen_at ? relativeTime(place.first_seen_at) : "—"}
          {place.last_checked_at ? ` · confirmed by the source ${relativeTime(place.last_checked_at)}` : ""}
        </span>
      </p>
    </div>
  );
}
