import { useState } from 'react'
import { Plug, Plus, RefreshCw, Upload, Trash2, Terminal, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { usePOSSync } from '../hooks/usePOSSync'
import { useAuth } from '../hooks/useAuth'
import { errorMessage, fmt, POS_TYPES } from '../lib/api'
import Modal from '../components/Modal'
import Notice from '../components/Notice'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { Field } from './Register'

export default function POSBridge() {
  const pos = usePOSSync()
  const { refreshMe } = useAuth()
  const [msg, setMsg] = useState(null)
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [openLogs, setOpenLogs] = useState({})

  const act = async (id, fn, ok) => {
    setBusyId(id)
    try { const out = await fn(); await refreshMe(); if (ok) setMsg({ ok: true, text: typeof ok === 'function' ? ok(out) : ok }); return out } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) } finally { setBusyId(null) }
    return null
  }
  const summary = (o) => `${o.status === 'success' ? 'Synced' : 'Sync ' + o.status}: ${o.items_processed} rows · ${o.items_added} added · ${o.items_updated} updated${o.errors?.length ? ` · ${o.errors.length} errors: ${o.errors.slice(0, 2).join(' · ')}` : ''}`
  const toggleLogs = async (id) => {
    const next = !openLogs[id]
    setOpenLogs({ ...openLogs, [id]: next })
    if (next) pos.loadLogs(id).catch(() => {})
  }

  return (
    <div>
      <PageHeader title="POS Bridge" subtitle="Your till already knows your stock. Connect it and the network sees what you have, as you sell it.">
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} /> Connect a POS</button>
      </PageHeader>
      <Notice msg={msg} className="mb-4" />

      {pos.connections.length === 0 ? (
        <EmptyState icon={Plug} title="No POS connected" hint="Square and Shopify sync on a schedule. For any other till, export a CSV or run the local sync daemon from pos-extension/." action={<button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} /> Connect a POS</button>} />
      ) : (
        <div className="space-y-3">
          {pos.connections.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Plug size={16} className={c.is_active ? 'text-vendor-500' : 'text-neutral-600'} />
                    <span className="font-medium truncate">{c.connection_name}</span>
                    <span className="pill-gray">{c.pos_type}</span>
                    <span className={c.mode === 'pull' ? 'pill-blue' : 'pill-amber'}>{c.mode}</span>
                    {!c.is_active && <span className="pill-red">disconnected</span>}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    {c.store_id && <>store {c.store_id} · </>}
                    {c.items_synced} items synced · last {c.last_sync_at ? fmt.ago(c.last_sync_at) : 'never'}
                    {c.mode === 'pull' && c.auto_sync && <> · every {c.sync_interval_minutes} min</>}
                    {c.mode === 'pull' && !c.has_credentials && <span className="text-amber-300"> · no credentials</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {c.mode === 'pull' ? (
                    <button className="btn-primary" disabled={busyId === c.id || !c.is_active} onClick={() => act(c.id, () => pos.sync(c.id), summary)}><RefreshCw size={14} className={busyId === c.id ? 'animate-spin' : ''} /> Sync now</button>
                  ) : (
                    <label className={`btn-primary cursor-pointer ${busyId === c.id || !c.is_active ? 'opacity-50 pointer-events-none' : ''}`}>
                      <Upload size={14} /> Push CSV
                      <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) act(c.id, () => pos.pushCsv(c.id, f), summary); e.target.value = '' }} />
                    </label>
                  )}
                  <button className="btn-ghost" onClick={() => toggleLogs(c.id)}><Clock size={14} /> Logs</button>
                  <button className="btn-danger" title="Disconnect" onClick={() => window.confirm(`Disconnect "${c.connection_name}"? Stock stays on your shelf.`) && act(c.id, () => pos.disconnect(c.id), 'Disconnected.')}><Trash2 size={14} /></button>
                </div>
              </div>

              {c.mode === 'push' && c.is_active && (
                <div className="mt-3 rounded-lg bg-black/40 border border-brief-border p-3 text-xs font-mono text-neutral-400 flex items-start gap-2">
                  <Terminal size={13} className="mt-0.5 shrink-0 text-vendor-500" />
                  <div className="min-w-0">
                    <div className="text-neutral-500"># keep this till in sync from the shop computer</div>
                    <div className="truncate">python pos-extension/sync_daemon.py --connection {c.id} --adapter {c.pos_type === 'csv' ? 'csv --file exports/stock.csv' : c.pos_type} --api {window.location.origin}</div>
                  </div>
                </div>
              )}

              {openLogs[c.id] && (
                <div className="mt-3 border-t border-brief-border pt-3">
                  {!(pos.logs[c.id]?.length) ? <p className="text-xs text-neutral-500">No syncs recorded yet.</p> : (
                    <table className="w-full text-xs">
                      <thead className="text-neutral-500 text-left"><tr><th className="py-1 font-normal">When</th><th className="font-normal">Type</th><th className="font-normal">Status</th><th className="font-normal text-right">Rows</th><th className="font-normal text-right">Added</th><th className="font-normal text-right">Updated</th><th className="font-normal">Errors</th></tr></thead>
                      <tbody>
                        {pos.logs[c.id].map((l) => (
                          <tr key={l.id} className="border-t border-brief-border/60">
                            <td className="py-1.5">{fmt.dateTime(l.started_at)}</td>
                            <td>{l.sync_type}</td>
                            <td className="flex items-center gap-1">{l.status === 'success' ? <CheckCircle2 size={12} className="text-vendor-400" /> : l.status === 'failed' ? <XCircle size={12} className="text-red-400" /> : <Clock size={12} className="text-amber-400" />} {l.status}</td>
                            <td className="text-right tabular-nums">{l.items_processed}</td>
                            <td className="text-right tabular-nums">{l.items_added}</td>
                            <td className="text-right tabular-nums">{l.items_updated}</td>
                            <td className="text-red-300 truncate max-w-[16rem]" title={(l.errors || []).join('\n')}>{(l.errors || []).slice(0, 1).join('; ')}{l.errors?.length > 1 ? ` (+${l.errors.length - 1})` : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConnectModal open={adding} onClose={() => setAdding(false)} onConnect={async (payload) => {
        const out = await act('new', () => pos.connect(payload), (r) => `${r.message} ${r.next_step}`)
        if (out) setAdding(false)
      }} />
    </div>
  )
}

function ConnectModal({ open, onClose, onConnect }) {
  const [f, setF] = useState({ pos_type: 'square', connection_name: '', api_key: '', api_secret: '', store_id: '', auto_sync: true, sync_interval_minutes: 15, exclude_sku: '', min_stock: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const type = POS_TYPES.find((t) => t.id === f.pos_type)
  return (
    <Modal open={open} title="Connect a POS" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault()
        const sync_config = {}
        if (f.exclude_sku) sync_config.exclude_sku = f.exclude_sku.split(',').map((s) => s.trim()).filter(Boolean)
        if (f.min_stock !== '') sync_config.min_stock = Number(f.min_stock)
        onConnect({
          pos_type: f.pos_type, connection_name: f.connection_name || `${type.label} till`,
          api_key: f.api_key || null, api_secret: f.api_secret || null, store_id: f.store_id || null,
          auto_sync: f.auto_sync, sync_interval_minutes: Number(f.sync_interval_minutes) || 15, sync_config,
        })
      }}>
        <div className="grid grid-cols-5 gap-1.5">
          {POS_TYPES.map((t) => (
            <button type="button" key={t.id} onClick={() => setF({ ...f, pos_type: t.id })} className={`rounded-lg border px-2 py-2 text-xs ${f.pos_type === t.id ? 'bg-vendor-900/40 border-vendor-800 text-vendor-200' : 'border-brief-border text-neutral-400 hover:text-neutral-100'}`}>
              {t.label}<div className="text-[10px] opacity-60">{t.mode}</div>
            </button>
          ))}
        </div>
        <Field label="Connection name" id="p_name"><input id="p_name" className="input" placeholder={`${type.label} · main shop`} value={f.connection_name} onChange={set('connection_name')} /></Field>
        {type.mode === 'pull' ? (
          <>
            <Field label={f.pos_type === 'square' ? 'Square access token' : 'Shopify Admin API access token'} id="p_key" hint="stored encrypted"><input id="p_key" type="password" className="input font-mono" value={f.api_key} onChange={set('api_key')} required autoComplete="off" /></Field>
            <Field label={f.pos_type === 'square' ? 'Location ID' : 'Shop domain'} id="p_store" hint={f.pos_type === 'square' ? 'optional' : 'e.g. mystore.myshopify.com'}><input id="p_store" className="input font-mono" value={f.store_id} onChange={set('store_id')} required={f.pos_type === 'shopify'} /></Field>
            <div className="grid grid-cols-2 gap-3 items-end">
              <Field label="Sync every (minutes)" id="p_int"><input id="p_int" type="number" min="5" max="1440" className="input" value={f.sync_interval_minutes} onChange={set('sync_interval_minutes')} /></Field>
              <label className="flex items-center gap-2 text-sm text-neutral-300 pb-2"><input type="checkbox" className="accent-vendor-500" checked={f.auto_sync} onChange={set('auto_sync')} /> Auto-sync</label>
            </div>
          </>
        ) : (
          <p className="text-sm text-neutral-400 rounded-lg bg-neutral-900 border border-brief-border p-3">
            {f.pos_type === 'csv' && 'Export stock from your till as CSV and push it here, or point the sync daemon at the export file so it re-pushes whenever the file changes.'}
            {f.pos_type === 'manual' && 'No integration — you push rows from the daemon, a script, or the CSV button. Good for a notebook-and-pen shop moving to a spreadsheet.'}
            {f.pos_type === 'custom_api' && 'Your own system posts {"items": [...]} to this connection\'s push endpoint with your bearer token. Field names: name, sku, quantity, unit_price, wholesale_price, category, tags.'}
          </p>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-neutral-400">Sync rules</summary>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Exclude SKUs" id="p_ex" hint="comma-separated"><input id="p_ex" className="input font-mono" value={f.exclude_sku} onChange={set('exclude_sku')} /></Field>
            <Field label="Skip below quantity" id="p_min"><input id="p_min" type="number" min="0" className="input" value={f.min_stock} onChange={set('min_stock')} /></Field>
          </div>
        </details>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary"><Plug size={14} /> Connect</button></div>
      </form>
    </Modal>
  )
}
