import { Link } from "react-router-dom";
import { ArrowRight, TrendingUp } from "lucide-react";

/**
 * BUSINESS PULSE — Simplified to focus on growth only (v3.3).
 *
 * Removed: Listings Live, Open Trades, Supplier Links, Fulfilment Percentage
 * These metrics are now on their dedicated screens.
 *
 * Kept: Business growth focus with heading and single Growth Planner link.
 * This maintains the single source of truth principle.
 */
export default function BusinessPulseSimplified({ headingId = "business-pulse-title", className }) {
  return (
    <div 
      role="region" 
      aria-labelledby={headingId} 
      className={className}
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
            Business pulse
          </p>
          <h2 id={headingId} className="mt-1 text-base font-bold tracking-tight text-ink-1 sm:text-lg">
            Your business today
          </h2>
        </div>
        <Link
          to="/growth"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-500/10 px-3 py-2 text-micro font-bold text-brand-700 hover:bg-brand-500/20 transition-colors dark:bg-brand-500/20 dark:text-brand-300 dark:hover:bg-brand-500/30"
        >
          <TrendingUp size={12} aria-hidden="true" />
          Growth planner
          <ArrowRight size={11} aria-hidden="true" />
        </Link>
      </div>

      {/* Info text explaining the change */}
      <p className="mt-2 text-2xs text-ink-4">
        Detailed metrics available in their dedicated screens: 
        <Link to="/stock" className="text-brand-600 dark:text-brand-400 hover:underline">Listings</Link>,
        <Link to="/orders" className="text-brand-600 dark:text-brand-400 hover:underline"> Trades</Link>,
        <Link to="/network" className="text-brand-600 dark:text-brand-400 hover:underline"> Connections</Link>,
        <Link to="/analytics" className="text-brand-600 dark:text-brand-400 hover:underline"> Performance</Link>.
      </p>
    </div>
  );
}
