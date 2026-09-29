import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { errorMessage } from '../lib/api'
import Notice from '../components/Notice'

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [form, setForm] = useState({ identifier: '', password: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      await login(form.identifier.trim(), form.password)
      nav(loc.state?.from || '/', { replace: true })
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err, 'Could not sign in') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Sign in" subtitle="Vendors only. Use your email or @handle.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="identifier">Email or @handle</label>
          <input id="identifier" className="input" autoComplete="username" value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" className="input" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </div>
        <Notice msg={msg} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Enter the network'}</button>
      </form>
      <p className="text-sm text-neutral-500 mt-6 text-center">
        New here? <Link to="/register" className="text-vendor-400 hover:underline">Register your business</Link>
      </p>
    </AuthShell>
  )
}

export function AuthShell({ title, subtitle, children, wide = false }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-brief-dark">
      <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <div className="mb-8 text-center">
          <div className="text-4xl font-bold tracking-tight">Brief<span className="text-vendor-500">_</span></div>
          <p className="text-neutral-500 text-sm mt-2">No consumers. Only vendors.</p>
          <p className="text-neutral-600 text-xs mt-1 italic">You source today, you sell tomorrow.</p>
        </div>
        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-neutral-500 mt-1 mb-6">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  )
}
