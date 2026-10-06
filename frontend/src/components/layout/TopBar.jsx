import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Menu, Package } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useStockStore } from "@/stores/stockStore";
import NotificationBell from "@/components/notifications/NotificationBell";
import Avatar from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";

export default function TopBar() {
  const setMobileSidebar = useUIStore((s) => s.setMobileSidebar);
  const vendor = useAuthStore((s) => s.vendor);
  const movements = useStockStore((s) => s.movements);
  const loadMovements = useStockStore((s) => s.loadMovements);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 20);
    return () => clearInterval(t);
  }, []);

  const pending = movements.filter((m) => m.actionable);

  return (
    <header className="sticky top-0 z-20 bg-surface-0 shadow-[0_1px_0_0_rgba(255,255,255,0.05)]">
      <div className="flex items-center justify-between gap-3 h-14 px-4 sm:px-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setMobileSidebar(true)}
            className="lg:hidden p-2 -ml-1 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-white/5 transition-colors"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          {/* live clock — the digital pulse of the top bar */}
          <p className="hidden sm:flex items-baseline gap-1.5 select-none" title="Nairobi time">
            <span className="digital digital-glow text-sm text-brand-300">
              {now.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false })}
            </span>
            <span className="digital text-2xs text-ink-4 opacity-70">
              {now.toLocaleDateString("en-KE", { weekday: "short", day: "2-digit", month: "short" })}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {vendor?.current_role === "sourcing" && (
            <Link
              to="/stock?tab=movements"
              className="relative p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-white/5 transition-colors"
              title={pending.length ? `${pending.length} movement(s) need you` : "Movements"}
              aria-label="Movements"
            >
              <Package size={17} />
              {pending.length > 0 && <span className="notif-dot notif-dot-amber" aria-hidden="true" />}
            </Link>
          )}
          <NotificationBell />
          {vendor && (
            <Link
              to={`/@${vendor.vendor_handle}`}
              className="flex items-center gap-2 pl-1"
              title={vendor.business_name}
            >
              <Avatar name={vendor.business_name} size="sm" online />
              <span className="hidden md:block text-xs font-medium max-w-[10rem] truncate">{vendor.business_name}</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
