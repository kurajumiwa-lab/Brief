import { Link } from "react-router-dom";
import { ArrowRight, Store } from "lucide-react";
import { BRAND } from "@/config/brand";

/**
 * YOUR BUSINESS — as a billboard.
 *
 * The upper band is a Nairobi-at-golden-hour digital billboard: copper light,
 * a lit screen, acacia silhouettes. It is art, not a photograph of this
 * business, so the overlay never pretends otherwise — the shop's own name and
 * handle sit *on* the billboard the way a real one carries a name, and the line
 * under it is the network's, not a claim about the trader.
 *
 * Under the art, the shelf is copper: an opaque surface, not a tint. Colour is
 * carried by a single gradient wash + noise so text contrast stays predictable;
 * nothing here depends on the photograph's brightness. Every piece of text
 * sits on `surface` at AA contrast against the copper, in both themes.
 *
 * The images are decorative and always optional: the component renders its
 * full colour and a legible card with no image at all (see `data-has-art`),
 * because a slow connection must not turn somebody's business into a grey box.
 */

const ART = {
  light: "/business-billboard-wide.jpg",
  dark: "/business-billboard-dark.jpg",
};

export default function BusinessBillboard({ vendor, headingId = "home-your-business-title", className }) {
  const name = vendor?.business_name || vendor?.display_name || "Your business";
  const handle = vendor?.vendor_handle ? `@${vendor.vendor_handle}` : null;
  const place = vendor?.physical_location || vendor?.city || null;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="home-your-business"
      className={className}
    >
      <div className="overflow-hidden rounded-2xl border border-[#8a4a22]/35 shadow-sm">
        {/* ── the billboard itself ─────────────────────────────────────── */}
        <div className="relative isolate min-h-[148px] overflow-hidden bg-[#2b1508]">
          {/* The art. Two files so dark mode gets the night billboard rather
              than a dimmed daylight one — a photo that has simply been made
              darker looks like a bug, not a theme. */}
          <picture>
            <source media="(prefers-color-scheme: dark)" srcSet={ART.dark} />
            <img
              src={ART.light}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover object-right"
            />
          </picture>

          {/* Legibility wash: copper, not black, so the art keeps its warmth
              under the text instead of being greyed out. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[linear-gradient(100deg,rgba(43,21,8,0.94)_0%,rgba(93,46,18,0.86)_38%,rgba(140,72,28,0.34)_62%,rgba(140,72,28,0.06)_100%)]"
          />
          {/* A hairline of light along the top edge: the billboard's own glow. */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,196,138,0.65),transparent)]"
          />

          <div className="relative flex min-h-[148px] flex-col justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-micro font-bold uppercase tracking-[0.16em] text-[#f3c9a4]">
                Your business
              </p>
              <h2
                id={headingId}
                className="mt-1 text-lg font-extrabold leading-tight tracking-tight text-white sm:text-xl"
              >
                {name}
              </h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs font-medium text-[#f6ddc6]">
                {handle && <span className="font-mono">{handle}</span>}
                {place && <span className="opacity-80">{place}</span>}
                {!handle && !place && <span className="opacity-80">A shelf on {BRAND.name}</span>}
              </p>
            </div>

            <Link
              to="/me"
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-2.5 py-1.5 text-micro font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <Store size={12} aria-hidden="true" />
              Open your shelf
              <ArrowRight size={11} aria-hidden="true" />
            </Link>
          </div>
        </div>

        {/* ── the copper shelf under it ────────────────────────────────── */}
        <div className="relative isolate overflow-hidden bg-[#8a4a22] dark:bg-[#532a13]">
          {/* Opaque copper, textured rather than flat: a warm vertical wash and
              a faint woven grain, both pure CSS so they cost nothing. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[linear-gradient(180deg,rgba(196,104,48,0.92)_0%,rgba(138,74,34,0.96)_55%,rgba(96,49,22,0.98)_100%)]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.16] mix-blend-overlay"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(255,255,255,0.9) 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.9) 0 1px, transparent 1px 4px)",
            }}
          />

          <div className="relative flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <p className="text-micro font-semibold text-[#fdf0e2]">
              {vendor?.stock_count
                ? `${vendor.stock_count} on the shelf`
                : "Your shelf, on the network"}
            </p>
            <Link
              to="/stock"
              className="inline-flex items-center gap-1 text-micro font-bold text-white underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              Manage stock
              <ArrowRight size={11} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
