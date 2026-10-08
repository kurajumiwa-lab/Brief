import { cn } from "@/lib/utils";

/**
 * Every empty state answers three questions: what is missing, why, and what
 * to do next. An empty screen without an action is a dead end.
 */
export default function EmptyState({ icon: Icon, title, description, action, secondaryAction, className, compact, tone = "neutral" }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-4",
    brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300",
    danger: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300",
  };
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center rounded-2xl border border-edge-1 border-dashed bg-surface-1",
        compact ? "py-10 px-5" : "py-16 px-6",
        className
      )}
    >
      {Icon && (
        <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-4", tones[tone] || tones.neutral)}>
          <Icon size={22} aria-hidden="true" />
        </div>
      )}
      <h3 className="text-base font-semibold text-ink-1">{title}</h3>
      {description && <p className="text-xs text-ink-3 mt-1.5 max-w-sm leading-relaxed text-pretty">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
