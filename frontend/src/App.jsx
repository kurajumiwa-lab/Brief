import { useEffect, lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Shell from "@/components/layout/Shell";
import { PageSpinner } from "@/components/ui/Spinner";
import AuthPage from "@/pages/auth/AuthPage";
import LocalHome from "@/pages/home/LocalHome";
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
        <Suspense fallback={<PageSpinner />}>
          {/* Home is the B2C local-business home (Nextdoor-style, GPS +
              categories). The B2B surfaces feed stays one tap away at /feed. */}
          <Route path="/" element={<LocalHome />} />
          <Route path="/feed" element={<SurfaceFeed />} />
          <Route path="/search" element={<SearchHub />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/news" element={<News />} />
          <Route path="/squad" element={<SquadPage />} />
          <Route path="/tasks" element={<TasksPortal />} />
          <Route path="/markets" element={<MarketsPage />} />
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
        </Suspense>
      </Route>
    </Routes>
  );
}
