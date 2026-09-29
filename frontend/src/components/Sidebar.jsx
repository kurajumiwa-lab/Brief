import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Package, ClipboardList, Users, MessageSquare, Wrench, CalendarDays, Plug, LogOut, X,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/stock', label: 'Stock Room', icon: Package },
  { to: '/vendor-lists', label: 'Vendor Lists', icon: ClipboardList },
  { to: '/groups', label: 'Groups', icon: Users },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/tools', label: 'Tools', icon: Wrench },
  { to: '/events', label: 'Events', icon: CalendarDays },
  { to: '/pos', label: 'POS Bridge', icon: Plug },
]

export default function Sidebar({ open, onClose }) {
  const { vendor, logout } = useAuth()
  return (
    <>
      {open && <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed z-40 inset-y-0 left-0 w-64 bg-brief-card border-r border-brief-border flex flex-col transform transition-transform lg:translate-x-0 lg:static ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="h-16 flex items-center justify-between px-5 border-b border-brief-border">
          <NavLink to="/" className="flex items-baseline gap-1" onClick={onClose}>
            <span className="text-xl font-bold tracking-tight">Brief</span>
            <span className="text-xl font-bold text-vendor-500">_</span>
            <span className="ml-2 text-[10px] uppercase tracking-widest text-neutral-500">vendor network</span>
          </NavLink>
          <button className="lg:hidden text-neutral-400" onClick={onClose} aria-label="Close menu"><X size={18} /></button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-vendor-900/40 text-vendor-300 border border-vendor-800/60' : 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/70 border border-transparent'
                }`
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-brief-border p-4">
          <p className="text-[11px] text-neutral-500 italic mb-3">No consumers. Only vendors.</p>
          {vendor && (
            <div className="flex items-center justify-between gap-2">
              <NavLink to={`/@${vendor.vendor_handle}`} onClick={onClose} className="min-w-0">
                <div className="text-sm font-medium truncate">{vendor.business_name}</div>
                <div className="text-xs text-vendor-400 truncate">@{vendor.vendor_handle}</div>
              </NavLink>
              <button onClick={logout} className="text-neutral-500 hover:text-red-300" title="Sign out" aria-label="Sign out">
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
