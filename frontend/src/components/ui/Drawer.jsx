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
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const fromX = side === "left" ? "-100%" : "100%";
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x: fromX }}
            animate={{ x: 0 }}
            exit={{ x: fromX }}
            transition={{ type: "tween", duration: 0.22 }}
            className={cn(
              "absolute top-0 bottom-0 w-full glass-strong shadow-2xl flex flex-col",
              side === "left" ? "left-0" : "right-0",
              width,
              className
            )}
          >
            {(title || onClose) && (
              <div className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  {title && <h2 className="text-sm font-semibold text-ink-1 truncate">{title}</h2>}
                  {description && <p className="text-xs text-ink-4 mt-0.5">{description}</p>}
                </div>
                {onClose && (
                  <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-ink-4 hover:text-ink-1 hover:bg-surface-3">
                    <X size={16} />
                  </button>
                )}
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
            {footer && <div className="px-5 py-3 border-t border-edge-1 flex items-center justify-end gap-2">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
