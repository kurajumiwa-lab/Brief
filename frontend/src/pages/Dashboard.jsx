import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Package, ArrowLeftRight, Users, Sparkles, Activity, Plug, Crown } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import StatCard from '../components/StatCard'
import VendorCard from '../components/VendorCard'
import MovementRow from '../components/MovementRow'
import PageHeader from '../components/PageHeader'
import Notice from '../components/Notice'

export default function Dashboard() {
  const { vendor, refreshMe } = useAuth()
  const [stock, setStock] = useState([])
  const [movements, setMovements] = useState([])
  const [suggested, setSuggested] = useState([])
  const [connections, setConnections] = useState([])
  const [stats, setStats] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [s, m, sug, con, st] = await Promise.all([
      api.get('/stock/my-stock'), api.get('/stock/movements'), api.get('/vendors/suggested', { params: { limit: 6 } }),
      api.get('/vendors/connections'), api.get('/vendors/stats'),
    ])
    setStock(s.data); setMovements(m.data); setSuggested(sug.data); setConnections(con.data); setStats(st.data)
  }
  useEffect(() => { load().catch((e) => setMsg({ ok: false, text: errorMessage(e) })) }, [])

  const open = movements.filter((m) => ['pending', 'confirmed', 'in_transit'].includes(m.status))
  const units = stock.reduce((a, i) => a + (i.quantity_in_stock || 0), 0)
  const reserved = stock.reduce((a, i) => a + (i.quantity_reserved || 0), 0)

  const act = async (m, action) => {
    setBusy(true)
    try {
      await api.post(`/stock/movements/${m.id}/${action}`)
      await Promise.all([load(), refreshMe()])
      setMsg({ ok: true, text: `Movement ${action === 'receive' ? 'received — shelves updated' : action + 'ed'}.` })
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) } finally { setBusy(false) }
  }
  const connect = async (id) => {
    try { await api.post(`/vendors/connect/${id}`); await load() } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
  }

  if (!vendor) return null
  return (
    <div>
      <PageHeader
        title={<>Habari, <span className="text-vendor-400">@{vendor.vendor_handle}</span></>}
        subtitle={`${vendor.business_name} · ${vendor.current_role} today${vendor.physical_location ? ` · ${vendor.physical_location}` : ''}`}
      >
        {!vendor.is_patron && <Link to="/vendor-lists" className="btn-ghost"><Crown size={14} /> Become a patron</Link>}
        {!vendor.has_pos_connected && <Link to="/pos" className="btn-ghost"><Plug size={14} /> Connect your POS</Link>}
        <Link to="/stock" className="btn-primary"><Package size={14} /> Stock room</Link>
      </PageHeader>

      <Notice msg={msg} className="mb-4" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Package} label="Units on shelf" value={units.toLocaleString()} hint={`${stock.length} lines · ${reserved} reserved`} />
        <StatCard icon={ArrowLeftRight} label="Open movements" value={open.length} hint={`${vendor.total_sourced} sourced · ${vendor.total_supplied} supplied`} tone="blue" />
        <StatCard icon={Activity} label="Network score" value={Math.round(vendor.network_score)} hint={`parasitism index ${Number(vendor.parasitism_index).toFixed(1)}`} />
        <StatCard icon={Users} label="Connections" value={connections.length} hint={stats ? `${stats.vendors} vendors on the network` : ''} tone="amber" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Movements needing you</h2>
            <Link to="/stock?tab=movements" className="text-xs text-vendor-400 hover:underline">All movements</Link>
          </div>
          {open.length === 0 ? (
            <div className="card p-6 text-sm text-neutral-500">
              Nothing in flight. Browse <Link to="/stock?tab=network" className="text-vendor-400 hover:underline">network stock</Link> to source, or put your own stock on the network.
            </div>
          ) : open.slice(0, 6).map((m) => <MovementRow key={m.id} m={m} onAction={act} busy={busy} />)}

          <h2 className="font-semibold pt-4">Your strongest links</h2>
          {connections.length === 0 ? (
            <div className="card p-6 text-sm text-neutral-500">No connections yet. Your first completed sourcing creates one automatically.</div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {connections.slice(0, 4).map((c) => <VendorCard key={c.vendor_id} vendor={c} score={c.parasitism_score} compact />)}
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <h2 className="font-semibold flex items-center gap-2"><Sparkles size={16} className="text-vendor-400" /> Vendors worth meeting</h2>
          {suggested.length === 0 ? (
            <div className="card p-5 text-sm text-neutral-500">
              Suggestions appear once your <Link to={`/@${vendor.vendor_handle}`} className="text-vendor-400 hover:underline">profile</Link> says what you stock and what you source.
            </div>
          ) : suggested.map((s) => <VendorCard key={s.vendor_id} vendor={s} reasons={s.reasons} onConnect={connect} compact />)}
        </aside>
      </div>
    </div>
  )
}
