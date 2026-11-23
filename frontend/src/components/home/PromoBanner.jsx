import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import Media from "@/components/ui/Media";
import { photoUrl } from "@/lib/photos";

/**
 * THE PROMO BANNER — the brief's step 4, and its one sanctioned use of colour.
 *
 * The brief says gradients and dark panels are for "promotional banners and
 * special features" only. So this is the single loud element on Home: a teal
 * plate with a photograph, a short line, and one action. Everything around it
 * stays white and quiet, which is what makes it read as a promotion rather than
 * as wallpaper.
 *
 * The copy is short because the brief asks for short copy, and the claim is
 * deliberately small — it describes what Brief does, not a discount Brief is
 * inventing. Nothing here advertises a price that does not exist.
 */
const PLATES = {
  street: {
    subject: "banner-street",
    eyebrow: "Live Street",
    title: "See what is selling near you today",
    body: "Real shops, real stock, from people one street over.",
    cta: "Open Live Street",
    to: "/street",
  },
  produce: {
    subject: "banner-produce",
    eyebrow: "Fair corridor price",
    title: "Know the going rate before you bargain",
    body: "Median prices from your own corridor, shown on every stall.",
    cta: "Browse goods",
    to: "/discover?kind=listing",
  },
  community: {
    subject: "banner-community",
    eyebrow: "Town network",
    title: "Rounds, chamas and meetups this week",
    body: "Join a group that is already organising near you.",
    cta: "Find an event",
    to: "/discover?kind=event",
  },
};

export default function PromoBanner({ plate = "street", className = "" }) {
  const config = PLATES[plate] || PLATES.street;
  const image = photoUrl(config.subject);

  return (
    <section aria-labelledby={`promo-${plate}-title`} className={className}>
      <Link
        to={config.to}
        className="group relative block overflow-hidden rounded-2xl bg-brand-700 shadow-sm"
      >
        {/* The photograph is the right-hand third on wide screens and a dimmed
            backdrop on narrow ones, so the text never sits on a busy detail. */}
        <Media
          src={image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-45 transition-transform duration-3 group-hover:scale-[1.03] sm:opacity-100 sm:[clip-path:polygon(38%_0,100%_0,100%_100%,24%_100%)]"
          fallback={<span className="absolute inset-0 bg-gradient-to-br from-brand-600 to-brand-800" aria-hidden="true" />}
        />
        <span
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-800 via-brand-800/92 to-brand-700/45 sm:via-brand-800/80"
          aria-hidden="true"
        />

        <div className="relative max-w-[78%] p-4 sm:max-w-[62%] sm:p-5">
          <span className="inline-flex items-center rounded-full bg-amber-400 px-2 py-0.5 text-2xs font-extrabold uppercase tracking-[0.07em] text-brand-900">
            {config.eyebrow}
          </span>
          <h2
            id={`promo-${plate}-title`}
            className="mt-2 text-card-title font-extrabold leading-snug text-white"
          >
            {config.title}
          </h2>
          <p className="mt-1 text-xs font-medium leading-relaxed text-white/85">{config.body}</p>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-extrabold text-amber-300">
            {config.cta}
            <ArrowRight size={13} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Link>
    </section>
  );
}
