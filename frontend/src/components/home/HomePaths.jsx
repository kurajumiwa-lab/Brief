import { Link } from "react-router-dom";
import { Bell, Compass, Plus, UserRound } from "lucide-react";

/**
 * CHOOSE YOUR PATH — four doors, all always open. Nothing here is locked, gated or ordered by
 * completion. Each door is an existing screen; no route is added. The person picks the path.
 */
const PATHS = [
  { to: "/explore", label: "Discover", hint: "Suppliers, goods and services near you", icon: Compass },
  { to: "/activity", label: "Connect", hint: "Messages, requests and trades", icon: Bell },
  { to: "/me", label: "My World", hint: "Your profile, shop and purchases", icon: UserRound },
  { to: "/create", label: "Create", hint: "Publish something or sell it", icon: Plus },
];

export default function HomePaths() {
  return (
    <nav aria-label="Choose your path" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {PATHS.map(({ to, label, hint, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="group flex flex-col gap-2 rounded-2xl border border-edge-1 bg-surface-0 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-surface-2 dark:text-brand-300">
            <Icon size={18} aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold text-ink-1">{label}</span>
          <span className="text-xs leading-snug text-ink-3">{hint}</span>
        </Link>
      ))}
    </nav>
  );
}
