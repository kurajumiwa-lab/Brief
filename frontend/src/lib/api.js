import axios from 'axios'

// Same-origin API. Vite proxies /api in development; in production FastAPI
// serves the built frontend, so the browser never needs a hard-coded host.
export const api = axios.create({ baseURL: '/api', timeout: 20000 })

let onUnauthorized = null
export function setUnauthorizedHandler(fn) { onUnauthorized = fn }

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('brief.token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && onUnauthorized) onUnauthorized()
    return Promise.reject(err)
  },
)

/** Human message out of a FastAPI error (string detail or validation list). */
export function errorMessage(err, fallback = 'Something went wrong') {
  const detail = err?.response?.data?.detail
  if (!detail) return err?.message || fallback
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((d) => `${(d.loc || []).slice(1).join('.')}: ${d.msg}`).join('; ')
  }
  return fallback
}

/** WebSocket URL for a chat room, on the same origin (wss behind https). */
export function roomSocketUrl(roomId, token) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/chat/${roomId}/ws?token=${encodeURIComponent(token)}`
}

export const fmt = {
  money: (n, currency = 'KES') =>
    n == null ? '—' : `${currency} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
  num: (n) => (n == null ? '—' : Number(n).toLocaleString()),
  date: (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'),
  dateTime: (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'),
  time: (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''),
  ago: (iso) => {
    if (!iso) return '—'
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  },
}

export const ROLES = [
  { id: 'sourcing', label: 'Sourcing', hint: 'Buying stock from the network' },
  { id: 'selling', label: 'Selling', hint: 'Supplying stock to the network' },
  { id: 'both', label: 'Both', hint: 'Sourcing and selling' },
  { id: 'dormant', label: 'Dormant', hint: 'Watching, not trading' },
]

export const GROUP_TYPES = ['niche', 'regional', 'trade', 'sourcing', 'event', 'open']
export const TOOL_CATEGORIES = [
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'cold_storage', label: 'Cold storage' },
  { id: 'transport', label: 'Transport' },
  { id: 'courier', label: 'Courier' },
  { id: 'popup_shop', label: 'Pop-up shop' },
  { id: 'hotel_sourcing', label: 'Hotel sourcing' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'packaging', label: 'Packaging' },
]
export const EVENT_TYPES = ['market_day', 'sourcing_trip', 'trade_fair', 'workshop', 'popup', 'meetup', 'auction']
export const POS_TYPES = [
  { id: 'square', label: 'Square', mode: 'pull' },
  { id: 'shopify', label: 'Shopify', mode: 'pull' },
  { id: 'csv', label: 'CSV export', mode: 'push' },
  { id: 'manual', label: 'Manual', mode: 'push' },
  { id: 'custom_api', label: 'Custom API', mode: 'push' },
]

export const splitList = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean)
