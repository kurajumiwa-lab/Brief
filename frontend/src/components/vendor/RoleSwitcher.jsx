import { useState } from "react";
import { VENDOR_ROLES } from "@/config/constants";
import { useAuthStore } from "@/stores/authStore";
import { useVendorStore } from "@/stores/vendorStore";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Inline role switcher. `compact` renders emoji-only (collapsed sidebar);
 * default renders a 2×2 grid with labels.
 */
export default function RoleSwitcher({ compact = false, className }) {
  const role = useAuthStore((s) => s.vendor?.current_role);
  const switchRole = useVendorStore((s) => s.switchRole);
  const [busy, setBusy] = useState(null);

  const pick = async (value) => {
    if (value === role || busy) return;
    setBusy(value);
    try {
      await switchRole(value);
      const meta = VENDOR_ROLES.find((r) => r.value === value);
      toast.success(`You're now ${meta?.label.toLowerCase()}`);
    } catch (e) {
      toast.error(apiError(e, "Couldn't switch role"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cn(compact ? "flex flex-col gap-1" : "grid grid-cols-2 gap-1", className)} role="radiogroup" aria-label="Current role">
      {VENDOR_ROLES.map((r) => {
        const active = r.value === role;
        return (
          <button
            key={r.value}
            role="radio"
            aria-checked={active}
            title={`${r.label} — ${r.hint}`}
            onClick={() => pick(r.value)}
            disabled={!!busy}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border text-xs transition-colors disabled:opacity-60",
              compact ? "justify-center h-8 w-8" : "px-2 py-1.5",
              active ? "border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400" : "border-edge-1 bg-surface-2 text-ink-3 hover:border-edge-2 hover:text-ink-1",
              busy === r.value && "animate-pulse"
            )}
          >
            <span className="text-sm leading-none">{r.emoji}</span>
            {!compact && <span className="truncate">{r.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
