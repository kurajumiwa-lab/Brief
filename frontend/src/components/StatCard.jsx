export default function StatCard({ icon: Icon, label, value, hint, tone = 'green' }) {
  const tones = { green: 'text-vendor-400', blue: 'text-sky-400', amber: 'text-amber-400', gray: 'text-neutral-400' }
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>
        {Icon && <Icon size={16} className={tones[tone]} />}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value ?? '—'}</div>
      {hint && <div className="text-xs text-neutral-500 mt-1">{hint}</div>}
    </div>
  )
}
