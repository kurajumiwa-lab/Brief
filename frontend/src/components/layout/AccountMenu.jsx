import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart3, Briefcase, ChevronDown, LogOut, Moon, Package, Settings, Store, Sun, Terminal,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toast";
import { LevelBadge } from "@/components/trust/TrustSignals";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useVendorStore } from "@/stores/vendorStore";
import { VENDOR_ROLES } from "@/config/constants";
import { apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The avatar menu — identity, the role switch, the quiet destinations and the
 * theme. In v2 the role switcher sat in the sidebar footer, below the fold on
 * a phone; it is the product's signature mechanic, so it now lives one tap
 * from every screen (the marketplace "switch to selling" pattern).
 */
export default function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const logout = useAuthStore((s) => s.logout);
  const switchRole = useVendorStore((s) => s.switchRole);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!vendor) return null;

  const pickRole = async (value) => {
    if (value === vendor.current_role || busy) return;
    setBusy(value);
    try {
      await switchRole(value);
      toast.success(`You're now ${VENDOR_ROLES.find((r) => r.value === value)?.label.toLowerCase()}`);
    } catch (e) {
      toast.error(apiError(e, "Couldn't switch role"));
    } finally {
      setBusy(null);
    }
  };

  const go = (to) => {
    setOpen(false);
    navigate(to);
  };

  const item =
    "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink-1 transition-colors text-left";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className={cn(
          "flex items-center gap-1.5 rounded-xl p-1 pr-1.5 transition-colors hover:bg-surface-2",
          open && "bg-surface-2"
        )}
      >
        <Avatar name={vendor.business_name} size="sm" />
        <ChevronDown size={14} className={cn("text-ink-4 transition-transform duration-1", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 rounded-2xl border border-edge-1 bg-surface-0 shadow-xl z-50 overflow-hidden animate-scale-in origin-top-right"
        >
          {/* identity */}
          <Link
            to={`/@${vendor.vendor_handle}`}
            onClick={() => setOpen(false)}
            className="flex items-start gap-3 p-4 hover:bg-surface-1 transition-colors border-b border-edge-1"
          >
            <Avatar name={vendor.business_name} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-1 truncate">{vendor.business_name}</p>
              <p className="text-2xs text-ink-4 font-mono truncate">@{vendor.vendor_handle}</p>
              <div className="mt-1.5">
                <LevelBadge vendor={vendor} />
              </div>
            </div>
          </Link>

          {/* the fluid role — the mechanic that defines the product */}
          <div className="p-3 border-b border-edge-1">
            <p className="text-micro uppercase tracking-[0.1em] font-bold text-ink-4 mb-2">I am currently</p>
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Current role">
              {VENDOR_ROLES.map((r) => {
                const active = r.value === vendor.current_role;
                return (
                  <button
                    key={r.value}
                    role="radio"
                    aria-checked={active}
                    title={`${r.label} — ${r.hint}`}
                    disabled={!!busy}
                    onClick={() => pickRole(r.value)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-2xs font-semibold transition-colors disabled:opacity-60",
                      active
                        ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                        : "border-edge-2 text-ink-3 hover:border-ink-4 hover:text-ink-1",
                      busy === r.value && "animate-pulse"
                    )}
                  >
                    <span aria-hidden="true">{r.emoji}</span>
                    <span className="truncate">{r.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* quiet destinations */}
          <div className="p-1.5">
            <button className={item} onClick={() => go(`/@${vendor.vendor_handle}`)} role="menuitem">
              <Store size={15} aria-hidden="true" /> My shop front
            </button>
            <button className={item} onClick={() => go("/stock")} role="menuitem">
              <Package size={15} aria-hidden="true" /> My shelf
            </button>
            <button className={item} onClick={() => go("/brief")} role="menuitem">
              <Briefcase size={15} aria-hidden="true" /> Dashboard
            </button>
            <button className={item} onClick={() => go("/analytics")} role="menuitem">
              <BarChart3 size={15} aria-hidden="true" /> Analytics
            </button>
            <button className={item} onClick={() => go("/pos")} role="menuitem">
              <Terminal size={15} aria-hidden="true" /> POS Bridge
            </button>
            <button className={item} onClick={() => go(`/@${vendor.vendor_handle}?edit=1`)} role="menuitem">
              <Settings size={15} aria-hidden="true" /> Edit profile
            </button>
          </div>

          <div className="p-1.5 border-t border-edge-1">
            <button className={item} onClick={toggleTheme} role="menuitem">
              {theme === "dark" ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
              {theme === "dark" ? "Light theme" : "Dark theme"}
              <Badge variant="gray" size="xs" className="ml-auto">
                {theme}
              </Badge>
            </button>
            <button
              className={cn(item, "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-700")}
              onClick={() => {
                logout();
                toast.success("Signed out.");
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
