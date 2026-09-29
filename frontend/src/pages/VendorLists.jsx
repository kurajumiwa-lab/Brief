import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Crown, Plus, Users, Lock, Unlock, Check, X, MessageSquare } from 'lucide-react'
import { api, errorMessage, fmt, splitList } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import Modal from '../components/Modal'
import Notice from '../components/Notice'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { Field } from './Register'

const statusPill = { approved: 'pill-green', pending: 'pill-amber', rejected: 'pill-red', removed: 'pill-gray' }

export default function VendorLists() {
  const { vendor, refreshMe } = useAuth()
  const [lists, setLists] = useState([])
  const [mine, setMine] = useState([])
  const [patron, setPatron] = useState(null)
  const [msg, setMsg] = useState(null)
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState(null)
  const [filters, setFilters] = useState({ category: '', region: '' })

  const load = async () => {
    const [b, m, p] = await Promise.all([
      api.get('/vendor-lists/browse', { params: { category: filters.category || undefined, region: filters.region || undefined } }),
      api.get('/vendor-lists/mine'),
      api.get('/vendors/me/patron'),
    ])
    setLists(b.data); setMine(m.data); setPatron(p.data)
  }
  useEffect(() => { load().catch((e) => setMsg({ ok: false, text: errorMessage(e) })) }, [filters.category, filters.region]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn, ok) => {
    try { const out = await fn(); await load(); if (ok) setMsg({ ok: true, text: typeof ok === 'function' ? ok(out) : ok }); return out } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
    return null
  }
  const becomePatron = () => act(async () => { const r = await api.post('/vendors/become-patron'); await refreshMe(); return r.data }, (o) => `${o.message} Tier: ${o.tier}.`)
  const register = (l) => act(() => api.post(`/vendor-lists/${l.id}/register`), (r) => (r.data.status === 'approved' ? 'You are on the list.' : 'Registration sent — the patron will review it.'))

  const runByMe = mine.filter((l) => l.i_run_it)
  const memberOf = mine.filter((l) => !l.i_run_it)

  return (
    <div>
      <PageHeader title="Vendor Lists" subtitle="Curated rosters run by patrons and groups: who is in the Saturday market, who supplies the hotel, who gets the bulk price.">
        {patron?.is_patron ? (
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> New list</button>
        ) : (
          <button className="btn-primary" onClick={becomePatron}><Crown size={14} /> Become a patron</button>
        )}
      </PageHeader>

      <Notice msg={msg} className="mb-4" />

      {patron?.is_patron && (
        <div className="card p-4 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="flex items-center gap-2 font-medium"><Crown size={16} className="text-amber-400" /> Patron · <span className="capitalize">{patron.tier}</span></span>
          <span className="text-neutral-400">{patron.total_vendors_managed} vendors managed</span>
          <span className="text-neutral-400">{patron.total_events_organized} events organized</span>
          <span className="text-neutral-400">reputation {Math.round(patron.reputation_score)}</span>
          <span className="text-neutral-500 ml-auto">
            {patron.max_lists == null ? 'unlimited lists' : `${runByMe.length}/${patron.max_lists} lists`} · {patron.max_vendors_per_list == null ? 'no cap per list' : `${patron.max_vendors_per_list} vendors per list`}
          </span>
        </div>
      )}

      {runByMe.length > 0 && (
        <Section title="Lists you run">
          {runByMe.map((l) => <ListCard key={l.id} l={l} onManage={() => setManaging(l)} onRegister={register} />)}
        </Section>
      )}
      {memberOf.length > 0 && (
        <Section title="Lists you are on">
          {memberOf.map((l) => <ListCard key={l.id} l={l} onRegister={register} />)}
        </Section>
      )}

      <div className="flex items-center justify-between mb-3 mt-2">
        <h2 className="font-semibold">Open lists</h2>
        <div className="flex gap-2">
          <input className="input w-36" placeholder="category" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} />
          <input className="input w-36" placeholder="region" value={filters.region} onChange={(e) => setFilters({ ...filters, region: e.target.value })} />
        </div>
      </div>
      {lists.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No lists yet" hint="Patrons create lists; vendors register. Become a patron to run the first one." />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {lists.map((l) => <ListCard key={l.id} l={l} onRegister={register} onManage={l.i_run_it ? () => setManaging(l) : undefined} />)}
        </div>
      )}

      <CreateListModal open={creating} onClose={() => setCreating(false)} onCreate={async (payload) => {
        const out = await act(() => api.post('/vendor-lists/create', payload), (r) => `${r.data.message}. Cap: ${r.data.max_vendors} vendors.`)
        if (out) setCreating(false)
      }} />

      <ManageListModal l={managing} onClose={() => setManaging(null)} onChanged={load} setMsg={setMsg} me={vendor} />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h2 className="font-semibold mb-3">{title}</h2>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{children}</div>
    </div>
  )
}

function ListCard({ l, onRegister, onManage }) {
  const full = l.member_count >= l.max_vendors
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium truncate">{l.name}</h3>
          <div className="text-xs text-neutral-500">
            {l.is_group_created ? 'group list' : <>patron <Link to={`/@${l.patron_handle}`} className="text-vendor-400 hover:underline">@{l.patron_handle}</Link></>}
            {l.category && ` · ${l.category}`}{l.region && ` · ${l.region}`}
          </div>
        </div>
        {l.is_open ? <span className="pill-green"><Unlock size={11} className="mr-1" />open</span> : <span className="pill-gray"><Lock size={11} className="mr-1" />closed</span>}
      </div>
      {l.description && <p className="text-sm text-neutral-400 line-clamp-2">{l.description}</p>}
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <Users size={13} /> {l.member_count}/{l.max_vendors} vendors
        {l.requires_approval && <span className="pill-gray">approval</span>}
        {l.my_status && <span className={statusPill[l.my_status] || 'pill-gray'}>{l.my_status}</span>}
      </div>
      <div className="flex gap-2 pt-1 mt-auto">
        {onManage && <button className="btn-ghost flex-1" onClick={onManage}>Manage</button>}
        {!l.i_run_it && !l.my_status && (
          <button className="btn-primary flex-1" disabled={!l.is_open || full} onClick={() => onRegister(l)}>
            {full ? 'Full' : l.requires_approval ? 'Apply' : 'Join'}
          </button>
        )}
        {l.my_status === 'approved' && <Link to="/chat" className="btn-ghost" title="List chat"><MessageSquare size={14} /></Link>}
      </div>
    </div>
  )
}

function CreateListModal({ open, onClose, onCreate }) {
  const [f, setF] = useState({ name: '', description: '', category: '', region: '', max_vendors: 20, requires_approval: true, categories: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  return (
    <Modal open={open} title="New vendor list" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault()
        const cats = splitList(f.categories)
        onCreate({
          name: f.name, description: f.description || null, category: f.category || null, region: f.region || null,
          max_vendors: Number(f.max_vendors) || 20, requires_approval: f.requires_approval,
          entry_criteria: cats.length ? { business_categories: cats } : {},
        })
      }}>
        <Field label="Name" id="l_name"><input id="l_name" className="input" value={f.name} onChange={set('name')} required minLength={3} /></Field>
        <Field label="Description" id="l_desc"><textarea id="l_desc" rows={2} className="input" value={f.description} onChange={set('description')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" id="l_cat"><input id="l_cat" className="input" value={f.category} onChange={set('category')} /></Field>
          <Field label="Region" id="l_reg"><input id="l_reg" className="input" value={f.region} onChange={set('region')} /></Field>
          <Field label="Max vendors" id="l_max" hint="capped by tier"><input id="l_max" type="number" min="1" className="input" value={f.max_vendors} onChange={set('max_vendors')} /></Field>
          <Field label="Entry: trades in" id="l_ec" hint="optional, comma-separated"><input id="l_ec" className="input" placeholder="produce, food" value={f.categories} onChange={set('categories')} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-300"><input type="checkbox" className="accent-vendor-500" checked={f.requires_approval} onChange={set('requires_approval')} /> Approve each vendor by hand</label>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary">Create list</button></div>
      </form>
    </Modal>
  )
}

function ManageListModal({ l, onClose, onChanged, setMsg }) {
  const [members, setMembers] = useState([])
  const [tab, setTab] = useState('pending')
  const load = async () => {
    if (!l) return
    const { data } = await api.get(`/vendor-lists/${l.id}/members`, { params: { status: tab } })
    setMembers(data)
  }
  useEffect(() => { load().catch(() => {}) }, [l, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!l) return null
  const act = async (fn, ok) => {
    try { await fn(); await Promise.all([load(), onChanged()]); setMsg({ ok: true, text: ok }) } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
  }
  return (
    <Modal open title={`Manage · ${l.name}`} onClose={onClose} wide>
      <div className="flex items-center justify-between mb-4">
        <div className="inline-flex rounded-lg border border-brief-border bg-neutral-900 p-0.5">
          {['pending', 'approved', 'rejected'].map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1 text-sm rounded-md capitalize ${tab === t ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400'}`}>{t}</button>
          ))}
        </div>
        <button className="btn-ghost" onClick={() => act(() => api.post(`/vendor-lists/${l.id}/close`, null, { params: { is_open: !l.is_open } }), l.is_open ? 'List closed to new registrations.' : 'List reopened.')}>
          {l.is_open ? <><Lock size={14} /> Close list</> : <><Unlock size={14} /> Reopen list</>}
        </button>
      </div>
      {members.length === 0 ? (
        <p className="text-sm text-neutral-500 py-6 text-center">No {tab} vendors.</p>
      ) : (
        <div className="divide-y divide-brief-border">
          {members.map((m) => (
            <div key={m.vendor_id} className="py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <Link to={`/@${m.vendor_handle}`} className="font-medium hover:text-vendor-300">{m.business_name}</Link>
                <span className="text-xs text-vendor-400 ml-2">@{m.vendor_handle}</span>
                <div className="text-xs text-neutral-500">{(m.business_categories || []).join(', ') || '—'} · {fmt.date(m.joined_at)}</div>
              </div>
              {tab === 'pending' && (
                <>
                  <button className="btn-primary !py-1 !px-2 text-xs" onClick={() => act(() => api.post(`/vendor-lists/${l.id}/approve/${m.vendor_id}`), `@${m.vendor_handle} approved.`)}><Check size={13} /> Approve</button>
                  <button className="btn-danger !py-1 !px-2 text-xs" onClick={() => act(() => api.post(`/vendor-lists/${l.id}/reject/${m.vendor_id}`), `@${m.vendor_handle} rejected.`)}><X size={13} /></button>
                </>
              )}
              {tab === 'approved' && (
                <button className="btn-danger !py-1 !px-2 text-xs" onClick={() => act(() => api.post(`/vendor-lists/${l.id}/reject/${m.vendor_id}`), `@${m.vendor_handle} removed.`)}><X size={13} /> Remove</button>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
