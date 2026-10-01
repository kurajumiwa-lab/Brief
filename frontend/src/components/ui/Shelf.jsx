import { useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Moving shelf" — a horizontal swipe carousel.
 *
 * Swipe on touch (native scroll + snap), drag with the mouse (pointer
 * handler), arrow keys / buttons on desktop. Children enter with a stagger
 * and drift gently while idle (the `float` animation).
 */
export default function Shelf({ title, sub, action, children, className, itemClassName, fade = true }) {
  const scroller = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const drag = useRef(null);

  const updateArrows = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  }, []);

  const nudge = (dir) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: "smooth" });
  };

  // mouse drag-to-scroll (pointer events; touch keeps native momentum)
  const onPointerDown = (e) => {
    if (e.pointerType !== "mouse") return;
    const el = scroller.current;
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
  };
  const onPointerMove = (e) => {
    if (!drag.current || e.pointerType !== "mouse") return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    scroller.current.scrollLeft = drag.current.left - dx;
  };
  const endDrag = () => {
    if (drag.current?.moved) {
      const el = scroller.current;
      el.scrollTo({ left: el.scrollLeft, behavior: "smooth" }); // re-snap
    }
    drag.current = null;
  };

  return (
    <section className={cn("group/shelf relative", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-2.5 px-0.5">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink-1 leading-tight">{title}</h3>
            {sub && <p className="text-xs text-ink-4 mt-0.5">{sub}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {action}
            <div className="hidden md:flex items-center gap-1 opacity-0 group-hover/shelf:opacity-100 transition-opacity">
              <button
                onClick={() => nudge(-1)}
                disabled={!canLeft}
                aria-label="Scroll shelf left"
                className="p-1.5 rounded-full glass text-ink-3 hover:text-ink-1 disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              <button
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
          className={cn("shelf select-none", "cursor-grab active:cursor-grabbing")}
          role="list"
          aria-label={typeof title === "string" ? title : "shelf"}
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
