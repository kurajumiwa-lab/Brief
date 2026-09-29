import { Link } from 'react-router-dom'
import { Link2, Link2Off, MessageSquare, BadgeCheck, Crown } from 'lucide-react'

const roleTone = { sourcing: 'pill-blue', selling: 'pill-green', both: 'pill-amber', dormant: 'pill-gray' }

/** A vendor as seen by another vendor: handle, role, categories, score, connect. */
export default function VendorCard({ vendor, reasons, score, onConnect, onDisconnect, onMessage, compact = false }) {
  const id = vendor.vendor_id || vendor.id
  const handle = vendor.vendor_handle || vendor.handle
  const connected = vendor.connected ?? Boolean(onDisconnect)
  return (
    <div className={`card ${compact ? 'p-3' : 'p-4'} flex flex-col gap-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/@${handle}`} className="font-medium hover:text-vendor-300 truncate flex items-center gap-1.5">
            {vendor.business_name}
            {vendor.is_verified && <BadgeCheck size={14} className="text-vendor-400" />}
            {vendor.is_patron && <Crown size={13} className="text-amber-400" title="Patron" />}
          </Link>
          <div className="text-xs text-vendor-400">@{handle}</div>
        </div>
        <span className={roleTone[vendor.current_role || vendor.role] || 'pill-gray'}>{vendor.current_role || vendor.role}</span>
      </div>

      {(vendor.business_categories || []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {vendor.business_categories.slice(0, 5).map((c) => <span key={c} className="pill-gray">{c}</span>)}
        </div>
      )}
      {vendor.physical_location && <div className="text-xs text-neutral-500">{vendor.physical_location}</div>}

      {reasons?.length > 0 && (
        <ul className="text-xs text-neutral-400 list-disc list-inside">
          {reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}

      <div className="flex items-center justify-between text-xs text-neutral-500 mt-1">
        <span>network <b className="text-neutral-200">{Math.round(vendor.network_score ?? 0)}</b></span>
        {score != null && <span>pair score <b className="text-vendor-300">{Math.round(score)}</b></span>}
        {vendor.total_stock_moved != null && <span>moved <b className="text-neutral-200">{vendor.total_stock_moved}</b></span>}
      </div>

      {(onConnect || onDisconnect || onMessage) && (
        <div className="flex gap-2 pt-1">
          {connected && onDisconnect ? (
            <button className="btn-ghost flex-1" onClick={() => onDisconnect(id)}><Link2Off size={14} /> Disconnect</button>
          ) : onConnect ? (
            <button className="btn-primary flex-1" onClick={() => onConnect(id)}><Link2 size={14} /> Connect</button>
          ) : null}
          {onMessage && <button className="btn-ghost" onClick={() => onMessage(id)} title="Message"><MessageSquare size={14} /></button>}
        </div>
      )}
    </div>
  )
}
