import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Newspaper, Package, ArrowLeftRight, CalendarDays, Users, ShoppingBasket,
} from "lucide-react";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import Badge from "@/components/ui/Badge";
import { newsAPI, apiError } from "@/lib/api";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// MARKET NEWS — information, not commentary.
//
// Each line is a real row written inside the window (a stock line, a movement,
// an event, a group, a flash-lock window) with its source and its own
// timestamp. A line never says "prices rose" — rows are single price points,
// not a series, so a stock line shows what its vendor stated and when.
// ─────────────────────────────────────────────────────────────────────────────

const KIND_META = {
  stock: { icon: Package, cls: "text-amber-300 bg-amber-400/10" },
  movement: { icon: ArrowLeftRight, cls: "text-brand-300 bg-brand-500/10" },
  event: { icon: CalendarDays, cls: "text-brand-300 bg-brand-500/10" },
  group: { icon: Users, cls: "text-violet-300 bg-violet-400/10" },
  lock: { icon: ShoppingBasket, cls: "text-blue-300 bg-blue-400/10" },
};

export default function News() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    newsAPI
      .feed(7)
      .then((r) => live && setData(r.data))
      .catch((e) => live && setError(apiError(e, "The board could not be loaded")));
    return () => { live = false; };
  }, []);

  if (error) return <EmptyState icon={Newspaper} title="The board is down" description={error} />;
  if (!data) return <PageSpinner label="Reading the board…" />;

  const open = (link) => {
    if (!link?.to) return;
    const q = Object.entries(link.q || {}).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    navigate(q ? `${link.to}?${q}` : link.to);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Market News</h2>
          <p className="text-xs text-ink-4 mt-0.5">What changed in the last {data.window_days} days · sourced from rows, not feeds</p>
        </div>
        <Badge variant="brand" size="sm">{num(data.new_today)} today</Badge>
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title="No new lines in the last 7 days"
          description="Lines appear when vendors restate stock, movements happen, events open or groups move."
        />
      ) : (
        <Card padding="p-2 sm:p-2.5">
          <ul className="space-y-1.5">
            {data.items.map((it) => {
              const m = KIND_META[it.kind] || KIND_META.stock;
              const Icon = m.icon;
              return (
                <li key={it.id}>
                  <button
                    onClick={() => open(it.link)}
                    className="w-full text-left glass glass-hover rounded-2xl p-3 flex gap-3 items-center animate-fade-in"
                  >
                    <span className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", m.cls)}>
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-1 truncate">{it.headline}</span>
                      <span className="block text-2xs text-ink-4 mt-0.5 truncate">
                        {it.source}
                        {it.detail ? ` · ${it.detail}` : ""} · {relativeTime(it.at)}
                      </span>
                    </span>
                    {it.price != null && (
                      <span className="shrink-0 digital text-sm text-ink-2 tabular-nums">
                        {it.currency} {num(it.price)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
