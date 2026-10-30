import { useEffect, useState, lazy, Fragment } from "react";
import { Routes, Route, Navigate, useLocation, useSearchParams } from "react-router-dom";
import Shell from "@/components/layout/Shell";
import { PageSpinner } from "@/components/ui/Spinner";
import BootSplash from "@/components/system/BootSplash";
import Button from "@/components/ui/Button";
import AuthPage from "@/pages/auth/AuthPage";
import HomeHub from "@/pages/home/HomeHub";
import NearbyPage from "@/pages/nearby/NearbyPage";
import PlaceProfile from "@/pages/nearby/PlaceProfile";
import MarketDetail from "@/pages/markets/MarketDetail";
import TaskTrack from "@/pages/tasks/TaskTrack";
import BusinessDeskPage from "@/pages/storefront/BusinessDeskPage";
import CreatePage from "@/pages/create/CreatePage";
import MorningBriefPage from "@/pages/brief/MorningBriefPage";
import LegalPage from "@/pages/legal/LegalPage";
import SubscriptionPage from "@/pages/billing/SubscriptionPage";
import ReceiptsPage from "@/pages/payments/ReceiptsPage";
import { useAuthStore } from "@/stores/authStore";

// Every page is lazy. The home screen downloads only what it renders —
// Leaflet (map), chat, analytics, ops and the rest split into chunks fetched
// on first navigation.
const BrowsePage = lazy(() => import("@/pages/browse/BrowsePage"));
// Outside (v4) destinations. Explore and Activity are lazy like everything
// else. Create is the one exception and it is deliberate: it is the middle tab
// on every screen, and the app's primary action should not show a spinner.
// Measured cost of keeping it in the main chunk: 14.3 kB raw / 3.9 kB gzip
// (`npm run build`, index 327.90 kB vs 313.56 kB lazy). If first paint ever
// needs those kilobytes back, making it lazy is a one-line change and the
// Suspense fallback in Shell already handles it.
const ExplorePage = lazy(() => import("@/pages/explore/ExplorePage"));
const CommunityPage = lazy(() => import("@/pages/community/CommunityPage"));
const ParksPage = lazy(() =>
  import("@/pages/parks/ParksPage").then((m) => ({ default: m.ParksPage }))
);
const ParkDetailPage = lazy(() =>
  import("@/pages/parks/ParksPage").then((m) => ({ default: m.ParkDetailPage }))
);
const ActivityPage = lazy(() => import("@/pages/activity/ActivityPage"));
const ActivityDetailPage = lazy(() => import("@/pages/activities/ActivityDetailPage"));
const ListingPage = lazy(() => import("@/pages/listing/ListingPage"));
const OrdersPage = lazy(() => import("@/pages/orders/OrdersPage"));
const RepeatOrderPage = lazy(() => import("@/pages/orders/RepeatOrderPage"));
const TradeRecordsPage = lazy(() => import("@/pages/orders/TradeRecordsPage"));
const OrderDetailPage = lazy(() => import("@/pages/orders/OrderDetailPage"));
const WorkPage = lazy(() => import("@/pages/work/WorkPage"));
const SurfaceFeed = lazy(() => import("@/pages/surface/SurfaceFeed"));
const SearchHub = lazy(() => import("@/pages/search/SearchHub"));
const MapPage = lazy(() => import("@/pages/map/MapPage"));
const News = lazy(() => import("@/pages/news/News"));
const TasksPortal = lazy(() => import("@/pages/tasks/TasksPortal"));
const MarketsPage = lazy(() => import("@/pages/markets/MarketsPage"));
const MePage = lazy(() => import("@/pages/me/MePage"));
const PassportPage = lazy(() => import("@/pages/standing/PassportPage"));
const GrowthPlannerPage = lazy(() => import("@/pages/growth/GrowthPlannerPage"));
const EnterprisePage = lazy(() => import("@/pages/enterprise/EnterprisePage"));
const StockRoom = lazy(() => import("@/pages/stock/StockRoom"));
const Network = lazy(() => import("@/pages/network/Network"));
const VendorLists = lazy(() => import("@/pages/lists/VendorLists"));
const Groups = lazy(() => import("@/pages/groups/Groups"));
const ChatPage = lazy(() => import("@/pages/chat/ChatPage"));
const MarketLocks = lazy(() => import("@/pages/locks/MarketLocks"));
const OurNetwork = lazy(() => import("@/pages/governance/OurNetwork"));
const ToolsPage = lazy(() => import("@/pages/tools/ToolsPage"));
const EventsPage = lazy(() => import("@/pages/events/EventsPage"));
const POSBridge = lazy(() => import("@/pages/pos/POSBridge"));
const Analytics = lazy(() => import("@/pages/analytics/Analytics"));
const Ops = lazy(() => import("@/pages/ops/Ops"));
const VendorProfile = lazy(() => import("@/pages/vendor/VendorProfile"));
// Operator-only: kept out of the bundle a customer downloads.
const EnquiryInboxPage = lazy(() => import("@/pages/storefront/EnquiryInboxPage"));

/** Signed in, but the profile call failed. Saying so — with the server's own
    words — beats the old silent bounce to /auth, which was indistinguishable
    from a wrong password and sent people round the login loop. */
function SessionProblem() {
  const authError = useAuthStore((s) => s.authError);
  const fetchVendor = useAuthStore((s) => s.fetchVendor);
  const logout = useAuthStore((s) => s.logout);
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-surface-0">
      <div className="w-full max-w-md rounded-3xl border border-edge-1 bg-surface-0 shadow-sm p-6 space-y-4 animate-fade-in">
        <h1 className="text-lg font-extrabold tracking-tight text-ink-1">Almost in</h1>
        <p className="text-sm text-ink-3 leading-relaxed">{authError}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => fetchVendor()}>Try again</Button>
          <Button variant="ghost" onClick={logout}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}

/** Gate: no token → /auth (remembering where to return); token but vendor not
    loaded yet → spinner; token but the profile call failed → the reason. */
function RequireVendor({ children }) {
  const { token, vendor, ready, authError } = useAuthStore();
  const location = useLocation();
  if (!token) return <Navigate to="/auth" replace state={{ from: location.pathname + location.search }} />;
  if (!ready) return <PageSpinner label="Entering the network…" />;
  if (!vendor) return authError ? <SessionProblem /> : <Navigate to="/auth" replace />;
  return children;
}

/**
 * v3 promoted two tabs of the Stock Room into destinations of their own
 * (/browse and /orders). Every v2 URL still resolves — a link in someone's
 * WhatsApp thread from last month must still land on the right screen.
 */
function StockRoomRouter() {
  const [params] = useSearchParams();
  const tab = params.get("tab");
  if (tab === "network") {
    const next = new URLSearchParams(params);
    next.delete("tab");
    return <Navigate to={`/browse${next.toString() ? `?${next}` : ""}`} replace />;
  }
  if (tab === "movements") {
    const next = new URLSearchParams(params);
    next.delete("tab");
    return <Navigate to={`/orders${next.toString() ? `?${next}` : ""}`} replace />;
  }
  return <StockRoom />;
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  const ready = useAuthStore((s) => s.ready);
  const fetchVendor = useAuthStore((s) => s.fetchVendor);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    if (!ready) fetchVendor();
  }, [ready, token, fetchVendor]);

  return (
    <>
      {/* The five-second cold-start screen. It runs alongside the session check
          rather than before it, so the time is spent, not added. */}
      {!splashDone && <BootSplash onDone={() => setSplashDone(true)} />}
      <AppRoutes />
    </>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      {/* Public storefront (v2.14): catalogue, tiers, trial — readable without
          an account; enquiring attaches to a vendor @handle. */}
      <Route path="/storefront" element={<BusinessDeskPage />} />
      {/* Operator side of the same desk: where a request lands. The API answers
          403 for anyone without a market-ops role, so the page can be public. */}
      <Route path="/storefront/inbox" element={<EnquiryInboxPage />} />
      <Route
        element={
          <RequireVendor>
            <Shell />
          </RequireVendor>
        }
      >
        <Fragment>
          {/* ── Primary destinations ───────────────────────────────────
              Home · Browse · Work · Inbox · Business — organised around what
              an owner is doing, not around our databases. Discovery routes
              remain deep-linkable beneath Browse (/network, /nearby, /map,
              /markets, /news are views of the same results); work routes
              (/orders, /tasks, /locks, /tools) under Work; business routes
              under /me. Nothing was deleted — only duplicated navigation. */}
          <Route path="/" element={<HomeHub />} />
          {/* v2.15 — the read-only brief, and the trust/data-rights surface */}
          <Route path="/brief" element={<MorningBriefPage />} />
          <Route path="/legal" element={<LegalPage />} />
          <Route path="/billing" element={<SubscriptionPage />} />
          <Route path="/payments" element={<ReceiptsPage />} />
          {/* ── Outside destinations (v4) ──────────────────────────────────
              Explore absorbs Browse's discovery surfaces; Activity absorbs
              Work and Inbox. Every older URL below still resolves and still
              highlights the right tab (see config/navigation.js areas). */}
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/parks" element={<ParksPage />} />
          <Route path="/parks/:slug" element={<ParkDetailPage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/activities/:id" element={<ActivityDetailPage />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/listing/:id" element={<ListingPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/repeat" element={<RepeatOrderPage />} />
          <Route path="/orders/records" element={<TradeRecordsPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/work" element={<WorkPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/stock" element={<StockRoomRouter />} />

          {/* ── Browse and supporting discovery surfaces ──────────────── */}
          <Route path="/nearby" element={<NearbyPage />} />
          <Route path="/nearby/:group" element={<NearbyPage />} />
          <Route path="/place/:id" element={<PlaceProfile />} />
          <Route path="/feed" element={<SurfaceFeed />} />
          <Route path="/search" element={<SearchHub />} />
          <Route path="/search/:tab" element={<SearchHub />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/news" element={<News />} />
          <Route path="/news/:kind" element={<News />} />
          <Route path="/markets" element={<MarketsPage />} />
          <Route path="/markets/:id" element={<MarketDetail />} />
          <Route path="/network" element={<Network />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/lists" element={<VendorLists />} />
          <Route path="/locks" element={<MarketLocks />} />

          {/* ── Tasks (Squad league + Brief workspace) ─────────────────── */}
          <Route path="/squad" element={<Navigate to="/tasks/squad" replace />} />
          <Route path="/tasks" element={<TasksPortal />} />
          <Route path="/tasks/:track" element={<TaskTrack />} />

          {/* ── Your business ─────────────────────────────────────────── */}
          <Route path="/me" element={<MePage />} />
          {/* Brief is the legacy name for the Me workspace; keep old links alive. */}
          <Route path="/brief" element={<Navigate to="/me" replace />} />
          <Route path="/profile" element={<Navigate to="/me" replace />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/pos" element={<POSBridge />} />
          <Route path="/governance" element={<OurNetwork />} />
          <Route path="/ops" element={<Ops />} />
          <Route path="/passport" element={<PassportPage />} />
          <Route path="/growth" element={<GrowthPlannerPage />} />
          {/* v2.13 enterprise workspaces — the paid, private side of the dual
              model. Lazy-imported above and named in ME_ROOTS, so the surface is
              reachable at the URL the README and the API both use. */}
          <Route path="/enterprise" element={<EnterprisePage />} />
          {/* The creative-portfolio page was retired in v2.16. Its capability —
              showing work — now lives on the shop front (selected work), its
              price list lives on the Business Desk, and its inquiry pipeline is
              the enquiry inbox. LinkedIn-old links still land somewhere useful. */}
          <Route path="/portfolio" element={<Navigate to="/me" replace />} />
          <Route path="/studio" element={<Navigate to="/me" replace />} />
          <Route path="/@:handle" element={<VendorProfile />} />
          <Route path="/:handle" element={<VendorHandleRoute />} />

          {/* ── v2 URLs that moved ────────────────────────────────────── */}
          <Route path="/movements" element={<Navigate to="/orders" replace />} />
          <Route path="/stock/:id" element={<ListingRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Fragment>
      </Route>
    </Routes>
  );
}

function VendorHandleRoute() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/@") && pathname.length > 2) {
    return <VendorProfile />;
  }
  return <Navigate to="/" replace />;
}

function ListingRedirect() {
  const { pathname } = useLocation();
  return <Navigate to={pathname.replace(/^\/stock\//, "/listing/")} replace />;
}

