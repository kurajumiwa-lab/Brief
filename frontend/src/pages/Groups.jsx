import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Users, Plus, Search, MessageSquare, LogOut, Check, ClipboardList, Shield } from 'lucide-react'
import { api, errorMessage, fmt, splitList, GROUP_TYPES } from '../lib/api'
import Modal from '../components/Modal'
import Notice from '../components/Notice'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { Field } from './Register'

const typeTone = { niche: 'pill-blue', regional: 'pill-amber', trade: 'pill-green', sourcing: 'pill-green', event: 'pill-amber', open: 'pill-gray' }

export default function Groups() {
  const nav = useNavigate()
  const [groups, setGroups] = useState([])
  const [mine, setMine] = useState([])
  const [filters, setFilters] = useState({ search: '', group_type: '' })
  const [msg, setMsg] = useState(null)
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState(null)

  const load = async () => {
    const [b, m] = await Promise.all([
      api.get('/groups/browse', { params: { search: filters.search || undefined, group_type: filters.group_type || undefined } }),
      api.get('/groups/mine'),
    ])
    setGroups(b.data); setMine(m.data)
  }
  useEffect(() => { load().catch((e) => setMsg({ ok: false, text: errorMessage(e) })) }, [filters.group_type]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn, ok) => {
    try { const out = await fn(); await load(); if (ok) setMsg({ ok: true, text: typeof ok === 'function' ? ok(out) : ok }); return out } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
    return null
  }
  const join = (g) => act(() => api.post(`/groups/${g.id}/join`), (r) => r.data.message)
  const leave = (g) => window.confirm(`Leave "${g.name}"?`) && act(() => api.post(`/groups/${g.id}/leave`), (r) => r.data.message)
  const mineIds = new Set(mine.map((g) => g.id))

  return (
    <div>
      <PageHeader title="Vendor Groups" subtitle="Niche, regional, trade and sourcing circles. Every group gets a chat room the moment it exists.">
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> New group</button>
      </PageHeader>
      <Notice msg={msg} className="mb-4" />

      {mine.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold mb-3">Your groups</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {mine.map((g) => <GroupCard key={g.id} g={g} onOpen={() => setDetail(g)} onChat={() => nav(`/chat?room=${g.chat_room_id}`)} onLeave={() => leave(g)} />)}
          </div>
        </div>
      )}

      <form className="flex gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); load() }}>
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-neutral-500" />
          <input className="input pl-9" placeholder="Search groups" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        </div>
        <select className="input w-40" value={filters.group_type} onChange={(e) => setFilters({ ...filters, group_type: e.target.value })}>
          <option value="">All types</option>
          {GROUP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </form>

      {groups.length === 0 ? (
        <EmptyState icon={Users} title="No groups match" hint="Start the first one for your trade or your market." action={<button className="btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> New group</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {groups.filter((g) => !mineIds.has(g.id)).map((g) => <GroupCard key={g.id} g={g} onOpen={() => setDetail(g)} onJoin={() => join(g)} />)}
        </div>
      )}

      <CreateGroupModal open={creating} onClose={() => setCreating(false)} onCreate={async (payload) => {
        const out = await act(() => api.post('/groups/create', payload), (r) => r.data.message)
        if (out) setCreating(false)
      }} />
      <GroupDetail g={detail} onClose={() => setDetail(null)} setMsg={setMsg} onChanged={load} />
    </div>
  )
}

function GroupCard({ g, onOpen, onJoin, onChat, onLeave }) {
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpen} className="text-left min-w-0">
          <h3 className="font-medium truncate hover:text-vendor-300">{g.name}</h3>
          <div className="text-xs text-neutral-500">{g.category || 'general'}{g.region && ` · ${g.region}`}</div>
        </button>
        <span className={typeTone[g.group_type] || 'pill-gray'}>{g.group_type}</span>
      </div>
      {g.description && <p className="text-sm text-neutral-400 line-clamp-2">{g.description}</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
        <Users size={13} /> {g.member_count}{g.max_members ? `/${g.max_members}` : ''}
        {!g.is_public && <span className="pill-gray">private</span>}
        {g.requires_approval && <span className="pill-gray">approval</span>}
        {g.my_role && <span className={g.my_role === 'pending' ? 'pill-amber' : 'pill-green'}>{g.my_role}</span>}
        {(g.tags || []).slice(0, 3).map((t) => <span key={t} className="pill-gray">#{t}</span>)}
      </div>
      <div className="flex gap-2 pt-1 mt-auto">
        {onJoin && !g.my_role && <button className="btn-primary flex-1" onClick={onJoin}>{g.requires_approval ? 'Request to join' : 'Join'}</button>}
        {onJoin && g.my_role === 'pending' && <button className="btn-ghost flex-1" disabled>Pending approval</button>}
        {onChat && g.my_role && g.my_role !== 'pending' && <button className="btn-primary flex-1" onClick={onChat}><MessageSquare size={14} /> Chat</button>}
        {onLeave && g.my_role && <button className="btn-ghost" onClick={onLeave} title="Leave"><LogOut size={14} /></button>}
      </div>
    </div>
  )
}

function CreateGroupModal({ open, onClose, onCreate }) {
  const [f, setF] = useState({ name: '', description: '', group_type: 'niche', category: '', region: '', tags: '', is_public: true, requires_approval: false, max_members: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  return (
    <Modal open={open} title="New vendor group" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault()
        onCreate({
          name: f.name, description: f.description || null, group_type: f.group_type, category: f.category || null, region: f.region || null,
          tags: splitList(f.tags), is_public: f.is_public, requires_approval: f.requires_approval, max_members: f.max_members ? Number(f.max_members) : null,
        })
      }}>
        <Field label="Name" id="g_name"><input id="g_name" className="input" value={f.name} onChange={set('name')} required minLength={3} /></Field>
        <Field label="Description" id="g_desc"><textarea id="g_desc" rows={2} className="input" value={f.description} onChange={set('description')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" id="g_type">
            <select id="g_type" className="input" value={f.group_type} onChange={set('group_type')}>{GROUP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          </Field>
          <Field label="Category" id="g_cat"><input id="g_cat" className="input" value={f.category} onChange={set('category')} placeholder="produce" /></Field>
          <Field label="Region" id="g_reg"><input id="g_reg" className="input" value={f.region} onChange={set('region')} placeholder="Nairobi" /></Field>
          <Field label="Max members" id="g_max" hint="blank = no cap"><input id="g_max" type="number" min="2" className="input" value={f.max_members} onChange={set('max_members')} /></Field>
        </div>
        <Field label="Tags" id="g_tags" hint="comma-separated"><input id="g_tags" className="input" value={f.tags} onChange={set('tags')} /></Field>
        <div className="flex flex-wrap gap-4 text-sm text-neutral-300">
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-vendor-500" checked={f.is_public} onChange={set('is_public')} /> Public (listed in browse)</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-vendor-500" checked={f.requires_approval} onChange={set('requires_approval')} /> Admins approve joins</label>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary">Create group</button></div>
      </form>
    </Modal>
  )
}

function GroupDetail({ g, onClose, setMsg, onChanged }) {
  const nav = useNavigate()
  const [full, setFull] = useState(null)
  const [members, setMembers] = useState([])
  const [listForm, setListForm] = useState(null)
  const load = async () => {
    if (!g) return
    const [d, m] = await Promise.all([api.get(`/groups/${g.id}`), api.get(`/groups/${g.id}/members`).catch(() => ({ data: [] }))])
    setFull(d.data); setMembers(m.data)
  }
  useEffect(() => { setFull(null); setMembers([]); setListForm(null); load().catch(() => {}) }, [g]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!g) return null
  const me = full || g
  const isAdmin = ['admin', 'moderator'].includes(me.my_role)
  const act = async (fn, ok) => {
    try { const out = await fn(); await Promise.all([load(), onChanged()]); setMsg({ ok: true, text: typeof ok === 'function' ? ok(out) : ok }); return out } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
    return null
  }
  const pending = members.filter((m) => !m.is_active)
  const active = members.filter((m) => m.is_active)
  return (
    <Modal open title={me.name} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className={typeTone[me.group_type] || 'pill-gray'}>{me.group_type}</span>
        {me.category && <span className="pill-gray">{me.category}</span>}
        {me.region && <span className="pill-gray">{me.region}</span>}
        <span className="text-neutral-500">created by <Link to={`/@${me.created_by}`} className="text-vendor-400">@{me.created_by}</Link></span>
        {me.my_role && <span className="pill-green ml-auto"><Shield size={11} className="mr-1" />{me.my_role}</span>}
      </div>
      {me.description && <p className="text-sm text-neutral-300 mb-4">{me.description}</p>}
      {full?.rules && <p className="text-xs text-neutral-500 mb-4 whitespace-pre-line">Rules: {full.rules}</p>}

      <div className="flex flex-wrap gap-2 mb-5">
        {me.my_role && me.my_role !== 'pending' && me.chat_room_id && <button className="btn-primary" onClick={() => nav(`/chat?room=${me.chat_room_id}`)}><MessageSquare size={14} /> Open group chat</button>}
        {!me.my_role && <button className="btn-primary" onClick={() => act(() => api.post(`/groups/${g.id}/join`), (r) => r.data.message)}>{me.requires_approval ? 'Request to join' : 'Join group'}</button>}
        {isAdmin && <button className="btn-ghost" onClick={() => setListForm({ name: '', description: '', max_vendors: 50, requires_approval: true })}><ClipboardList size={14} /> Create a vendor list</button>}
      </div>

      {listForm && (
        <form className="card p-4 mb-5 space-y-3 bg-neutral-900/60" onSubmit={async (e) => {
          e.preventDefault()
          const out = await act(() => api.post(`/groups/${g.id}/create-vendor-list`, { ...listForm, max_vendors: Number(listForm.max_vendors) || 50, description: listForm.description || null }), (r) => r.data.message)
          if (out) setListForm(null)
        }}>
          <div className="text-sm font-medium">Group-created vendor list <span className="text-neutral-500 font-normal">· no patron needed, group admins run it</span></div>
          <div className="grid sm:grid-cols-3 gap-3">
            <input className="input sm:col-span-2" placeholder="List name" value={listForm.name} onChange={(e) => setListForm({ ...listForm, name: e.target.value })} required minLength={3} />
            <input className="input" type="number" min="1" placeholder="Max vendors" value={listForm.max_vendors} onChange={(e) => setListForm({ ...listForm, max_vendors: e.target.value })} />
          </div>
          <input className="input" placeholder="Description" value={listForm.description} onChange={(e) => setListForm({ ...listForm, description: e.target.value })} />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-neutral-300"><input type="checkbox" className="accent-vendor-500" checked={listForm.requires_approval} onChange={(e) => setListForm({ ...listForm, requires_approval: e.target.checked })} /> Approve registrations</label>
            <div className="flex gap-2"><button type="button" className="btn-ghost" onClick={() => setListForm(null)}>Cancel</button><button className="btn-primary">Create</button></div>
          </div>
        </form>
      )}

      {isAdmin && pending.length > 0 && (
        <>
          <h3 className="text-sm font-semibold mb-2">Waiting for approval</h3>
          <div className="divide-y divide-brief-border mb-5">
            {pending.map((m) => (
              <div key={m.vendor_id} className="py-2 flex items-center gap-3">
                <div className="flex-1"><span className="font-medium">{m.business_name}</span> <span className="text-xs text-vendor-400">@{m.vendor_handle}</span></div>
                <button className="btn-primary !py-1 !px-2 text-xs" onClick={() => act(() => api.post(`/groups/${g.id}/approve/${m.vendor_id}`), `@${m.vendor_handle} is in.`)}><Check size={13} /> Approve</button>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="text-sm font-semibold mb-2">Members · {active.length}</h3>
      {active.length === 0 ? <p className="text-sm text-neutral-500">Members are visible to members.</p> : (
        <div className="grid sm:grid-cols-2 gap-x-6 divide-y sm:divide-y-0 divide-brief-border">
          {active.map((m) => (
            <div key={m.vendor_id} className="py-2 flex items-center gap-3 text-sm">
              <Link to={`/@${m.vendor_handle}`} className="flex-1 min-w-0 truncate hover:text-vendor-300">{m.business_name} <span className="text-xs text-vendor-400">@{m.vendor_handle}</span></Link>
              <span className="pill-gray">{m.role}</span>
              <span className="text-xs text-neutral-500 hidden sm:inline">{m.messages_sent} msgs · {fmt.date(m.joined_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
