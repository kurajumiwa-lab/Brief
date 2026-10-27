import { useEffect, useRef } from "react";
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
import MeasurePage from "./pages/MeasurePage.jsx";
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

  // Two things a single-page app routinely forgets, and both matter more on a
  // phone in the sun than in a demo: the document title has to say where you
  // are, and focus has to follow a navigation. Otherwise a screen reader
  // announces nothing after a tap and the user is still, silently, on the link.
  const firstRender = useRef(true);
  useEffect(() => {
    document.title = titleFor(pathname);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // preventScroll matters: focusing an element scrolls it into view, and the
    // main region sits under a sticky top bar — so a plain focus() on load left
    // the page scrolled 57px down with the hero title half hidden behind it.
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Rail />
      <div>
        <TopBar />
        <main className="shell__main" id="main" tabIndex={-1}>
          <div className="container">
            <Routes>
              <Route path="/" element={<FeedPage />} />
              <Route path="/circles" element={<CirclesPage />} />
              <Route path="/circles/:circleId" element={<CirclePage />} />
              <Route path="/compose" element={<ComposePage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/safety" element={<SafetyPage />} />
              <Route path="/measure" element={<MeasurePage />} />
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

/** Every route says where it is. "Caesar" alone is not an answer. */
export function titleFor(pathname = "/") {
  if (pathname.startsWith("/circles/")) return "Circle · Caesar";
  const titles = {
    "/": "Feed · Caesar",
    "/circles": "Circles · Caesar",
    "/compose": "Write a post · Caesar",
    "/profile": "Profile · Caesar",
    "/safety": "Safety centre · Caesar",
    "/measure": "What this would measure · Caesar",
  };
  return titles[pathname] || "Caesar — The community decides.";
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
