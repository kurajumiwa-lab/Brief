import { Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Sidebar, { SidebarContent, Brand } from "./Sidebar";
import TopBar from "./TopBar";
import MobileNav from "./MobileNav";
import Drawer from "@/components/ui/Drawer";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";
import { useUIStore } from "@/stores/uiStore";

/** Persistent app frame — rendered once as a layout route so navigation never remounts it. */
export default function Shell() {
  const mobileOpen = useUIStore((s) => s.mobileSidebarOpen);
  const setMobile = useUIStore((s) => s.setMobileSidebar);
  const { pathname } = useLocation();
  const fullBleed = pathname.startsWith("/chat");

  useEffect(() => setMobile(false), [pathname, setMobile]);

  return (
    <div className="h-screen flex bg-surface-0 text-ink-1 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className={fullBleed ? "flex-1 min-h-0 pb-14 lg:pb-0" : "flex-1 overflow-y-auto px-4 lg:px-6 py-5 pb-20 lg:pb-8"}>
          <div className={fullBleed ? "h-full" : "max-w-6xl mx-auto"}>
            <Outlet />
          </div>
        </main>
      </div>
      <MobileNav />

      <Drawer open={mobileOpen} onClose={() => setMobile(false)} side="left" width="max-w-xs" className="!p-0" title={<Brand />}>
        <div className="-m-5 h-[calc(100%+2.5rem)] py-3">
          <SidebarContent onNavigate={() => setMobile(false)} />
        </div>
      </Drawer>
      <ConfirmDialog />
      <OnboardingFlow />
    </div>
  );
}
