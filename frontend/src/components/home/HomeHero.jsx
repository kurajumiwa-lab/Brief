import { Link } from "react-router-dom";
import {
  ArrowRight, Building2, Cpu, Factory, Package, Search, Truck, Wrench,
} from "lucide-react";
import MarketSearch from "@/components/home/MarketSearch";
import { useAuthStore } from "@/stores/authStore";
import { BRAND } from "@/config/brand";
import { cn } from "@/lib/utils";

/**
 * THE HOME HERO — the connection layer, stated in one screenful.
 * ---------------------------------------------------------------------------
 * v3.2's hero sold a market: a photograph of produce under a green scrim, and a
 * headline that changed with the vendor's trading mode ("Find the stock your
 * business needs" / "Put your stock in front of the network"). Both said the
 * same thing twice — that this is a place where buyers and sellers meet — and
 * they made the product look like an agricultural directory.
 *
 * v2.18 (direction C) changes what the first screen claims:
 *
 *   · **The photograph is infrastructure, not produce.** Electricians,
 *     fabricators, workshops, a stocked warehouse. A market garden is a
 *     business *on* this network, not a picture of it.
 *   · **One headline for everybody.** "The businesses around you. Connected."
 *     does not ask which side of a trade you are on, because on this network a
 *     school is a buyer of electricians and a seller of nothing, a household is
 *     both, and an artisan is a supplier with clients. A mode-dependent
 *     headline is a mode-dependent product.
 *   · **The overlay is heavy (≈82%).** The photograph sets a place; the words
 *     carry the meaning. A half-lit scrim makes white type fight a bright wall.
 *   · **Search stays white.** It is the one control that must look pressable.
 *   · **The category tiles are doors**, and every one of them lands on a
 *     screen that exists (`/browse?type=…`, `/network`, `/tools`).
 *   · **The ask is at the bottom of the card**, in the second voice (#19A783),
 *     because "have a business or skill?" is a different sentence from "find
 *     something" and should not compete with the search for the same attention.
 *
 * Nothing here is a statistic. The footer line — "An existing economy. A
 * connected future." — is the position, not a claim about size.
 */

const DOORS = [
  { to: "/browse?type=services", label: "Technology", icon: Cpu },
  { to: "/browse?type=goods", label: "Manufacturing", icon: Factory },
  { to: "/browse?type=people", label: "Skilled trades", icon: Wrench },
  { to: "/browse?type=equipment", label: "Products", icon: Package },
  { to: "/network", label: "Enterprises", icon: Building2 },
  { to: "/tools", label: "Logistics", icon: Truck },
];

export default function HomeHero({ className }) {
  const vendor = useAuthStore((s) => s.vendor);
  // Home is behind the auth gate, so everyone who reaches it is a vendor. The
  // ask still differs: someone with a shop front is being invited to *complete*
  // it, not to create one. (A record with no handle is a data problem, not a
  // signup: it goes to the profile, never to /auth.)
  const hasFront = Boolean(vendor?.vendor_handle);
  const askHref = hasFront ? `/@${vendor.vendor_handle}?edit=1` : "/me";

  return (
    <section
      aria-label={`${BRAND.name} trade network`}
      data-testid="home-hero"
      className={cn(
        "relative isolate overflow-hidden rounded-[1.5rem] bg-brand-600 shadow-lg sm:rounded-[1.75rem]",
        className
      )}
    >
      {/* The place: a workshop floor, not a market stall. The scrim is a flat
          82% so the type is predictable whatever the photograph does — a
          directional gradient meant the headline's contrast depended on which
          part of the picture happened to sit behind it. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-brand-700"
        style={{
          backgroundImage: "url('/trade-hero.jpg'), url('/ogallo-market-hero.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center 42%",
        }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "linear-gradient(178deg, rgb(8 35 30 / .86) 0%, rgb(16 60 53 / .82) 55%, rgb(9 42 36 / .88) 100%)",
        }}
      />

      <div className="px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5 lg:px-8 lg:pb-7 lg:pt-6">
        {/* ── who this is ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-brand-600"
            >
              <NetworkMark />
            </span>
            <span className="truncate text-xs font-extrabold tracking-tight text-white sm:text-sm">
              {BRAND.name}
            </span>
          </div>
          <span className="shrink-0 rounded-full border border-tech-300/40 bg-tech-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-tech-200">
            Trade network
          </span>
        </div>

        {/* ── the sentence ────────────────────────────────────────────────── */}
        <h1 className="mt-5 max-w-[22ch] text-[1.7rem] font-extrabold leading-[1.1] tracking-[-0.025em] text-white text-balance sm:max-w-[26ch] sm:text-[2.15rem] lg:text-[2.4rem]">
          The businesses around you. Connected.
        </h1>
        <p className="mt-2 max-w-[48ch] text-2xs leading-relaxed text-[#C8DED6] sm:text-xs">
          Discover suppliers, skilled professionals, products and enterprises. Build your own
          business presence and connect with clients.
        </p>

        {/* ── the one control ─────────────────────────────────────────────── */}
        <div className="mt-4 sm:mt-5">
          <MarketSearch />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-micro text-[#9FBDB2]">Suppliers, services, people, markets.</p>
          <Link
            to="/explore"
            className="inline-flex shrink-0 items-center gap-1 rounded text-micro font-bold text-white underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            Browse everything
            <ArrowRight size={11} aria-hidden="true" />
          </Link>
        </div>

        {/* ── the doors ───────────────────────────────────────────────────── */}
        <p className="mt-5 text-[9px] font-bold uppercase tracking-[0.16em] text-[#9FBDB2]">
          Explore the network
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {DOORS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className={cn(
                  "flex items-center gap-2 rounded-xl bg-[#205448] px-2.5 py-2 transition-colors",
                  "hover:bg-[#276556] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                )}
              >
                <Icon size={15} className="shrink-0 text-[#B5E9D5]" aria-hidden="true" />
                <span className="truncate text-micro font-semibold text-white">{label}</span>
              </Link>
            </li>
          ))}
        </ul>

        {/* ── the ask ─────────────────────────────────────────────────────── */}
        <Link
          to={askHref}
          className={cn(
            "mt-3 flex items-center justify-between gap-3 rounded-xl bg-tech-500 px-3 py-2.5",
            "transition-colors hover:bg-tech-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          )}
        >
          <span className="min-w-0">
            <span className="block text-xs font-bold text-white">
              {hasFront ? "Your vendor front is your shop" : "Have a business or skill?"}
            </span>
            <span className="mt-0.5 block text-micro leading-snug text-white/90">
              {hasFront
                ? "Photos, categories and a sentence about what you do — the three things a buyer checks."
                : "Create your digital vendor identity and connect with clients."}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-micro font-bold text-white">
            <Search size={12} aria-hidden="true" />
            {hasFront ? "Open it" : "Create one"}
            <ArrowRight size={12} aria-hidden="true" />
          </span>
        </Link>

        <p className="mt-3 text-[10px] text-[#9FBDB2]">An existing economy. A connected future.</p>
      </div>
    </section>
  );
}

/** The mark: three nodes and the lines between them. */
function NetworkMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="5" r="2.4" fill="currentColor" />
      <circle cx="5" cy="18" r="2.4" fill="currentColor" />
      <circle cx="19" cy="18" r="2.4" fill="currentColor" />
      <path
        d="M11 7.2 6 15.8M13 7.2l5 8.6M7.4 18h9.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity=".55"
      />
    </svg>
  );
}
