import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bell, Menu } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { NAV, Brand } from "./Sidebar";
import { useUIStore } from "@/stores/uiStore";
import { useStockStore } from "@/stores/stockStore";
import { useAuthStore } from "@/stores/authStore";
import { VENDOR_ROLES, ROLE_BADGE } from "@/config/constants";

const titleFor = (pathname) => {
  if (pathname.startsWith("/@")) return "Vendor profile";
  const hit = NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));
  return hit?.label || "Brief_";
};

export default function TopBar() {
  const { pathname } = useLocation();
  const openMobile = useUIStore((s) => s.setMobileSidebar);
  const vendor = useAuthStore((s) => s.vendor);
  const movements = useStockStore((s) => s.movements);
  const actionable = useStockStore((s) => s.actionable);
  const fetchMovements = useStockStore((s) => s.fetchMovements);
  const role = VENDOR_ROLES.find((r) => r.value === vendor?.current_role);

  // light poll so the bell reflects requests made on your stock while you're elsewhere
  useEffect(() => {
    fetchMovements().catch(() => {});
    const t = setInterval(() => fetchMovements().catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [fetchMovements]);

  const pending = movements.length ? actionable().length : 0;

  return (
    <header className="h-14 shrink-0 flex items-center gap-3 px-4 lg:px-6 border-b border-edge-1 bg-surface-0/80 backdrop-blur sticky top-0 z-30">
      <button onClick={() => openMobile(true)} className="lg:hidden p-1.5 -ml-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface-3" aria-label="Open menu">
        <Menu size={18} />
      </button>
      <div className="lg:hidden">
        <Brand collapsed />
      </div>
      <h1 className="text-sm font-semibold text-ink-1 truncate">{titleFor(pathname)}</h1>
      {role && (
        <Badge variant={ROLE_BADGE[role.value]} size="xs" className="hidden sm:inline-flex">
          {role.emoji} {role.label}
        </Badge>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Link
          to="/stock?tab=movements"
          className="relative p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface-3"
          aria-label={pending ? `${pending} movements need your action` : "Movements"}
          title={pending ? `${pending} movement${pending === 1 ? "" : "s"} waiting on you` : "Stock movements"}
        >
          <Bell size={17} />
          {pending > 0 && (
            <span className="absolute top-1 right-1 min-w-[1rem] h-4 px-1 rounded-full bg-brand-500 text-surface-0 text-2xs font-bold flex items-center justify-center">
              {pending > 9 ? "9+" : pending}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
