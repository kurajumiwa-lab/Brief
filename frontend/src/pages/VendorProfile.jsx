import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BadgeCheck, Crown, Link2, Link2Off, MessageSquare, MapPin, Package, Save } from 'lucide-react'
import { api, errorMessage, splitList, ROLES } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import Notice from '../components/Notice'
import StatCard from '../components/StatCard'
import StockCard from '../components/StockCard'
import VendorCard from '../components/VendorCard'
import PageHeader from '../components/PageHeader'
import { Field } from './Register'

export default function VendorProfile() {
  const { handle } = useParams()
  const clean = (handle || '').replace(/^@/, '')
  const { vendor: me, refreshMe } = useAuth()
  const nav = useNavigate()
  const isMe = me?.vendor_handle === clean
  const [v, setV] = useState(null)
  const [stock, setStock] = useState([])
  const [connections, setConnections] = useState([])
  const [profile, setProfile] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = async () => {
    const { data } = await api.get(`/vendors/${clean}`)
    setV(data)
    if (isMe) {
      const [s, c, p] = await Promise.all([api.get('/stock/my-stock'), api.get('/vendors/connections'), api.get('/vendors/me/profile')])
      setStock(s.data); setConnections(c.data); setProfile(p.data)
    } else {
      const s = await api.get('/stock/network-stock', { params: { vendor_handle: clean } })
      setStock(s.data.filter((i) => i.vendor_handle === clean))
    }
  }
  useEffect(() => { setV(null); setMsg(null); load().catch((e) => setMsg({ ok: false, text: errorMessage(e) })) }, [clean, isMe]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn, ok) => {
    try { await fn(); await Promise.all([load(), refreshMe()]); if (ok) setMsg({ ok: true, text: ok }) } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
  }
  const message = async () => {
    try { const { data } = await api.post(`/chat/direct/${v.id}`); nav(`/chat?room=${data.room_id}`) } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
  }

  if (!v) return <Notice msg={msg} /> || null
  return (
    <div>
      <PageHeader
        title={<span className="flex items-center gap-2">{v.business_name}{v.is_verified && <BadgeCheck size={20} className="text-vendor-400" />}{v.is_patron && <Crown size={18} className="text-amber-400" />}</span>}
        subtitle={<span className="flex flex-wrap items-center gap-x-3"><span className="text-vendor-400">@{v.vendor_handle}</span><span className="capitalize">{v.current_role}</span>{v.physical_location && <span className="flex items-center gap-1"><MapPin size={12} /> {v.physical_location}</span>}{v.has_pos_connected && <span className="pill-blue">POS live</span>}</span>}
      >
        {!isMe && (
          <>
            <button className="btn-ghost" onClick={message}><MessageSquare size={14} /> Message</button>
            {v.connected ? <button className="btn-ghost" onClick={() => act(() => api.delete(`/vendors/connect/${v.id}`), 'Disconnected.')}><Link2Off size={14} /> Disconnect</button>
              : <button className="btn-primary" onClick={() => act(() => api.post(`/vendors/connect/${v.id}`), `Connected with @${v.vendor_handle}.`)}><Link2 size={14} /> Connect</button>}
          </>
        )}
      </PageHeader>
      <Notice msg={msg} className="mb-4" />

      {v.business_description && <p className="text-neutral-300 mb-5 max-w-3xl">{v.business_description}</p>}
      <div className="flex flex-wrap gap-1.5 mb-6">{(v.business_categories || []).map((c) => <span key={c} className="pill-gray">{c}</span>)}</div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <StatCard label="Network score" value={Math.round(v.network_score)} hint="deals, reciprocity, balance" />
        <StatCard label="Parasitism index" value={Number(v.parasitism_index).toFixed(1)} hint="avg. link strength" tone="blue" />
        <StatCard label="Stock moved" value={v.total_stock_moved} hint={`${v.total_sourced} sourced · ${v.total_supplied} supplied`} tone="amber" />
        <StatCard label="Role" value={<span className="capitalize text-lg">{v.current_role}</span>} hint={ROLES.find((r) => r.id === v.current_role)?.hint} tone="gray" />
      </div>

      {isMe && profile && <ProfileEditor v={v} profile={profile} onSaved={() => act(() => Promise.resolve(), 'Profile saved.')} setMsg={setMsg} />}

      <h2 className="font-semibold mb-3 flex items-center gap-2"><Package size={16} className="text-vendor-500" /> {isMe ? 'Your shelves' : 'On their shelves'}</h2>
      {stock.length === 0 ? <p className="text-sm text-neutral-500 mb-8">Nothing visible.</p> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-8">
          {stock.map((i) => <StockCard key={i.id} item={i} mine={isMe} onEdit={() => nav('/stock')} onRemove={() => nav('/stock')} onSource={() => nav('/stock?tab=network')} onDeal={async (item) => { const { data } = await api.post(`/chat/deal/${item.id}`); nav(`/chat?room=${data.room_id}`) }} />)}
        </div>
      )}

      {isMe && connections.length > 0 && (
        <>
          <h2 className="font-semibold mb-3">Connections · {connections.length}</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {connections.map((c) => <VendorCard key={c.vendor_id} vendor={c} score={c.parasitism_score} compact onDisconnect={(id) => act(() => api.delete(`/vendors/connect/${id}`), 'Disconnected.')} onMessage={async (id) => { const { data } = await api.post(`/chat/direct/${id}`); nav(`/chat?room=${data.room_id}`) }} />)}
          </div>
        </>
      )}
    </div>
  )
}

function ProfileEditor({ v, profile, onSaved, setMsg }) {
  const [open, setOpen] = useState(false)
  const [a, setA] = useState({ business_name: v.business_name, business_description: v.business_description || '', physical_location: v.physical_location || '', business_categories: (v.business_categories || []).join(', ') })
  const [p, setP] = useState({ primary_goods: (profile.primary_goods || []).join(', '), sourcing_interests: (profile.sourcing_interests || []).join(', '), preferred_regions: (profile.preferred_regions || []).join(', '), min_order_value: profile.min_order_value ?? '', accepts_bulk: Boolean(profile.accepts_bulk), offers_credit: Boolean(profile.offers_credit), warehouse_address: profile.warehouse_address || '', operating_hours: profile.operating_hours || '' })
  const setA_ = (k) => (e) => setA({ ...a, [k]: e.target.value })
  const setP_ = (k) => (e) => setP({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const save = async (e) => {
    e.preventDefault()
    try {
      await api.put('/vendors/me', { business_name: a.business_name, business_description: a.business_description || null, physical_location: a.physical_location || null, business_categories: splitList(a.business_categories) })
      await api.put('/vendors/me/profile', { primary_goods: splitList(p.primary_goods), sourcing_interests: splitList(p.sourcing_interests), preferred_regions: splitList(p.preferred_regions), min_order_value: p.min_order_value === '' ? null : Number(p.min_order_value), accepts_bulk: p.accepts_bulk, offers_credit: p.offers_credit, warehouse_address: p.warehouse_address || null, operating_hours: p.operating_hours || null })
      setOpen(false)
      onSaved()
    } catch (err) { setMsg({ ok: false, text: errorMessage(err) }) }
  }
  return (
    <div className="card p-4 mb-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">What you stock, what you source</div>
          <div className="text-xs text-neutral-500">Suggestions and the parasitism map are only as good as this. {profile.primary_goods?.length ? `Stocks ${profile.primary_goods.join(', ')}` : 'Nothing set yet'}{profile.sourcing_interests?.length ? ` · sources ${profile.sourcing_interests.join(', ')}` : ''}.</div>
        </div>
        <button className="btn-ghost" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit profile'}</button>
      </div>
      {open && (
        <form className="grid sm:grid-cols-2 gap-4 mt-4" onSubmit={save}>
          <Field label="Business name" id="pf_name"><input id="pf_name" className="input" value={a.business_name} onChange={setA_('business_name')} required /></Field>
          <Field label="Location" id="pf_loc"><input id="pf_loc" className="input" value={a.physical_location} onChange={setA_('physical_location')} /></Field>
          <div className="sm:col-span-2"><Field label="Trades in" id="pf_cats" hint="comma-separated"><input id="pf_cats" className="input" value={a.business_categories} onChange={setA_('business_categories')} /></Field></div>
          <div className="sm:col-span-2"><Field label="About" id="pf_desc"><textarea id="pf_desc" rows={2} className="input" value={a.business_description} onChange={setA_('business_description')} /></Field></div>
          <Field label="Primary goods (what you stock)" id="pf_goods" hint="comma-separated"><input id="pf_goods" className="input" value={p.primary_goods} onChange={setP_('primary_goods')} placeholder="sukuma, tomatoes, onions" /></Field>
          <Field label="Sourcing interests (what you buy)" id="pf_src" hint="comma-separated"><input id="pf_src" className="input" value={p.sourcing_interests} onChange={setP_('sourcing_interests')} placeholder="packaging, cooking oil" /></Field>
          <Field label="Preferred regions" id="pf_reg" hint="comma-separated"><input id="pf_reg" className="input" value={p.preferred_regions} onChange={setP_('preferred_regions')} /></Field>
          <Field label="Minimum order value" id="pf_mov"><input id="pf_mov" type="number" min="0" className="input" value={p.min_order_value} onChange={setP_('min_order_value')} /></Field>
          <Field label="Warehouse address" id="pf_wh"><input id="pf_wh" className="input" value={p.warehouse_address} onChange={setP_('warehouse_address')} /></Field>
          <Field label="Operating hours" id="pf_hrs"><input id="pf_hrs" className="input" value={p.operating_hours} onChange={setP_('operating_hours')} placeholder="Mon–Sat 6am–6pm" /></Field>
          <div className="sm:col-span-2 flex flex-wrap gap-4 text-sm text-neutral-300">
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-vendor-500" checked={p.accepts_bulk} onChange={setP_('accepts_bulk')} /> Accepts bulk orders</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-vendor-500" checked={p.offers_credit} onChange={setP_('offers_credit')} /> Offers credit to connected vendors</label>
          </div>
          <div className="sm:col-span-2 flex justify-end"><button className="btn-primary"><Save size={14} /> Save</button></div>
        </form>
      )}
    </div>
  )
}
