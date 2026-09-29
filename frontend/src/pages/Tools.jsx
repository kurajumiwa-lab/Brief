import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Wrench, Plus, Search, Truck, Warehouse, Snowflake, Store, Hotel, Package, Box, Bike, MapPin, Star, Calendar } from 'lucide-react'
import { api, errorMessage, fmt, splitList, TOOL_CATEGORIES } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import Modal from '../components/Modal'
import Notice from '../components/Notice'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { Field } from './Register'

const ICONS = { warehouse: Warehouse, cold_storage: Snowflake, transport: Truck, courier: Bike, popup_shop: Store, hotel_sourcing: Hotel, equipment: Wrench, packaging: Box }

export default function Tools() {
  const { vendor } = useAuth()
  const [tools, setTools] = useState([])
  const [mine, setMine] = useState([])
  const [couriers, setCouriers] = useState([])
  const [filters, setFilters] = useState({ category: '', search: '', location: '' })
  const [msg, setMsg] = useState(null)
  const [listing, setListing] = useState(false)
  const [courierForm, setCourierForm] = useState(false)
  const [booking, setBooking] = useState(null)

  const load = async () => {
    const [b, m, c] = await Promise.all([
      api.get('/tools/browse', { params: { category: filters.category || undefined, search: filters.search || undefined, location: filters.location || undefined } }),
      api.get('/tools/mine'),
      api.get('/tools/couriers'),
    ])
    setTools(b.data); setMine(m.data); setCouriers(c.data)
  }
  useEffect(() => { load().catch((e) => setMsg({ ok: false, text: errorMessage(e) })) }, [filters.category]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn, ok) => {
    try { const out = await fn(); await load(); if (ok) setMsg({ ok: true, text: typeof ok === 'function' ? ok(out) : ok }); return out } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
    return null
  }

  return (
    <div>
      <PageHeader title="Vendor Tools" subtitle="Shared infrastructure between vendors: space, wheels, cold rooms, pop-up counters, hotel supply slots.">
        <button className="btn-ghost" onClick={() => setCourierForm(true)}><Bike size={14} /> Register as courier</button>
        <button className="btn-primary" onClick={() => setListing(true)}><Plus size={14} /> List a tool</button>
      </PageHeader>
      <Notice msg={msg} className="mb-4" />

      <div className="flex flex-wrap gap-1.5 mb-4">
        <button onClick={() => setFilters({ ...filters, category: '' })} className={`px-3 py-1.5 rounded-lg text-sm border ${!filters.category ? 'bg-vendor-900/40 border-vendor-800 text-vendor-200' : 'border-brief-border text-neutral-400 hover:text-neutral-100'}`}>All</button>
        {TOOL_CATEGORIES.map((c) => {
          const Icon = ICONS[c.id] || Wrench
          return (
            <button key={c.id} onClick={() => setFilters({ ...filters, category: c.id })} className={`px-3 py-1.5 rounded-lg text-sm border flex items-center gap-1.5 ${filters.category === c.id ? 'bg-vendor-900/40 border-vendor-800 text-vendor-200' : 'border-brief-border text-neutral-400 hover:text-neutral-100'}`}>
              <Icon size={14} /> {c.label}
            </button>
          )
        })}
      </div>
      <form className="flex gap-2 mb-5" onSubmit={(e) => { e.preventDefault(); load() }}>
        <div className="relative flex-1"><Search size={15} className="absolute left-3 top-2.5 text-neutral-500" /><input className="input pl-9" placeholder="Search tools" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} /></div>
        <input className="input w-44" placeholder="Location" value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} />
        <button className="btn-ghost">Search</button>
      </form>

      {mine.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-3">Your listings</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {mine.map((t) => <ToolCard key={t.id} t={t} mine onToggle={() => act(() => api.post(`/tools/${t.id}/availability`, null, { params: { is_available: !t.is_available } }), t.is_available ? 'Marked unavailable.' : 'Available again.')} />)}
          </div>
        </div>
      )}

      {(!filters.category || filters.category === 'courier') && couriers.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-3">Registered couriers</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {couriers.map((c) => (
              <div key={c.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-medium flex items-center gap-2"><Bike size={15} className="text-vendor-500" />{c.courier_name}</div><Link to={`/@${c.vendor_handle}`} className="text-xs text-vendor-400">@{c.vendor_handle}</Link></div>
                  {c.is_verified && <span className="pill-green">verified</span>}
                </div>
                <div className="text-xs text-neutral-500 mt-2">{(c.coverage_areas || []).join(', ') || 'coverage not set'}</div>
                <div className="text-xs text-neutral-500">{(c.service_types || []).join(', ')}</div>
                <div className="text-sm mt-2">{c.price_per_kg != null && <>{fmt.money(c.price_per_kg)}/kg</>}{c.base_rate != null && <> · base {fmt.money(c.base_rate)}</>}</div>
                <div className="text-xs text-neutral-500 mt-1 flex items-center gap-1"><Star size={12} /> {c.rating ?? '—'} · {c.total_deliveries} deliveries</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 className="font-semibold mb-3">On offer</h2>
      {tools.length === 0 ? (
        <EmptyState icon={Wrench} title="Nothing listed here yet" hint="Got a spare corner of a warehouse, a pickup that runs empty on Tuesdays, a cold room with room? List it." action={<button className="btn-primary" onClick={() => setListing(true)}><Plus size={14} /> List a tool</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {tools.filter((t) => t.vendor_id !== vendor?.id).map((t) => <ToolCard key={t.id} t={t} onBook={() => setBooking(t)} />)}
        </div>
      )}

      <ListToolModal open={listing} onClose={() => setListing(false)} onCreate={async (payload) => {
        const out = await act(() => api.post('/tools/list', payload), (r) => r.data.message || 'Listed.')
        if (out) setListing(false)
      }} />
      <CourierModal open={courierForm} onClose={() => setCourierForm(false)} onCreate={async (payload) => {
        const out = await act(() => api.post('/tools/courier/register', payload), (r) => r.data.message || 'Registered as courier.')
        if (out) setCourierForm(false)
      }} />
      <BookModal t={booking} onClose={() => setBooking(null)} onBook={async (payload) => {
        const out = await act(() => api.post(`/tools/${booking.id}/book-warehouse`, payload), (r) => r.data.message)
        if (out) setBooking(null)
      }} />
    </div>
  )
}

function ToolCard({ t, mine, onBook, onToggle }) {
  const Icon = ICONS[t.category] || Wrench
  const bookable = ['warehouse', 'cold_storage'].includes(t.category)
  const d = t.details || {}
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium flex items-center gap-2 truncate"><Icon size={15} className="text-vendor-500 shrink-0" />{t.title}</h3>
          <div className="text-xs text-neutral-500 flex items-center gap-1 mt-0.5">
            {t.location && <><MapPin size={11} /> {t.location} · </>}
            <Link to={`/@${t.vendor_handle}`} className="text-vendor-400">@{t.vendor_handle}</Link>
          </div>
        </div>
        <span className={t.is_available ? 'pill-green' : 'pill-gray'}>{t.is_available ? 'available' : 'unavailable'}</span>
      </div>
      {t.description && <p className="text-sm text-neutral-400 line-clamp-2">{t.description}</p>}
      <div className="text-sm"><b>{fmt.money(t.price_per_unit)}</b> <span className="text-neutral-500">{t.price_unit?.replace('_', ' ')}</span>{t.deposit_required ? <span className="text-neutral-500"> · deposit {fmt.money(t.deposit_required)}</span> : null}</div>
      <div className="flex flex-wrap gap-1 text-[11px]">
        {Object.entries(t.capacity || {}).map(([k, v]) => <span key={k} className="pill-gray">{k}: {String(v)}</span>)}
        {(t.features || []).slice(0, 4).map((f) => <span key={f} className="pill-gray">{f}</span>)}
        {d.vehicle_type && <span className="pill-blue">{d.vehicle_type}{d.max_weight_kg ? ` · ${d.max_weight_kg}kg` : ''}</span>}
        {d.venue_name && <span className="pill-blue">{d.venue_name}</span>}
        {d.hotel_name && <span className="pill-blue">{d.hotel_name}</span>}
      </div>
      <div className="text-xs text-neutral-500 flex items-center gap-1"><Star size={12} /> {t.avg_rating ?? '—'} · booked {t.times_booked}×</div>
      <div className="flex gap-2 pt-1 mt-auto">
        {mine ? <button className="btn-ghost flex-1" onClick={onToggle}>{t.is_available ? 'Mark unavailable' : 'Mark available'}</button>
          : bookable ? <button className="btn-primary flex-1" disabled={!t.is_available} onClick={onBook}><Calendar size={14} /> Book space</button>
          : <Link to={`/@${t.vendor_handle}`} className="btn-ghost flex-1">Contact vendor</Link>}
      </div>
    </div>
  )
}

function ListToolModal({ open, onClose, onCreate }) {
  const [f, setF] = useState({ category: 'warehouse', title: '', description: '', location: '', price_per_unit: '', price_unit: 'per_day', deposit_required: '', capacity: '', features: '', terms: '', vehicle_type: '', max_weight_kg: '', routes: '', venue_name: '', venue_type: '', hotel_name: '', proximity_to: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = (e) => {
    e.preventDefault()
    const capacity = {}
    splitList(f.capacity).forEach((pair) => { const [k, v] = pair.split(':').map((x) => x.trim()); if (k) capacity[k] = isNaN(Number(v)) ? v : Number(v) })
    const payload = {
      category: f.category, title: f.title, description: f.description || null, location: f.location || null,
      price_per_unit: f.price_per_unit === '' ? null : Number(f.price_per_unit), price_unit: f.price_unit,
      deposit_required: f.deposit_required === '' ? null : Number(f.deposit_required), capacity, features: splitList(f.features), terms: f.terms || null,
    }
    if (f.category === 'transport') payload.transport = { vehicle_type: f.vehicle_type || null, max_weight_kg: f.max_weight_kg ? Number(f.max_weight_kg) : null, routes: splitList(f.routes) }
    if (f.category === 'popup_shop') payload.popup_shop = { venue_name: f.venue_name || null, venue_type: f.venue_type || null }
    if (f.category === 'hotel_sourcing') payload.hotel_sourcing = { hotel_name: f.hotel_name || null, proximity_to: splitList(f.proximity_to) }
    onCreate(payload)
  }
  return (
    <Modal open={open} title="List a tool for the network" onClose={onClose} wide>
      <form className="grid sm:grid-cols-2 gap-4" onSubmit={submit}>
        <Field label="Category" id="tl_cat"><select id="tl_cat" className="input" value={f.category} onChange={set('category')}>{TOOL_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
        <Field label="Title" id="tl_title"><input id="tl_title" className="input" value={f.title} onChange={set('title')} required minLength={3} /></Field>
        <div className="sm:col-span-2"><Field label="Description" id="tl_desc"><textarea id="tl_desc" rows={2} className="input" value={f.description} onChange={set('description')} /></Field></div>
        <Field label="Location" id="tl_loc"><input id="tl_loc" className="input" value={f.location} onChange={set('location')} /></Field>
        <Field label="Price" id="tl_price"><div className="flex gap-2"><input id="tl_price" type="number" min="0" step="0.01" className="input" value={f.price_per_unit} onChange={set('price_per_unit')} /><select className="input w-36" value={f.price_unit} onChange={set('price_unit')}>{['per_hour', 'per_day', 'per_week', 'per_month', 'per_trip', 'per_kg', 'flat'].map((u) => <option key={u} value={u}>{u.replace('_', ' ')}</option>)}</select></div></Field>
        <Field label="Deposit" id="tl_dep" hint="optional"><input id="tl_dep" type="number" min="0" className="input" value={f.deposit_required} onChange={set('deposit_required')} /></Field>
        <Field label="Capacity" id="tl_cap" hint="key: value, comma-separated"><input id="tl_cap" className="input" placeholder="sqm: 40, pallets: 12" value={f.capacity} onChange={set('capacity')} /></Field>
        <div className="sm:col-span-2"><Field label="Features" id="tl_feat" hint="comma-separated"><input id="tl_feat" className="input" placeholder="24h access, security, forklift" value={f.features} onChange={set('features')} /></Field></div>
        {f.category === 'transport' && (<>
          <Field label="Vehicle type" id="tl_veh"><input id="tl_veh" className="input" placeholder="pickup, 3-tonne truck" value={f.vehicle_type} onChange={set('vehicle_type')} /></Field>
          <Field label="Max weight (kg)" id="tl_kg"><input id="tl_kg" type="number" min="0" className="input" value={f.max_weight_kg} onChange={set('max_weight_kg')} /></Field>
          <div className="sm:col-span-2"><Field label="Routes" id="tl_routes" hint="comma-separated"><input id="tl_routes" className="input" placeholder="Nairobi–Nakuru, Nairobi–Mombasa" value={f.routes} onChange={set('routes')} /></Field></div>
        </>)}
        {f.category === 'popup_shop' && (<>
          <Field label="Venue name" id="tl_venue"><input id="tl_venue" className="input" value={f.venue_name} onChange={set('venue_name')} /></Field>
          <Field label="Venue type" id="tl_vtype"><input id="tl_vtype" className="input" placeholder="mall kiosk, market stall" value={f.venue_type} onChange={set('venue_type')} /></Field>
        </>)}
        {f.category === 'hotel_sourcing' && (<>
          <Field label="Hotel name" id="tl_hotel"><input id="tl_hotel" className="input" value={f.hotel_name} onChange={set('hotel_name')} /></Field>
          <Field label="Near" id="tl_prox" hint="comma-separated"><input id="tl_prox" className="input" placeholder="Wakulima market, CBD" value={f.proximity_to} onChange={set('proximity_to')} /></Field>
        </>)}
        <div className="sm:col-span-2"><Field label="Terms" id="tl_terms" hint="optional"><textarea id="tl_terms" rows={2} className="input" value={f.terms} onChange={set('terms')} /></Field></div>
        <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary">Publish listing</button></div>
      </form>
    </Modal>
  )
}

function CourierModal({ open, onClose, onCreate }) {
  const [f, setF] = useState({ courier_name: '', registration_number: '', coverage_areas: '', service_types: 'same_day', price_per_kg: '', base_rate: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal open={open} title="Register as a courier" onClose={onClose}>
      <p className="text-sm text-neutral-400 mb-4">Vendors who move things for other vendors. Your registration also appears as a courier tool listing.</p>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onCreate({ courier_name: f.courier_name, registration_number: f.registration_number || null, coverage_areas: splitList(f.coverage_areas), service_types: splitList(f.service_types), price_per_kg: f.price_per_kg === '' ? null : Number(f.price_per_kg), base_rate: f.base_rate === '' ? null : Number(f.base_rate) }) }}>
        <Field label="Courier name" id="c_name"><input id="c_name" className="input" value={f.courier_name} onChange={set('courier_name')} required /></Field>
        <Field label="Registration number" id="c_reg" hint="optional"><input id="c_reg" className="input" value={f.registration_number} onChange={set('registration_number')} /></Field>
        <Field label="Coverage areas" id="c_areas" hint="comma-separated"><input id="c_areas" className="input" placeholder="CBD, Westlands, Kasarani" value={f.coverage_areas} onChange={set('coverage_areas')} /></Field>
        <Field label="Service types" id="c_types" hint="comma-separated"><input id="c_types" className="input" placeholder="same_day, next_day, cold_chain" value={f.service_types} onChange={set('service_types')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price per kg" id="c_kg"><input id="c_kg" type="number" min="0" step="0.01" className="input" value={f.price_per_kg} onChange={set('price_per_kg')} /></Field>
          <Field label="Base rate" id="c_base"><input id="c_base" type="number" min="0" step="0.01" className="input" value={f.base_rate} onChange={set('base_rate')} /></Field>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary">Register</button></div>
      </form>
    </Modal>
  )
}

function BookModal({ t, onClose, onBook }) {
  const [f, setF] = useState({ start_date: '', end_date: '', space: '' })
  useEffect(() => { setF({ start_date: '', end_date: '', space: '' }) }, [t])
  if (!t) return null
  return (
    <Modal open title={`Book · ${t.title}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault()
        const space = {}
        splitList(f.space).forEach((pair) => { const [k, v] = pair.split(':').map((x) => x.trim()); if (k) space[k] = isNaN(Number(v)) ? v : Number(v) })
        onBook({ start_date: new Date(f.start_date).toISOString(), end_date: new Date(f.end_date).toISOString(), space_allocated: space })
      }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" id="b_from"><input id="b_from" type="datetime-local" className="input" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} required /></Field>
          <Field label="Until" id="b_to"><input id="b_to" type="datetime-local" className="input" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} required /></Field>
        </div>
        <Field label="Space needed" id="b_space" hint="key: value, comma-separated"><input id="b_space" className="input" placeholder="sqm: 10, pallets: 3" value={f.space} onChange={(e) => setF({ ...f, space: e.target.value })} /></Field>
        <div className="text-sm text-neutral-400">{fmt.money(t.price_per_unit)} {t.price_unit?.replace('_', ' ')} · settle directly with @{t.vendor_handle}.</div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary">Reserve</button></div>
      </form>
    </Modal>
  )
}
