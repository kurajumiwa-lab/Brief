import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MessageSquare, Hash, Users, Repeat, ClipboardList, User, Plus, Send, Package, Wifi, WifiOff } from 'lucide-react'
import { api, errorMessage, fmt, splitList } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useWebSocket } from '../hooks/useWebSocket'
import Modal from '../components/Modal'
import Notice from '../components/Notice'
import PageHeader from '../components/PageHeader'
import { Field } from './Register'

const TYPE_META = {
  group: { label: 'Groups', icon: Users },
  vendor_list: { label: 'Vendor lists', icon: ClipboardList },
  deal: { label: 'Deals', icon: Repeat },
  direct: { label: 'Direct', icon: User },
  niche: { label: 'Niche topics', icon: Hash },
}

export default function Chat() {
  const { vendor, token } = useAuth()
  const [params, setParams] = useSearchParams()
  const roomId = params.get('room')
  const [rooms, setRooms] = useState([])
  const [messages, setMessages] = useState([])
  const [room, setRoom] = useState(null)
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState(null)
  const [newTopic, setNewTopic] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [myStock, setMyStock] = useState([])
  const bottomRef = useRef(null)

  const loadRooms = useCallback(async () => {
    const { data } = await api.get('/chat/rooms')
    setRooms(data)
    return data
  }, [])
  useEffect(() => { loadRooms().catch((e) => setMsg({ ok: false, text: errorMessage(e) })) }, [loadRooms])

  useEffect(() => {
    if (!roomId) { setRoom(null); setMessages([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const [r, m] = await Promise.all([api.get(`/chat/${roomId}`), api.get(`/chat/${roomId}/messages`)])
        if (cancelled) return
        setRoom(r.data); setMessages(m.data); setMsg(null)
      } catch (e) {
        if (!cancelled) { setRoom(null); setMessages([]); setMsg({ ok: false, text: errorMessage(e) }) }
      }
    })()
    return () => { cancelled = true }
  }, [roomId])

  const onIncoming = useCallback((m) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
  }, [])
  const { status, closeReason } = useWebSocket(room?.joined ? roomId : null, token, onIncoming)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])

  const grouped = useMemo(() => {
    const out = {}
    for (const r of rooms) (out[r.room_type] ||= []).push(r)
    return out
  }, [rooms])

  const send = async (payload) => {
    if (!roomId) return
    try {
      const { data } = await api.post(`/chat/${roomId}/message`, payload)
      onIncoming(data.sent)
      setDraft('')
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
  }
  const joinTopic = async () => {
    try { await api.post(`/chat/${roomId}/join`); const r = await api.get(`/chat/${roomId}`); setRoom(r.data); await loadRooms() } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
  }
  const openShare = async () => {
    try { const { data } = await api.get('/stock/my-stock'); setMyStock(data); setShareOpen(true) } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <PageHeader title="Chat" subtitle="Deal rooms, group rooms, list rooms and open niche topics. Vendor to vendor.">
        <button className="btn-primary" onClick={() => setNewTopic(true)}><Plus size={14} /> Niche topic</button>
      </PageHeader>
      <Notice msg={msg} className="mb-3" />

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[18rem_1fr] gap-4">
        <aside className={`card overflow-y-auto ${roomId ? 'hidden md:block' : ''}`}>
          {rooms.length === 0 && <p className="p-4 text-sm text-neutral-500">No rooms yet. Join a group, open a deal from network stock, or start a niche topic.</p>}
          {Object.entries(TYPE_META).map(([type, meta]) => grouped[type]?.length ? (
            <div key={type} className="py-2">
              <div className="px-4 py-1 text-[10px] uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><meta.icon size={12} /> {meta.label}</div>
              {grouped[type].map((r) => (
                <button key={r.id} onClick={() => setParams({ room: r.id })} className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${r.id === roomId ? 'bg-vendor-900/30 text-vendor-200' : 'hover:bg-neutral-800/60 text-neutral-300'}`}>
                  <span className="flex-1 truncate">{r.name}</span>
                  {!r.joined && <span className="pill-gray">open</span>}
                  <span className="text-[10px] text-neutral-600 tabular-nums">{r.message_count}</span>
                </button>
              ))}
            </div>
          ) : null)}
        </aside>

        <section className={`card flex flex-col min-h-0 ${!roomId ? 'hidden md:flex' : ''}`}>
          {!room ? (
            <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm p-8 text-center">
              <div><MessageSquare size={28} className="mx-auto mb-3 text-neutral-700" />Pick a room.</div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-brief-border flex items-center gap-3">
                <button className="md:hidden text-neutral-400 text-sm" onClick={() => setParams({})}>←</button>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{room.name}</div>
                  <div className="text-xs text-neutral-500 truncate">
                    {TYPE_META[room.room_type]?.label}{room.topic && ` · ${room.topic}`} · {room.participant_count} in room
                    {room.deal_stock_item_id && <> · <Link to="/stock?tab=network" className="text-vendor-400">stock</Link></>}
                  </div>
                </div>
                {room.joined && (
                  <span className={`flex items-center gap-1 text-[11px] ${status === 'open' ? 'text-vendor-400' : 'text-neutral-500'}`} title={closeReason || status}>
                    {status === 'open' ? <Wifi size={13} /> : <WifiOff size={13} />} {status === 'open' ? 'live' : status}
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && <p className="text-sm text-neutral-500 text-center py-8">No messages yet. Say habari.</p>}
                {messages.map((m) => <Bubble key={m.id} m={m} mine={m.sender_id === vendor?.id} />)}
                <div ref={bottomRef} />
              </div>

              {room.joined ? (
                <form className="p-3 border-t border-brief-border flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send({ content: draft.trim() }) }}>
                  <button type="button" className="btn-ghost !px-2.5" title="Share a stock item" onClick={openShare}><Package size={15} /></button>
                  <input className="input flex-1" placeholder="Message the room" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000} />
                  <button className="btn-primary !px-3" disabled={!draft.trim()} aria-label="Send"><Send size={15} /></button>
                </form>
              ) : (
                <div className="p-3 border-t border-brief-border flex items-center justify-between gap-3">
                  <span className="text-sm text-neutral-400">Open topic — join to post.</span>
                  <button className="btn-primary" onClick={joinTopic}>Join topic</button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <Modal open={newTopic} title="Start a niche topic" onClose={() => setNewTopic(false)}>
        <TopicForm onDone={async (payload) => {
          try {
            const { data } = await api.post('/chat/niche-topic', payload)
            setNewTopic(false)
            await loadRooms()
            setParams({ room: data.room_id })
          } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
        }} />
      </Modal>

      <Modal open={shareOpen} title="Share stock into the room" onClose={() => setShareOpen(false)}>
        {myStock.length === 0 ? <p className="text-sm text-neutral-500">Your shelves are empty.</p> : (
          <div className="divide-y divide-brief-border max-h-96 overflow-y-auto">
            {myStock.map((i) => (
              <button key={i.id} className="w-full text-left py-2.5 flex items-center gap-3 hover:text-vendor-300" onClick={() => { setShareOpen(false); send({ content: `${i.name} — ${i.quantity_available} ${i.unit_of_measure} available at ${fmt.money(i.wholesale_price ?? i.unit_price)}`, message_type: 'stock_share', shared_stock_id: i.id }) }}>
                <Package size={15} className="text-vendor-500" />
                <span className="flex-1 truncate">{i.name}</span>
                <span className="text-xs text-neutral-500">{i.quantity_available} {i.unit_of_measure}</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}

function TopicForm({ onDone }) {
  const [f, setF] = useState({ name: '', topic: '', topic_tags: '' })
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onDone({ name: f.name, topic: f.topic, topic_tags: splitList(f.topic_tags) }) }}>
      <Field label="Room name" id="t_name"><input id="t_name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} placeholder="Import regulations" /></Field>
      <Field label="Topic" id="t_topic"><input id="t_topic" className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} required placeholder="KRA, KEBS, clearing agents" /></Field>
      <Field label="Tags" id="t_tags" hint="comma-separated"><input id="t_tags" className="input" value={f.topic_tags} onChange={(e) => setF({ ...f, topic_tags: e.target.value })} /></Field>
      <div className="flex justify-end"><button className="btn-primary">Open topic</button></div>
    </form>
  )
}

function Bubble({ m, mine }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-xl px-3.5 py-2 ${mine ? 'bg-vendor-900/50 border border-vendor-800/60' : 'bg-neutral-900 border border-brief-border'}`}>
        {!mine && <Link to={`/@${m.sender_handle}`} className="text-[11px] text-vendor-400 hover:underline">@{m.sender_handle}</Link>}
        <div className="text-sm whitespace-pre-wrap break-words">{m.content}</div>
        {m.shared_stock && (
          <div className="mt-2 rounded-lg bg-black/30 border border-brief-border px-3 py-2 text-xs flex items-center gap-2">
            <Package size={13} className="text-vendor-500" />
            <span className="flex-1">{m.shared_stock.name} · {m.shared_stock.quantity_available} {m.shared_stock.unit_of_measure} · {fmt.money(m.shared_stock.wholesale_price ?? m.shared_stock.unit_price)}</span>
            <Link to="/stock?tab=network" className="text-vendor-400 hover:underline">source</Link>
          </div>
        )}
        {m.deal_data && Object.keys(m.deal_data).length > 0 && (
          <pre className="mt-2 text-[11px] text-neutral-400 bg-black/30 rounded p-2 overflow-x-auto">{JSON.stringify(m.deal_data, null, 1)}</pre>
        )}
        <div className="text-[10px] text-neutral-500 mt-1 text-right">{fmt.time(m.sent_at)}</div>
      </div>
    </div>
  )
}
