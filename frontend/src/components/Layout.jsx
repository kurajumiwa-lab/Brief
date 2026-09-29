import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import RoleSwitcher from './RoleSwitcher'
import ScoreBadge from './ScoreBadge'
import { useAuth } from '../hooks/useAuth'

export default function Layout() {
  const [open, setOpen] = useState(false)
  const { vendor, refreshMe } = useAuth()
  useEffect(() => { refreshMe().catch(() => {}) }, [refreshMe])

  return (
    <div className="min-h-screen flex bg-brief-dark">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 border-b border-brief-border bg-brief-dark/80 backdrop-blur sticky top-0 z-20 flex items-center gap-3 px-4 sm:px-6">
          <button className="lg:hidden text-neutral-300" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <RoleSwitcher />
          </div>
          {vendor && (
            <div className="hidden sm:flex items-center gap-3">
              <ScoreBadge label="Network" value={vendor.network_score} />
              <ScoreBadge label="Parasitism" value={vendor.parasitism_index} tone="blue" />
            </div>
          )}
        </header>
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
