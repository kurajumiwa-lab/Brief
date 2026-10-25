import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import TopBar from "./components/TopBar.jsx";
import { Rail, TabBar } from "./components/Nav.jsx";
import Toasts from "./components/Toasts.jsx";
import FeedPage from "./pages/FeedPage.jsx";
import CirclesPage from "./pages/CirclesPage.jsx";
import CirclePage from "./pages/CirclePage.jsx";
import ComposePage from "./pages/ComposePage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import SafetyPage from "./pages/SafetyPage.jsx";
import { useApp } from "./store/appStore.js";

export default function App() {
  const theme = useApp((state) => state.preferences.theme);
  const locale = useApp((state) => state.preferences.locale);
  const { pathname } = useLocation();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Screen readers and hyphenation both key off this; a translated interface
  // that still claims to be English is a half-done translation.
  useEffect(() => {
    document.documentElement.setAttribute("lang", locale);
  }, [locale]);

  // A new screen starts at the top; the feed is long and the reader is on a phone.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);

  return (
    <div className="shell">
      <Rail />
      <div>
        <TopBar />
        <main className="shell__main">
          <div className="container">
            <Routes>
              <Route path="/" element={<FeedPage />} />
              <Route path="/circles" element={<CirclesPage />} />
              <Route path="/circles/:circleId" element={<CirclePage />} />
              <Route path="/compose" element={<ComposePage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/safety" element={<SafetyPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </main>
      </div>
      <TabBar />
      <Toasts />
    </div>
  );
}

function NotFound() {
  return (
    <div className="empty" style={{ marginTop: 40 }}>
      <p style={{ fontSize: 14 }}>That page does not exist.</p>
      <a className="btn btn--sm btn--ghost" href="/">
        Back to the feed
      </a>
    </div>
  );
}
