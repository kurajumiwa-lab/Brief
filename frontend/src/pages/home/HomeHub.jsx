import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import SetupChecklist from "@/components/onboarding/SetupChecklist";
import SourceDialog from "@/components/stock/SourceDialog";
import HomeHero from "@/components/home/HomeHero";
import TradeOverviewShelf from "@/components/home/TradeOverviewShelf";
import HomeFeed from "@/components/home/HomeFeed";
import CommunityStrip from "@/components/home/CommunityStrip";
import { useTradeOverviewStore } from "@/stores/tradeOverviewStore";

/**
 * HOME — the trade network, shown rather than described (v3.3).
 *
 * The hierarchy, and the order it is read in:
 *
 *   1  **identity and search** — the market hero: who you are, one field that
 *      finds goods, suppliers, people, markets and rentals, and the suggestions
 *      that make the field obvious. This is the only place Home raises its voice.
 *   2  **the setup card**, for the vendors who still have a first trade to run.
 *      Once it is done it renders nothing at all — the business numbers have
 *      their own band further down.
 *   3  **the marketplace** — discovery doors, then shelves of real records from
 *      other vendors, then your business band, then the wider network.
 *
 * What changed in v3.3:
 *   · Trade overview is now a compact shelf instead of oversized cards
 *   · Business pulse simplified to focus on growth, metrics moved to dedicated screens
 *   · Reduced vertical space substantially without removing functionality
 *
 * What stays exactly where it was: the header and its own search (owned by the
 * app shell), the first-run checklist, the sourcing dialog, the bottom
 * navigation and every route anything links to.
 */
export default function HomeHub() {
  const navigate = useNavigate();
  const [sourcing, setSourcing] = useState(null);

  // A connection that comes back should heal the overview without the reader
  // hunting for the retry link.
  useEffect(() => {
    const onOnline = () => {
      const state = useTradeOverviewStore.getState();
      if (state.status === "error" && state.retryable) state.retry();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return (
    <div className="space-y-5 sm:space-y-6">
      <HomeHero />

      {/* The way into the community: static by design, so it cannot be the
          reason Home has a hole in it. */}
      <CommunityStrip />

      {/* New vendors get four steps; established traders get nothing here. */}
      <SetupChecklist />

      {/* Compact trade overview - replaces oversized cards (v3.3) */}
      <TradeOverviewShelf />

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
