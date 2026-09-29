import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { errorMessage, splitList } from '../lib/api'
import Notice from '../components/Notice'
import { AuthShell } from './Login'

export default function Register() {
  const { register } = useAuth()
  const nav = useNavigate()
  const [form, setForm] = useState({
    business_name: '', vendor_handle: '', email: '', phone: '', password: '',
    business_categories: '', business_description: '', physical_location: '',
  })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      await register({
        ...form,
        vendor_handle: form.vendor_handle.replace(/^@/, '').trim().toLowerCase(),
        phone: form.phone || null,
        business_categories: splitList(form.business_categories),
      })
      nav('/', { replace: true })
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err, 'Could not register') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Register your business" subtitle="Every account is a vendor. You can source, sell, or both — and change your mind any day." wide>
      <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
        <Field label="Business name" id="business_name"><input id="business_name" className="input" value={form.business_name} onChange={set('business_name')} required maxLength={200} /></Field>
        <Field label="@handle" id="vendor_handle" hint="letters, numbers, underscores">
          <div className="relative">
            <span className="absolute left-3 top-2 text-neutral-500 text-sm">@</span>
            <input id="vendor_handle" className="input pl-7" value={form.vendor_handle} onChange={set('vendor_handle')} required minLength={3} maxLength={50} pattern="@?[A-Za-z0-9_]+" />
          </div>
        </Field>
        <Field label="Email" id="email"><input id="email" type="email" className="input" autoComplete="email" value={form.email} onChange={set('email')} required /></Field>
        <Field label="Phone" id="phone" hint="optional"><input id="phone" className="input" value={form.phone} onChange={set('phone')} maxLength={20} /></Field>
        <Field label="Password" id="password" hint="8+ characters"><input id="password" type="password" className="input" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={8} /></Field>
        <Field label="Location" id="physical_location"><input id="physical_location" className="input" placeholder="Nairobi, Gikomba" value={form.physical_location} onChange={set('physical_location')} /></Field>
        <div className="sm:col-span-2">
          <Field label="What you trade in" id="business_categories" hint="comma-separated: produce, textiles, electronics">
            <input id="business_categories" className="input" value={form.business_categories} onChange={set('business_categories')} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="About the business" id="business_description" hint="optional">
            <textarea id="business_description" className="input" rows={2} value={form.business_description} onChange={set('business_description')} />
          </Field>
        </div>
        <div className="sm:col-span-2 space-y-3">
          <Notice msg={msg} />
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Join the network'}</button>
        </div>
      </form>
      <p className="text-sm text-neutral-500 mt-6 text-center">
        Already a vendor? <Link to="/login" className="text-vendor-400 hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  )
}

export function Field({ label, id, hint, children }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}{hint && <span className="ml-1 normal-case tracking-normal text-neutral-600">· {hint}</span>}</label>
      {children}
    </div>
  )
}
