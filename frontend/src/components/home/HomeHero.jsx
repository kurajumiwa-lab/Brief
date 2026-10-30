import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, ChevronDown, MapPin } from "lucide-react";
import MarketSearch from "@/components/home/MarketSearch";
import { VENDOR_ROLES } from "@/config/constants";
import { useAuthStore } from "@/stores/authStore";
import { initials } from "@/lib/utils";
import { BRAND } from "@/config/brand";

/**
 * THE HOME HERO — identity, then the one thing you do here.
 *
 * v3.2 rebuilt the top of Home around a single decision: the market search is
 * the hero, so it is the only control in the first screenful and everything
 * around it is quiet.
 *
 *   · **Identity leads.** The vendor's own name, verification, handle and
 *     location — facts the session already holds, so the hero paints instantly
 *     and never waits on a request. The operating mode sits opposite it as one
 *     status word, not a second badge rail.
 *   · **One sentence of voice**, by mode, from the copy that was already here —
 *     plus the line that says what to do next. No invented statistics, no
 *     "market rates", nothing that is not either the vendor's own record or a
 *     link into a screen that exists.
 *   · **The search is a designed interaction, not a field with chips stuck
 *     under it.** Field and suggestion row live in one white card on the
 *     photograph: type, or take a suggestion, or open Browse — one surface.
 *   · **The photograph stays**, deepened by a single directional scrim so the
 *     produce reads as an image and the white type stays legible in daylight.
 *
 * Everything the old banner linked to still exists: `Browse everything` and
 * every suggestion chip go into the existing Browse query.
 */

const MODES = {
  sourcing: {
    headline: "Find the stock your business needs.",
    line: "Search the network, compare what vendors state, and source it.",
  },
  selling: {
    headline: "Put your stock in front of the network.",
    line: "Publish your shelf and let other businesses find you.",
  },
  both: {
    headline: "A good market runs both ways.",
    line: "Source what you need, and put your own shelf in front of buyers.",
  },
  dormant: {
    headline: "Your network is ready when you are.",
    line: "Set your categories and location to start matching with the network.",
  },
};

export default function HomeHero({ className }) {
  const vendor = useAuthStore((s) => s.vendor);
  const role =
    VENDOR_ROLES.find((item) => item.value === vendor?.current_role) ||
    VENDOR_ROLES.find((item) => item.value === "both");
  const mode = MODES[role.value] || MODES.both;

  const name = vendor?.business_name || "Your business";
  // Where the business trades — the vendor's own `physical_location`, falling
  // back to the first category they declared, and to nothing at all if they
  // have stated neither. Never a guess, never a blank dash in the hero.
  const categories = Array.isArray(vendor?.business_categories) ? vendor.business_categories : [];
  const where = vendor?.physical_location || categories[0] || null;

  return (
    <section
      aria-label={`${BRAND.name} trading network`}
      data-testid="home-hero"
      className={`relative isolate overflow-hidden rounded-[1.5rem] shadow-lg sm:rounded-[1.75rem] ${className || ""}`}
    >
      {/* the market, and one scrim that keeps the produce visible while the
          type stays legible — the photograph is the product, not wallpaper */}
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-ink-1"
        style={{
          backgroundImage: "url('/ogallo-market-hero.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center 58%",
        }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "linear-gradient(103deg, rgb(5 29 18 / .95) 0%, rgb(6 33 22 / .89) 40%, rgb(8 38 25 / .70) 68%, rgb(8 31 23 / .52) 100%)",
        }}
      />

      <div className="px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5 lg:px-8 lg:pb-7 lg:pt-6">
        {/* ── who is trading, and how ───────────────────────────────────────
            Two lines, and nothing that fights for the same pixels: the business
            name (one line, ellipsised) with its verification mark, then the ONE
            fact a trade network filters by — where this business trades from,
            falling back to what it trades in when the vendor has not stated a
            place. The operating mode sits opposite as a single status word.

            The handle deliberately left this block: it is the account's own
            identity and it is already on the profile, in the account menu and on
            the shop front. Spending a wrapped line on it in the hero was the
            thing making the top of Home read as clutter. */}
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/12 text-2xs font-bold uppercase text-white ring-1 ring-white/25"
          >
            {initials(name)}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-bold text-white sm:text-sm">{name}</span>
              {vendor?.is_verified && (
                <BadgeCheck size={14} className="shrink-0 text-brand-300" aria-label="Verified business" />
              )}
            </div>
            {where && (
              <Link
                to="/me"
                className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-white/20 bg-white/10 py-0.5 pl-1.5 pr-2 text-micro font-semibold text-white/85 backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              >
                <MapPin size={10} className="shrink-0" aria-hidden="true" />
                <span className="truncate">{where}</span>
                <ChevronDown size={10} className="shrink-0 opacity-70" aria-hidden="true" />
              </Link>
            )}
          </div>

          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-micro font-bold uppercase tracking-[0.1em] text-white/90">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-300 animate-dot-pulse" aria-hidden="true" />
            {role.label}
          </span>
        </div>

        {/* ── the one sentence, and the next step ─────────────────────────── */}
        <h1 className="mt-4 max-w-[26ch] text-[1.6rem] font-extrabold leading-[1.14] tracking-[-0.02em] text-white text-balance sm:text-[2rem] lg:text-[2.15rem]">
          {mode.headline}
        </h1>
        <p className="mt-1.5 max-w-[46ch] text-2xs leading-relaxed text-white/70 sm:text-xs">{mode.line}</p>

        {/* ── the search: one compact field, and nothing invented under it ──
            The old version was a tall card holding a 52px field plus a permanent
            row of chips ("tomatoes, sukuma wiki, …") that was the same five words
            for every business on the network. The field is now 40px, sits on the
            photograph itself, and the suggestions under it are real ones from the
            guide — or the vendor's own categories, or nothing at all. */}
        <div className="mt-4 sm:mt-5">
          <MarketSearch />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-micro text-white/55">Stock, suppliers, people, markets and rentals.</p>
          <Link
            to="/browse"
            className="inline-flex shrink-0 items-center gap-1 text-micro font-bold text-white/85 underline-offset-2 hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            Browse everything
            <ArrowRight size={11} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
