import { Link } from "react-router-dom";
import { ArrowRight, BadgePercent, CalendarDays, Store, Users } from "lucide-react";
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
  return (
    <section aria-label="Spotlight" data-testid="discover-spotlight">
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {slides.map((slide) => {
          const Icon = slide.Icon;
          return (
            <article
              key={slide.key}
              className={cn(
                "relative min-w-[86%] snap-start overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white shadow-sm sm:min-w-[48%]",
                TONES[slide.tone] || TONES.forest,
              )}
            >
              <span className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10" aria-hidden="true" />
              <span className="absolute -bottom-12 right-8 h-24 w-24 rounded-full bg-white/5" aria-hidden="true" />
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-micro font-bold uppercase tracking-[0.08em]">
                <Icon size={11} aria-hidden="true" /> {slide.badge}
              </span>
              <h2 className="mt-2 line-clamp-2 text-lg font-extrabold leading-tight">{slide.title}</h2>
              <p className="mt-1 line-clamp-2 text-xs text-white/80">{slide.meta}</p>
              <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2">
                <Link to={slide.to} className="inline-flex h-9 items-center gap-1 rounded-lg bg-white px-3 text-micro font-extrabold text-brand-800 hover:bg-white/90">
                  {slide.cta} <ArrowRight size={11} aria-hidden="true" />
                </Link>
                {slide.spot && onSpotSale && (
                  <button type="button" onClick={onSpotSale} className="inline-flex h-9 items-center gap-1 rounded-lg border border-white/40 px-3 text-micro font-bold text-white hover:bg-white/10">
                    Spot a public sale
                  </button>
                )}
              </div>
              {slide.note && <p className="mt-2 line-clamp-2 text-[10px] text-white/65">{slide.note}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
