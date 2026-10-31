import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import SetupChecklist from "@/components/onboarding/SetupChecklist";
import SourceDialog from "@/components/stock/SourceDialog";
import HomeHero from "@/components/home/HomeHero";
import TradeOverviewShelf from "@/components/home/TradeOverviewShelf";
import HomeFeed from "@/components/home/HomeFeed";
import CommunityStrip from "@/components/home/CommunityStrip";
import HomeTrustStrip from "@/components/home/HomeTrustStrip";
import TradeNetworkPanel from "@/components/home/TradeNetworkPanel";
import ParticipantBand from "@/components/home/ParticipantBand";
import FoundationStrip from "@/components/home/FoundationStrip";
import MarketsAround from "@/components/markets/MarketsAround";
import { useTradeOverviewStore } from "@/stores/tradeOverviewStore";

/**
 * HOME — the trade network, shown rather than described (v3.3).
 *
 * The hierarchy, and the order it is read in:
 *
 *   1  **identity and search** — the market hero: who you are, one field that
 *      finds goods, suppliers, people, markets and rentals, and the suggestions
 *      that make the field obvious. This is the only place Home raises its voice.
 *   2  **the setup card** — the hard-coded vital-information task. It is not
 *      optional and it is not dismissible until the shop has a photo, a face, a
 *      sentence and a category. Once it is done it renders nothing at all.
 *   3  **the categories** — five doors with descriptions, replacing the shelf
 *      strip whose first three tiles read "Online services · Farms · Your
 *      category".
 *   4  **the architecture, in order** — the guarantees, the participants, the
 *      four systems, then the live marketplace itself.
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
      {/* ── the connection layer, stated once ──────────────────────────────
          Identity, one search, the doors, and the ask. The photograph is a
          workshop floor rather than a market stall, because this is
          infrastructure for trade, not a market garden. */}
      <HomeHero />

      {/* The hard-coded vital-information task. It is second on the page on
          purpose: a vendor who has not yet put a photo, a face, a sentence and a
          category on their shop needs to be told that before they are shown
          anything else. It renders nothing at all once those are done. */}
      <SetupChecklist />

      {/* The five categories, as doors with descriptions — the replacement for
          the "Online services · Farms · Your category" shelf. */}
      <TradeNetworkPanel />

      {/* Four guarantees, each already true of the product. */}
      <HomeTrustStrip />

      {/* Who is on the network, and the fact that everyone trades both ways. */}
      <ParticipantBand />

      {/* The four systems underneath, each pointing at the screen it lives on. */}
      <FoundationStrip />

      {/* The way into the community: static by design, so it cannot be the
          reason Home has a hole in it. */}
      <CommunityStrip />

      {/* Markets around you — loaded by itself, at a walking radius, busiest
          first. This replaces "press Scan and pick a radius starting at 150 km". */}
      <MarketsAround limit={3} />

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
