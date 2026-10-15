import { Link } from "react-router-dom";
import { DISCOVERY_SHORTCUTS } from "@/config/navigation";

/**
 * COMPACT DISCOVERY SHORTCUTS
 *
 * Six chips, one swipe wide, each one a link to a destination that already
 * exists: the four Browse job views, the tools & rentals browser, and the tasks
 * hub where jobs and call-ups live. No category list is created here — the
 * chips are doors, so nothing is duplicated and nothing needs maintaining when
 * the taxonomy changes.
 *
 * It is wrapped at both ends (not the round rail) so a short row reads as
 * deliberate on a wide screen.
 */
export default function DiscoveryShortcuts({ className }) {
  return (
    <nav aria-label="Find your way around the network" className={className}>
      <ul className="-mx-1 flex gap-2 overflow-x-auto no-scrollbar px-1 pb-1">
        {DISCOVERY_SHORTCUTS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="shrink-0">
            <Link
              to={to}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-edge-2 bg-surface-0 px-3.5 text-2xs font-semibold text-ink-2 transition-colors hover:border-brand-500/50 hover:bg-brand-50 hover:text-brand-800 dark:hover:bg-brand-500/10 dark:hover:text-brand-300"
            >
              <Icon size={14} className="text-brand-700 dark:text-brand-300" aria-hidden="true" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
