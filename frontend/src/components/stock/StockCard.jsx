import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownToLine, BadgeCheck, ChevronDown, ChevronUp, Eye, EyeOff, FileText, HeartHandshake, Info, Pencil,
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
 * Compute the explicit visibility & publishing status of a shelf item:
 *   - Published   — visible to other users and eligible for trade
 *   - Draft       — saved but not published (missing price / incomplete)
 *   - Hidden      — intentionally not shared with the network
 *   - Unavailable — not currently available for trade (0 available, below MOQ, or expired)
 */
export function getStockVisibilityStatus(item) {
  if (!item) {
    return {
      key: "draft",
      label: "Draft",
      variant: "gray",
      summary: "Draft — saved but not published.",
      reason: "Complete the listing details to publish.",
      isPublished: false,
    };
  }
  const available = item.quantity_available ?? item.quantity_in_stock ?? 0;
  const moq = item.min_order_quantity ?? item.minimum_order_quantity ?? 1;
  const expired = Boolean(item.expiry_date && new Date(item.expiry_date) < Date.now());
  const hasPrice = Number(item.unit_price) > 0 || Number(item.wholesale_price) > 0;

  if (item.visible_to_network === false) {
    return {
      key: "hidden",
      label: "Hidden",
      variant: "gray",
      summary: "Hidden — intentionally not shared with the network.",
      reason: "Turn on network visibility so buyers can see this listing on your Shop front and in Browse.",
      isPublished: false,
    };
  }

  if (item.status === "draft" || !hasPrice) {
    return {
      key: "draft",
      label: "Draft",
      variant: "amber",
      summary: "Draft — saved but not published.",
      reason: "Add a stated price and stock quantity to publish this listing to buyers.",
      isPublished: false,
    };
  }

  if (expired) {
    return {
      key: "unavailable",
      label: "Unavailable",
      variant: "red",
      summary: "Unavailable — not currently available for trade.",
      reason: "The batch expiry date has passed. Update the batch or expiry date to resume trading.",
      isPublished: false,
    };
  }

  if (available <= 0) {
    return {
      key: "unavailable",
      label: "Unavailable",
      variant: "red",
      summary: "Unavailable — not currently available for trade.",
      reason:
        (item.quantity_reserved || 0) > 0
          ? `All ${item.quantity_reserved} units are currently reserved by open trades.`
          : "Available quantity is 0. Increase stock quantity so it appears on your Shop front and in Browse.",
      isPublished: false,
    };
  }

  if (available < moq) {
    return {
      key: "unavailable",
      label: "Unavailable",
      variant: "amber",
      summary: "Unavailable — not currently available for trade.",
      reason: `Available quantity (${available}) is below your minimum order quantity (${moq}).`,
      isPublished: false,
    };
  }

  return {
    key: "published",
    label: "Published",
    variant: "brand",
    summary: "Published — visible to other users.",
    reason: hasPrice
      ? "Live on your public Shop front and searchable by other accounts in Browse."
      : "Visible on your Shop front and Browse. Add a unit price so buyers can order immediately.",
    isPublished: true,
  };
}

/**
 * THE LISTING CARD — Amazon-style B2B marketplace card with progressive disclosure.
 *
 * Hierarchy:
 *   1. First glance: Product visual, item name, price/unit, available quantity,
 *      MOQ, availability badge, vendor identity, and primary action.
 *   2. On demand (`Details`): Provenance (batch/lot, origin, expiry, spec sheet),
 *      full description, tags, and commercial context.
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const available = item.quantity_available ?? item.quantity_in_stock ?? 0;
  const unit = item.unit_of_measure || "unit";
  const moq = item.min_order_quantity ?? item.minimum_order_quantity ?? 1;
  const low = available > 0 && available <= moq * 2;
  const out = available <= 0;
  const expired = item.expiry_date && new Date(item.expiry_date) < Date.now();
  const batch = item.batch_number || item.batch_code;
  const origin = item.origin_country || item.origin_region;
  const provenance = batch || origin || item.expiry_date || item.spec_sheet_url;
  const visibility = getStockVisibilityStatus(item);
  const hasDetails = Boolean(
    provenance || item.description || (item.tags && item.tags.length > 0) || item.updated_at || item.wholesale_price != null
  );
  const to = href || `/listing/${item.id}`;

  return (
    <article className="group flex flex-col bg-surface-0 border border-edge-1 rounded-2xl overflow-hidden shadow-xs glass-hover h-full">
      {/* ── media ─────────────────────────────────────────────────────── */}
      <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50" tabIndex={-1} aria-hidden="true">
        <StockThumb item={item} ratio="aspect-[16/9]">
          <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1">
            {mode === "mine" ? (
              <Badge variant={visibility.variant} size="xs" data-testid={`stock-status-${visibility.key}`}>
                {visibility.label}
              </Badge>
            ) : out ? (
              <Badge variant="red" size="xs">
                Sold out
              </Badge>
            ) : low ? (
              <Badge variant="amber" size="xs">
                Low stock
              </Badge>
            ) : (
              <Badge variant="brand" size="xs">
                Available now
              </Badge>
            )}
            {mode === "mine" && low && visibility.isPublished && (
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
          <div className="absolute top-2.5 right-2.5 flex gap-1">
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
                  "grid place-items-center w-7 h-7 rounded-lg bg-surface-0 border border-edge-1 shadow-2xs transition-colors",
                  item.visible_to_network ? "text-brand-600 dark:text-brand-400" : "text-ink-4"
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
            <Link to={`/@${item.vendor_handle}`} className="shrink-0" aria-label={`${item.vendor_business || item.vendor_business_name} shop front`}>
              <Avatar name={item.vendor_business || item.vendor_business_name || item.vendor_handle} size="xs" />
            </Link>
            <div className="min-w-0 flex-1">
              <Link to={`/@${item.vendor_handle}`} className="text-2xs font-semibold text-ink-2 hover:underline underline-offset-2 truncate block">
                {item.vendor_business || item.vendor_business_name || `@${item.vendor_handle}`}
              </Link>
            </div>
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
          {mode === "mine" && (
            <div className="mt-2 rounded-lg border border-edge-1 bg-surface-1 px-2.5 py-1.5 text-micro text-ink-3">
              <p className="font-semibold text-ink-1">{visibility.summary}</p>
              {!visibility.isPublished && (
                <p className="mt-0.5 text-ink-4 leading-snug">{visibility.reason}</p>
              )}
            </div>
          )}
        </div>

        {/* ── price + availability + MOQ at first glance ────────────── */}
        <div className="mt-auto rounded-xl bg-surface-1 border border-edge-1 p-3">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p className="text-micro uppercase tracking-[0.08em] font-bold text-ink-4">
                {item.unit_price != null ? "Stated price" : "No price stated"}
              </p>
              <p className="text-lg font-bold text-ink-1 tabular-nums leading-tight mt-0.5">
                {item.unit_price != null ? currency(item.unit_price) : "—"}
                {item.unit_price != null && <span className="text-2xs font-medium text-ink-4"> / {unit}</span>}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={cn("text-sm font-bold tabular-nums", out ? "text-red-600 dark:text-red-400" : low ? "text-accent-600 dark:text-accent-400" : "text-ink-1")}>
                {num(available)}
              </p>
              <p className="text-micro text-ink-4">{unit} available</p>
            </div>
          </div>

          <div className="mt-2 pt-2 border-t border-edge-1 flex items-center justify-between gap-2 text-micro text-ink-3">
            <span className="font-medium">
              Min order: <strong className="text-ink-1 tabular-nums">{num(moq)} {unit}</strong>
            </span>
            {mode === "mine" && item.quantity_reserved > 0 ? (
              <span className="text-accent-600 dark:text-accent-400 font-semibold tabular-nums">
                {num(item.quantity_reserved)} reserved
              </span>
            ) : item.updated_at ? (
              <span className="text-ink-4">stated {relativeTime(item.updated_at)}</span>
            ) : null}
          </div>
        </div>

        {/* ── Progressive disclosure: Details on demand ─────────────── */}
        {detailsOpen && (
          <div className="rounded-xl border border-edge-1 bg-surface-1 p-3 space-y-2 text-micro text-ink-3 animate-fade-in">
            {item.description && <p className="text-2xs text-ink-2 leading-relaxed">{item.description}</p>}
            {provenance && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-micro text-ink-3">
                {batch && <span className="font-mono">Lot: {batch}</span>}
                {origin && <span>Origin: {origin}</span>}
                {item.expiry_date && (
                  <span className={cn(expired && "text-red-600 dark:text-red-400 font-semibold")}>
                    Exp: {shortDate(item.expiry_date)}
                  </span>
                )}
                {item.spec_sheet_url && (
                  <a
                    href={item.spec_sheet_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-400 hover:underline"
                  >
                    <FileText size={10} aria-hidden="true" /> Spec sheet
                  </a>
                )}
              </div>
            )}
            {mode === "mine" && (item.cost_price != null || item.wholesale_price != null) && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
                {item.cost_price != null && <span>Cost: {currency(item.cost_price)}</span>}
                {item.wholesale_price != null && <span>Wholesale: {currency(item.wholesale_price)}</span>}
              </div>
            )}
            {item.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {item.tags.map((t) => (
                  <span key={t} className="rounded-md bg-surface-0 border border-edge-1 px-1.5 py-0.5 text-ink-3">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── act ───────────────────────────────────────────────────── */}
        <div className="relative flex items-center gap-1.5">
          {mode === "network" ? (
            <>
              {onSource ? (
                <Button size="sm" icon={ArrowDownToLine} disabled={out} onClick={() => onSource(item)} className="flex-1">
                  {out ? "Sold out" : "Source"}
                </Button>
              ) : (
                <Link
                  to={to}
                  className="flex-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-brand-700 hover:bg-brand-800 px-3 text-xs font-semibold text-white transition-colors"
                >
                  View &amp; order
                </Link>
              )}
              {hasDetails && (
                <Button
                  size="xs"
                  variant="ghost"
                  icon={detailsOpen ? ChevronUp : ChevronDown}
                  onClick={() => setDetailsOpen((v) => !v)}
                  aria-expanded={detailsOpen}
                  title="Toggle item details"
                >
                  Details
                </Button>
              )}
              {onCompare && (
                <Button
                  size="icon"
                  variant="secondary"
                  icon={Scale}
                  onClick={() => onCompare(item)}
                  title="Compare alternatives"
                  aria-label={`Compare alternatives to ${item.name}`}
                />
              )}
              {onDeal && (
                <Button
                  size="icon"
                  variant="secondary"
                  icon={HeartHandshake}
                  onClick={() => onDeal(item)}
                  title="Open a deal room"
                  aria-label={`Negotiate ${item.name}`}
                />
              )}
              {canPatronVerify && onPatronVerify && item.quality_status !== "patron_verified" && (
                <Button
                  size="icon"
                  variant="secondary"
                  icon={BadgeCheck}
                  onClick={() => onPatronVerify(item)}
                  title="Verify as patron"
                  aria-label={`Verify ${item.name} as patron`}
                />
              )}
            </>
          ) : (
            <>
              <span className="text-micro text-ink-4 mr-auto">min order {num(moq)}</span>
              {hasDetails && (
                <Button
                  size="xs"
                  variant="ghost"
                  icon={Info}
                  onClick={() => setDetailsOpen((v) => !v)}
                  aria-expanded={detailsOpen}
                >
                  Details
                </Button>
              )}
              {onVerify && (
                <Button
                  size="icon"
                  variant="secondary"
                  icon={ShieldCheck}
                  onClick={() => onVerify(item)}
                  title="Declare provenance"
                  aria-label="Declare provenance"
                />
              )}
              <Button size="icon" variant="secondary" icon={Pencil} onClick={() => onEdit?.(item)} aria-label="Edit" />
              <Button
                size="icon"
                variant="ghost"
                icon={Trash2}
                onClick={() => onRemove?.(item)}
                aria-label="Remove"
                className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
              />
            </>
          )}
        </div>
      </div>
    </article>
  );
}
