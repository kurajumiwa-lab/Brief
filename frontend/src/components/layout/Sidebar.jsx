import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Check, ChevronDown, LogOut, ShieldCheck, X } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useVendorStore } from "@/stores/vendorStore";
import { LogoMark } from "./Logo";
import { SECTION_GROUPS, isDrawerActive } from "@/config/navigation";
import { reachability, REACHABILITY } from "@/lib/reachability";
import { VENDOR_ROLES } from "@/config/constants";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import { BRAND } from "@/config/brand";

/**
 * THE WORKSPACE DRAWER — Wasta 2.0.
 *
 * Three sections, in the order a business uses them: what it owns (My
 * workspace), who it trades with (Network), and the two doors that are about
 * the account rather than the work (Account). A footer carries the one
 * irreversible action, Sign out, where it is expected and out of the way.
 *
 * What this deliberately does NOT have, because a review rejected each one:
 *
 *   · a subtitle under the wordmark ("Everything else, in one place") — the
 *     mark is the mark, and a sentence under it was decoration;
 *   · a descriptive line under every row — the rows are labels, and a drawer
 *     with sixteen explanations is a manual;
 *   · a rank badge in the identity strip — rank is a Profile idea, and a chip
 *     in the drawer made it look like a status the navigation depends on;
 *   · a long paragraph at the bottom explaining what the drawer is — if the
 *     sections need explaining, the sections are wrong;
 *   · a "More" heading on the drawer itself — the panel is the workspace, and
 *     it now says so by naming the business at the top.
 *
 * Every row is a real destination. The Account section's two legal rows use
 * `/legal` because that is the page that actually holds Privacy, Your data
 * rights and Support; they scroll to their section, so the label and the
 * destination agree instead of the label promising a page that does not exist.
 */

const linkCls = ({ isActive }) =>
  cn(
    // 44px min target, full-row hit area, one visible focus ring.
    "group flex min-h-11 items-center gap-3 rounded-btn px-3 text-xs font-semibold transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0",
    isActive
      ? "bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300"
      : "text-ink-2 hover:bg-surface-2 hover:text-ink-1",
  );

const DOT = {
  [REACHABILITY.REACHABLE]: "bg-tech-500",
  [REACHABILITY.PAGE_ONLY]: "bg-amber-400",
  [REACHABILITY.ROUTE_ONLY]: "bg-amber-400",
  [REACHABILITY.UNPUBLISHED]: "bg-ink-4",
  [REACHABILITY.UNKNOWN]: "bg-ink-4",
};

/**
 * The identity row: who this drawer belongs to, and whether the rest of the
 * world can reach them.
 *
 * The switcher appears only when there is more than one role to switch
 * between — the server has `switch-role`, and the four roles are real. It is a
 * *role* switcher, not a second-account switcher, because the frontend holds
 * exactly one identity and inventing a list of peers would be a fiction.
 */
function IdentityCard({ onNavigate }) {
  const vendor = useAuthStore((s) => s.vendor);
  // The store's real fields, not the whole store object: subscribing to `s`
  // re-renders on every unrelated write (status, error, loaded), and passing
  // the object means `exposure()` sees a new identity every time.
  const contact = useIdentityStore((s) => s.contact);
  const affiliation = useIdentityStore((s) => s.affiliation);
  const licence = useIdentityStore((s) => s.licence);
  const switchRole = useVendorStore((s) => s.switchRole);
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");

  // LOAD THE CONTACT RECORD, or the indicator lies.
  //
  // `exposure()` counts a published phone/email as a reply route, and those
  // live in the identity store — which the drawer never read. A business whose
  // only route was a published email therefore showed as "Not published" until
  // the person happened to visit Profile, then silently became "Reachable".
  // The drawer is the surface that makes the claim, so it fetches the record
  // itself. The store de-duplicates, so this is one request per session and a
  // no-op everywhere else.
  useEffect(() => {
    if (vendor) useIdentityStore.getState().load();
  }, [vendor, vendor?.id]);

  // Escape closes the disclosure. No outside-click handler: the panel sits in
  // the flow, so there is no floating layer to dismiss.
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!vendor) {
    return (
      <div className="border-b border-edge-1 px-4 py-4">
        <p className="text-xs font-bold text-ink-1">Not signed in</p>
        <Link
          to="/auth"
          onClick={onNavigate}
          className="mt-2 inline-flex min-h-11 items-center text-2xs font-bold text-brand-700 hover:underline dark:text-brand-300"
        >
          Sign in to your workspace
        </Link>
      </div>
    );
  }

  const reach = reachability(vendor, { contact, affiliation, licence });
  const role = VENDOR_ROLES.find((item) => item.value === vendor.current_role);
  const handle = vendor.vendor_handle;

  const choose = async (nextRole) => {
    if (nextRole === vendor.current_role || busy) {
      setOpen(false);
      return;
    }

    // "Dormant" is not a mode, it is a removal from discovery: the network and
    // the recommendation engine both filter `current_role != 'dormant'`, and the
    // endpoint sets it with no guard. A one-tap row in a drawer must not quietly
    // take a business off the market, so this one asks first.
    if (nextRole === "dormant") {
      const ok = await confirm({
        title: "Stop appearing in discovery?",
        message:
          "Other businesses will no longer find you in the network or in recommendations. Your page, stock and records stay exactly as they are, and you can switch back at any time.",
        confirmLabel: "Go dormant",
        danger: true,
      });
      if (!ok) {
        setOpen(false);
        return;
      }
    }

    setBusy(nextRole);
    try {
      await switchRole(nextRole);
      const label = VENDOR_ROLES.find((item) => item.value === nextRole)?.label;
      toast.success(`Now operating as: ${label}`);
      setOpen(false);
    } catch {
      toast.error("Could not change how you operate. Try again.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="border-b border-edge-1 px-4 py-4">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={`${vendor.business_name}. Operating as ${role?.label || "unknown"}. Change how you operate`}
          className="flex w-full min-h-11 items-center gap-3 rounded-btn text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
        >
          <Avatar name={vendor.business_name} src={vendor.avatar_url || vendor.logo_url} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold text-ink-1">
              {vendor.business_name}
            </span>
            <span className="block truncate font-mono text-micro text-ink-4">
              {handle ? `/p/${handle}` : "no page address yet"}
            </span>
          </span>
          <ChevronDown
            size={15}
            className={cn("shrink-0 text-ink-4 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>

        {/* In the flow, not floating. The drawer's body is a scroll
            container, so an absolutely-positioned popover would either be
            clipped or force the panel to scroll; and on a 320px-wide sheet
            a disclosure is easier to hit than a popover. */}
        {open && (
          <div
            role="menu"
            aria-label="How you operate"
            className="mt-2 overflow-hidden rounded-btn border border-edge-1 bg-surface-1 p-1"
          >
            {VENDOR_ROLES.map((item) => (
              <button
                key={item.value}
                type="button"
                role="menuitemradio"
                aria-checked={item.value === vendor.current_role}
                disabled={Boolean(busy)}
                onClick={() => choose(item.value)}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-2xs font-semibold text-ink-2 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-ink-1">{item.label}</span>
                  <span className="block text-micro font-normal text-ink-4">{item.hint}</span>
                </span>
                {item.value === vendor.current_role && (
                  <Check size={14} className="shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Reachability is a fact, not a score. The dot has a label beside it and
          the whole row carries the explanation as its title, so colour is never
          the only signal. */}
      <p className="mt-2 flex items-start gap-2 px-1 text-micro leading-snug text-ink-3">
        <span
          className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", DOT[reach.state])}
          aria-hidden="true"
        />
        <span>
          <span className="font-bold text-ink-2">{reach.label}</span>
          <span className="text-ink-4"> · {reach.detail}</span>
        </span>
      </p>
    </div>
  );
}

export function SidebarContent({ onNavigate }) {
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const { pathname, hash } = useLocation();

  // "/legal#privacy" is one destination with a section to open. NavLink compares
  // pathnames and would treat every `/legal` row as active at once, so the
  // Account rows are plain links that carry their own hash and report active
  // state from it.
  const hashActive = (to) => {
    const [, wantHash] = to.split("#");
    return wantHash ? hash === `#${wantHash}` : false;
  };

  const signOut = () => {
    logout();
    onNavigate?.();
    toast.success("You are signed out.");
    navigate("/auth");
  };

  return (
    <div className="flex h-full flex-col bg-surface-0">
      {/* The panel's whole top bar: the mark, the product's name, and the one
          way out. The drawer is a side sheet, not a page, so it closes with a
          visible control as well as Escape and the scrim. */}
      <div className="flex items-center gap-3 border-b border-edge-1 px-4 py-3">
        <LogoMark size={28} />
        <p className="min-w-0 flex-1 truncate text-sm font-extrabold tracking-tight text-ink-1">
          {BRAND.name}
        </p>
        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Close the workspace menu"
            className="-mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-btn text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <X size={19} aria-hidden="true" />
          </button>
        )}
      </div>

      <IdentityCard onNavigate={onNavigate} />

      <nav id="secondary-sections" className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Workspace">
        {SECTION_GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="px-3 pb-1 pt-4 text-micro font-bold uppercase tracking-[0.12em] text-ink-4">
              {group.title}
            </h2>
            <ul className="space-y-0.5">
              {/* Active state comes from `isDrawerActive`, not from NavLink's
                  prefix match: `/orders` would otherwise light up on
                  `/orders/records` and two rows would claim the same screen. */}
              {group.items.map(({ to, label, icon: Icon, tab }) => (
                <li key={to}>
                  {to.includes("#") ? (
                    <Link
                      to={to}
                      onClick={onNavigate}
                      aria-current={hashActive(to) ? "location" : undefined}
                      className={linkCls({ isActive: hashActive(to) })}
                    >
                      <Icon size={17} className="shrink-0" aria-hidden="true" />
                      <span className="flex-1">{label}</span>
                    </Link>
                  ) : (
                    <NavLink
                      to={to}
                      onClick={onNavigate}
                      aria-current={isDrawerActive(pathname, to) ? "page" : undefined}
                      className={linkCls({ isActive: isDrawerActive(pathname, to) })}
                    >
                      <Icon size={17} className="shrink-0" aria-hidden="true" />
                      <span className="flex-1">{label}</span>
                      {/* The one row that is also a tab. Saying so is cheaper
                          than a second, differently-worded route to Explore. */}
                      {tab && (
                        <span className="shrink-0 text-micro font-medium text-ink-4">{tab}</span>
                      )}
                    </NavLink>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <div className="border-t border-edge-1 p-3">
        <button
          type="button"
          onClick={signOut}
          className="flex min-h-11 w-full items-center gap-3 rounded-btn px-3 text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
        >
          <LogOut size={17} className="shrink-0" aria-hidden="true" />
          Sign out
        </button>
        <p className="mt-1 flex items-center gap-1.5 px-3 text-micro text-ink-4">
          <ShieldCheck size={11} aria-hidden="true" />
          Records only. No money is held here.
        </p>
      </div>
    </div>
  );
}

/** Legacy direct mount. The shell normally renders `SidebarContent` itself. */
export default function Sidebar() {
  const setMobileSidebar = useUIStore((s) => s.setMobileSidebar);
  return <SidebarContent onNavigate={() => setMobileSidebar(false)} />;
}
