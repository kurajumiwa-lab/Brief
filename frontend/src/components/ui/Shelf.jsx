import { useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Moving shelf" — THE horizontal carousel.
 *
 * One implementation serves every horizontal surface in the product (the home
 * feed's discovery shelves, the dashboard's rails): swipe on touch (native
 * scroll + snap), drag with the mouse, arrow buttons on desktop, arrow keys
 * when the rail has focus.
 *
 * Wrapped inside `components/home/HorizontalCarousel` for the home feed, so
 * the feed never grows a second carousel of its own.
 *
 * SWIPE IS NOT A TAP. A gesture that moves more than `SWIPE_SLOP` px marks the
 * following click as a swipe and suppresses it, so dragging a shelf can never
 * open the card under the thumb. The guard only lives for `SUPPRESS_MS` after
 * the drag, so a deliberate tap straight afterwards still works.
 */

const SWIPE_SLOP = 8;
const SUPPRESS_MS = 320;

export default function Shelf({
  title,
  sub,
  action,
  children,
  className,
  fade = true,
  arrows = "hover",
  ariaLabel,
  tabIndex = 0,
}) {
  const scroller = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const drag = useRef(null);
  const touchStart = useRef({ x: 0, y: 0, moved: false });
  const suppressClickUntil = useRef(0);

  const updateArrows = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > SWIPE_SLOP);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - SWIPE_SLOP);
  }, []);

  const nudge = (dir) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: "smooth" });
  };

  /** A swipe just ended — the click it produces is the swipe, not a choice. */
  const guardClick = () => {
    suppressClickUntil.current = Date.now() + SUPPRESS_MS;
  };

  const onClickCapture = (e) => {
    if (Date.now() < suppressClickUntil.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // touch: the browser owns the scroll; we only watch whether it was a swipe
  const onTouchStart = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY, moved: false };
  };
  const onTouchMove = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    if (
      Math.abs(t.clientX - touchStart.current.x) > SWIPE_SLOP ||
      Math.abs(t.clientY - touchStart.current.y) > SWIPE_SLOP
    ) {
      touchStart.current.moved = true;
    }
  };
  const onTouchEnd = () => {
    if (touchStart.current.moved) guardClick();
    touchStart.current.moved = false;
  };

  // mouse drag-to-scroll
  const onPointerDown = (e) => {
    if (e.pointerType !== "mouse") return;
    const el = scroller.current;
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
  };
  const onPointerMove = (e) => {
    if (!drag.current || e.pointerType !== "mouse") return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > SWIPE_SLOP) drag.current.moved = true;
    scroller.current.scrollLeft = drag.current.left - dx;
  };
  const endDrag = () => {
    if (drag.current?.moved) {
      const el = scroller.current;
      el.scrollTo({ left: el.scrollLeft, behavior: "smooth" }); // re-snap
      guardClick();
    }
    drag.current = null;
  };

  const label = ariaLabel || (typeof title === "string" ? title : "shelf");

  return (
    <section className={cn("group/shelf relative", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-2.5 px-0.5">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-ink-1 leading-tight">{title}</h3>}
            {sub && <p className="text-xs text-ink-4 mt-0.5">{sub}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {action}
            <div
              className={cn(
                "hidden md:flex items-center gap-1 transition-opacity",
                arrows === "hover" && "opacity-0 group-hover/shelf:opacity-100 focus-within:opacity-100"
              )}
            >
              <button
                type="button"
                onClick={() => nudge(-1)}
                disabled={!canLeft}
                aria-label="Scroll shelf left"
                className="p-1.5 rounded-full glass text-ink-3 hover:text-ink-1 disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={() => nudge(1)}
                disabled={!canRight}
                aria-label="Scroll shelf right"
                className="p-1.5 rounded-full glass text-ink-3 hover:text-ink-1 disabled:opacity-30"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
      <div className={cn("relative", fade && "shelf-fade")}>
        <div
          ref={scroller}
          onScroll={updateArrows}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClickCapture={onClickCapture}
          tabIndex={tabIndex}
          className={cn("shelf select-none", "cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40")}
          role="list"
          aria-roledescription="carousel"
          aria-label={label}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

/**
 * One shelf slot: enters with the stagger, then drifts while idle.
 * Pass `float={false}` for dense shelves that shouldn't sway.
 */
export function ShelfItem({ children, className, float = true, index = 0, onClick, style }) {
  return (
    <motion.div
      role="listitem"
      onClick={onClick}
      initial={{ opacity: 0, y: 14, x: -12 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ delay: 0.05 * index, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn("shelf-item", float && "animate-float", onClick && "cursor-pointer", className)}
      style={{ animationDelay: `${index * 0.6}s`, ...style }}
    >
      {children}
    </motion.div>
  );
}

/** Small pop for shelf-level toasts etc. (kept for API completeness). */
export { AnimatePresence };
