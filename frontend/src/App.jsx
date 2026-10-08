import { useEffect, lazy, Fragment } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Shell from "@/components/layout/Shell";
import { PageSpinner } from "@/components/ui/Spinner";
import AuthPage from "@/pages/auth/AuthPage";
import HomeHub from "@/pages/home/HomeHub";
import NearbyPage from "@/pages/nearby/NearbyPage";
import PlaceProfile from "@/pages/nearby/PlaceProfile";
import MarketDetail from "@/pages/markets/MarketDetail";
import TaskTrack from "@/pages/tasks/TaskTrack";
import { useAuthStore } from "@/stores/authStore";

// v2.8 performance pass: every page is lazy. The home screen downloads only
// what it renders — Leaflet (map), chat, analytics, ops and the rest split
// into chunks fetched on first navigation. This is what makes the first paint
// fast on a phone; the previous build shipped one ~660 kB chunk for everything.
const SurfaceFeed = lazy(() => import("@/pages/surface/SurfaceFeed"));
const SearchHub = lazy(() => import("@/pages/search/SearchHub"));
const MapPage = lazy(() => import("@/pages/map/MapPage"));
const News = lazy(() => import("@/pages/news/News"));
const SquadPage = lazy(() => import("@/pages/squad/SquadPage"));
const TasksPortal = lazy(() => import("@/pages/tasks/TasksPortal"));
const MarketsPage = lazy(() => import("@/pages/markets/MarketsPage"));
const Dashboard = lazy(() => import("@/pages/dashboard/Dashboard"));
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
          {/* ── Home, and the screens that hang off it ──
              Home is a hub: every tile opens a secondary screen, and each of
              those has somewhere to go next (a category screen, a place, a
              shop front, the map). Nothing on the hub is a dead end. */}
          <Route path="/" element={<HomeHub />} />
          <Route path="/nearby" element={<NearbyPage />} />
          <Route path="/nearby/:group" element={<NearbyPage />} />
          <Route path="/place/:id" element={<PlaceProfile />} />
          <Route path="/feed" element={<SurfaceFeed />} />
          <Route path="/search" element={<SearchHub />} />
          <Route path="/search/:tab" element={<SearchHub />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/news" element={<News />} />
          <Route path="/news/:kind" element={<News />} />
          {/* /squad is now a track of the Tasks section — the old URL still resolves. */}
          <Route path="/squad" element={<Navigate to="/tasks/squad" replace />} />
          <Route path="/tasks" element={<TasksPortal />} />
          <Route path="/tasks/:track" element={<TaskTrack />} />
          <Route path="/markets" element={<MarketsPage />} />
          <Route path="/markets/:id" element={<MarketDetail />} />
          <Route path="/brief" element={<Dashboard />} />
          <Route path="/stock" element={<StockRoom />} />
          <Route path="/network" element={<Network />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/lists" element={<VendorLists />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/locks" element={<MarketLocks />} />
          <Route path="/governance" element={<OurNetwork />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/pos" element={<POSBridge />} />
          <Route path="/ops" element={<Ops />} />
          <Route path="/@:handle" element={<VendorProfile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Fragment>
      </Route>
    </Routes>
  );
}
