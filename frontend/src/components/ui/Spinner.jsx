import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Spinner({ size = 20, className, label }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 text-ink-4", className)} role="status" aria-live="polite">
      <Loader2 size={size} className="animate-spin text-brand-600" aria-hidden="true" />
      {label && <span className="text-2xs">{label}</span>}
      {!label && <span className="sr-only">Loading</span>}
    </div>
  );
}

export function PageSpinner({ label = "Loading…" }) {
  return <Spinner className="py-20" size={24} label={label} />;
}
