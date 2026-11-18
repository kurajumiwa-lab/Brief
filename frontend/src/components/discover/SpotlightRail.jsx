import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BadgePercent, CalendarDays, ChevronLeft, ChevronRight, Store, Users,
} from "lucide-react";
import { ownerLevel } from "@/lib/standing";
import { priceLabel } from "@/lib/categoryArt";
import { cn } from "@/lib/utils";

/**
 * SPOTLIGHT — the one promotional slot on Discover.
 *
 * It is populated from real records already on the page: a spotted public sale,
 * an upcoming round, a live offer, or a service provider with a traceable
 * record. Nothing is promoted because someone paid, and nothing is called
 * "verified" unless the standing ladder actually reached Level 3.
 *
 * Presentation is a shopfront top-pick: one large photograph, a dark caption
 * plate, arrows and dots. The reader gets one thing at a time instead of a row
 * of competing gradients.
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
      meta: `${sale.merchant_name || "Local shop"}${sale.town ? ` · ${sale.town}` : ""}${sale.discount_summary ? ` · ${sale.discount_summary}` : ""}`,
      image: sale.image || sale.product_image || null,
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
      meta: `${event.location || "Near you"}${event.price_kes != null ? ` · ${priceLabel(event.price_kes)}` : " · Free to join"}`,
      image: event.image || null,
      price: event.price_kes != null ? priceLabel(event.price_kes) : "Free to join",
      to: event.to || "/events",
      cta: event.kind === "scheduled" ? "See round" : "See event",
      note: event.reasons?.[0] || null,
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
      meta: `${offer.location || "Near you"}${offer.price_kes != null ? ` · ${priceLabel(offer.price_kes)}` : ""}`,
      image: offer.image || null,
      price: offer.price_kes != null ? priceLabel(offer.price_kes) : null,
      to: offer.to || "/discover?kind=listing",
      cta: "View offer",
      note: offer.reasons?.[0] || null,
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
      meta: `${provider.location || "Near you"}${provider.price_kes != null ? ` · from ${priceLabel(provider.price_kes)}` : ""}`,
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
      className="overflow-hidden rounded-3xl border border-mk-line bg-mk-card"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-mk-orange">Our top picks</p>
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

      <div className="relative mx-4 mt-3 aspect-[4/3] overflow-hidden rounded-2xl bg-mk-warm">
        {slide.image ? (
          <img src={slide.image} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className={cn("flex h-full w-full items-center justify-center bg-gradient-to-br", TONES[slide.tone] || TONES.forest)}>
            <Icon size={54} strokeWidth={1.2} className="text-white/80" aria-hidden="true" />
          </div>
        )}
        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-mk-card/95 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-mk-ink backdrop-blur">
          <Icon size={11} aria-hidden="true" /> {slide.badge}
        </span>
      </div>

      <div className="bg-mk-ink px-5 pb-5 pt-4 text-center text-mk-cream">
        <h2 className="line-clamp-2 text-lg font-black leading-tight">{slide.title}</h2>
        <p className="mt-1 line-clamp-2 text-xs text-mk-cream/70">{slide.meta}</p>

        {slides.length > 1 && (
          <div className="mt-3 flex items-center justify-center gap-1.5" aria-label="Choose top pick">
            {slides.map((s, index) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Top pick ${index + 1}: ${s.title}`}
                aria-pressed={index === active}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  index === active ? "w-5 bg-mk-cream" : "w-1.5 bg-mk-cream/35 hover:bg-mk-cream/60",
                )}
              />
            ))}
          </div>
        )}

        {slide.price && <p className="mt-2 text-2xl font-black tracking-tight">{slide.price}</p>}

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Link
            to={slide.to}
            className="inline-flex h-10 items-center gap-1 rounded-xl bg-mk-orange px-4 text-xs font-extrabold text-white transition-transform hover:-translate-y-0.5"
          >
            {slide.cta} <ArrowRight size={12} aria-hidden="true" />
          </Link>
          {slide.spot && onSpotSale && (
            <button
              type="button"
              onClick={onSpotSale}
              className="inline-flex h-10 items-center gap-1 rounded-xl border border-mk-cream/35 px-4 text-xs font-bold text-mk-cream hover:bg-white/10"
            >
              Spot a public sale
            </button>
          )}
        </div>
        {slide.note && <p className="mt-2 line-clamp-2 text-[10px] text-mk-cream/50">{slide.note}</p>}
      </div>
    </section>
  );
}
