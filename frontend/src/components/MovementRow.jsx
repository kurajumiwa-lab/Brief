import { ArrowDownLeft, ArrowUpRight, Check, Truck, PackageCheck, XCircle } from 'lucide-react'
import { fmt } from '../lib/api'

const statusTone = {
  pending: 'pill-amber', confirmed: 'pill-blue', in_transit: 'pill-blue', received: 'pill-green', cancelled: 'pill-red',
}

/**
 * One line of the movement ledger with the next legal action for this side:
 * supplier confirms then ships; buyer receives; either side cancels before receipt.
 */
export default function MovementRow({ m, onAction, busy }) {
  const incoming = m.direction === 'incoming'
  const actions = []
  if (!incoming && m.status === 'pending') actions.push({ id: 'confirm', label: 'Confirm', icon: Check })
  if (!incoming && m.status === 'confirmed') actions.push({ id: 'ship', label: 'Mark shipped', icon: Truck })
  if (incoming && (m.status === 'confirmed' || m.status === 'in_transit')) actions.push({ id: 'receive', label: 'Received', icon: PackageCheck })
  if (['pending', 'confirmed', 'in_transit'].includes(m.status)) actions.push({ id: 'cancel', label: 'Cancel', icon: XCircle, danger: true })

  return (
    <div className="card p-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className={`shrink-0 rounded-lg p-2 ${incoming ? 'bg-sky-900/30 text-sky-300' : 'bg-vendor-900/30 text-vendor-300'}`}>
        {incoming ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium truncate">{m.stock_name}</span>
          {m.sku && <span className="font-mono text-xs text-neutral-500">{m.sku}</span>}
          <span className={statusTone[m.status] || 'pill-gray'}>{m.status.replace('_', ' ')}</span>
        </div>
        <div className="text-xs text-neutral-500 mt-0.5">
          {incoming ? <>from <b className="text-neutral-300">@{m.from_handle}</b></> : <>to <b className="text-neutral-300">@{m.to_handle}</b></>}
          {' · '}{fmt.num(m.quantity)} × {fmt.money(m.unit_price)} = <b className="text-neutral-200">{fmt.money(m.total_value)}</b>
          {' · '}{fmt.ago(m.created_at)}
          {m.notes && <span className="italic"> · “{m.notes}”</span>}
        </div>
      </div>
      {actions.length > 0 && (
        <div className="flex gap-1.5 shrink-0">
          {actions.map(({ id, label, icon: Icon, danger }) => (
            <button key={id} disabled={busy} onClick={() => onAction?.(m, id)} className={`${danger ? 'btn-danger' : 'btn-primary'} !py-1.5 !px-2.5 text-xs`}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
