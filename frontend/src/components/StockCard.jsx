import { Package, Pencil, Trash2, ArrowDownToLine, MessageSquare, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { fmt } from '../lib/api'

const sourceLabel = { manual: 'manual', pos_sync: 'POS', bulk_import: 'CSV', network_transfer: 'network' }

/**
 * One stock line. `mine` shows the owner controls (edit / close line);
 * otherwise it shows Source + deal-room actions for a network item.
 */
export default function StockCard({ item, mine = false, onEdit, onRemove, onSource, onDeal }) {
  const low = item.quantity_available <= 0
  const price = item.wholesale_price ?? item.unit_price
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-vendor-500 shrink-0" />
            <h3 className="font-medium truncate">{item.name}</h3>
          </div>
          <div className="mt-1 text-xs text-neutral-500 flex flex-wrap gap-x-2">
            {item.sku && <span className="font-mono">{item.sku}</span>}
            <span>{item.category}{item.subcategory ? ` / ${item.subcategory}` : ''}</span>
            {!mine && (
              <Link to={`/@${item.vendor_handle}`} className="text-vendor-400 hover:underline">@{item.vendor_handle}</Link>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-semibold tabular-nums">{fmt.money(price)}</div>
          <div className="text-[11px] text-neutral-500">per {item.unit_of_measure}{item.wholesale_price != null ? ' · wholesale' : ''}</div>
        </div>
      </div>

      {item.description && <p className="text-sm text-neutral-400 line-clamp-2">{item.description}</p>}

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="In stock" value={item.quantity_in_stock} />
        <Stat label="Reserved" value={item.quantity_reserved} tone={item.quantity_reserved ? 'amber' : ''} />
        <Stat label="Available" value={item.quantity_available} tone={low ? 'red' : 'green'} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="pill-gray">min {item.min_order_quantity} {item.unit_of_measure}</span>
        <span className="pill-gray">{sourceLabel[item.source] || item.source}</span>
        {mine && (
          <span className={item.visible_to_network ? 'pill-green' : 'pill-amber'}>
            {item.visible_to_network ? <Eye size={11} className="mr-1" /> : <EyeOff size={11} className="mr-1" />}
            {item.visible_to_network ? 'on the network' : 'hidden'}
          </span>
        )}
        {item.last_pos_sync && <span className="pill-blue"><RefreshCw size={11} className="mr-1" />POS {fmt.ago(item.last_pos_sync)}</span>}
        {(item.tags || []).slice(0, 4).map((t) => <span key={t} className="pill-gray">#{t}</span>)}
      </div>

      <div className="flex gap-2 mt-auto pt-1">
        {mine ? (
          <>
            <button className="btn-ghost flex-1" onClick={() => onEdit?.(item)}><Pencil size={14} /> Edit</button>
            <button className="btn-danger" onClick={() => onRemove?.(item)} title="Close this line" disabled={item.quantity_reserved > 0}><Trash2 size={14} /></button>
          </>
        ) : (
          <>
            <button className="btn-primary flex-1" onClick={() => onSource?.(item)} disabled={low}>
              <ArrowDownToLine size={14} /> {low ? 'None available' : 'Source'}
            </button>
            <button className="btn-ghost" onClick={() => onDeal?.(item)} title="Open a deal room"><MessageSquare size={14} /></button>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, tone = '' }) {
  const color = { green: 'text-vendor-300', amber: 'text-amber-300', red: 'text-red-300' }[tone] || 'text-neutral-200'
  return (
    <div className="rounded-lg bg-neutral-900 border border-brief-border py-1.5">
      <div className={`text-sm font-semibold tabular-nums ${color}`}>{fmt.num(value)}</div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
    </div>
  )
}
