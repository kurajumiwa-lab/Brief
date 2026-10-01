import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

export default function Modal({ open, onClose, title, description, size = "md", footer, children, className }) {
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

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : undefined}
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.9 }}
            className={cn(
              "relative w-full glass-strong rounded-t-2xl sm:rounded-3xl flex flex-col max-h-[92vh] overflow-hidden",
              sizes[size],
              className
            )}
          >
            {(title || onClose) && (
              <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
                <div>
                  {title && <h2 className="text-base font-semibold text-ink-1">{title}</h2>}
                  {description && <p className="text-xs text-ink-4 mt-1">{description}</p>}
                </div>
                {onClose && (
                  <button onClick={onClose} aria-label="Close" className="p-1.5 -mr-1.5 -mt-1.5 rounded-lg text-ink-4 hover:text-ink-1 hover:bg-white/5">
                    <X size={16} />
                  </button>
                )}
              </div>
            )}
            <div className="px-5 pb-5 overflow-y-auto">{children}</div>
            {footer && <div className="px-5 py-3 flex items-center justify-end gap-2 bg-white/[0.03] rounded-b-2xl">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
