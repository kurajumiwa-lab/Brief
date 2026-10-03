import { useState } from "react";
import { Store, Building2, Swords, Truck, CalendarDays, Navigation, Link2, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { vendorAPI, geoAPI, squadAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// MARKET RADAR — the "go outside" part of onboarding.
//
// Everything on this list exists: a named supplier, a public place, an open
// call-up, a rental, an event — each with its true haversine distance from
// your shop. One row, one real action: connect, claim, accept. A tap that
// writes no row is a tap that should not exist, so there are none.
// ─────────────────────────────────────────────────────────────────────────────

const KIND_META = {
  vendor: { icon: Store, tint: "text-brand-300", label: "suppliers" },
  place: { icon: Building2, tint: "text-blue-300", label: "places" },
  call: { icon: Swords, tint: "text-amber-300", label: "call-ups" },
  tool: { icon: Truck, tint: "text-violet-300", label: "rentals" },
  event: { icon: CalendarDays, tint: "text-ink-2", label: "events" },
};

function Row({ icon, tint, title, meta, distance, action, busy }) {
  const Icon = icon;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className={cn("w-9 h-9 rounded-xl bg-white/[0.05] flex items-center justify-center shrink-0", tint)}>
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-1 truncate">{title}</p>
        <p className="text-2xs text-ink-4 truncate">{meta}</p>
      </div>
      <span className="shrink-0 digital text-2xs text-ink-4 w-14 text-right">{distance} km</span>
      {action}
    </div>
  );
}

export default function MarketRadar({ nearby, onRefresh, compact = false }) {
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState(null);

  if (!nearby) {
    return (
      <div className="rounded-2xl bg-white/[0.04] p-4 text-center">
        <Navigation size={20} className="mx-auto text-ink-4" />
        <p className="text-xs text-ink-3 mt-2">Put your shop on the map and your market appears here — real suppliers, places and call-ups within {nearby?.radius_km ?? 3} km.</p>
      </div>
    );
  }

  const act = async (id, fn, okMsg) => {
    setBusyId(id);
    try {
      await fn();
      toast.success(okMsg);
      onRefresh?.();
    } catch (e) {
      toast.error(apiError(e, "That did not land — try again"));
    } finally {
      setBusyId(null);
    }
  };

  const total = nearby.vendors.length + nearby.places.length + nearby.calls.length + nearby.tools.length + nearby.events.length;
  if (total === 0) {
    return (
      <div className="rounded-2xl bg-white/[0.04] p-4 text-center">
        <MapPin size={20} className="mx-auto text-ink-4" />
        <p className="text-xs text-ink-3 mt-2">Nothing named yet within {nearby.radius_km} km. More public places are ingested daily from OpenStreetMap.</p>
      </div>
    );
  }

  const limit = compact ? 5 : 20;
  const btn = (label, id, fn, okMsg, disabled = false) => (
    <button
      type="button"
      disabled={busyId === id || disabled}
      onClick={() => act(id, fn, okMsg)}
      className={cn("shrink-0 rounded-full px-3 h-8 text-2xs font-semibold cursor-pointer disabled:cursor-default",
        disabled ? "text-ink-4 bg-white/[0.04]" : "bg-brand-500/20 text-brand-200 hover:bg-brand-500/30")}
    >
      {busyId === id ? "…" : label}
    </button>
  );

  return (
    <div className="divide-y divide-white/[0.05]">
      {nearby.vendors.slice(0, limit).map((v) => (
        <Row
          key={`v-${v.id}`}
          icon={Store}
          tint="text-brand-300"
          title={v.name}
          meta={`@${v.handle}${v.categories?.length ? ` · ${v.categories.slice(0, 2).join(", ")}` : ""}${v.location ? ` · ${v.location}` : ""}`}
          distance={v.distance_km}
          action={btn(<span className="inline-flex items-center gap-1"><Link2 size={10} /> Connect</span>, v.id, () => vendorAPI.connect(v.id), `Connected with ${v.name}`)}
        />
      ))}
      {nearby.places.slice(0, limit).map((p) => (
        <Row
          key={`p-${p.id}`}
          icon={Building2}
          tint="text-blue-300"
          title={p.name}
          meta={`${p.category || "business"}${p.zone_name ? ` · ${p.zone_name}` : ""}`}
          distance={p.distance_km}
          action={p.claimed_by_me
            ? btn("Yours ✓", p.id, async () => {}, "", true)
            : btn("Claim", p.id, () => geoAPI.claim(p.id), `${p.name} is linked to your account`)}
        />
      ))}
      {nearby.calls.slice(0, limit).map((c) => (
        <Row
          key={`c-${c.id}`}
          icon={Swords}
          tint="text-amber-300"
          title={c.title}
          meta={`KES ${num(c.pay_kes)} · ${c.skill}${c.squad ? " · squad" : ""}`}
          distance={c.distance_km}
          action={btn("Accept", c.id, () => squadAPI.accept(c.id), "Contract signed — the match is on")}
        />
      ))}
      {nearby.tools.slice(0, limit).map((t) => (
        <Row
          key={`t-${t.id}`}
          icon={Truck}
          tint="text-violet-300"
          title={t.name}
          meta={`${t.category} · ${t.price_per_unit != null ? `KES ${num(t.price_per_unit)} ${t.price_unit || ""}` : "price on request"}`}
          distance={t.distance_km}
          action={btn("View", `tool-${t.id}`, () => navigate("/tools"), "")}
        />
      ))}
      {nearby.events.slice(0, limit).map((e) => (
        <Row
          key={`e-${e.id}`}
          icon={CalendarDays}
          tint="text-ink-2"
          title={e.name}
          meta={e.location || "online"}
          distance={e.distance_km}
          action={btn("View", `event-${e.id}`, () => navigate("/events"), "")}
        />
      ))}
    </div>
  );
}
