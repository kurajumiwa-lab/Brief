import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Plus, MapPin, Users, Video, Ticket, Check, XCircle } from 'lucide-react'
import { api, errorMessage, fmt, splitList, EVENT_TYPES } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import Modal from '../components/Modal'
import Notice from '../components/Notice'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { Field } from './Register'

const statusPill = { upcoming: 'pill-green', active: 'pill-blue', completed: 'pill-gray', cancelled: 'pill-red' }

export default function Events() {
  const { vendor } = useAuth()
  const [events, setEvents] = useState([])
  const [mine, setMine] = useState([])
  const [lists, setLists] = useState([])
  const [groups, setGroups] = useState([])
  const [filters, setFilters] = useState({ event_type: '', location: '', include_past: false })
  const [msg, setMsg] = useState(null)
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState(null)

  const load = async () => {
    const [b, m, l, g] = await Promise.all([
      api.get('/events/browse', { params: { event_type: filters.event_type || undefined, location: filters.location || undefined, include_past: filters.include_past } }),
      api.get('/events/mine'), api.get('/vendor-lists/mine'), api.get('/groups/mine'),
    ])
    setEvents(b.data); setMine(m.data); setLists(l.data); setGroups(g.data)
  }
  useEffect(() => { load().catch((e) => setMsg({ ok: false, text: errorMessage(e) })) }, [filters.event_type, filters.include_past]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn, ok) => {
    try { const out = await fn(); await load(); if (ok) setMsg({ ok: true, text: typeof ok === 'function' ? ok(out) : ok }); return out } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
    return null
  }
  const register = (e) => act(() => api.post(`/events/${e.id}/register`), (r) => r.data.message)
  const cancel = (e) => act(() => api.post(`/events/${e.id}/cancel-registration`), (r) => r.data.message)
  const setStatus = (e, status) => act(() => api.post(`/events/${e.id}/status`, null, { params: { status } }), `Event marked ${status}.`)

  const organizing = mine.filter((e) => e.organizer_id === vendor?.id)
  const attending = mine.filter((e) => e.organizer_id !== vendor?.id)

  return (
    <div>
      <PageHeader title="Events" subtitle="Market days, sourcing trips, trade fairs. Scoped to a vendor list or group when they should be.">
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> New event</button>
      </PageHeader>
      <Notice msg={msg} className="mb-4" />

      {organizing.length > 0 && <Block title="You organize">{organizing.map((e) => <EventCard key={e.id} e={e} mine onOpen={() => setDetail(e)} onStatus={setStatus} />)}</Block>}
      {attending.length > 0 && <Block title="You are registered for">{attending.map((e) => <EventCard key={e.id} e={e} onOpen={() => setDetail(e)} onCancel={cancel} />)}</Block>}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="font-semibold mr-auto">Upcoming</h2>
        <select className="input w-40" value={filters.event_type} onChange={(e) => setFilters({ ...filters, event_type: e.target.value })}><option value="">All types</option>{EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select>
        <form onSubmit={(e) => { e.preventDefault(); load() }}><input className="input w-40" placeholder="Location" value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} /></form>
        <label className="text-sm text-neutral-400 flex items-center gap-2"><input type="checkbox" className="accent-vendor-500" checked={filters.include_past} onChange={(e) => setFilters({ ...filters, include_past: e.target.checked })} /> past</label>
      </div>
      {events.length === 0 ? (
        <EmptyState icon={CalendarDays} title="Nothing on the calendar" hint="Organize a market day for your list or a sourcing trip for your group." action={<button className="btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> New event</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {events.map((e) => <EventCard key={e.id} e={e} mine={e.organizer_id === vendor?.id} onOpen={() => setDetail(e)} onRegister={register} onCancel={cancel} onStatus={setStatus} />)}
        </div>
      )}

      <CreateEventModal open={creating} lists={lists} groups={groups} onClose={() => setCreating(false)} onCreate={async (payload) => {
        const out = await act(() => api.post('/events/create', payload), (r) => r.data.message)
        if (out) setCreating(false)
      }} />
      <EventDetail e={detail} me={vendor} onClose={() => setDetail(null)} />
    </div>
  )
}

function Block({ title, children }) {
  return <div className="mb-6"><h2 className="font-semibold mb-3">{title}</h2><div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{children}</div></div>
}

function EventCard({ e, mine, onOpen, onRegister, onCancel, onStatus }) {
  const past = new Date(e.end_date) < new Date()
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpen} className="text-left min-w-0">
          <h3 className="font-medium truncate hover:text-vendor-300">{e.title}</h3>
          <div className="text-xs text-neutral-500">{e.event_type.replace('_', ' ')} · by <Link to={`/@${e.organizer}`} className="text-vendor-400">@{e.organizer}</Link></div>
        </button>
        <span className={statusPill[e.status] || 'pill-gray'}>{e.status}</span>
      </div>
      <div className="text-sm text-neutral-300 flex items-center gap-1.5"><CalendarDays size={14} className="text-vendor-500" /> {fmt.dateTime(e.start_date)} → {fmt.dateTime(e.end_date)}</div>
      <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-x-3 gap-y-1">
        {e.is_virtual ? <span className="flex items-center gap-1"><Video size={12} /> virtual</span> : e.location && <span className="flex items-center gap-1"><MapPin size={12} /> {e.location}</span>}
        <span className="flex items-center gap-1"><Users size={12} /> {e.registered_count}/{e.max_vendors} · {e.spots_left} left</span>
        {e.entry_fee > 0 && <span className="flex items-center gap-1"><Ticket size={12} /> {fmt.money(e.entry_fee)}</span>}
        {e.vendor_list_id && <span className="pill-gray">list members</span>}
        {e.group_id && <span className="pill-gray">group members</span>}
        {e.my_status && <span className={e.my_status === 'registered' ? 'pill-green' : 'pill-gray'}>{e.my_status}</span>}
      </div>
      {e.description && <p className="text-sm text-neutral-400 line-clamp-2">{e.description}</p>}
      <div className="flex gap-2 pt-1 mt-auto">
        {mine ? (
          <>
            <button className="btn-ghost flex-1" onClick={onOpen}>Registrations</button>
            {e.status === 'upcoming' && onStatus && <button className="btn-danger" title="Cancel event" onClick={() => window.confirm('Cancel this event?') && onStatus(e, 'cancelled')}><XCircle size={14} /></button>}
            {e.status !== 'completed' && e.status !== 'cancelled' && past && onStatus && <button className="btn-ghost" onClick={() => onStatus(e, 'completed')}><Check size={14} /> Done</button>}
          </>
        ) : e.my_status === 'registered' ? (
          onCancel && <button className="btn-ghost flex-1" onClick={() => onCancel(e)}>Cancel registration</button>
        ) : (
          onRegister && <button className="btn-primary flex-1" disabled={e.spots_left === 0 || e.status !== 'upcoming'} onClick={() => onRegister(e)}>{e.spots_left === 0 ? 'Full' : 'Register'}</button>
        )}
      </div>
    </div>
  )
}

function CreateEventModal({ open, lists, groups, onClose, onCreate }) {
  const [f, setF] = useState({ title: '', description: '', event_type: 'market_day', start_date: '', end_date: '', location: '', is_virtual: false, virtual_link: '', max_vendors: 50, entry_fee: 0, categories: '', scope: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const managedLists = lists.filter((l) => l.i_run_it)
  const adminGroups = groups.filter((g) => ['admin', 'moderator'].includes(g.my_role))
  return (
    <Modal open={open} title="New event" onClose={onClose} wide>
      <form className="grid sm:grid-cols-2 gap-4" onSubmit={(e) => {
        e.preventDefault()
        const [kind, id] = f.scope ? f.scope.split(':') : []
        const cats = splitList(f.categories)
        onCreate({
          title: f.title, description: f.description || null, event_type: f.event_type,
          start_date: new Date(f.start_date).toISOString(), end_date: new Date(f.end_date).toISOString(),
          location: f.location || null, is_virtual: f.is_virtual, virtual_link: f.virtual_link || null,
          max_vendors: Number(f.max_vendors) || 50, entry_fee: Number(f.entry_fee) || 0,
          vendor_requirements: cats.length ? { categories: cats } : {},
          vendor_list_id: kind === 'list' ? id : null, group_id: kind === 'group' ? id : null,
        })
      }}>
        <div className="sm:col-span-2"><Field label="Title" id="e_title"><input id="e_title" className="input" value={f.title} onChange={set('title')} required minLength={3} /></Field></div>
        <Field label="Type" id="e_type"><select id="e_type" className="input" value={f.event_type} onChange={set('event_type')}>{EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></Field>
        <Field label="Who can register" id="e_scope">
          <select id="e_scope" className="input" value={f.scope} onChange={set('scope')}>
            <option value="">Any vendor</option>
            {managedLists.map((l) => <option key={l.id} value={`list:${l.id}`}>List · {l.name}</option>)}
            {adminGroups.map((g) => <option key={g.id} value={`group:${g.id}`}>Group · {g.name}</option>)}
          </select>
        </Field>
        <Field label="Starts" id="e_start"><input id="e_start" type="datetime-local" className="input" value={f.start_date} onChange={set('start_date')} required /></Field>
        <Field label="Ends" id="e_end"><input id="e_end" type="datetime-local" className="input" value={f.end_date} onChange={set('end_date')} required /></Field>
        <Field label="Location" id="e_loc"><input id="e_loc" className="input" value={f.location} onChange={set('location')} placeholder="Marikiti market" /></Field>
        <Field label="Virtual link" id="e_link" hint="shown to registered vendors"><input id="e_link" className="input" value={f.virtual_link} onChange={set('virtual_link')} /></Field>
        <Field label="Max vendors" id="e_max"><input id="e_max" type="number" min="1" className="input" value={f.max_vendors} onChange={set('max_vendors')} /></Field>
        <Field label="Entry fee" id="e_fee"><input id="e_fee" type="number" min="0" step="0.01" className="input" value={f.entry_fee} onChange={set('entry_fee')} /></Field>
        <div className="sm:col-span-2"><Field label="Vendor requirements: trades in" id="e_req" hint="optional, comma-separated"><input id="e_req" className="input" placeholder="produce, food" value={f.categories} onChange={set('categories')} /></Field></div>
        <div className="sm:col-span-2"><Field label="Description" id="e_desc"><textarea id="e_desc" rows={2} className="input" value={f.description} onChange={set('description')} /></Field></div>
        <label className="sm:col-span-2 flex items-center gap-2 text-sm text-neutral-300"><input type="checkbox" className="accent-vendor-500" checked={f.is_virtual} onChange={set('is_virtual')} /> Virtual event</label>
        <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary">Create event</button></div>
      </form>
    </Modal>
  )
}

function EventDetail({ e, me, onClose }) {
  const [regs, setRegs] = useState(null)
  useEffect(() => {
    setRegs(null)
    if (e && e.organizer_id === me?.id) api.get(`/events/${e.id}/registrations`).then((r) => setRegs(r.data)).catch(() => setRegs([]))
  }, [e, me])
  if (!e) return null
  return (
    <Modal open title={e.title} onClose={onClose} wide>
      <div className="text-sm text-neutral-300 space-y-1 mb-4">
        <div>{fmt.dateTime(e.start_date)} → {fmt.dateTime(e.end_date)}</div>
        {e.location && <div className="text-neutral-400">{e.location}</div>}
        {e.virtual_link && <a href={e.virtual_link} target="_blank" rel="noreferrer" className="text-vendor-400 hover:underline">{e.virtual_link}</a>}
        {e.description && <p className="text-neutral-400 pt-2 whitespace-pre-line">{e.description}</p>}
        {Object.keys(e.vendor_requirements || {}).length > 0 && <div className="text-xs text-neutral-500 pt-2">Requirements: {JSON.stringify(e.vendor_requirements)}</div>}
      </div>
      {regs && (
        <>
          <h3 className="text-sm font-semibold mb-2">Registered vendors · {regs.length}</h3>
          {regs.length === 0 ? <p className="text-sm text-neutral-500">Nobody yet.</p> : (
            <div className="divide-y divide-brief-border">
              {regs.map((r) => (
                <div key={r.vendor_id} className="py-2 flex items-center gap-3 text-sm">
                  <Link to={`/@${r.vendor_handle}`} className="flex-1 hover:text-vendor-300">{r.business_name} <span className="text-xs text-vendor-400">@{r.vendor_handle}</span></Link>
                  <span className={r.status === 'registered' ? 'pill-green' : 'pill-gray'}>{r.status}</span>
                  <span className="text-xs text-neutral-500">{fmt.date(r.registered_at)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
