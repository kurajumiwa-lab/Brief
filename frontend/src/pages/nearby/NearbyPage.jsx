import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Store, Phone, Search, ChevronRight } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { nearbyAPI, apiError } from "@/lib/api";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// AROUND YOU — the near-you list, now with somewhere to go.
//
// This used to BE the home screen: a list with a radius and a category filter,
// and nothing behind a row (tapping a business sent you to the map, which was a
// dead end). It is now a SECONDARY SCREEN of the home hub, and the pattern the
// other surfaces get cloned from:
//
//     /nearby                 — everything within the radius
//     /nearby/{group}         — one category's screen (deep-linkable, shareable)
//     /place/{id}             — an open-data business's own screen
//     /@{handle}              — a member's shop front
//
// The category chips are therefore LINKS, not local state: a category is a
// screen you can open, link to, and go back from. Radius and search stay local
// because they are filters on the same screen, not screens of their own.
//
// Honesty rules carried over unchanged: the radius is a filter and not a
// promise, distances are real haversine, and open-data rows say so until a
// vendor claims them.
// ─────────────────────────────────────────────────────────────────────────────

const RADII = [1, 3, 5, 10, 25];

export default function NearbyPage() {
  const navigate = useNavigate();
  const { group: groupParam } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  // The radius lives in localStorage so opening a category screen keeps the
  // area you chose — a chip changes what you are looking at, not how far.
  const [radius, setRadius] = useState(() => {
    try { return Number(localStorage.getItem("nearby:radius")) || 5; } catch { return 5; }
  });
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    try { localStorage.setItem("nearby:radius", String(radius)); } catch { /* private mode */ }
  }, [radius]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    nearbyAPI
      .list({ radius_km: radius, group: groupParam || undefined, q: debouncedQ || undefined })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => { if (!cancelled) setError(apiError(e, "The nearby list could not be loaded")); });
    return () => { cancelled = true; };
  }, [radius, groupParam, debouncedQ, retry]);

  const groupLabel = data?.groups?.find((g) => g.group === groupParam)?.label;
  // On a category screen `total` is that category's count, so the "All" chip
  // sums the group counts instead of wearing another screen's number.
  const allCount = groupParam ? (data?.groups || []).reduce((a, g) => a + g.count, 0) : data?.total;

  if (error) {
    return (
      <EmptyState
        icon={Store}
        title="The nearby list is down"
        description={error}
        action={<Button size="sm" onClick={() => setRetry((r) => r + 1)}>Retry</Button>}
      />
    );
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* Breadcrumb — this screen sits under Home, and says so */}
      <nav className="flex items-center gap-1.5 text-2xs text-ink-4" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-ink-2">Home</Link>
        <ChevronRight size={11} />
        <Link to="/nearby" className="hover:text-ink-2">Around you</Link>
        {groupLabel && (
          <>
            <ChevronRight size={11} />
            <span className="text-ink-2">{groupLabel}</span>
          </>
        )}
      </nav>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">{groupLabel || "Around you"}</h2>
          <p className="text-xs text-ink-4 mt-0.5">
            {data
              ? `${num(data.total)} ${data.total === 1 ? "place" : "places"} within ${radius} km${data.area ? ` of ${data.area}` : ""}`
              : "Finding businesses near you…"}
          </p>
        </div>
        <select
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="shrink-0 bg-surface-1 text-ink-1 text-xs font-medium rounded-lg px-2 py-1.5"
          aria-label="Radius"
        >
          {RADII.map((r) => (<option key={r} value={r}>{r} km</option>))}
        </select>
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

      {/* Category screens — each chip is a link to its own screen */}
      {data && data.groups.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <Link
            to="/nearby"
            className={cn(
              "shrink-0 rounded-full px-3 h-8 text-xs font-medium flex items-center",
              !groupParam ? "bg-brand-500 text-white" : "bg-white/[0.06] text-ink-3 hover:text-ink-1"
            )}
          >
            All <span className="opacity-70 font-mono ml-1">{num(allCount)}</span>
          </Link>
          {data.groups.map((g) => (
            <Link
              key={g.group}
              to={`/nearby/${g.group}`}
              className={cn(
                "shrink-0 rounded-full px-3 h-8 text-xs font-medium flex items-center",
                groupParam === g.group ? "bg-brand-500 text-white" : "bg-white/[0.06] text-ink-3 hover:text-ink-1"
              )}
            >
              {g.label} <span className="opacity-70 font-mono ml-1">{num(g.count)}</span>
            </Link>
          ))}
        </div>
      )}

      {/* The list */}
      {data === null ? (
        <PageSpinner label="Finding businesses near you…" />
      ) : (data.businesses || []).length === 0 ? (
        <EmptyState
          icon={Store}
          title={debouncedQ ? `Nothing matches “${debouncedQ}” within ${radius} km${groupLabel ? ` in ${groupLabel}` : ""}` : `No businesses within ${radius} km${groupLabel ? ` in ${groupLabel}` : ""}`}
          description={debouncedQ ? "Try fewer words, or widen the radius." : "Widen the radius to search a wider area."}
          action={
            radius >= 25 ? (
              <Button size="sm" variant="secondary" onClick={() => navigate("/nearby")}>See every category</Button>
            ) : (
              <Button size="sm" onClick={() => setRadius(RADII[RADII.indexOf(radius) + 1] || 25)}>
                Widen to {RADII[RADII.indexOf(radius) + 1] || 25} km
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-2">
          {(data.businesses || []).map((b) => (
            <BusinessCard
              key={b.id}
              b={b}
              onOpen={() => {
                if (b.source === "member" && b.handle) navigate(`/@${b.handle}`);
                else navigate(`/place/${b.id}`);
              }}
            />
          ))}
          <p className="text-2xs text-ink-4 text-center pt-2 pb-4">
            {num((data.businesses || []).length)} of {num(data.total)} shown · members + OpenStreetMap (ODbL)
            {data.generated_at ? ` · ${relativeTime(data.generated_at)}` : ""}
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
      <ChevronRight size={14} className="shrink-0 text-ink-4" />
    </div>
  );
}
