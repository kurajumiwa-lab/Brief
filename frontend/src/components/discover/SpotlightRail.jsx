import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BadgePercent, CalendarDays, ChevronLeft, ChevronRight, Store, Users,
} from "lucide-react";
import { ownerLevel } from "@/lib/standing";
import { priceLabel } from "@/lib/categoryArt";
import { regionLabel } from "@/config/regions";
import { cn } from "@/lib/utils";

/**
 * SPOTLIGHT — the one promotional slot on Discover.
 *
 * It is populated from real records already on the page: a spotted public sale,
 * an upcoming round, a live offer, or a service provider with a traceable
 * record. Nothing is promoted because someone paid, and nothing is called
 * "verified" unless the standing ladder actually reached Level 3.
 *
 * Presentation is one full-bleed poster: the photograph, title, place and price
 * share a single surface under a bottom scrim, so the card never breaks into a
 * picture stacked on a solid block. Arrows and dots stay outside the scrim.
 */
export function spotlightSlides({ items = [], spotted = [], region = null }) {
  const slides = [];
  const sale = spotted[0];
  if (sale) {
    slides.push({
      key: `sale:${sale.id}`,
      badge: "Public sale",
      tone: "hot",
      Icon: BadgePercent,
      title: sale.title,
      location: sale.town || sale.area || "Near you",
      meta: `${sale.merchant_name || "Local shop"}${sale.discount_summary ? ` · ${sale.discount_summary}` : ""}`,
      image: sale.image || sale.product_image || sale.images?.[0] || null,
      price: sale.price_kes != null ? priceLabel(sale.price_kes) : null,
      to: "/discover?kind=spotted",
      cta: "See spotlit sales",
      note: "Posted by a neighbour; unverified and awards no standing.",
    });
  }

  const event = items.find((item) => item.kind === "event" || item.kind === "scheduled");
  if (event) {
    slides.push({
      key: `event:${event.id}`,
      badge: "Featured round",
      tone: "forest",
      Icon: CalendarDays,
      title: event.title,
      location: event.location || "Near you",
      meta: event.reasons?.[0] || null,
      image: event.image || null,
      price: event.price_kes == null
        ? "Price on request"
        : Number(event.price_kes) > 0 ? `From ${priceLabel(event.price_kes)}` : "Free to join",
      to: event.to || "/events",
      cta: event.kind === "scheduled" ? "See round" : "See event",
      note: null,
    });
  }

  const offer = items.find((item) => ["listing", "rental", "available"].includes(item.kind));
  if (offer) {
    slides.push({
      key: `offer:${offer.id}`,
      badge: offer.kind === "rental" ? "Rental" : "Live offer",
      tone: "amber",
      Icon: Store,
      title: offer.title,
      location: offer.location || "Near you",
      meta: offer.reasons?.[0] || null,
      image: offer.image || null,
      price: offer.price_kes != null ? priceLabel(offer.price_kes) : null,
      to: offer.to || "/discover?kind=listing",
      cta: "View offer",
      note: null,
    });
  }

  const provider = items.find((item) => ["service", "provider", "person"].includes(item.kind) && ownerLevel(item.owner) >= 2);
  if (provider) {
    const level = ownerLevel(provider.owner);
    slides.push({
      key: `provider:${provider.id}`,
      badge: level >= 3 ? "Verified trader" : "Local service",
      tone: "forest",
      Icon: Users,
      title: provider.title,
      location: provider.location || "Near you",
      meta: null,
      image: provider.image || null,
      price: provider.price_kes != null ? `from ${priceLabel(provider.price_kes)}` : null,
      to: provider.to || "#",
      cta: "Open page",
      note: `Lvl ${level}${level >= 3 ? "+" : ""} · completed trade record, not an institutional check.`,
    });
  }

  if (!slides.length) {
    slides.push({
      key: "fallback",
      badge: "Around you",
      tone: "forest",
      Icon: BadgePercent,
      title: region ? `${region.name} is open for trade` : "Find what is around you",
      location: region ? regionLabel(region) : "Around you",
      meta: region ? region.knownFor.slice(0, 3).join(" · ") : "Post an offer or spot a public sale.",
      image: null,
      price: null,
      to: "/create",
      cta: "Post something",
      note: "The spotlight is made from live records, never paid placement.",
      spot: true,
    });
  }

  return slides.slice(0, 4);
}

const TONES = {
  forest: "from-brand-700 to-brand-900",
  hot: "from-[#7A2E0E] to-hot",
  amber: "from-[#6B3F12] to-[#B8792A]",
};

export default function SpotlightRail({ items, spotted, region, onSpotSale }) {
  const slides = spotlightSlides({ items, spotted, region });
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(slides.length - 1, 0)));
  }, [slides.length]);

  const slide = slides[active] || slides[0];
  const Icon = slide.Icon;
  const go = (delta) => setActive((current) => (current + delta + slides.length) % slides.length);

  return (
    <section
      aria-label="Spotlight"
      data-testid="discover-spotlight"
      className="overflow-hidden rounded-2xl bg-mk-card/70"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <p className="text-2xs font-extrabold uppercase tracking-[0.18em] text-mk-orange">Our top picks</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous top pick"
            className="grid h-9 w-9 place-items-center rounded-full border border-mk-line bg-mk-cream text-mk-ink transition-colors hover:border-mk-ink/40"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next top pick"
            className="grid h-9 w-9 place-items-center rounded-full border border-mk-line bg-mk-cream text-mk-ink transition-colors hover:border-mk-ink/40"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        data-testid="spotlight-poster"
        data-poster="true"
        className="relative m-4 aspect-[4/5] overflow-hidden rounded-2xl bg-ink-1 sm:aspect-[16/10]"
      >
        {slide.image ? (
          <img src={slide.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className={cn("absolute inset-0 flex items-center justify-center bg-gradient-to-br", TONES[slide.tone] || TONES.forest)}>
            <Icon size={64} strokeWidth={1.2} className="text-white/80" aria-hidden="true" />
          </div>
        )}

        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-1/55 via-transparent to-transparent"
          aria-hidden="true"
        />

        <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-black/55 px-2.5 py-1 text-2xs font-extrabold uppercase tracking-[0.08em] text-white backdrop-blur-sm">
            <Icon size={11} aria-hidden="true" /> {slide.badge}
          </span>
          {slide.spot && (
            <span className="rounded-md border border-white/20 bg-black/45 px-2 py-1 text-2xs font-bold text-white/80 backdrop-blur-sm">
              Live record
            </span>
          )}
        </div>

        {slides.length > 1 && (
          <span className="absolute right-3 top-3 z-20 rounded-md border border-white/20 bg-black/45 px-2 py-1 text-2xs font-bold tabular-nums text-white/80 backdrop-blur-sm">
            {active + 1} / {slides.length}
          </span>
        )}

        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink-1 via-ink-1/90 to-transparent px-4 pb-4 pt-24 text-white">
          <p className="text-2xs font-extrabold uppercase tracking-[0.16em] text-[#FFB38F]">{slide.location}</p>
          <h2 className="mt-1 line-clamp-2 text-xl font-black leading-tight tracking-tight text-white sm:text-2xl">
            {slide.title}
          </h2>
          {slide.meta && <p className="mt-1 line-clamp-1 text-2xs font-semibold text-white/70">{slide.meta}</p>}

          <div className={cn("mt-3 flex items-end gap-3", slide.price ? "justify-between" : "justify-end")}>
            <div className="min-w-0">
              {slide.price && (
                <p className="truncate text-xl font-black tracking-tight text-[#FFD7A8] sm:text-2xl">{slide.price}</p>
              )}
              {slides.length > 1 && (
                <div className="mt-2 flex items-center gap-1.5" aria-label="Choose top pick">
                  {slides.map((s, index) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setActive(index)}
                      aria-label={`Top pick ${index + 1}: ${s.title}`}
                      aria-pressed={index === active}
                      className={cn(
                        "h-1.5 rounded-full transition-all",
                        index === active ? "w-5 bg-white" : "w-1.5 bg-white/35 hover:bg-white/60",
                      )}
                    />
                  ))}
                </div>
              )}
            </div>

            <Link
              to={slide.to}
              className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl bg-mk-orange px-4 text-[12px] font-extrabold text-white shadow-sm transition-transform hover:-translate-y-0.5"
            >
              {slide.cta} <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>

          {slide.note && <p className="mt-2 line-clamp-1 text-2xs text-white/55">{slide.note}</p>}
          {slide.spot && onSpotSale && (
            <button
              type="button"
              onClick={onSpotSale}
              className="mt-2 inline-flex h-8 items-center gap-1 rounded-lg border border-white/30 px-2.5 text-2xs font-bold text-white/85 hover:bg-white/10"
            >
              Spot a public sale
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
