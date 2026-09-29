import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Package, Plus, Upload, Search, Globe, ArrowLeftRight } from 'lucide-react'
import { useStock } from '../hooks/useStock'
import { api, errorMessage, fmt, splitList } from '../lib/api'
import StockCard from '../components/StockCard'
import MovementRow from '../components/MovementRow'
import Modal from '../components/Modal'
import Notice from '../components/Notice'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { Field } from './Register'

const TABS = [
  { id: 'mine', label: 'My shelves', icon: Package },
  { id: 'network', label: 'Network stock', icon: Globe },
  { id: 'movements', label: 'Movements', icon: ArrowLeftRight },
]

const emptyForm = {
  name: '', sku: '', category: '', subcategory: '', description: '', quantity_in_stock: 0, unit_of_measure: 'pieces',
  cost_price: '', wholesale_price: '', unit_price: 0, min_order_quantity: 1, visible_to_network: true, tags: '',
}

export default function StockRoom() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'mine'
  const stock = useStock()
  const nav = useNavigate()
  const [msg, setMsg] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | item
  const [sourcing, setSourcing] = useState(null) // network item
  const [importOpen, setImportOpen] = useState(false)
  const [filters, setFilters] = useState({ search: '', category: '', direction: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (tab === 'network') stock.loadNetwork({ search: filters.search || undefined, category: filters.category || undefined }).catch(() => {})
    if (tab === 'movements') stock.loadMovements({ direction: filters.direction || undefined }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filters.category, filters.direction])

  const setTab = (t) => setParams(t === 'mine' ? {} : { tab: t })

  const myFiltered = useMemo(() => {
    const q = filters.search.toLowerCase()
    return stock.myStock.filter((i) => !q || i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
  }, [stock.myStock, filters.search])

  const run = async (fn, okText) => {
    setBusy(true)
    setMsg(null)
    try {
      const out = await fn()
      if (okText) setMsg({ ok: true, text: typeof okText === 'function' ? okText(out) : okText })
      return out
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
      throw e
    } finally {
      setBusy(false)
    }
  }

  const openDeal = async (item) => {
    try {
      const { data } = await api.post(`/chat/deal/${item.id}`)
      nav(`/chat?room=${data.room_id}`)
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
  }

  return (
    <div>
      <PageHeader title="Stock Room" subtitle="Stock, not listings. What is on your shelf is what the network can source.">
        <button className="btn-ghost" onClick={() => setImportOpen(true)}><Upload size={14} /> Import CSV</button>
        <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> Add stock</button>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="inline-flex rounded-lg border border-brief-border bg-neutral-900 p-0.5 self-start">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 ${tab === id ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:text-neutral-100'}`}>
              <Icon size={14} /> {label}
              {id === 'movements' && stock.movements.some((m) => m.status === 'pending') && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </button>
          ))}
        </div>
        {tab !== 'movements' ? (
          <form className="flex-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (tab === 'network') stock.loadNetwork({ search: filters.search || undefined, category: filters.category || undefined }) }}>
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-2.5 text-neutral-500" />
              <input className="input pl-9" placeholder={tab === 'mine' ? 'Filter my shelves' : 'Search the network: name, SKU, tag'} value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
            </div>
            {tab === 'network' && (
              <select className="input w-44" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
                <option value="">All categories</option>
                {stock.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </form>
        ) : (
          <select className="input w-44" value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: e.target.value })}>
            <option value="">All movements</option>
            <option value="incoming">Incoming (I source)</option>
            <option value="outgoing">Outgoing (I supply)</option>
          </select>
        )}
      </div>

      <Notice msg={msg} className="mb-4" />

      {tab === 'mine' && (
        myFiltered.length === 0 ? (
          <EmptyState icon={Package} title={stock.myStock.length ? 'Nothing matches' : 'Your shelves are empty'} hint="Add stock by hand, import your POS export as CSV, or connect a POS and let the bridge keep it in sync." action={<button className="btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> Add stock</button>} />
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {myFiltered.map((i) => (
              <StockCard key={i.id} item={i} mine onEdit={setEditing} onRemove={(item) => {
                if (window.confirm(`Close the line "${item.name}"? It leaves the network and its quantities are zeroed.`)) run(() => stock.removeStock(item.id), 'Line closed.')
              }} />
            ))}
          </div>
        )
      )}

      {tab === 'network' && (
        stock.networkStock.length === 0 ? (
          <EmptyState icon={Globe} title="Nothing on the network matches" hint="Other vendors' visible stock shows here — never your own. Try a broader search." />
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {stock.networkStock.map((i) => <StockCard key={i.id} item={i} onSource={setSourcing} onDeal={openDeal} />)}
          </div>
        )
      )}

      {tab === 'movements' && (
        stock.movements.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} title="No movements yet" hint="Every sourcing request is a movement: pending → confirmed → shipped → received. The received ones build your network score." />
        ) : (
          <div className="space-y-2">
            {stock.movements.map((m) => (
              <MovementRow key={m.id} m={m} busy={busy} onAction={(mv, action) => run(() => stock.advance(mv.id, action), (out) => `Movement ${out.status.replace('_', ' ')}.`)} />
            ))}
          </div>
        )
      )}

      <StockForm
        open={editing !== null}
        item={editing === 'new' ? null : editing}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={async (payload, id) => {
          await run(() => (id ? stock.updateStock(id, payload) : stock.addStock(payload)), id ? 'Stock updated.' : 'Stock added to your shelf.')
          setEditing(null)
        }}
      />

      <SourceModal
        item={sourcing}
        busy={busy}
        onClose={() => setSourcing(null)}
        onSubmit={async (payload) => {
          const out = await run(() => stock.source(sourcing.id, payload), (o) => `Requested ${o.quantity} from @${o.from_handle}. Reserved on their shelf until they confirm.`)
          setSourcing(null)
          setTab('movements')
          return out
        }}
      />

      <Modal open={importOpen} title="Import stock from CSV" onClose={() => setImportOpen(false)}>
        <p className="text-sm text-neutral-400 mb-3">
          Columns: <code className="font-mono text-xs">name, sku, category, quantity, unit_price, wholesale_price, cost_price, unit, min_order, description, tags</code>. Rows with a SKU you already have are updated, the rest are added.
        </p>
        <input type="file" accept=".csv,text/csv" className="input" onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          await run(() => stock.bulkImport(f), (o) => `Imported ${o.added} new, updated ${o.updated}${o.errors?.length ? `, ${o.errors.length} rows skipped: ${o.errors.slice(0, 3).join(' · ')}` : ''}.`)
          setImportOpen(false)
        }} />
      </Modal>
    </div>
  )
}

function StockForm({ open, item, onClose, onSave, busy }) {
  const [form, setForm] = useState(emptyForm)
  useEffect(() => {
    if (!open) return
    setForm(item ? {
      ...emptyForm, ...item, cost_price: item.cost_price ?? '', wholesale_price: item.wholesale_price ?? '', tags: (item.tags || []).join(', '),
    } : emptyForm)
  }, [open, item])
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const num = (v) => (v === '' || v == null ? null : Number(v))

  const submit = (e) => {
    e.preventDefault()
    onSave({
      name: form.name, sku: form.sku || null, category: form.category || 'general', subcategory: form.subcategory || null,
      description: form.description || null, quantity_in_stock: Number(form.quantity_in_stock) || 0, unit_of_measure: form.unit_of_measure || 'pieces',
      cost_price: num(form.cost_price), wholesale_price: num(form.wholesale_price), unit_price: Number(form.unit_price) || 0,
      min_order_quantity: Number(form.min_order_quantity) || 1, visible_to_network: Boolean(form.visible_to_network), tags: splitList(form.tags),
    }, item?.id)
  }

  return (
    <Modal open={open} title={item ? `Edit · ${item.name}` : 'Add stock'} onClose={onClose} wide>
      <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><Field label="Name" id="s_name"><input id="s_name" className="input" value={form.name} onChange={set('name')} required /></Field></div>
        <Field label="SKU" id="s_sku" hint="matches POS / CSV rows"><input id="s_sku" className="input font-mono" value={form.sku || ''} onChange={set('sku')} /></Field>
        <Field label="Category" id="s_cat"><input id="s_cat" className="input" value={form.category} onChange={set('category')} placeholder="produce" /></Field>
        <Field label="Quantity in stock" id="s_qty"><input id="s_qty" type="number" min="0" className="input" value={form.quantity_in_stock} onChange={set('quantity_in_stock')} /></Field>
        <Field label="Unit" id="s_unit"><input id="s_unit" className="input" value={form.unit_of_measure} onChange={set('unit_of_measure')} placeholder="pieces, kg, bunches" /></Field>
        <Field label="Unit price" id="s_price" hint="retail"><input id="s_price" type="number" min="0" step="0.01" className="input" value={form.unit_price} onChange={set('unit_price')} required /></Field>
        <Field label="Wholesale price" id="s_wprice" hint="what the network pays"><input id="s_wprice" type="number" min="0" step="0.01" className="input" value={form.wholesale_price} onChange={set('wholesale_price')} /></Field>
        <Field label="Cost price" id="s_cprice" hint="private"><input id="s_cprice" type="number" min="0" step="0.01" className="input" value={form.cost_price} onChange={set('cost_price')} /></Field>
        <Field label="Minimum order" id="s_moq"><input id="s_moq" type="number" min="1" className="input" value={form.min_order_quantity} onChange={set('min_order_quantity')} /></Field>
        <div className="sm:col-span-2"><Field label="Tags" id="s_tags" hint="comma-separated, searchable"><input id="s_tags" className="input" value={form.tags} onChange={set('tags')} /></Field></div>
        <div className="sm:col-span-2"><Field label="Description" id="s_desc"><textarea id="s_desc" rows={2} className="input" value={form.description || ''} onChange={set('description')} /></Field></div>
        <label className="sm:col-span-2 flex items-center gap-2 text-sm text-neutral-300">
          <input type="checkbox" checked={Boolean(form.visible_to_network)} onChange={set('visible_to_network')} className="accent-vendor-500" />
          Visible to the network (other vendors can source it)
        </label>
        <div className="sm:col-span-2 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{item ? 'Save changes' : 'Put it on the shelf'}</button>
        </div>
      </form>
    </Modal>
  )
}

function SourceModal({ item, onClose, onSubmit, busy }) {
  const [qty, setQty] = useState(1)
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  useEffect(() => { if (item) { setQty(item.min_order_quantity || 1); setPrice(''); setNotes('') } }, [item])
  if (!item) return null
  const unit = price !== '' ? Number(price) : (item.wholesale_price ?? item.unit_price)
  const total = unit * (Number(qty) || 0)
  return (
    <Modal open title={`Source · ${item.name}`} onClose={onClose}>
      <p className="text-sm text-neutral-400 mb-4">
        From <b className="text-neutral-200">@{item.vendor_handle}</b> · {fmt.num(item.quantity_available)} {item.unit_of_measure} available · minimum {item.min_order_quantity}.
        The quantity is reserved on their shelf until they confirm or you cancel.
      </p>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit({ quantity: Number(qty), proposed_price: price === '' ? null : Number(price), notes: notes || null }) }}>
        <Field label={`Quantity (${item.unit_of_measure})`} id="q"><input id="q" type="number" min={item.min_order_quantity || 1} max={item.quantity_available} className="input" value={qty} onChange={(e) => setQty(e.target.value)} required /></Field>
        <Field label="Proposed unit price" id="p" hint={`leave blank for ${fmt.money(item.wholesale_price ?? item.unit_price)}`}><input id="p" type="number" min="0" step="0.01" className="input" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Note to the supplier" id="n" hint="optional"><input id="n" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pick-up Friday morning" /></Field>
        <div className="flex items-center justify-between rounded-lg bg-neutral-900 border border-brief-border px-3 py-2 text-sm">
          <span className="text-neutral-400">Total</span><span className="font-semibold">{fmt.money(total)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>Request stock</button>
        </div>
      </form>
    </Modal>
  )
}
