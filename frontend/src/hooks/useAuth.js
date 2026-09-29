import { useAuthStore } from '../store/authStore'

/** Convenience selector over the auth store. */
export function useAuth() {
  const token = useAuthStore((s) => s.token)
  const vendor = useAuthStore((s) => s.vendor)
  const loading = useAuthStore((s) => s.loading)
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)
  const logout = useAuthStore((s) => s.logout)
  const refreshMe = useAuthStore((s) => s.refreshMe)
  const switchRole = useAuthStore((s) => s.switchRole)
  return { token, vendor, loading, isAuthenticated: Boolean(token), login, register, logout, refreshMe, switchRole }
}
