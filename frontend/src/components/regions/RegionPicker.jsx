import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Check, ChevronDown, MapPin, Search } from "lucide-react";
import { COUNTRIES, REGIONS, regionLabel, regionPath } from "@/config/regions";
import { cn } from "@/lib/utils";

const GUTTER = 8; // px of breathing room between the panel and any edge
const PANEL_WIDTH = 352; // 22rem — the list never gets wider than this
const PANEL_MAX_DESKTOP = 560; // px — a desktop column, not a full-height scroller

/**
 * THE REGION KNOB.
 *
 * Discovery used to open on a market — "Gikomba" — because the app thought a
 * physical gate was the unit of geography. A market is one address; the people
 * who trade there do not stop at the gate. This control picks a region instead:
 * a corridor with a hub city, which is what the results are actually around.
 *
 * It is a knob, not a settings screen: one press opens the list, one press
 * closes it, and the currently chosen region is always the label.
 *
 * THE SEARCH BAR IS PERMANENT. The knob sits in the region masthead, which
 * scrolls away; the search + quick filters directly underneath it stick to the
 * top. An absolutely positioned panel inside the masthead therefore opened
 * *over* that sticky bar (equal z-index, later stacking context) and made
 * search unusable while the list was open — the whole point of the knob is to
 * narrow what search returns.
 *
 * So the panel is portalled to the body and placed with `fixed` coordinates
 * that are always at or below the bottom edge of the sticky bar it must not
 * cover (`avoidSelector`). It keeps its internal scroll, stays inside the
 * viewport on a narrow phone, and sits above page content but *below* the
 * sticky search bar (z-30): if the geometry is ever off by a frame, the search
 * wins the paint, never the list.
 */
export default function RegionPicker({ region, onSelect, className, avoidSelector }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [placement, setPlacement] = useState(null);
  const knobRef = useRef(null);
  const panelRef = useRef(null);

  const place = useCallback(() => {
    const knob = knobRef.current;
    if (!knob || typeof window === "undefined") return;

    const viewportW = window.innerWidth || 0;
    const viewportH = window.innerHeight || 0;
    const rect = knob.getBoundingClientRect();

    const width = Math.max(0, Math.min(PANEL_WIDTH, viewportW - GUTTER * 2));
    // Opens under the knob, but never above the sticky search bar: whichever
    // edge is lower wins, so the chip row stays visible and tappable.
    let top = rect.bottom + GUTTER;
    const bar = avoidSelector ? document.querySelector(avoidSelector) : null;
    if (bar) {
      const barRect = bar.getBoundingClientRect();
      // Below whichever edge is lower: the knob's, or the pinned bar's. The
      // bar stays put while the masthead scrolls, so the list keeps clearing
      // search even as the page moves under it.
      if (barRect.bottom > 0) top = Math.max(top, barRect.bottom + GUTTER);
    }

    // Right-aligned under the knob, then clamped so the panel cannot hang off
    // the side of a narrow screen.
    const rightAligned = rect.right - width;
    const maxLeft = Math.max(GUTTER, viewportW - GUTTER - width);
    const left = Math.min(Math.max(GUTTER, rightAligned), maxLeft);

    // Leave room for the phone's bottom tab bar: the list scrolls, it never
    // runs underneath the tabs.
    const tabs = document.querySelector('nav[aria-label="Primary mobile"]');
    const tabsHeight = tabs ? tabs.getBoundingClientRect().height || 0 : 0;
    const reserve = (tabsHeight > 0 ? tabsHeight : 0) + GUTTER * 2;
    let maxHeight = Math.max(160, viewportH - top - reserve);
    if (viewportW >= 640) maxHeight = Math.min(maxHeight, PANEL_MAX_DESKTOP);

    setPlacement({ top, left, width, maxHeight });
  }, [avoidSelector]);

  // Measured before paint, then kept honest while the page scrolls (the
  // masthead scrolls away, the sticky bar does not) or the phone rotates.
  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const onResize = () => place();
    const onScroll = (event) => {
      // Scrolling the list itself is not the page moving.
      if (panelRef.current?.contains(event.target)) return;
      place();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      knobRef.current?.focus?.();
    };
    const onOutside = (event) => {
      if (knobRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, [open]);

  const needle = search.trim().toLowerCase();
  const groups = COUNTRIES.map((country) => ({
    ...country,
    regions: REGIONS.filter((item) => {
      if (item.country !== country.code) return false;
      if (!needle) return true;
      return [item.name, item.hub, ...item.aliases, ...item.knownFor]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    }),
  })).filter((group) => group.regions.length > 0);

  function choose(item) {
    onSelect?.(item);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className={cn("min-w-0", className)}>
      <button
        ref={knobRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? "region-picker-panel" : undefined}
        data-testid="region-picker"
        className="inline-flex h-8 min-w-0 max-w-full items-center gap-1 rounded-full border border-edge-1 bg-surface-1 px-2.5 text-2xs font-semibold text-ink-2 transition-colors hover:border-ink-4 hover:text-ink-1"
      >
        <MapPin size={12} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
        <span className="truncate" data-testid="region-picker-label">
          {regionLabel(region)}
        </span>
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={cn("shrink-0 text-ink-4 transition-transform", open && "rotate-180")}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id="region-picker-panel"
            role="dialog"
            aria-label="Choose a region"
            data-testid="region-picker-panel"
            style={
              placement
                ? {
                    top: placement.top,
                    left: placement.left,
                    width: placement.width,
                    maxHeight: placement.maxHeight,
                  }
                : undefined
            }
            className="fixed z-[25] overflow-y-auto overscroll-contain rounded-2xl border border-edge-1 bg-surface-0 p-3 shadow-xl"
          >
            <label htmlFor="region-picker-search" className="sr-only">
              Find a region or town
            </label>
            <div className="relative">
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"
              />
              <input
                id="region-picker-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Region, town or trade"
                className="h-9 w-full rounded-lg border border-edge-1 bg-surface-1 pl-8 pr-3 text-xs text-ink-1 placeholder:text-ink-4 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>

            {groups.length === 0 ? (
              <p className="px-1 py-4 text-xs text-ink-4">
                No region matches “{search.trim()}”. Try a town, or browse all regions.
              </p>
            ) : (
              groups.map((country) => (
                <div key={country.code} className="mt-3">
                  <p className="px-1 text-micro font-bold uppercase tracking-[0.12em] text-ink-4">
                    {country.name}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {country.regions.map((item) => {
                      const active = item.slug === region?.slug;
                      return (
                        <li key={item.slug}>
                          <button
                            type="button"
                            onClick={() => choose(item)}
                            aria-pressed={active}
                            data-testid={`region-option-${item.slug}`}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                              active ? "bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-200" : "hover:bg-surface-2",
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-bold text-ink-1">{item.name}</span>
                              <span className="block truncate text-micro text-ink-4">
                                {item.hub} · {item.knownFor.slice(0, 2).join(" · ")}
                              </span>
                            </span>
                            {active && <Check size={14} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-edge-1 pt-2.5">
              <Link
                to="/regions/all"
                onClick={() => setOpen(false)}
                className="text-micro font-bold text-brand-700 hover:underline dark:text-brand-300"
              >
                All regions
              </Link>
              {region && (
                <Link
                  to={regionPath(region)}
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-1 text-micro font-semibold text-ink-3 hover:text-ink-1"
                >
                  Open {region.name} <ChevronDown size={11} className="-rotate-90" aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
