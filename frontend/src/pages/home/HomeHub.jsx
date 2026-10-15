import { useState } from "react";
import { useNavigate } from "react-router-dom";
import SetupChecklist from "@/components/onboarding/SetupChecklist";
import SourceDialog from "@/components/stock/SourceDialog";
import HomeHero from "@/components/home/HomeHero";
import HomeFeed from "@/components/home/HomeFeed";

/**
 * HOME — the trade network, shown rather than described.
 *
 * The hierarchy, and the order it is read in (v3.1 discovered it, v3.2 made the
 * type and spacing say it out loud):
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
 * What stays exactly where it was: the header and its own search (owned by the
 * app shell), the first-run checklist, the sourcing dialog, the bottom
 * navigation and every route anything links to.
 *
 * What moved, deliberately, in v3.2:
 *   · the four business metrics         → the "your business" band, beside My
 *                                         Shop, instead of above the market
 *   · the search suggestions            → inside the search card, as one
 *                                         designed interaction rather than
 *                                         chips loose on a photograph
 *   · the "network is quiet" message    → a designed panel with real doors
 */
export default function HomeHub() {
  const navigate = useNavigate();
  const [sourcing, setSourcing] = useState(null);

  return (
    <div className="space-y-6 sm:space-y-7">
      <HomeHero />

      {/* New vendors get four steps; established traders get nothing here. */}
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
