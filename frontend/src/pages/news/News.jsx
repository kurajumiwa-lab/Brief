import { useMemo, useState } from "react";
import { useEffect } from "react";
import {
  Newspaper, Package, ArrowLeftRight, CalendarDays, Users, ShoppingBasket, ChevronDown, ArrowUpRight,
} from "lucide-react";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import Badge from "@/components/ui/Badge";
import { useNavigate } from "react-router-dom";
import { newsAPI, apiError } from "@/lib/api";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// MARKET NEWS — five templates, one idea each.
//
// Every card leads with the information a trader acts on (price / route /
// date / time-window / membership), keeps the supporting line to one row,
// and hides the extra detail (min order, quality, timing, requirements…)
// behind a tap. A line never says "prices rose" — a price is what a vendor
// stated, and the card says whether it is the unit or the wholesale price.
// ─────────────────────────────────────────────────────────────────────────────

const KIND_FILTERS = [
  { value: "all", label: "All", icon: Newspaper },
  { value: "stock", label: "Prices", icon: Package },
  { value: "movement", label: "Moves", icon: ArrowLeftRight },
  { value: "event", label: "Events", icon: CalendarDays },
  { value: "group", label: "Groups", icon: Users },
  { value: "lock", label: "Locks", icon: ShoppingBasket },
];

const STATUS_TONE = {
  pending: "text-amber-300", confirmed: "text-blue-300", in_transit: "text-blue-300",
  shipped: "text-blue-300", received: "text-brand-300", completed: "text-brand-300",
  cancelled: "text-red-300", failed: "text-red-300", open: "text-brand-300", rolling: "text-amber-300",
};

const QualityLabel = { unverified: "unverified", self_declared: "self-declared", patron_verified: "patron-verified", lab_certified: "lab-certified" };

function FreshDot({ fresh }) {
  if (!fresh) return null;
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-400 animate-dot-pulse" title="in the last 24h" />;
}

function CardShell({ open, onToggle, children, expanded, onOpenLink }) {
  return (
    <div className="glass rounded-2xl animate-fade-in overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full text-left p-3.5 cursor-pointer" aria-expanded={open}>
        <div className="flex items-start gap-3">
          {children}
          <ChevronDown size={14} className={cn("mt-1 shrink-0 text-ink-4 transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pt-0.5 border-t border-white/[0.06] mt-0.5 animate-fade-in">
          {expanded}
          {onOpenLink && (
            <button type="button" onClick={onOpenLink}
              className="mt-2.5 inline-flex items-center gap-1 text-2xs font-bold text-brand-300 hover:text-brand-200 cursor-pointer">
              Open <ArrowUpRight size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const Meta = ({ k, v }) => (
  <div className="flex items-baseline gap-2 min-w-0">
    <span className="text-2xs text-ink-4 w-20 shrink-0">{k}</span>
    <span className="text-2xs text-ink-2 truncate">{v}</span>
  </div>
);

// ── PRICE template (stock line) ─────────────────────────────────────────────
function StockCard({ it, open, onToggle, onOpen }) {
  const d = it.data;
  return (
    <CardShell open={open} onToggle={onToggle} onOpenLink={onOpen}
      expanded={
        <div className="space-y-1 pt-2">
          <Meta k="category" v={[d.category, d.subcategory].filter(Boolean).join(" / ") || "—"} />
          <Meta k="min order" v={d.min_order ? `${d.min_order} ${d.unit_of_measure}` : "none"} />
          <Meta k="quality" v={QualityLabel[d.quality] || d.quality || "—"} />
          {d.origin && <Meta k="origin" v={d.origin} />}
          {d.batch && <Meta k="batch" v={d.batch} />}
          {d.expiry && <Meta k="expires" v={d.expiry} />}
          {d.sku && <Meta k="sku" v={d.sku} />}
          {d.tags?.length > 0 && <Meta k="tags" v={d.tags.join(", ")} />}
          {d.description && <p className="text-2xs text-ink-4 pt-1">{d.description}</p>}
        </div>
      }
    >
      <div className="w-24 shrink-0">
        <p className="digital text-lg text-ink-1 leading-none">{d.price != null ? num(d.price) : "—"}</p>
        <p className="text-2xs text-ink-4 mt-1">KES · {d.price_is || "n/a"}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-1 truncate flex items-center gap-1.5">
          <FreshDot fresh={it.fresh} />{d.name}
        </p>
        <p className="text-2xs text-ink-4 mt-0.5 truncate">
          {d.is_new ? "new on shelf" : "re-stated"} · {d.vendor}
          {d.quantity_available != null && d.quantity_available > 0 ? ` · ${num(d.quantity_available)} ${d.unit_of_measure}` : ""}
        </p>
      </div>
    </CardShell>
  );
}

// ── ROUTE template (movement) ───────────────────────────────────────────────
function MovementCard({ it, open, onToggle, onOpen }) {
  const d = it.data;
  const t = d.times || {};
  return (
    <CardShell open={open} onToggle={onToggle} onOpenLink={onOpen}
      expanded={
        <div className="space-y-1 pt-2">
          <Meta k="type" v={d.movement_type || "—"} />
          <Meta k="confirmed" v={t.confirmed ? relativeTime(t.confirmed) : "—"} />
          <Meta k="shipped" v={t.shipped ? relativeTime(t.shipped) : "—"} />
          <Meta k="received" v={t.completed ? relativeTime(t.completed) : "—"} />
          {d.notes && <p className="text-2xs text-ink-4 pt-1">{d.notes}</p>}
        </div>
      }
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-1 truncate flex items-center gap-1.5">
          <FreshDot fresh={it.fresh} />
          <span className="truncate">{d.from.name}</span>
          <ArrowLeftRight size={12} className="text-ink-4 shrink-0" />
          <span className="truncate">{d.to.name}</span>
        </p>
        <p className="text-2xs text-ink-4 mt-0.5 truncate">
          {d.name} · {num(d.quantity)} {d.unit}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="digital text-sm text-ink-2">{d.total_value != null ? `KES ${num(d.total_value)}` : "—"}</p>
        <span className={cn("text-2xs font-bold uppercase tracking-wide", STATUS_TONE[d.status] || "text-ink-4")}>{d.status}</span>
      </div>
    </CardShell>
  );
}

// ── DATE template (event) ───────────────────────────────────────────────────
function EventCard({ it, open, onToggle, onOpen }) {
  const d = it.data;
  const pct = d.capacity > 0 ? Math.min(100, Math.round((d.registered / d.capacity) * 100)) : 0;
  return (
    <CardShell open={open} onToggle={onToggle} onOpenLink={onOpen}
      expanded={
        <div className="space-y-1 pt-2">
          <Meta k="type" v={d.event_type || "—"} />
          <Meta k="organiser" v={d.organizer || "—"} />
          {d.requirements && Object.keys(d.requirements).length > 0 && (
            <Meta k="requirements" v={Object.entries(d.requirements).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" · ")} />
          )}
          {d.virtual_link && <Meta k="link" v={d.virtual_link} />}
        </div>
      }
    >
      <div className="w-16 shrink-0 text-center rounded-xl bg-white/[0.05] py-1.5">
        <p className="text-2xs font-bold text-ink-4">{d.dow}</p>
        <p className="digital text-lg text-ink-1 leading-tight">{d.day}</p>
        <p className="text-2xs font-bold text-ink-4">{d.mon}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-1 truncate">{d.title}</p>
        <p className="text-2xs text-ink-4 mt-0.5 truncate">{d.time} · {d.location}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-white/[0.07] overflow-hidden max-w-[8rem]">
            <div className="h-full bg-gradient-to-r from-brand-500 to-brand-300" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-2xs text-ink-4">{num(d.registered)}/{num(d.capacity)} in</span>
        </div>
      </div>
      {d.fee != null && <div className="shrink-0"><p className="digital text-sm text-ink-2">KES {num(d.fee)}</p><p className="text-2xs text-ink-4">entry</p></div>}
    </CardShell>
  );
}

// ── COMMUNITY template (group) ──────────────────────────────────────────────
function GroupCard({ it, open, onToggle, onOpen }) {
  const d = it.data;
  return (
    <CardShell open={open} onToggle={onToggle} onOpenLink={onOpen}
      expanded={
        <div className="space-y-1 pt-2">
          <Meta k="open to" v={d.requires_approval ? "by approval" : "any vendor"} />
          {d.tags?.length > 0 && <Meta k="tags" v={d.tags.join(", ")} />}
          {d.description && <p className="text-2xs text-ink-4 pt-1">{d.description}</p>}
        </div>
      }
    >
      <div className="w-16 shrink-0 text-center rounded-xl bg-violet-400/10 py-1.5">
        <p className="digital text-lg text-violet-300 leading-tight">{num(d.member_count)}</p>
        <p className="text-2xs text-ink-4">members</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-1 truncate flex items-center gap-1.5">
          <FreshDot fresh={it.fresh} />{d.name}
        </p>
        <p className="text-2xs text-ink-4 mt-0.5 truncate">
          {[d.group_type, d.category, d.region].filter(Boolean).join(" · ") || "vendor group"}
        </p>
      </div>
    </CardShell>
  );
}

// ── TIME-WINDOW template (flash lock) ───────────────────────────────────────
function LockCard({ it, open, onToggle, onOpen }) {
  const d = it.data;
  return (
    <CardShell open={open} onToggle={onToggle} onOpenLink={onOpen}
      expanded={
        <div className="space-y-1 pt-2">
          <Meta k="zone" v={[d.zone, d.city].filter(Boolean).join(", ")} />
          <Meta k="delivered by" v={d.delivery} />
          <Meta k="rolls" v={d.roll_count > 0 ? `${d.roll_count} extension${d.roll_count === 1 ? "" : "s"}` : "none yet"} />
        </div>
      }
    >
      <div className="w-28 shrink-0">
        <p className="digital text-lg text-ink-1 leading-none">{d.opens}–{d.closes}</p>
        <p className="text-2xs text-ink-4 mt-1">pick window</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-1 truncate flex items-center gap-1.5">
          <FreshDot fresh={it.fresh} />Flash lock · {d.zone}
        </p>
        <p className="text-2xs text-ink-4 mt-0.5">deliver by {d.delivery}</p>
      </div>
      <span className={cn("shrink-0 text-2xs font-bold uppercase tracking-wide", STATUS_TONE[d.status] || "text-ink-4")}>{d.status}</span>
    </CardShell>
  );
}

const TEMPLATES = { stock: StockCard, movement: MovementCard, event: EventCard, group: GroupCard, lock: LockCard };

export default function News() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let live = true;
    newsAPI
      .feed(7)
      .then((r) => live && setData(r.data))
      .catch((e) => live && setError(apiError(e, "The board could not be loaded")));
    return () => { live = false; };
  }, []);

  const counts = useMemo(() => {
    const c = { all: data?.items.length ?? 0 };
    for (const it of data?.items ?? []) c[it.kind] = (c[it.kind] || 0) + 1;
    return c;
  }, [data]);

  if (error) return <EmptyState icon={Newspaper} title="The board is down" description={error} />;
  if (!data) return <PageSpinner label="Reading the board…" />;

  const openLink = (link) => {
    if (!link?.to) return;
    const q = Object.entries(link.q || {}).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    setOpenId(null);
    navigate(q ? `${link.to}?${q}` : link.to);
  };

  const shown = data.items.filter((it) => filter === "all" || it.kind === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Market News</h2>
          <p className="text-xs text-ink-4 mt-0.5">What changed in the last {data.window_days} days · sourced from rows, not feeds</p>
        </div>
        <Badge variant="brand" size="sm">{num(data.new_today)} today</Badge>
      </div>

      {/* Kind filters — each kind has its own card template */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {KIND_FILTERS.map((f) => {
          const n = counts[f.value] || 0;
          return (
            <button key={f.value} type="button" onClick={() => setFilter(f.value)}
              disabled={f.value !== "all" && n === 0}
              className={cn("shrink-0 rounded-full px-3 h-8 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-default",
                filter === f.value ? "bg-brand-500/20 text-brand-200" : "text-ink-4 hover:text-ink-2",
                f.value !== "all" && n === 0 && "opacity-40")}>
              {f.label}
              <span className="font-mono text-2xs opacity-70">{n || ""}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title={filter === "all" ? "No new lines in the last 7 days" : `No ${filter} lines in the window`}
          description="Lines appear when vendors restate stock, movements happen, events open, groups form or a flash lock goes open."
        />
      ) : (
        <div className="space-y-2">
          {shown.map((it) => {
            const T = TEMPLATES[it.kind] || StockCard;
            return (
              <T key={it.id} it={it}
                open={openId === it.id}
                onToggle={() => setOpenId(openId === it.id ? null : it.id)}
                onOpen={() => openLink(it.link)}
              />
            );
          })}
        </div>
      )}

      <p className="text-2xs text-ink-4 px-1">
        Tap a line for the detail · prices are stated by the vendor, never computed · board read {relativeTime(data.generated_at)}
      </p>
    </div>
  );
}
