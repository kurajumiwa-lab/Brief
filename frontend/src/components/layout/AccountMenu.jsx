import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, Moon, Settings, Sun } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import RoleSwitcher from "@/components/vendor/RoleSwitcher";
import { toast } from "@/components/ui/Toast";
import { LevelBadge } from "@/components/trust/TrustSignals";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

/** Identity, the single operating-mode selector, account settings and theme. */
export default function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const logout = useAuthStore((s) => s.logout);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!vendor) return null;

  const item =
    "w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink-1 transition-colors text-left";
  const close = () => setOpen(false);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account and operating mode"
        className={cn("flex items-center gap-1.5 rounded-xl p-1 pr-1.5 transition-colors hover:bg-surface-2", open && "bg-surface-2")}
      >
        <Avatar name={vendor.business_name} size="sm" />
        <ChevronDown size={14} className={cn("text-ink-4 transition-transform duration-1", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-72 rounded-2xl border border-edge-1 bg-surface-0 shadow-xl z-50 overflow-hidden animate-scale-in origin-top-right">
          <div role="none" className="flex items-start gap-3 p-4 border-b border-edge-1">
            <Avatar name={vendor.business_name} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-1 truncate">{vendor.business_name}</p>
              <p className="text-2xs text-ink-4 font-mono truncate">@{vendor.vendor_handle}</p>
              <div className="mt-1.5"><LevelBadge vendor={vendor} /></div>
            </div>
          </div>

          <div className="p-3 border-b border-edge-1">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-micro uppercase tracking-[0.1em] font-bold text-ink-4">I am currently</p>
              <span className="text-micro text-ink-4">This updates your whole network view</span>
            </div>
            <RoleSwitcher />
          </div>

          <div className="p-1.5">
            <button
              type="button"
              className={item}
              onClick={() => {
                close();
                navigate(`/@${vendor.vendor_handle}?edit=1`);
              }}
              role="menuitem"
            >
              <Settings size={15} aria-hidden="true" /> Profile settings
            </button>
            <button
              type="button"
              className={item}
              onClick={toggleTheme}
              role="menuitem"
            >
              {theme === "dark" ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
              {theme === "dark" ? "Light theme" : "Dark theme"}
              <Badge variant="gray" size="xs" className="ml-auto">{theme}</Badge>
            </button>
          </div>

          <div className="p-1.5 border-t border-edge-1">
            <button
              type="button"
              className={cn(item, "text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10")}
              onClick={() => {
                logout();
                close();
                toast.success("You are signed out.");
                navigate("/auth");
              }}
              role="menuitem"
            >
              <LogOut size={15} aria-hidden="true" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
