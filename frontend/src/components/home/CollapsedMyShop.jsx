import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, Package, Plus, Share2, Store } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toast";
import { getStockVisibilityStatus } from "@/components/stock/StockCard";
import { useAuthStore } from "@/stores/authStore";
import { useStockStore } from "@/stores/stockStore";
import { appUrl, shareLink } from "@/lib/share";
import { currency, num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * YOUR SHOP — the door to managing your own listings, folded shut.
 *
 * Home is for discovering the network; managing your own listings is a
 * different job and it lives where that job lives (`/stock`). What stays on
 * Home is the door:
 *
 *   collapsed  ── who the shop is, its live counts, and one clear way in
 *   expanded   ── a compact summary: the listings that are published, and the
 *                 same actions the shop has always had (add, preview, share,
 *                 and the full management screen)
 *
 * **The layout, fixed (v3.2).** The old card put the mark, the title, the
 * counts *and* two buttons on one line. On a phone that left the text column
 * about a dozen characters wide, so "2 published · 3 on your shelf · 1 not
 * visible to buyers" broke into four lines while the buttons kept their full
 * width. The card is now a two-row composition instead: identity and counts
 * own the width they need, and the actions sit on their own row — full width on
 * a phone, tucked to the right from `sm` up — so nothing is squeezed and the
 * primary action is visibly the primary action.
 *
 * Nothing about stock management is re-implemented here: the rows link into the
 * Stock Room's own filtered view (`/stock?search=…`), where editing, hiding and
 * deleting already work, and visibility comes from `getStockVisibilityStatus`,
 * the single source of truth for what "published" means.
 *
 * Counts are shown only when the shelf has actually been read — an invented
 * number would be worse than no number.
 */
export default function CollapsedMyShop({ className }) {
  const vendor = useAuthStore((s) => s.vendor);
  const mine = useStockStore((s) => s.mine);
  const mineLoaded = useStockStore((s) => s.mineLoaded);
  const fetchMine = useStockStore((s) => s.fetchMine);
  const [open, setOpen] = useState(false); // collapsed on initial load, always

  useEffect(() => {
    // One read of the shelf, shared with anything else that needs it (the
    // store collapses concurrent calls), and never repeated once loaded.
    if (!mineLoaded && !mine.length) fetchMine?.().catch(() => {});
  }, [mineLoaded, mine.length, fetchMine]);

  const listings = useMemo(
    () => (mine || []).map((item) => ({ item, status: getStockVisibilityStatus(item) })),
    [mine]
  );
  const published = useMemo(() => listings.filter(({ status }) => status.isPublished), [listings]);
  const hidden = listings.length - published.length;
  const countsKnown = mineLoaded || listings.length > 0;

  const shareShop = async () => {
    if (!vendor?.vendor_handle) return;
    const result = await shareLink({
      title: vendor.business_name,
      text: `What ${vendor.business_name} has on the shelf right now`,
      url: appUrl(`/@${vendor.vendor_handle}`),
    });
    if (result === "copied") toast.success("Shop link copied");
    if (result === "failed") toast.error("This device couldn't open the share sheet.");
  };

  if (!vendor) return null;

  return (
    <section
      aria-labelledby="my-shop-heading"
      data-testid="home-your-shop"
      data-shop-state={open ? "expanded" : "collapsed"}
      className={cn("rounded-3xl border border-edge-1 bg-surface-0 shadow-xs", className)}
    >
      {/* ── the folded state ─────────────────────────────────────────────
          A phone stacks identity above the actions; from `sm` the same two
          blocks sit on one line, actions to the right. It is ONE action set
          either way — a duplicated row would give a screen reader the same
          button twice. */}
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
            aria-hidden="true"
          >
            <Store size={19} />
          </span>

          <div className="min-w-0 flex-1">
            <h2 id="my-shop-heading" className="text-sm font-bold text-ink-1">
              My Shop
            </h2>
            <p className="mt-0.5 text-2xs text-ink-3">Manage your published listings.</p>
            <p className="mt-1 text-micro text-ink-4" data-testid="my-shop-counts">
              {countsKnown ? (
                <>
                  <span className="font-semibold text-ink-2">{num(published.length)} published</span>
                  {listings.length > 0 ? ` · ${num(listings.length)} on your shelf` : ""}
                  {hidden > 0 ? ` · ${num(hidden)} not visible to buyers` : ""}
                </>
              ) : (
                "Reading your shelf…"
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/stock"
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-700 px-3.5 text-2xs font-bold text-white transition-colors hover:bg-brand-800 sm:h-9 sm:flex-none"
          >
            <Package size={14} aria-hidden="true" />
            Manage shop
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="my-shop-summary"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-edge-2 bg-surface-1 px-3 text-2xs font-semibold text-ink-2 sm:h-9",
              "transition-colors hover:border-edge-3 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            )}
          >
            {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            {open ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {/* ── the summary, on demand ─────────────────────────────────────── */}
      {open && (
        <div id="my-shop-summary" className="animate-fade-in space-y-3 border-t border-edge-1 p-4">
          {listings.length === 0 ? (
            <p className="text-2xs text-ink-3">
              Nothing on your shelf yet. Add your first item and it appears on your shop front and in Browse.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="brand" size="sm">{num(published.length)} published</Badge>
                {hidden > 0 && <Badge variant="gray" size="sm">{num(hidden)} draft or hidden</Badge>}
                <Badge variant="outline" size="sm">{num(listings.length)} total</Badge>
              </div>

              <ul className="divide-y divide-edge-1 overflow-hidden rounded-2xl border border-edge-1 bg-surface-1">
                {published.slice(0, 4).map(({ item, status }) => (
                  <li key={item.id}>
                    <Link
                      to={`/stock?search=${encodeURIComponent(item.name || "")}`}
                      className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-ink-1">{item.name}</span>
                        <span className="block text-micro text-ink-4 tabular-nums">
                          {item.unit_price != null ? `${currency(item.unit_price)} · ` : "No price · "}
                          {num(item.quantity_available ?? item.quantity_in_stock ?? 0)} {item.unit_of_measure || "units"} available
                        </span>
                      </span>
                      <Badge variant={status.variant} size="xs">{status.label}</Badge>
                    </Link>
                  </li>
                ))}
                {published.length > 4 && (
                  <li className="px-3 py-2 text-micro text-ink-4">
                    {num(published.length - 4)} more published {published.length - 4 === 1 ? "listing" : "listings"} in the shop
                  </li>
                )}
                {published.length === 0 && (
                  <li className="px-3 py-2 text-micro text-ink-4">
                    Nothing published yet — finish the listings above to put them in front of buyers.
                  </li>
                )}
              </ul>
            </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/stock?new=1"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-700 px-3.5 text-2xs font-bold text-white transition-colors hover:bg-brand-800"
            >
              <Plus size={14} aria-hidden="true" /> Add stock
            </Link>
            <Link
              to={`/@${vendor.vendor_handle}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-edge-2 bg-surface-0 px-3 text-2xs font-semibold text-ink-1 transition-colors hover:bg-surface-2"
            >
              <Store size={14} aria-hidden="true" /> Preview shop
            </Link>
            <button
              type="button"
              onClick={shareShop}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-edge-2 bg-surface-0 px-3 text-2xs font-semibold text-ink-1 transition-colors hover:bg-surface-2"
            >
              <Share2 size={14} aria-hidden="true" /> Share shop
            </button>
            <Link
              to="/stock"
              className="ml-auto inline-flex h-9 items-center gap-1 rounded-xl px-1 text-2xs font-semibold text-brand-700 hover:underline underline-offset-2 dark:text-brand-400"
            >
              Full shop management →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
