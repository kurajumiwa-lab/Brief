import { Link } from "react-router-dom";
import {
  ArrowDownToLine, BadgeCheck, Eye, EyeOff, FileText, HeartHandshake, Pencil,
  Plug, Scale, ShieldCheck, Trash2,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Avatar from "@/components/ui/Avatar";
import QualityBadge from "./QualityBadge";
import StockThumb from "./StockThumb";
import { FulfilmentChip } from "@/components/trust/TrustSignals";
import { currency, num, relativeTime, shortDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * THE LISTING CARD — the atom of the marketplace.
 *
 * Mechanics are untouched (same props, same handlers, same endpoints). What
 * changed is the reading order, which now matches how a trader actually
 * decides:
 *
 *    1. what is it            → media + name
 *    2. who is selling it     → vendor row with a derived supplier level
 *    3. can I trust it        → quality / provenance badge
 *    4. what does it cost     → price block, leading the footer
 *    5. act                   → Source (primary) · compare · deal room
 *
 * `mode="mine"` keeps every owner control that existed in v2.
 */
export default function StockCard({
  item,
  mode = "network",
  onSource,
  onDeal,
  onEdit,
  onRemove,
  onToggleVisible,
  onCompare,
  onVerify,
  onPatronVerify,
  canPatronVerify,
  href,
}) {
  const available = item.quantity_available ?? item.quantity_in_stock ?? 0;
  const low = available > 0 && available <= (item.min_order_quantity || 1) * 2;
  const out = available <= 0;
  const expired = item.expiry_date && new Date(item.expiry_date) < Date.now();
  const provenance = item.batch_number || item.origin_country || item.expiry_date || item.spec_sheet_url;
  const to = href || `/listing/${item.id}`;

  return (
    <article className="group flex flex-col bg-surface-0 border border-edge-1 rounded-2xl overflow-hidden shadow-xs glass-hover h-full">
      {/* ── media ─────────────────────────────────────────────────────── */}
      <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50" tabIndex={-1} aria-hidden="true">
        <StockThumb item={item} ratio="aspect-[16/9]">
          <div className="absolute top-2 left-2 flex flex-wrap gap-1">
            {out && (
              <Badge variant="red" size="xs">
                Sold out
              </Badge>
            )}
            {!out && low && (
              <Badge variant="amber" size="xs">
                Low stock
              </Badge>
            )}
            {expired && (
              <Badge variant="red" size="xs">
                Expired
              </Badge>
            )}
          </div>
          <div className="absolute top-2 right-2 flex gap-1">
            {item.source === "pos_sync" && (
              <Badge variant="blue" size="xs" title="Live from this vendor's till">
                <Plug size={10} aria-hidden="true" /> Live
              </Badge>
            )}
            {mode === "mine" && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onToggleVisible?.(item);
                }}
                title={item.visible_to_network ? "Visible to the network" : "Hidden from the network"}
                aria-label={item.visible_to_network ? "Hide from the network" : "Show to the network"}
                className={cn(
                  "grid place-items-center w-7 h-7 rounded-lg backdrop-blur-sm transition-colors",
                  item.visible_to_network ? "bg-surface-0/90 text-brand-600 dark:text-brand-400" : "bg-surface-0/90 text-ink-4"
                )}
              >
                {item.visible_to_network ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            )}
          </div>
        </StockThumb>
      </Link>

      <div className="flex flex-col flex-1 p-4 gap-3">
        {/* ── who ───────────────────────────────────────────────────── */}
        {mode === "network" && (
          <div className="flex items-center gap-2 min-w-0">
            <Link to={`/@${item.vendor_handle}`} className="shrink-0" aria-label={`${item.vendor_business} shop front`}>
              <Avatar name={item.vendor_business} size="xs" />
            </Link>
            <Link to={`/@${item.vendor_handle}`} className="text-2xs font-semibold text-ink-2 hover:underline underline-offset-2 truncate">
              {item.vendor_business}
            </Link>
            <FulfilmentChip rate={item.vendor_fulfillment_rate} className="ml-auto shrink-0" />
          </div>
        )}

        {/* ── what ──────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink-1 leading-snug">
            <Link to={to} className="hover:underline underline-offset-2 line-clamp-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded">
                {item.name}
            </Link>
          </h3>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <QualityBadge status={item.quality_status} showUnverified={mode === "mine"} />
            {item.category && (
              <span className="text-micro text-ink-4 uppercase tracking-[0.08em] font-semibold">{item.category}</span>
            )}
            {item.sku && <span className="text-micro text-ink-4 font-mono">{item.sku}</span>}
          </div>
        </div>

        {/* ── provenance (progressive disclosure: only when declared) ── */}
        {provenance && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-micro text-ink-4">
            {item.batch_number && <span className="font-mono">lot {item.batch_number}</span>}
            {item.origin_country && <span>from {item.origin_country}</span>}
            {item.expiry_date && <span className={cn(expired && "text-red-600 dark:text-red-400 font-semibold")}>exp {shortDate(item.expiry_date)}</span>}
            {item.spec_sheet_url && (
              <a
                href={item.spec_sheet_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="relative inline-flex items-center gap-1 text-brand-700 dark:text-brand-400 hover:underline"
              >
                <FileText size={10} aria-hidden="true" /> spec sheet
              </a>
            )}
          </div>
        )}

        {mode === "mine" && (item.quantity_reserved > 0 || item.cost_price != null || item.wholesale_price != null) && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-micro text-ink-4 tabular-nums">
            {item.quantity_reserved > 0 && (
              <span className="text-accent-600 dark:text-accent-400 font-semibold">{num(item.quantity_reserved)} reserved</span>
            )}
            {item.cost_price != null && <span>cost {currency(item.cost_price)}</span>}
            {item.wholesale_price != null && <span>wholesale {currency(item.wholesale_price)}</span>}
          </div>
        )}

        {/* ── price + availability ──────────────────────────────────── */}
        <div className="mt-auto pt-3 border-t border-edge-1">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p className="text-micro uppercase tracking-[0.1em] font-bold text-ink-4">
                {item.unit_price != null ? "Stated price" : "No price stated"}
              </p>
              <p className="text-lg font-bold text-ink-1 tabular-nums leading-tight">
                {item.unit_price != null ? currency(item.unit_price) : "—"}
                {item.unit_price != null && <span className="text-2xs font-medium text-ink-4"> / {item.unit_of_measure || "unit"}</span>}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={cn("text-sm font-bold tabular-nums", out ? "text-red-600 dark:text-red-400" : low ? "text-accent-600 dark:text-accent-400" : "text-ink-1")}>
                {num(available)}
              </p>
              <p className="text-micro text-ink-4">available</p>
            </div>
          </div>
          {item.updated_at && <p className="mt-1 text-micro text-ink-4">stated {relativeTime(item.updated_at)}</p>}
        </div>

        {/* ── act ───────────────────────────────────────────────────── */}
        <div className="relative flex items-center gap-1.5">
          {mode === "network" ? (
            <>
              <Button size="sm" icon={ArrowDownToLine} disabled={out} onClick={() => onSource?.(item)} className="flex-1">
                {out ? "Sold out" : "Source"}
              </Button>
              {onCompare && (
                <Button size="icon" variant="secondary" icon={Scale} onClick={() => onCompare(item)} title="Compare alternatives" aria-label={`Compare alternatives to ${item.name}`} />
              )}
              {onDeal && (
                <Button size="icon" variant="secondary" icon={HeartHandshake} onClick={() => onDeal(item)} title="Open a deal room" aria-label={`Negotiate ${item.name}`} />
              )}
              {canPatronVerify && onPatronVerify && item.quality_status !== "patron_verified" && (
                <Button size="icon" variant="secondary" icon={BadgeCheck} onClick={() => onPatronVerify(item)} title="Verify as patron" aria-label={`Verify ${item.name} as patron`} />
              )}
            </>
          ) : (
            <>
              <span className="text-micro text-ink-4 mr-auto">min order {num(item.min_order_quantity || 1)}</span>
              {onVerify && <Button size="icon" variant="secondary" icon={ShieldCheck} onClick={() => onVerify(item)} title="Declare provenance" aria-label="Declare provenance" />}
              <Button size="icon" variant="secondary" icon={Pencil} onClick={() => onEdit?.(item)} aria-label="Edit" />
              <Button size="icon" variant="ghost" icon={Trash2} onClick={() => onRemove?.(item)} aria-label="Remove" className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10" />
            </>
          )}
        </div>
      </div>
    </article>
  );
}
