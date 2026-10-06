import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Package, Store, MapPin, Newspaper, Building2 } from "lucide-react";
import SearchInput from "@/components/ui/SearchInput";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { stockAPI, vendorAPI, marketsAPI, newsAPI, surfaceAPI, apiError } from "@/lib/api";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH HUB — the lists, behind one door.
//
// Every list that used to demand a separate screen and a scroll (products,
// suppliers, markets, news lines, places) is reachable here by typing. Each
// tab loads its real list once, then filters locally as you type — no fake
// "no results" padding, no invented entries. Empty is a real answer.
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { value: "products", label: "Products", icon: Package },
  { value: "suppliers", label: "Suppliers", icon: Store },
  { value: "markets", label: "Markets", icon: MapPin },
  { value: "news", label: "News", icon: Newspaper },
  { value: "places", label: "Places", icon: Building2 },
];

export default function SearchHub() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("products");
  const [q, setQ] = useState("");
  const [lists, setLists] = useState({ products: null, suppliers: null, markets: null, news: null, places: null });
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [p, s, m, n, pl] = await Promise.allSettled([
        stockAPI.network(),
        vendorAPI.network(),
        marketsAPI.list(),
        newsAPI.feed(7),
        surfaceAPI.map(),
      ]);
      if (!live) return;
      const next = { ...lists };
      if (p.status === "fulfilled") next.products = p.value.data;
      if (s.status === "fulfilled") next.suppliers = s.value.data;
      if (m.status === "fulfilled") next.markets = m.value.data.markets;
      if (n.status === "fulfilled") next.news = n.value.data.items;
      if (pl.status === "fulfilled") next.places = pl.value.data.places;
      setLists(next);
      if (p.status === "rejected" && s.status === "rejected" && m.status === "rejected") {
        setError(apiError(p.reason, "The search lists could not be loaded"));
      }
      return next;
    };
    load();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = q.trim().toLowerCase();

  const results = useMemo(() => {
    const inText = (haystack) => !query || haystack.toLowerCase().includes(query);
    switch (tab) {
      case "products":
        return (lists.products || [])
          .filter((it) => inText(`${it.name} ${it.category || ""} ${it.subcategory || ""} ${it.vendor_business || ""}`))
          .slice(0, 50);
      case "suppliers":
        return (lists.suppliers || [])
          .filter((v) => inText(`${v.business_name} ${v.vendor_handle} ${(v.business_categories || []).join(" ")} ${v.physical_location || ""}`))
          .slice(0, 50);
      case "markets":
        return (lists.markets || [])
          .filter((m) => inText(`${m.name} ${m.city} ${m.country || ""}`))
          .slice(0, 50);
      case "news":
        return (lists.news || [])
          .filter((it) => inText(newsHaystack(it)))
          .slice(0, 50);
      case "places":
        return (lists.places || [])
          .filter((p) => inText(`${p.name} ${p.category || ""} ${p.zone_name || ""}`))
          .slice(0, 50);
      default:
        return [];
    }
  }, [tab, query, lists]);

  const loaded = Array.isArray(lists[tab]);

  if (error && !loaded) return <EmptyState icon={Search} title="Search is down" description={error} />;

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div>
        <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Search</h2>
        <p className="text-xs text-ink-4 mt-0.5">The lists, behind one door — type and they filter.</p>
      </div>

      <SearchInput value={q} onChange={setQ} placeholder="Products, suppliers, markets, news, places…" />

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t.value} type="button" onClick={() => setTab(t.value)}
            className={cn("shrink-0 rounded-full px-3 h-8 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer",
              tab === t.value ? "bg-brand-500/20 text-brand-200" : "text-ink-4 hover:text-ink-2")}>
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      {!loaded ? (
        <PageSpinner label="Loading the list…" />
      ) : results.length === 0 ? (
        <EmptyState icon={Search} title={query ? "Nothing matches" : "Nothing here yet"}
          description={query ? "Try fewer words, or another tab." : "This list fills as real rows are written."} />
      ) : (
        <div className="space-y-2 pb-10">
          {tab === "products" && results.map((it) => (
            <Row key={it.id}
              title={it.name}
              meta={`${it.category || "uncategorised"}${it.vendor_business ? ` · ${it.vendor_business}` : ""}${it.quantity_available > 0 ? ` · ${num(it.quantity_available)} ${it.unit_of_measure}` : ""}`}
              right={it.wholesale_price != null || it.unit_price != null
                ? <span className="digital text-sm text-ink-1">KES {num(it.unit_price ?? it.wholesale_price)}<span className="text-2xs text-ink-4 ml-1">{it.unit_price != null ? "unit" : "whole"}</span></span>
                : null}
              sub={it.updated_at ? `stated ${relativeTime(it.updated_at)}` : null}
              onGo={() => navigate(`/stock?tab=network&search=${encodeURIComponent(it.name)}`)}
            />
          ))}
          {tab === "suppliers" && results.map((v) => (
            <Row key={v.id}
              title={v.business_name}
              meta={`${(v.business_categories || []).slice(0, 3).join(" · ") || "categories not stated"}${v.physical_location ? ` · ${v.physical_location}` : ""}`}
              sub={`@${v.vendor_handle}`}
              onGo={() => navigate("/network")}
            />
          ))}
          {tab === "markets" && results.map((m) => (
            <Row key={m.id}
              title={m.name}
              meta={[m.city, m.country].filter(Boolean).join(", ")}
              right={<span className="digital text-sm text-ink-1">{num(m.member_count)}<span className="text-2xs text-ink-4 ml-1">registered</span></span>}
              onGo={() => navigate("/markets")}
            />
          ))}
          {tab === "news" && results.map((it) => (
            <Row key={it.id}
              title={newsTitle(it)}
              meta={`${it.kind}${it.data?.vendor ? ` · ${it.data.vendor}` : ""}`}
              right={it.data?.price != null ? <span className="digital text-sm text-ink-1">KES {num(it.data.price)}</span> : null}
              sub={it.at ? relativeTime(it.at) : null}
              onGo={() => navigate("/news")}
            />
          ))}
          {tab === "places" && results.map((p) => (
            <Row key={p.id}
              title={p.name}
              meta={`${p.category || "business"}${p.zone_name ? ` · ${p.zone_name}` : ""}`}
              right={typeof p.distance_km === "number" ? <span className="digital text-sm text-ink-1">{p.distance_km} km</span> : null}
              onGo={() => navigate("/map")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ title, meta, right, sub, onGo }) {
  return (
    <button type="button" onClick={onGo}
      className="w-full text-left glass glass-hover rounded-2xl p-3.5 flex gap-3 items-center cursor-pointer animate-fade-in">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-1 truncate">{title}</p>
        <p className="text-2xs text-ink-4 mt-0.5 truncate">{meta}</p>
        {sub && <p className="text-2xs text-ink-4 mt-0.5">{sub}</p>}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
    </button>
  );
}

function newsTitle(it) {
  const d = it.data || {};
  switch (it.kind) {
    case "stock": return d.name || "Stock line";
    case "movement": return `${d.from?.name ?? "—"} → ${d.to?.name ?? "—"} · ${d.name || "stock"}`;
    case "event": return d.title || "Event";
    case "group": return d.name || "Group";
    case "lock": return `Flash lock · ${d.zone || "market"}`;
    default: return it.kind;
  }
}

function newsHaystack(it) {
  const d = it.data || {};
  return [
    it.kind, d.name, d.title, d.vendor, d.zone,
    d.from?.name, d.to?.name, d.location, d.category,
  ].filter(Boolean).join(" ");
}
