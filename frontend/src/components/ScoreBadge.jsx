/** Small metric chip used in the top bar and on vendor cards. */
export default function ScoreBadge({ label, value, tone = 'green' }) {
  const tones = {
    green: 'border-vendor-800 bg-vendor-900/30 text-vendor-300',
    blue: 'border-sky-900 bg-sky-900/30 text-sky-300',
    gray: 'border-neutral-700 bg-neutral-800 text-neutral-300',
  }
  return (
    <div className={`rounded-lg border px-2.5 py-1 leading-tight ${tones[tone] || tones.green}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value == null ? '—' : Number(value).toFixed(value % 1 ? 1 : 0)}</div>
    </div>
  )
}
