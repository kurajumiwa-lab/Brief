import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PiggyBank, Users, TrendingDown, ArrowRight, Sparkles } from "lucide-react";
import { commercialAPI, apiError } from "@/lib/api";
import { currency, num } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import Badge from "@/components/ui/Badge";
import CardShell, { CardBody, CardTitle, CardPrice, CardMeta, CARD_SLOT } from "@/components/home/cards/CardShell";

function CommercialOfferCard({ item }) {
  const hasGroup = item.group_price != null && item.individual_price != null && item.group_price < item.individual_price;
  const savings = item.savings_amount || (hasGroup ? item.individual_price - item.group_price : 0);
  const pct = item.savings_percentage || (hasGroup ? Math.round((savings / item.individual_price) * 100) : 0);

  return (
    <CardShell
      to={`/commercial/${item.id}`}
      label={`${item.title || item.content.slice(0, 60)} — ${item.group_price ? currency(item.group_price) : ""} group price`}
      className="border-emerald-200/50 dark:border-emerald-500/20"
    >
      <div className="relative bg-gradient-to-br from-emerald-50 to-blue-50 dark:from-emerald-500/10 dark:to-blue-500/10 border-b border-edge-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <Badge variant="emerald" size="xs"><PiggyBank size={10} /> {pct ? `${pct}% off` : "Group deal"}</Badge>
          <span className="text-2xs text-ink-4 inline-flex items-center gap-1"><Users size={10} /> {item.current_interested} interested</span>
        </div>
        <div className="mt-2 flex gap-2">
          <div className="flex-1">
            <p className="text-2xs text-ink-4">Individual</p>
            <p className={cn("text-sm font-medium", hasGroup ? "line-through text-ink-4" : "text-ink-1")}>
              {item.individual_price ? currency(item.individual_price) : "—"}
            </p>
          </div>
          <div className="flex-1">
            <p className="text-2xs text-ink-4">Group</p>
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
              {item.group_price ? currency(item.group_price) : "Ask"}
            </p>
          </div>
        </div>
        {savings > 0 && (
          <p className="mt-1.5 text-2xs font-bold text-emerald-700 dark:text-emerald-300">
            Save {currency(savings)} per unit · {pct}% less
          </p>
        )}
      </div>
      <CardBody>
        <CardTitle className="line-clamp-2">{item.title || item.content.slice(0, 80)}</CardTitle>
        <CardMeta className="mt-1 line-clamp-1">{item.location || item.vendor_business || `@${item.vendor_handle}`}</CardMeta>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, ((item.current_quantity_pledged || item.current_interested || 0) / (item.target_quantity || item.min_group_size || 10)) * 100)}%` }} />
          </div>
          <span className="text-micro text-ink-4">{item.current_quantity_pledged || item.current_interested || 0}/{item.target_quantity || item.min_group_size || "?"}</span>
        </div>
      </CardBody>
    </CardShell>
  );
}

export default function CommercialShelf({ onSource, limit = 8 }) {
  const [shelf, setShelf] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    commercialAPI
      .shelf({ limit })
      .then((r) => {
        if (!live) return;
        setShelf(r.data);
        setError("");
      })
      .catch((e) => {
        if (!live) return;
        // If API not yet deployed or empty, show empty gracefully
        if (e?.response?.status === 404) {
          setShelf({ shelf: [], title: "Commercial offers", subtitle: "No offers yet" });
        } else {
          setError(apiError(e, ""));
        }
      })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [limit]);

  if (loading) {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink-1 flex items-center gap-1.5">
              <PiggyBank size={16} className="text-emerald-600" /> Commercial shelf
            </h3>
            <p className="text-2xs text-ink-4 mt-0.5">Loading offers…</p>
          </div>
        </div>
        <div className="flex gap-3 overflow-hidden">
          {[1,2,3].map((i) => (
            <div key={i} className={cn("shrink-0 rounded-2xl border border-edge-1 bg-surface-0 p-3 animate-pulse", CARD_SLOT)}>
              <div className="h-20 bg-surface-2 rounded-xl mb-3" />
              <div className="h-3 bg-surface-2 rounded mb-2" />
              <div className="h-3 bg-surface-2 rounded w-2/3" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (error || !shelf || shelf.shelf?.length === 0) {
    // Hide shelf when empty — no placeholder products
    return null;
  }

  const items = shelf.shelf || [];

  return (
    <section className="space-y-3" data-testid="commercial-shelf">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-ink-1 flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
              <PiggyBank size={14} />
            </span>
            {shelf.title || "Commercial shelf — save more together"}
          </h3>
          <p className="text-2xs text-ink-4 mt-1">{shelf.subtitle || `${items.length} active offers · group buys unlock better prices`}</p>
        </div>
        <Link to="/commercial" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline">
          See all <ArrowRight size={12} />
        </Link>
      </div>

      <div className="relative">
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-none">
          {items.map((item) => (
            <div key={item.id} className="shrink-0 snap-start">
              <div className={CARD_SLOT}>
                <CommercialOfferCard item={item} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {shelf.total_savings_potential > 0 && (
        <p className="text-2xs text-ink-4 flex items-center gap-1.5">
          <Sparkles size={12} className="text-emerald-600" />
          Total potential savings on this shelf: <span className="font-bold text-emerald-700 dark:text-emerald-300">{currency(shelf.total_savings_potential)}</span> if group prices are confirmed
        </p>
      )}
    </section>
  );
}
