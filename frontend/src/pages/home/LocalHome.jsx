import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Search, Phone, Store } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { nearbyAPI, apiError } from "@/lib/api";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL HOME — the B2C face of the app (Nextdoor-style).
//
// "Around you in {area}" — the businesses and professionals within a radius
// of your location, grouped by a Kenyan category tree (Food & Drink, Health,
// Artisans & Jua Kali, Automotive…), each with its REAL count. Two sources,
// both labelled honestly: registered members and OpenStreetMap open data.
// Distances are true haversine; a phone number appears only when the row has
// one. An empty radius says so and offers to widen, not to invent.
//
// Performance-first: flat opaque cards (no glass blur), a bounded list (40),
// debounced search, latest-wins fetch guard.
// ─────────────────────────────────────────────────────────────────────────────

const RADII = [1, 3, 5, 10, 25];

export default function LocalHome() {
  const navigate = useNavigate();
  const [radius, setRadius] = useState(3);
  const [group, setGroup] = useState(null);
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const seq = useRef(0);

  // Single fetch source of truth. Radius/category changes fetch immediately
  // (q empty → 0ms); typing debounces 350ms so we don't fire per keystroke.
  // A sequence guard drops stale responses, so a slow old request can never
  // overwrite a newer result. `retry` re-fires the effect for the Retry button.
  useEffect(() => {
    const id = ++seq.current;
    const delay = q.trim() ? 350 : 0;
    const t = setTimeout(() => {
      setError("");
      setData(null);
      nearbyAPI
        .list({ radius_km: radius, group, q: q.trim() })
        .then((r) => { if (id === seq.current) setData(r.data); })
        .catch((e) => { if (id === seq.current) setError(apiError(e, "The nearby list could not be loaded")); });
    }, delay);
    return () => clearTimeout(t);
  }, [radius, group, q, retry]);

  const total = data?.total ?? null;
  const shown = data?.businesses ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Location + radius */}
      <div className="glass-strong rounded-3xl p-4">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-brand-500/15 text-brand-300 flex items-center justify-center shrink-0">
            <MapPin size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-ink-1 truncate">
              {data?.area ? `Around you in ${data.area}` : "Around you"}
            </p>
            <p className="text-2xs text-ink-4 mt-0.5">
              {total == null
                ? "finding businesses…"
                : `${num(total)} businesses within ${radius} km${data?.anchor === "market" ? " · nearest-market anchor — set your location in your profile for precise results" : ""}`}
            </p>
          </div>
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="shrink-0 bg-surface-1 text-ink-1 text-xs font-medium rounded-lg px-2 py-1.5"
            aria-label="Radius"
          >
            {RADII.map((r) => (
              <option key={r} value={r}>{r} km</option>
            ))}
          </select>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search businesses & services — e.g. plumber, pharmacy, boda boda"
          className="!pl-10"
        />
      </div>

      {/* Category tree (real counts, server-ordered by size) */}
      {data && data.groups.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <button
            type="button"
            onClick={() => setGroup(null)}
            className={cn(
              "shrink-0 rounded-full px-3 h-8 text-xs font-medium cursor-pointer",
              group === null ? "bg-brand-500 text-white" : "bg-white/[0.06] text-ink-3 hover:text-ink-1"
            )}
          >
            All <span className="opacity-70 font-mono">{num(data.total)}</span>
          </button>
          {data.groups.map((g) => (
            <button
              key={g.group}
              type="button"
              onClick={() => setGroup(group === g.group ? null : g.group)}
              className={cn(
                "shrink-0 rounded-full px-3 h-8 text-xs font-medium cursor-pointer",
                group === g.group ? "bg-brand-500 text-white" : "bg-white/[0.06] text-ink-3 hover:text-ink-1"
              )}
            >
              {g.label} <span className="opacity-70 font-mono">{num(g.count)}</span>
            </button>
          ))}
        </div>
      )}

      {/* The list */}
      {error ? (
        <EmptyState icon={Store} title="The nearby list is down" description={error}
          action={<Button size="sm" onClick={() => setRetry((r) => r + 1)}>Retry</Button>} />
      ) : data === null ? (
        <PageSpinner label="Finding businesses near you…" />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Store}
          title={q ? `Nothing matches “${q}” within ${radius} km` : `No businesses within ${radius} km`}
          description={q ? "Try fewer words, or widen the radius." : "Widen the radius to search a wider area."}
          action={
            radius >= 25 ? (
              <Button size="sm" variant="secondary" onClick={() => setGroup(null)}>Clear the category filter</Button>
            ) : (
              <Button size="sm" onClick={() => setRadius(RADII[RADII.indexOf(radius) + 1] || 25)}>
                Widen to {RADII[RADII.indexOf(radius) + 1] || 25} km
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-2">
          {shown.map((b) => (
            <BusinessCard key={b.id} b={b} onOpen={() => {
              if (b.source === "member" && b.handle) navigate(`/@${b.handle}`);
              else navigate("/map");
            }} />
          ))}
          <p className="text-2xs text-ink-4 text-center pt-2 pb-4">
            {num(shown.length)} of {num(total)} shown · members + OpenStreetMap (ODbL) · {data.generated_at ? relativeTime(data.generated_at) : ""}
          </p>
        </div>
      )}
    </div>
  );
}

function BusinessCard({ b, onOpen }) {
  const isMember = b.source === "member";
  const sub = [
    b.label,
    b.zone_name,
    ...(isMember && b.categories?.length ? [b.categories.slice(0, 2).join(", ")] : []),
  ].filter(Boolean).join(" · ");

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="glass glass-hover rounded-2xl p-3.5 flex items-center gap-3 cursor-pointer"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-ink-1 truncate">{b.name}</p>
          {isMember ? (
            <Badge variant="brand" size="xs">Member</Badge>
          ) : b.claimed_by_me ? (
            <Badge variant="brand" size="xs">Claimed</Badge>
          ) : (
            <span className="shrink-0 text-2xs text-ink-4">Open data</span>
          )}
        </div>
        {sub && <p className="text-2xs text-ink-4 mt-0.5 truncate">{sub}</p>}
      </div>
      <div className="shrink-0 text-right flex flex-col items-end gap-0.5">
        <span className="digital text-sm text-ink-2">{b.distance_km} km</span>
        {b.phone && (
          <a
            href={`tel:${b.phone.replace(/\s+/g, "")}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-2xs font-medium text-brand-300 hover:text-brand-200"
          >
            <Phone size={10} /> Call
          </a>
        )}
      </div>
    </div>
  );
}
