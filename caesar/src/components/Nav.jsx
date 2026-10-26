import { NavLink } from "react-router-dom";
import { Home, PenLine, ShieldCheck, UserRound, Users } from "lucide-react";
import { CaesarLogo } from "./Logo.jsx";
import { useApp } from "@/store/appStore.js";
import { LOCALES, makeT } from "@/lib/i18n.js";

const ITEMS = [
  { to: "/", end: true, icon: Home, key: "nav.home" },
  { to: "/circles", icon: Users, key: "nav.circles" },
  { to: "/compose", icon: PenLine, key: "nav.compose" },
  { to: "/profile", icon: UserRound, key: "nav.profile" },
  { to: "/safety", icon: ShieldCheck, key: "nav.safety" },
];

/** Desktop: a persistent left rail. */
export function Rail() {
  const locale = useApp((state) => state.preferences.locale);
  const memberships = useApp((state) => state.memberships);
  const t = makeT(locale);

  return (
    <aside className="rail">
      <div className="rail__brand">
        <CaesarLogo size={34} tagline />
      </div>

      {ITEMS.map(({ to, end, icon: Icon, key }) => (
        <NavLink key={to} to={to} end={end} className="rail__link">
          <Icon size={18} aria-hidden="true" />
          <span>{t(key)}</span>
          {key === "nav.circles" && <span className="rail__count">{memberships.length}</span>}
        </NavLink>
      ))}

      <div className="rail__foot">
        <div style={{ fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: 9.5 }}>
          Prototype · {LOCALES.length} languages
        </div>
        <p style={{ marginTop: 6 }}>
          No server. Everything you do here is stored in this browser and nothing leaves it.
        </p>
        <NavLink to="/measure" className="rail__foot-link">
          What this would measure →
        </NavLink>
      </div>
    </aside>
  );
}

/** Mobile: five destinations, and the pen in the middle where a thumb is. */
export function TabBar() {
  const locale = useApp((state) => state.preferences.locale);
  const t = makeT(locale);

  return (
    <nav className="tabbar" aria-label="Main">
      {ITEMS.map(({ to, end, icon: Icon, key }) => (
        <NavLink key={to} to={to} end={end} className="tabbar__link">
          <Icon size={19} aria-hidden="true" />
          <span>{t(key)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default Rail;
