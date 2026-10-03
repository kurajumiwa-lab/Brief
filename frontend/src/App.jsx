import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Shell from "@/components/layout/Shell";
import { PageSpinner } from "@/components/ui/Spinner";
import AuthPage from "@/pages/auth/AuthPage";
import ShopHome from "@/pages/home/ShopHome";
import News from "@/pages/news/News";
import SquadPage from "@/pages/squad/SquadPage";
import MarketsPage from "@/pages/markets/MarketsPage";
import Dashboard from "@/pages/dashboard/Dashboard";
import StockRoom from "@/pages/stock/StockRoom";
import Network from "@/pages/network/Network";
import VendorLists from "@/pages/lists/VendorLists";
import Groups from "@/pages/groups/Groups";
import ChatPage from "@/pages/chat/ChatPage";
import MarketLocks from "@/pages/locks/MarketLocks";
import OurNetwork from "@/pages/governance/OurNetwork";
import ToolsPage from "@/pages/tools/ToolsPage";
import EventsPage from "@/pages/events/EventsPage";
import POSBridge from "@/pages/pos/POSBridge";
import Analytics from "@/pages/analytics/Analytics";
import Ops from "@/pages/ops/Ops";
import VendorProfile from "@/pages/vendor/VendorProfile";
import { useAuthStore } from "@/stores/authStore";

/** Gate: no token → /auth; token but vendor not loaded yet → spinner. */
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
        {/* Home is the trade-information shelf; the vendor's own workspace
            (numbers, feed, suggestions) lives under Brief, as a feature. */}
        <Route path="/" element={<ShopHome />} />
        <Route path="/news" element={<News />} />
        <Route path="/squad" element={<SquadPage />} />
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
      </Route>
    </Routes>
  );
}
