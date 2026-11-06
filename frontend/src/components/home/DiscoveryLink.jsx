import { Link } from "react-router-dom";
import { ArrowRight, Compass } from "lucide-react";

/**
 * DISCOVERY SHORTCUT — one line to the marketplace. Discovery owns offers,
 * suppliers and product browsing; Home does not repeat any of it.
 */
export default function DiscoveryLink() {
  return (
    <Link
      to="/explore"
      className="flex items-center gap-3 rounded-2xl border border-edge-1 bg-surface-0 px-4 py-3 hover:bg-surface-1"
    >
      <Compass size={16} className="shrink-0 text-brand-700 dark:text-brand-400" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-xs font-semibold text-ink-1">Find suppliers, goods and offers in Discovery</span>
      <ArrowRight size={14} className="shrink-0 text-ink-4" aria-hidden="true" />
    </Link>
  );
}
