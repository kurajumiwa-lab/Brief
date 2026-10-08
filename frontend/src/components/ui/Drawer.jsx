import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Drawer({ open, onClose, title, description, side = "right", width = "max-w-md", children, footer, className }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const fromX = side === "left" ? "-100%" : "100%";
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-ink-1/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : "Panel"}
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
            {(title || onClose) && (
              <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-edge-1 shrink-0">
                <div className="min-w-0">
                  {title && <h2 className="text-sm font-semibold text-ink-1 truncate">{title}</h2>}
                  {description && <p className="text-2xs text-ink-3 mt-0.5">{description}</p>}
                </div>
                {onClose && (
                  <button type="button" onClick={onClose} aria-label="Close" className="p-2 -mr-2 rounded-lg text-ink-4 hover:text-ink-1 hover:bg-surface-2 transition-colors">
                    <X size={18} />
                  </button>
                )}
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
            {footer && <div className="px-5 py-3 border-t border-edge-1 bg-surface-1 flex items-center justify-end gap-2 shrink-0">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
