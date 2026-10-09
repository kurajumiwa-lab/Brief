import { Outlet, useLocation } from "react-router-dom";
import { useEffect, Suspense } from "react";
import AppHeader from "./AppHeader";
import MobileTabBar from "./MobileTabBar";
import { SidebarContent } from "./Sidebar";
import Footer from "./Footer";
import Drawer from "@/components/ui/Drawer";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";
import ErrorBoundary from "@/components/system/ErrorBoundary";
import { PageSpinner } from "@/components/ui/Spinner";
import { useUIStore } from "@/stores/uiStore";

/**
 * The app frame: a sticky marketplace header, a scrolling document body, a
 * thumb-reachable primary tabs on phones, and one secondary drawer carrying
 * the long tail of the information architecture.
 *
 * Rendered once as a layout route so navigation never remounts the chrome.
 */
export default function Shell() {
  const sectionsOpen = useUIStore((s) => s.mobileSidebarOpen);
  const setSections = useUIStore((s) => s.setMobileSidebar);
  const { pathname } = useLocation();
  const fullBleed = pathname.startsWith("/chat");

  // Close the sections drawer and return to the top on every navigation.
  useEffect(() => {
    setSections(false);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }, [pathname, setSections]);

  return (
    <div className="min-h-screen flex flex-col bg-surface-0 text-ink-2">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <AppHeader />

      <main id="main" tabIndex={-1} className={fullBleed ? "flex-1 min-h-0 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0" : "flex-1 pb-24 lg:pb-16"}>
        <div className={fullBleed ? "h-full" : "container-app py-6"}>
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<PageSpinner />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      {!fullBleed && <Footer />}

      <MobileTabBar />

      <Drawer
        open={sectionsOpen}
        onClose={() => setSections(false)}
        side="left"
        width="max-w-xs"
        className="!p-0"
        title="More sections"
        description="Community and business tools"
      >
        <div className="-m-5 h-[calc(100%+2.5rem)]">
          <SidebarContent onNavigate={() => setSections(false)} />
        </div>
      </Drawer>

      <ConfirmDialog />
      <OnboardingFlow />
    </div>
  );
}
