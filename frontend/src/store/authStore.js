import { create } from 'zustand'
import { api, setUnauthorizedHandler } from '../lib/api'

const savedVendor = (() => {
  try { return JSON.parse(localStorage.getItem('brief.vendor') || 'null') } catch { return null }
})()

export const useAuthStore = create((set, get) => ({
  token: localStorage.getItem('brief.token'),
  vendor: savedVendor,
  loading: false,

  isAuthenticated: () => Boolean(get().token),

  setSession(token, vendor) {
    localStorage.setItem('brief.token', token)
    if (vendor) localStorage.setItem('brief.vendor', JSON.stringify(vendor))
    set({ token, vendor: vendor ?? get().vendor })
  },

  async login(identifier, password) {
    const form = new URLSearchParams({ username: identifier, password })
    const { data } = await api.post('/auth/login', form)
    get().setSession(data.access_token, null)
    await get().refreshMe()
    return data
  },

  async register(payload) {
    const { data } = await api.post('/auth/register', payload)
    get().setSession(data.access_token, null)
    await get().refreshMe()
    return data
  },

  async refreshMe() {
    if (!get().token) return null
    set({ loading: true })
    try {
      const { data } = await api.get('/vendors/me')
      localStorage.setItem('brief.vendor', JSON.stringify(data))
      set({ vendor: data })
      return data
    } finally {
      set({ loading: false })
    }
  },

  async switchRole(role) {
    const { data } = await api.post(`/vendors/switch-role/${role}`)
    set((s) => ({ vendor: s.vendor ? { ...s.vendor, current_role: data.role } : s.vendor }))
    return data
  },

  logout() {
    localStorage.removeItem('brief.token')
    localStorage.removeItem('brief.vendor')
    set({ token: null, vendor: null })
  },
}))

setUnauthorizedHandler(() => {
  if (useAuthStore.getState().token) useAuthStore.getState().logout()
})
