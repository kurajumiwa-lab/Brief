import { cn } from "@/lib/utils";

export default function Stat({ label, value, hint, icon: Icon, tone = "default", className, onClick }) {
  const tones = { default: "text-ink-1", brand: "text-brand-400", amber: "text-amber-400", blue: "text-blue-400", red: "text-red-400" };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cn("rounded-xl border border-edge-1 bg-surface-1 p-4 text-left", onClick && "hover:border-edge-2 hover:bg-surface-2/60 transition-colors", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs uppercase tracking-wider text-ink-4 font-medium">{label}</span>
        {Icon && <Icon size={14} className="text-ink-4" />}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold font-mono tabular-nums leading-none", tones[tone])}>{value}</div>
      {hint && <p className="mt-2 text-2xs text-ink-4">{hint}</p>}
    </Tag>
  );
}
