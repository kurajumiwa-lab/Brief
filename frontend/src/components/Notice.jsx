import { AlertCircle, CheckCircle2 } from 'lucide-react'

/** Inline success / error line. `msg` is `{ ok, text }` or null. */
export default function Notice({ msg, className = '' }) {
  if (!msg) return null
  const Icon = msg.ok ? CheckCircle2 : AlertCircle
  return (
    <div className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 border ${msg.ok ? 'border-vendor-800 bg-vendor-900/30 text-vendor-200' : 'border-red-900/60 bg-red-900/30 text-red-200'} ${className}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span>{msg.text}</span>
    </div>
  )
}
