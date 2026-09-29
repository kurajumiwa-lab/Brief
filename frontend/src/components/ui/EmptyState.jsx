import { cn } from "@/lib/utils";

export default function EmptyState({ icon: Icon, title, description, action, className, compact }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-edge-2 bg-surface-1/40", compact ? "py-8 px-4" : "py-16 px-6", className)}>
      {Icon && (
        <div className="w-11 h-11 rounded-xl bg-surface-3 border border-edge-2 flex items-center justify-center text-ink-4 mb-3">
          <Icon size={20} />
        </div>
      )}
      <h3 className="text-sm font-semibold text-ink-2">{title}</h3>
      {description && <p className="text-xs text-ink-4 mt-1 max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
