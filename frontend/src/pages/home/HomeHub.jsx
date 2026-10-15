import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import GlobalSearch from "@/components/layout/GlobalSearch";
import Badge from "@/components/ui/Badge";
import SetupChecklist from "@/components/onboarding/SetupChecklist";
import SourceDialog from "@/components/stock/SourceDialog";
import HomeFeed from "@/components/home/HomeFeed";
import { VENDOR_ROLES } from "@/config/constants";
import { useAuthStore } from "@/stores/authStore";

/**
 * HOME — the trade network, shown rather than described.
 *
 * v3.1 restructured Home around discovery. It used to open with the vendor's
 * own shelf: published listings first, other people's stock below them. That is
 * backwards for a marketplace. The feed now leads with real inventory from
 * other vendors — goods, services, people, equipment, work, events,
 * communities, markets — each in its own shelf, and it ends with the vendor's
 * own shop folded shut, one tap from the management screen where that work
 * actually belongs.
 *
 * What stays exactly where it was: the header and its search (owned by the
 * app shell), the global search field, the first-run checklist, the sourcing
 * dialog, the bottom navigation and every route anything links to.
 *
 * What moved off Home, deliberately:
 *   · the vendor's listing cards          → My Shop, expanded on demand
 *   · "Needs your action" rows            → one line, pointing at /orders
 *   · "Recent trade activity"             → Work, which owns order history
 *   · "Browse by category" rail           → the discovery shortcuts, which are
 *                                            links into Browse's own views
 * Nothing was removed from the product; it was moved to the screen that owns it.
 */
export default function HomeHub() {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const [sourcing, setSourcing] = useState(null);

  const firstName = (vendor?.business_name || "").split(" ")[0];
  const role =
    VENDOR_ROLES.find((item) => item.value === vendor?.current_role) || VENDOR_ROLES.find((item) => item.value === "both");

  const headline = {
    sourcing: "Find the stock your business needs.",
    selling: "Put your stock in front of the network.",
    both: "A good market runs both ways.",
    dormant: "Your network is ready when you are.",
  }[role.value];

  return (
    <div className="space-y-8 sm:space-y-9">
      {/* ── the header: who you are, and the one search ─────────────────── */}
      <section
        aria-label="Ogallo trading network"
        className="relative isolate overflow-hidden rounded-[1.75rem] border border-edge-1 bg-ink-1 text-white shadow-md sm:rounded-[2rem]"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgb(8 31 23 / .93) 0%, rgb(8 31 23 / .82) 42%, rgb(8 31 23 / .38) 76%, rgb(8 31 23 / .18) 100%), url('/ogallo-market-hero.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center 56%",
        }}
      >
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-brand-950/20 via-transparent to-orchid-900/15" aria-hidden="true" />
        <div className="max-w-3xl px-5 py-6 sm:px-8 sm:py-7 lg:px-11 lg:py-9">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-brand-900 px-3 py-1 text-micro font-bold uppercase tracking-[0.12em] text-white">
              <Sparkles size={12} aria-hidden="true" /> Ogallo · the trade network
            </span>
            <Badge variant="purple" size="sm" className="!border !border-white/20 !bg-white/15 !text-white">
              {role.emoji} Currently {role.label.toLowerCase()}
            </Badge>
          </div>

          <p className="mt-5 text-xs font-semibold text-brand-100 dark:text-brand-300 sm:text-sm">
            {firstName ? `Welcome back, ${firstName}` : "Welcome to your trading network"}
          </p>
          <h1 className="mt-1.5 max-w-2xl text-2xl font-extrabold leading-tight tracking-tight text-balance text-white sm:text-3xl lg:text-[2.15rem]">
            {headline}
          </h1>

          <GlobalSearch className="mt-5 max-w-2xl" size="lg" />

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-micro font-bold uppercase tracking-[0.1em] text-white/65">Try</span>
            {["tomatoes", "sukuma wiki", "cooking oil", "kitenge", "rice"].map((term) => (
              <Link
                key={term}
                to={`/browse?search=${encodeURIComponent(term)}`}
                className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-2xs font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-white"
              >
                {term}
              </Link>
            ))}
            <Link
              to="/browse"
              className="ml-auto inline-flex items-center gap-1 text-2xs font-bold text-white/90 hover:text-white"
            >
              Browse everything <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* New vendors get four steps; established traders get a live pulse. */}
      <SetupChecklist />

      {/* ── the marketplace itself ─────────────────────────────────────── */}
      <HomeFeed onSource={setSourcing} />

      <SourceDialog
        item={sourcing}
        open={!!sourcing}
        onClose={() => setSourcing(null)}
        onDone={() => navigate("/orders")}
      />
    </div>
  );
}
