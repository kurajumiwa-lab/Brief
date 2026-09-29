import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Spinner({ size = 20, className, label }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 text-ink-4", className)} role="status" aria-live="polite">
      <Loader2 size={size} className="animate-spin text-brand-500" />
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}

export function PageSpinner({ label = "Loading…" }) {
  return <Spinner className="py-20" size={24} label={label} />;
}
