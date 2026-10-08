import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, Crown } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { PageSpinner } from "@/components/ui/Spinner";
import QualityBadge from "./QualityBadge";
import { stockAPI, apiError } from "@/lib/api";
import { currency, num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const price = (i) => i.wholesale_price ?? i.unit_price ?? null;

/**
 * Side-by-side comparison of an item with the network's alternatives
 * (v2.1 §3.2): price, availability, quality status, vendor reliability.
 */
export default function StockCompareModal({ item, open, onClose, onSource }) {
  const [alts, setAlts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !item) return;
    let alive = true;
    setLoading(true);
    setError("");
    stockAPI
      .alternatives(item.id, 6)
      .then(({ data }) => alive && setAlts(data))
      .catch((e) => alive && setError(apiError(e, "Couldn't load alternatives")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, item]);

  if (!item) return null;
  const rows = [item, ...alts];
  const base = price(item);
  const cheapest = rows.reduce((best, r) => (price(r) != null && (best == null || price(r) < best) ? price(r) : best), null);

  return (
    <Modal open={open} onClose={onClose} title={`Compare · ${item.name}`} description="Same category across the network, cheapest first. Reliability is the share of confirmed movements the vendor delivered." size="lg">
      {loading ? (
        <PageSpinner />
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-2xs text-ink-4 text-left border-b border-edge-1">
                <th className="py-2 pl-1 font-medium">Item · vendor</th>
                <th className="py-2 font-medium">Price</th>
                <th className="py-2 font-medium">Available</th>
                <th className="py-2 font-medium">Quality</th>
                <th className="py-2 font-medium">Reliability</th>
                <th className="py-2 pr-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-1">
              {rows.map((r, idx) => {
                const p = price(r);
                const delta = p != null && base != null && idx > 0 ? ((p - base) / (base || 1)) * 100 : null;
                const avail = r.quantity_available ?? r.quantity_in_stock ?? 0;
                return (
                  <tr key={r.id} className={cn(idx === 0 && "bg-surface-2/60")} data-testid={idx === 0 ? "compare-base" : "compare-alt"}>
                    <td className="py-2 pl-1 min-w-[12rem]">
                      <div className="text-ink-1 font-medium truncate">{r.name}</div>
                      <Link to={`/@${r.vendor_handle}`} className="text-2xs text-ink-4 hover:text-brand-600 dark:hover:text-brand-400 font-mono">
                        @{r.vendor_handle}
                      </Link>
                      {r.vendor_is_patron && <Crown size={10} className="inline ml-1 text-purple-600 dark:text-purple-400" title="Patron" />}
                      {idx === 0 && (
                        <Badge variant="outline" size="xs" className="ml-1.5">
                          this item
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 font-mono tabular-nums whitespace-nowrap">
                      <span className={cn(p != null && p === cheapest ? "text-brand-600 dark:text-brand-400 font-semibold" : "text-ink-1")}>{p != null ? currency(p) : "—"}</span>
                      {delta != null && delta !== 0 && <span className={cn("ml-1 text-2xs", delta < 0 ? "text-brand-600 dark:text-brand-400" : "text-accent-600 dark:text-accent-400")}>{delta > 0 ? "+" : ""}{delta.toFixed(0)}%</span>}
                      <div className="text-2xs text-ink-4">/ {r.unit_of_measure || "unit"}</div>
                    </td>
                    <td className="py-2 font-mono tabular-nums">
                      <span className={cn(avail <= 0 ? "text-red-600 dark:text-red-400" : "text-ink-1")}>{num(avail)}</span>
                      <div className="text-2xs text-ink-4">min {num(r.min_order_quantity || 1)}</div>
                    </td>
                    <td className="py-2">
                      <QualityBadge status={r.quality_status} showUnverified />
                    </td>
                    <td className="py-2 font-mono tabular-nums">
                      {r.vendor_fulfillment_rate != null ? (
                        <span className={cn(r.vendor_fulfillment_rate >= 90 ? "text-brand-600 dark:text-brand-400" : r.vendor_fulfillment_rate >= 70 ? "text-accent-600 dark:text-accent-400" : "text-red-600 dark:text-red-400")}>{r.vendor_fulfillment_rate.toFixed(0)}%</span>
                      ) : (
                        <span className="text-ink-4">new</span>
                      )}
                      {r.vendor_network_score != null && <div className="text-2xs text-ink-4">score {Number(r.vendor_network_score).toFixed(0)}</div>}
                    </td>
                    <td className="py-2 pr-1 text-right">
                      {onSource && (
                        <Button size="xs" variant={idx === 0 ? "secondary" : "primary"} icon={ArrowDownToLine} disabled={avail <= 0} onClick={() => onSource(r)}>
                          Source
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {alts.length === 0 && <p className="text-xs text-ink-4 py-4 text-center">No comparable stock on the network right now.</p>}
        </div>
      )}
    </Modal>
  );
}
