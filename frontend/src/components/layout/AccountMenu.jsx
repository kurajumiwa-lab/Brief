import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, Moon, Sun, UserRound } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toast";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useIdentityStore } from "@/stores/identityStore";
import { rankFor } from "@/config/identity";
import { cn } from "@/lib/utils";

/**
 * Account, page and theme.
 *
 * The old menu opened with an "I am currently sourcing / selling / both" switch.
 * That switch was the vendor model in miniature: it asked a person to declare a
 * permanent market position before they had done anything, and it changed the
 * whole app around the answer. Capabilities on You now do that job, and this menu
 * keeps only what belongs to the *session*: your page, your identity, the theme
 * and the way out.
 */
export default function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const logout = useAuthStore((s) => s.logout);
  const identity = useIdentityStore();
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

  const rank = rankFor({ vendor, identity });
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
        aria-label="Account"
        className={cn("flex items-center gap-1.5 rounded-xl p-1 pr-1.5 transition-colors hover:bg-surface-2", open && "bg-surface-2")}
      >
        <Avatar name={vendor.business_name} size="sm" src={vendor.avatar_url || vendor.logo_url} />
        <ChevronDown size={14} className={cn("text-ink-4 transition-transform duration-1", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-72 rounded-2xl border border-edge-1 bg-surface-0 shadow-xl z-50 overflow-hidden animate-scale-in origin-top-right">
          <div role="none" className="flex items-start gap-3 border-b border-edge-1 p-4">
            <Avatar name={vendor.business_name} size="md" src={vendor.avatar_url || vendor.logo_url} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-1">{vendor.business_name}</p>
              <p className="truncate font-mono text-2xs text-ink-4">/p/{vendor.vendor_handle}</p>
              <p className="mt-1 text-micro text-ink-3">
                {rank.label} · level {rank.level} of 5
              </p>
            </div>
          </div>

          <div className="p-1.5">
            <button
              type="button"
              className={item}
              role="menuitem"
              onClick={() => {
                close();
                navigate("/you");
              }}
            >
              <UserRound size={15} aria-hidden="true" />
              Your page & identity
            </button>
            <button type="button" className={item} onClick={toggleTheme} role="menuitem">
              {theme === "dark" ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
              {theme === "dark" ? "Light theme" : "Dark theme"}
              <Badge variant="gray" size="xs" className="ml-auto">{theme}</Badge>
            </button>
          </div>

          <div className="border-t border-edge-1 p-1.5">
            <Link
              to="/more"
              onClick={close}
              className="block w-full rounded-xl px-3 py-2 text-micro font-semibold text-ink-4 hover:bg-surface-2 hover:text-ink-2"
            >
              Settings & records
            </Link>
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
