import { Crown, Gauge, Leaf, Plug, ShieldCheck, Star } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { num } from "@/lib/formatters";

/* ═══════════════════════════════════════════════════════════════════════════
   TRUST SIGNALS
   ---------------------------------------------------------------------------
   Brief_ already computes everything a buyer needs to judge a supplier —
   fulfilment rate, completed movements, reliability score, patron tier,
   verification, POS liveness. It just never added up to a single judgement.

   This module derives ONE readable level from the EXISTING fields. No new
   endpoint, no new column, no invented number:

       level   = f(fulfillment_rate, movements_completed)
       honours = patron tier · verified · POS-live

   The levels are deliberately modest at the bottom ("New to the network") so
   the ladder stays honest: a vendor with no completed movements is never
   dressed up as reliable.
   ═══════════════════════════════════════════════════════════════════════════ */

export const LEVELS = {
  top: { key: "top", label: "Top supplier", variant: "brand", hint: "95%+ fulfilment across 20 or more completed movements" },
  l2: { key: "l2", label: "Level 2", variant: "brand", hint: "85%+ fulfilment across 10 or more completed movements" },
  l1: { key: "l1", label: "Level 1", variant: "blue", hint: "70%+ fulfilment across 3 or more completed movements" },
  rising: { key: "rising", label: "Getting started", variant: "amber", hint: "Trading, but not enough completed movements to rate yet" },
  new: { key: "new", label: "New to the network", variant: "gray", hint: "No completed movements yet — nothing to rate" },
};

/** Derive a supplier level from fields the API already returns. */
export function vendorLevel(vendor = {}) {
  const done = Number(vendor.movements_completed ?? vendor.total_supplied ?? 0);
  const rate = vendor.fulfillment_rate == null ? null : Number(vendor.fulfillment_rate);
  if (!done || rate == null) return LEVELS.new;
  if (rate >= 95 && done >= 20) return LEVELS.top;
  if (rate >= 85 && done >= 10) return LEVELS.l2;
  if (rate >= 70 && done >= 3) return LEVELS.l1;
  return LEVELS.rising;
}

/** The level, as a chip. Used on cards, listings and shop fronts alike. */
export function LevelBadge({ vendor, size = "sm", className }) {
  const level = vendorLevel(vendor);
  const Icon = level.key === "new" ? Leaf : level.key === "top" ? Star : Gauge;
  return (
    <Badge variant={level.variant} size={size} className={className} title={level.hint}>
      <Icon size={11} aria-hidden="true" />
      {level.label}
    </Badge>
  );
}

/**
 * The rate on its own, for surfaces where the API gives a fulfilment rate but
 * NOT the completed-movement count (stock listings carry
 * `vendor_fulfillment_rate` and nothing else). A level needs both numbers, so
 * those surfaces show the number they actually have rather than guessing a
 * level — an unknown sample size must never be rendered as a badge.
 */
export function FulfilmentChip({ rate, size = "xs", className }) {
  if (rate == null) return null;
  const r = Number(rate);
  const tone = r >= 90 ? "brand" : r >= 70 ? "blue" : r >= 50 ? "amber" : "red";
  return (
    <Badge variant={tone} size={size} className={className} title="Share of confirmed movements this vendor delivered">
      <Gauge size={11} aria-hidden="true" />
      {r.toFixed(0)}% fulfilled
    </Badge>
  );
}

// Static class pairs (Tailwind can only see literal class names).
const RATE_TONES = {
  none: { text: "text-ink-4", bar: "bg-edge-3" },
  high: { text: "text-brand-600 dark:text-brand-400", bar: "bg-brand-500" },
  good: { text: "text-blue-600 dark:text-blue-400", bar: "bg-blue-500" },
  fair: { text: "text-accent-600 dark:text-accent-400", bar: "bg-accent-500" },
  poor: { text: "text-red-600 dark:text-red-400", bar: "bg-red-500" },
};

const rateTone = (r) =>
  r == null ? RATE_TONES.none : r >= 90 ? RATE_TONES.high : r >= 70 ? RATE_TONES.good : r >= 50 ? RATE_TONES.fair : RATE_TONES.poor;

/** Fulfilment as a number plus a bar — a rate is easier to judge than to read. */
export function ReliabilityMeter({ rate, completed, className, showBar = true }) {
  const r = rate == null ? null : Number(rate);
  const tone = rateTone(r);
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-micro uppercase tracking-[0.1em] font-bold text-ink-4">Fulfilment</span>
        <span className={cn("text-xs font-bold tabular-nums", tone.text)}>{r == null ? "—" : `${r.toFixed(0)}%`}</span>
      </div>
      {showBar && (
        <div
          className="mt-1.5 h-1.5 rounded-full bg-surface-3 overflow-hidden"
          role="progressbar"
          aria-valuenow={r ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Fulfilment rate"
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-3 ease-out", tone.bar)}
            style={{ width: `${Math.max(0, Math.min(100, r ?? 0))}%` }}
          />
        </div>
      )}
      <p className="mt-1 text-micro text-ink-4">
        {completed ? `${num(completed)} completed movement${completed === 1 ? "" : "s"}` : "no completed movements yet"}
      </p>
    </div>
  );
}

/**
 * The one-line trust row carried by every vendor-bearing surface:
 * level · patron tier · verified · POS-live.
 */
export function TrustRow({ vendor = {}, size = "xs", className, showLevel = true }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {showLevel && <LevelBadge vendor={vendor} size={size} />}
      {vendor.is_patron && (
        <Badge variant="purple" size={size} title={`Patron${vendor.patron_tier ? ` · ${vendor.patron_tier}` : ""}`}>
          <Crown size={11} aria-hidden="true" />
          {vendor.patron_tier ? vendor.patron_tier : "Patron"}
        </Badge>
      )}
      {vendor.is_verified && (
        <Badge variant="blue" size={size} title="Identity verified">
          <ShieldCheck size={11} aria-hidden="true" />
          Verified
        </Badge>
      )}
      {vendor.has_pos_connected && (
        <Badge variant="gray" size={size} title="Stock syncs live from this vendor's till">
          <Plug size={11} aria-hidden="true" />
          Live stock
        </Badge>
      )}
    </div>
  );
}

export default TrustRow;
