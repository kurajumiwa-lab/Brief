import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { ROLES } from '../lib/api'
import { useAuth } from '../hooks/useAuth'

/** "You source today, you sell tomorrow." One click to change what you are doing. */
export default function RoleSwitcher({ compact = false }) {
  const { vendor, switchRole } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!vendor) return null
  const change = async (role) => {
    if (role === vendor.current_role || busy) return
    setBusy(true)
    try { await switchRole(role) } finally { setBusy(false) }
  }
  return (
    <div className={`inline-flex items-center rounded-lg border border-brief-border bg-neutral-900 p-0.5 ${busy ? 'opacity-60' : ''}`} role="radiogroup" aria-label="Current role">
      {!compact && <ArrowLeftRight size={14} className="mx-2 text-neutral-500" />}
      {ROLES.map((r) => (
        <button
          key={r.id}
          role="radio"
          aria-checked={vendor.current_role === r.id}
          title={r.hint}
          onClick={() => change(r.id)}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
            vendor.current_role === r.id ? 'bg-vendor-600 text-white' : 'text-neutral-400 hover:text-neutral-100'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}
