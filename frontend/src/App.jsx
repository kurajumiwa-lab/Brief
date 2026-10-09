import { useEffect, lazy, Fragment } from "react";
import { Routes, Route, Navigate, useLocation, useSearchParams } from "react-router-dom";
import Shell from "@/components/layout/Shell";
import { PageSpinner } from "@/components/ui/Spinner";
import AuthPage from "@/pages/auth/AuthPage";
import HomeHub from "@/pages/home/HomeHub";
import NearbyPage from "@/pages/nearby/NearbyPage";
import PlaceProfile from "@/pages/nearby/PlaceProfile";
import MarketDetail from "@/pages/markets/MarketDetail";
import TaskTrack from "@/pages/tasks/TaskTrack";
import { useAuthStore } from "@/stores/authStore";

// Every page is lazy. The home screen downloads only what it renders —
// Leaflet (map), chat, analytics, ops and the rest split into chunks fetched
// on first navigation.
const BrowsePage = lazy(() => import("@/pages/browse/BrowsePage"));
const ListingPage = lazy(() => import("@/pages/listing/ListingPage"));
const OrdersPage = lazy(() => import("@/pages/orders/OrdersPage"));
const SurfaceFeed = lazy(() => import("@/pages/surface/SurfaceFeed"));
const SearchHub = lazy(() => import("@/pages/search/SearchHub"));
const MapPage = lazy(() => import("@/pages/map/MapPage"));
const News = lazy(() => import("@/pages/news/News"));
const TasksPortal = lazy(() => import("@/pages/tasks/TasksPortal"));
const MarketsPage = lazy(() => import("@/pages/markets/MarketsPage"));
const MePage = lazy(() => import("@/pages/me/MePage"));
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

/** Gate: no token → /auth (remembering where to return); token but vendor not
    loaded yet → spinner. */
function RequireVendor({ children }) {
  const { token, vendor, ready } = useAuthStore();
  const location = useLocation();
  if (!token) return <Navigate to="/auth" replace state={{ from: location.pathname + location.search }} />;
  if (!ready || !vendor) return ready && !vendor ? <Navigate to="/auth" replace /> : <PageSpinner label="Entering the network…" />;
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

  useEffect(() => {
    if (!ready) fetchVendor();
  }, [ready, token, fetchVendor]);

  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route
        element={
          <RequireVendor>
            <Shell />
          </RequireVendor>
        }
      >
        <Fragment>
          {/* ── Primary destinations ───────────────────────────────────
              Home · Browse · Orders · Inbox · Me. Discovery routes remain
              individually deep-linkable beneath Browse; business routes
              remain deep-linkable beneath the Me workspace. */}
          <Route path="/" element={<HomeHub />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/listing/:id" element={<ListingPage />} />
          <Route path="/orders" element={<OrdersPage />} />
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
          <Route path="/@:handle" element={<VendorProfile />} />

          {/* ── v2 URLs that moved ────────────────────────────────────── */}
          <Route path="/movements" element={<Navigate to="/orders" replace />} />
          <Route path="/stock/:id" element={<ListingRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Fragment>
      </Route>
    </Routes>
  );
}

function ListingRedirect() {
  const { pathname } = useLocation();
  return <Navigate to={pathname.replace(/^\/stock\//, "/listing/")} replace />;
}

