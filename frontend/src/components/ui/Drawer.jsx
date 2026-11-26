import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A side sheet.
 *
 * Two accessibility behaviours a modal sheet is expected to have, and did not:
 *
 *   FOCUS RETURNS. Opening moves focus into the panel; closing puts it back on
 *   the control that opened it. Without the second half a keyboard user lands
 *   on `<body>` and has to tab from the top of the page again, which on a long
 *   screen is the same as losing their place.
 *
 *   THE NAME IS REAL. A `role="dialog"` with no accessible name is announced
 *   as "dialog" and nothing else. When `hideHeader` is set the caller is
 *   drawing its own bar, so it must pass `label` — the fallback is a word, not
 *   a shrug ("Panel" told a screen-reader user nothing about where they were).
 *
 * Content inside the panel is not inert while it is closed: the panel is
 * unmounted by `AnimatePresence`, so there is nothing to trap. Focus *inside*
 * the sheet is bounded by its own scroll container, and the sheet closes on
 * Escape from anywhere.
 */
export default function Drawer({
  open,
  onClose,
  title,
  label,
  description,
  side = "right",
  width = "max-w-md",
  children,
  footer,
  className,
  hideHeader = false,
}) {
  const panelRef = useRef(null);
  const restoreTo = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();

    // Remember what had focus, then move focus into the sheet.
    restoreTo.current = document.activeElement;
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // The panel itself is focusable, so a sheet with no focusable child still
    // receives focus rather than leaving the caret behind the scrim.
    panelRef.current?.focus({ preventScroll: true });

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      const back = restoreTo.current;
      if (back && typeof back.focus === "function" && document.contains(back)) {
        back.focus({ preventScroll: true });
      }
    };
  }, [open, onClose]);

  const fromX = side === "left" ? "-100%" : "100%";
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-ink-1/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label={label || (typeof title === "string" ? title : undefined)}
            aria-labelledby={!label && typeof title !== "string" ? "drawer-title" : undefined}
            aria-describedby={description ? "drawer-description" : undefined}
            initial={{ x: fromX }}
            animate={{ x: 0 }}
            exit={{ x: fromX }}
            transition={{ type: "tween", duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            className={cn(
              "absolute top-0 bottom-0 w-full bg-surface-0 shadow-xl flex flex-col",
              side === "left" ? "left-0 border-r" : "right-0 border-l",
              "border-edge-1",
              width,
              className
            )}
          >
            {/* A panel may own its header. The workspace drawer does: its top
                bar is the product mark plus the business it belongs to, and a
                second "More" bar above that was two titles for one panel. */}
            {!hideHeader && (title || onClose) && (
              <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-edge-1 shrink-0">
                <div className="min-w-0">
                  {title && (
                    <h2 id="drawer-title" className="text-sm font-semibold text-ink-1 truncate">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p id="drawer-description" className="text-2xs text-ink-3 mt-0.5">
                      {description}
                    </p>
                  )}
                </div>
                {onClose && (
                  <button type="button" onClick={onClose} aria-label="Close" className="p-2 -mr-2 rounded-lg text-ink-4 hover:text-ink-1 hover:bg-surface-2 transition-colors">
                    <X size={18} />
                  </button>
                )}
              </div>
            )}
            <div className={cn("flex-1 overflow-y-auto", hideHeader ? "p-0" : "p-5")}>{children}</div>
            {footer && <div className="px-5 py-3 border-t border-edge-1 bg-surface-1 flex items-center justify-end gap-2 shrink-0">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
