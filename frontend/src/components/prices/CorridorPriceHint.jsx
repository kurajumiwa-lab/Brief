import { CheckCircle2, Info, TrendingDown } from "lucide-react";

/**
 * THE SMART PRICE HINT ON + CREATE.
 *
 * A range from confirmed local trades, not a platform price and not a
 * valuation. If the engine has fewer than five independent points it returns
 * nothing, and this component renders nothing — the honest gap.
 */

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function CorridorPriceHint({ hint, enteredPrice, onApplySuggestedPrice }) {
  if (!hint?.available) return null;

  const p25 = number(hint.p25_kes);
  const p75 = number(hint.p75_kes);
  const median = number(hint.median_kes);
  const ceiling = number(hint.fair_price_ceiling_kes);
  const sample = Number(hint.sample_count || 0);
  const price = Number(enteredPrice);
  const hasPrice = Number.isFinite(price) && price > 0;
  const qualifies = hasPrice && price <= ceiling;
  const aboveTypical = hasPrice && price > p75;

  return (
    <section
      className="space-y-2 rounded-2xl border border-edge-1 bg-surface-2 p-3"
      aria-labelledby="price-hint-heading"
      data-testid="corridor-price-hint"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <TrendingDown size={14} className="shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />
          <h2 id="price-hint-heading" className="truncate text-xs font-extrabold text-ink-1">
            {hint.scope_label} Index
          </h2>
        </div>
        <span className="shrink-0 text-[10px] font-semibold text-ink-4">
          {sample} local trade{sample === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-edge-1 bg-surface-0 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="block text-[10px] uppercase tracking-wider text-ink-4">
            Typical range · last {hint.window_days || 45} days
          </span>
          <span className="text-sm font-extrabold tabular-nums text-ink-1" data-testid="price-hint-range">
            KSh {p25.toLocaleString()} – {p75.toLocaleString()}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onApplySuggestedPrice?.(median)}
          className="min-h-[44px] rounded-lg border border-brand-200 bg-brand-50 px-3 text-[11px] font-bold text-brand-800 transition-colors hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-200"
        >
          Use median (KSh {median.toLocaleString()})
        </button>
      </div>

      {hasPrice && (
        <div className="text-[11px] leading-relaxed" data-testid="price-hint-qualification">
          {qualifies ? (
            <span className="inline-flex items-center gap-1 font-semibold text-brand-800 dark:text-brand-200">
              <CheckCircle2 size={13} className="shrink-0" aria-hidden="true" />
              Qualifies for the “Fair Corridor Price” badge in Regions.
            </span>
          ) : aboveTypical ? (
            <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-200">
              <Info size={13} className="shrink-0" aria-hidden="true" />
              Above the typical corridor range — list clear inclusions to justify the price.
            </span>
          ) : (
            <span className="text-ink-3">
              Within the typical local range. The badge applies at or below KSh{" "}
              {ceiling.toLocaleString()} (median +5%).
            </span>
          )}
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-ink-4">
        {hint.signal_note || "A guide from confirmed local trades. It is not a valuation and awards no standing credit."}
      </p>
    </section>
  );
}
