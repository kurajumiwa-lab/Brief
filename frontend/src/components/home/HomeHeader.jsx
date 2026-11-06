import { Link } from "react-router-dom";

/**
 * HOME HEADER — who this is, and how far along the shop is. Nothing else.
 * The completion count is the same one the setup checklist shows (2/6).
 */
export default function HomeHeader({ progress }) {
  const { vendor, done, total, loaded } = progress;
  const name = vendor?.business_name || vendor?.display_name || vendor?.vendor_handle;
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-bold text-ink-1 tracking-tight">
          {name ? `Welcome, ${name}` : "Welcome"}
        </h1>
      </div>
      {loaded && total > 0 && (
        <Link
          to={`/@${vendor?.vendor_handle}?edit=1`}
          aria-label={`Shop set up ${done} of ${total}`}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-edge-1 bg-surface-0 px-3 py-1.5 text-micro font-bold text-ink-2 tabular-nums hover:bg-surface-1"
        >
          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
            <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(done / total) * 100}%` }} />
          </span>
          {done}/{total} set up
        </Link>
      )}
    </header>
  );
}
