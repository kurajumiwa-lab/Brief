import { Link } from "react-router-dom";
import { Package, ArrowDownToLine } from "lucide-react";
import { currency, num } from "@/lib/formatters";

/** Compact stock card embedded in a message (`message.shared_stock`). */
export default function StockShare({ stock, mine }) {
  if (!stock) return <p className="text-2xs text-ink-4 italic">Shared stock is no longer available</p>;
  return (
    <div className="mt-1.5 rounded-lg border border-edge-2 bg-surface-1/80 p-2.5 min-w-[14rem]">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0">
          <Package size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-ink-1 truncate">{stock.name}</div>
          <div className="text-2xs text-ink-4 font-mono truncate">
            {stock.sku && `${stock.sku} · `}
            {stock.category}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 mt-2 text-center">
        <Cell label="avail" value={`${num(stock.quantity_available)} ${stock.unit_of_measure || ""}`} />
        <Cell label="price" value={stock.unit_price != null ? currency(stock.unit_price) : "ask"} />
        <Cell label="min" value={num(stock.min_order_quantity || 1)} />
      </div>
      {!mine && (
        <Link to={`/stock?tab=network&search=${encodeURIComponent(stock.name)}`} className="mt-2 inline-flex items-center gap-1 text-2xs text-brand-600 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-400">
          <ArrowDownToLine size={11} /> Source it in the Stock Room
        </Link>
      )}
    </div>
  );
}

function Cell({ label, value }) {
  return (
    <div className="rounded bg-surface-2 px-1 py-1">
      <div className="text-2xs text-ink-4">{label}</div>
      <div className="text-2xs font-mono text-ink-1 truncate">{value}</div>
    </div>
  );
}
