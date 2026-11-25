import { ArrowRight, BadgePercent, HelpCircle, Sparkles } from "lucide-react";
import { regionLabel } from "@/config/regions";

/**
 * THE SHOPFRONT HEADLINE.
 *
 * The discovery screen opens like a catalogue, not a control panel: one big
 * promise, two doors, and the region named quietly underneath. The copy stays
 * honest — "around you", never a discount or verification we cannot prove.
 */
export default function MarketplaceHero({ region, onShopSale, onBrowseAll, onHowItWorks }) {
  const place = region ? regionLabel(region) : "around you";
  return (
    <section
      data-testid="discover-hero"
      className="soft-card relative overflow-hidden rounded-2xl bg-mk-cream px-5 py-6 text-center sm:px-10 sm:py-9"
    >
      <span
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-mk-orange/10 blur-2xl"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -bottom-24 -left-16 h-52 w-52 rounded-full bg-mk-ink/5 blur-2xl"
        aria-hidden="true"
      />

      <p className="relative inline-flex items-center gap-1.5 text-2xs font-extrabold uppercase tracking-[0.18em] text-mk-orange">
        <Sparkles size={12} aria-hidden="true" />
        Wasta marketplace · {place}
      </p>
      <h2 className="relative mt-3 text-[2.4rem] font-black leading-[0.98] tracking-[-0.045em] text-mk-ink sm:text-5xl">
        Great finds.
        <span className="mt-1 block text-mk-orange">Better deals.</span>
      </h2>
      <p className="relative mx-auto mt-4 max-w-lg text-sm leading-relaxed text-mk-ink-soft sm:text-base">
        Goods, services, rentals and rounds from the pages around you — with the
        price, the distance and the trade record on every card.
      </p>

      <div className="relative mx-auto mt-5 grid max-w-md gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={onShopSale}
          data-testid="discover-hero-sale"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-mk-ink px-5 text-sm font-extrabold text-mk-cream shadow-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
        >
          <BadgePercent size={16} aria-hidden="true" />
          Shop sale items
        </button>
        <button
          type="button"
          onClick={onBrowseAll}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-mk-ink/25 bg-mk-card px-5 text-sm font-extrabold text-mk-ink transition-colors hover:border-mk-ink/50"
        >
          Browse all products
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="relative mt-3 flex flex-wrap items-center justify-center gap-1.5">
        <p className="text-2xs font-medium text-mk-ink-soft/80">
          Ranked by proximity, timing and real activity. Never paid placement.
        </p>
        <button
          type="button"
          onClick={onHowItWorks}
          aria-haspopup="dialog"
          aria-label="How Wasta works"
          data-testid="discover-how-it-works-button"
          className="relative grid h-6 w-6 place-items-center rounded-full border border-mk-line bg-mk-card text-mk-ink-soft transition-colors after:absolute after:-inset-2.5 hover:border-mk-orange hover:text-mk-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mk-orange"
        >
          <HelpCircle size={13} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
