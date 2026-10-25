import { Check } from "lucide-react";
import { useApp } from "@/store/appStore.js";

/** Short confirmations. Never used for errors that need a decision. */
export default function Toasts() {
  const toasts = useApp((state) => state.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone === "gold" ? "toast--gold" : ""}`}>
          <Check size={14} aria-hidden="true" />
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
