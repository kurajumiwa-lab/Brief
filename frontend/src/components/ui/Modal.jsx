import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const sizes = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" };

/**
 * v3 modal — a bottom sheet on a phone, a centred dialog on a desktop.
 * Focus is trapped and returned, Escape closes, the page behind cannot scroll.
 */
export default function Modal({ open, onClose, title, description, size = "md", footer, children, className }) {
  const panelRef = useRef(null);
  const returnTo = useRef(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape") return onClose?.();
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = panelRef.current.querySelectorAll(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => panelRef.current?.querySelector("[autofocus],button,input,select,textarea")?.focus?.(), 60);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      returnTo.current?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-ink-1/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : undefined}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 34, mass: 0.85 }}
            className={cn(
              "relative w-full bg-surface-0 border border-edge-1 shadow-xl",
              "rounded-t-3xl sm:rounded-2xl flex flex-col max-h-[92vh] overflow-hidden",
              sizes[size],
              className
            )}
          >
            {/* grab handle — the sheet affordance on touch */}
            <div className="sm:hidden pt-2.5 pb-1 flex justify-center" aria-hidden="true">
              <span className="h-1 w-10 rounded-full bg-edge-3" />
            </div>
            {(title || onClose) && (
              <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-edge-1">
                <div className="min-w-0">
                  {title && <h2 className="text-base font-semibold text-ink-1">{title}</h2>}
                  {description && <p className="text-2xs text-ink-3 mt-1 leading-relaxed">{description}</p>}
                </div>
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="p-2 -mr-2 -mt-1 rounded-lg text-ink-4 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            )}
            <div className="px-5 py-4 overflow-y-auto">{children}</div>
            {footer && <div className="px-5 py-3 flex items-center justify-end gap-2 bg-surface-1 border-t border-edge-1">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
