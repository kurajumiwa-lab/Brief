import { Link } from "react-router-dom";
import { Eye, EyeOff, Pencil, Trash2, ArrowDownToLine, HeartHandshake, Plug } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { currency, num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * mode="mine"    → owner controls (edit / remove / visibility)
 * mode="network" → source + deal-room actions, vendor attribution
 */
export default function StockCard({ item, mode = "network", onSource, onDeal, onEdit, onRemove, onToggleVisible }) {
  const available = item.quantity_available ?? item.quantity_in_stock ?? 0;
  const low = available > 0 && available <= (item.min_order_quantity || 1) * 2;
  const out = available <= 0;

  return (
    <Card className="flex flex-col gap-3" padding="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink-1 truncate">{item.name}</h3>
          <div className="flex items-center gap-2 text-2xs text-ink-4 font-mono mt-0.5">
            {item.sku && <span>{item.sku}</span>}
            {item.category && <span className="text-ink-3">{item.category}</span>}
          </div>
        </div>
        {mode === "mine" ? (
          <button
            onClick={() => onToggleVisible?.(item)}
            title={item.visible_to_network ? "Visible to the network" : "Hidden from the network"}
            className={cn("p-1 rounded-md", item.visible_to_network ? "text-brand-400 hover:bg-brand-950" : "text-ink-4 hover:bg-surface-3")}
          >
            {item.visible_to_network ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        ) : (
          item.source === "pos_sync" && <Plug size={12} className="text-blue-400 shrink-0" title="Live from POS" />
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="available" value={num(available)} tone={out ? "red" : low ? "amber" : "default"} />
        <Metric label="unit" value={item.unit_of_measure || "units"} mono={false} />
        <Metric label="price" value={item.unit_price != null ? currency(item.unit_price) : "—"} />
      </div>

      {mode === "mine" && (item.quantity_reserved > 0 || item.wholesale_price != null || item.cost_price != null) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-ink-4 font-mono">
          {item.quantity_reserved > 0 && <span className="text-amber-300">{num(item.quantity_reserved)} reserved</span>}
          {item.cost_price != null && <span>cost {currency(item.cost_price)}</span>}
          {item.wholesale_price != null && <span>wholesale {currency(item.wholesale_price)}</span>}
        </div>
      )}

      {item.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.slice(0, 4).map((t) => (
            <Badge key={t} variant="outline" size="xs">
              {t}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        {mode === "network" ? (
          <>
            <Link to={`/@${item.vendor_handle}`} className="min-w-0 text-2xs text-ink-4 hover:text-brand-300 truncate">
              <span className="text-ink-3">{item.vendor_business}</span> <span className="font-mono">@{item.vendor_handle}</span>
            </Link>
            <div className="flex items-center gap-1.5 shrink-0">
              {onDeal && <Button size="xs" variant="ghost" icon={HeartHandshake} onClick={() => onDeal(item)} title="Open a deal room" aria-label="Open a deal room" />}
              <Button size="xs" icon={ArrowDownToLine} onClick={() => onSource?.(item)} disabled={out}>
                {out ? "Sold out" : "Source"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-2xs text-ink-4">min order {num(item.min_order_quantity || 1)}</span>
            <div className="flex items-center gap-1">
              <Button size="xs" variant="ghost" icon={Pencil} onClick={() => onEdit?.(item)} aria-label="Edit" />
              <Button size="xs" variant="dangerGhost" icon={Trash2} onClick={() => onRemove?.(item)} aria-label="Remove" />
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function Metric({ label, value, tone = "default", mono = true }) {
  const tones = { default: "text-ink-1", amber: "text-amber-300", red: "text-red-300" };
  return (
    <div className="rounded-lg bg-surface-2 border border-edge-1 px-2 py-1.5 min-w-0">
      <div className="text-2xs text-ink-4">{label}</div>
      <div className={cn("text-sm font-medium truncate", mono && "font-mono tabular-nums", tones[tone])}>{value}</div>
    </div>
  );
}
