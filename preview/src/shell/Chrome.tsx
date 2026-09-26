import React from 'react';
import { Bell, Menu, Sparkles } from 'lucide-react';
import { ActivityDot, DESTINATIONS, DESTINATION_ICONS } from '../model/core';



// ---------------------------------------------------------------------------
// CHROME -- App shell furniture: toasts, spring overlay, desktop rail, mobile
// dock. Extracted verbatim from App.tsx (Phase 5). All state lives in App /
// hooks; these only render.
// ---------------------------------------------------------------------------


export function StatusToasts(props: { setSpringOverlayOpen: any, springOverlayOpen: any, toastMessage: any }) {
  const { setSpringOverlayOpen, springOverlayOpen, toastMessage } = props;
  return (
    <>
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#40916C] text-[var(--accent-ink)] px-4 py-2.5 rounded-xl font-extrabold shadow-2xl flex items-center gap-2">
          <Sparkles className="w-4 h-4 shrink-0" />
          <span className="text-xs">{toastMessage}</span>
        </div>
      )}

      {springOverlayOpen && (
        <>
          <div
            onClick={() => setSpringOverlayOpen(false)}
            className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[8px] transition-opacity"
          />
          <div className="brief-spring-modal fixed top-1/2 left-1/2 z-[70] w-[calc(100%-48px)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#0891B2]/25 bg-[rgba(255, 255, 255, 0.90)] px-6 py-8 text-center shadow-2xl">
            <div className="text-4xl mb-4">⏳</div>
            <h3 className="text-xl font-bold mb-2">Nothing to do here?</h3>
            <p className="text-sm text-[var(--ink-60)] leading-relaxed mb-6">
              The current timeline is looking ultra quiet. Let's look into a
              different zone.
            </p>
            <button
              onClick={() => setSpringOverlayOpen(false)}
              className="w-full py-4 rounded-lg bg-[color:var(--color-paper)] border border-[#0891B2]/30 text-[var(--brief-ink)] text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer transition-transform duration-150 hover:-translate-y-0.5 hover:border-[#0891B2]/70 active:translate-y-0.5 active:scale-[0.96] active:border-white"
            >
              🗓️ Check a Different Time
            </button>
          </div>
        </>
      )}
    </>
  );
}

export function DesktopRail(props: { activeTab: any, destinationAlerts: any, goToDestination: any, menuOpen: any, setMenuOpen: any , notificationsOpen: any, notifUnread: any, setNotificationsOpen: any }) {
  const { activeTab, destinationAlerts, goToDestination, menuOpen, setMenuOpen, notificationsOpen, notifUnread, setNotificationsOpen } = props;
  return (
    <>
        <nav
          aria-label="Primary"
          className="hidden md:flex flex-col shrink-0 w-[76px] hover:w-60 transition-all duration-200 border-r border-[var(--brief-line)] bg-[color:var(--color-paper)] sticky top-0 h-screen py-4 group/rail overflow-hidden"
        >
          <button
            type="button"
            onClick={() => setMenuOpen((v: any) => !v)}
            title="Menu"
            aria-expanded={menuOpen}
            className={`relative flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors ${
              menuOpen ? 'text-[var(--brief-ink)] bg-[color:var(--color-paper)] font-extrabold' : 'text-[var(--brief-ink)] hover:text-[var(--brief-ink)]'
            }`}
          >
            <span
              className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r transition-all ${
                menuOpen ? 'h-7 bg-[#40916C]' : 'h-0 bg-transparent'
              }`}
            />
            <Menu className="w-5 h-5 shrink-0" />
            <span className="min-w-0 opacity-0 group-hover/rail:opacity-100 transition-opacity">
              <span className="block text-[14px] font-extrabold whitespace-nowrap">Menu</span>
            </span>
          </button>
          {DESTINATIONS.map((d) => {
            const active = activeTab === d.id;
            const Icon = DESTINATION_ICONS[d.id];
            return (
              <button
                key={d.id}
                onClick={() => goToDestination(d.id)}
                title={d.label}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors ${
                  active
                    ? 'text-[var(--brief-ink)] bg-[color:var(--color-paper)] font-extrabold'
                    : 'text-[var(--brief-ink)] hover:text-[var(--brief-ink)]'
                }`}
              >
                {/* Active marker on the edge, not a heavy filled pill. */}
                <span
                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r transition-all ${
                    active ? 'h-7 bg-[#40916C]' : 'h-0 bg-transparent'
                  }`}
                />
                <span className="relative shrink-0">
                  <Icon className="w-5 h-5" />
                  <span className="absolute -right-1.5 -top-1.5">
                    <ActivityDot n={destinationAlerts[d.id] ?? 0} />
                  </span>
                </span>
                <span className="min-w-0 opacity-0 group-hover/rail:opacity-100 transition-opacity">
                  <span className="block text-[14px] font-extrabold whitespace-nowrap">
                    {d.label}
                  </span>
                </span>
              </button>
            );
          })}
        {/* Bell — the subtle return-loop entry. Badge only when non-zero. */}
          <button
            type="button"
            onClick={() => setNotificationsOpen(true)}
            title="Updates"
            aria-label={notifUnread > 0 ? `Updates, ${notifUnread} unread` : 'Updates'}
            className={`relative mt-auto flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors ${
              notificationsOpen ? 'text-[var(--brief-ink)] bg-[color:var(--color-paper)] font-extrabold' : 'text-[var(--brief-ink)] hover:text-[var(--brief-ink)]'
            }`}
          >
            <span className="relative shrink-0">
              <Bell className="w-5 h-5" />
              {notifUnread > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#DC2626] px-1 text-[11px] font-extrabold text-[var(--accent-ink)]">
                  {notifUnread > 99 ? '99+' : notifUnread}
                </span>
              )}
            </span>
            <span className="min-w-0 opacity-0 group-hover/rail:opacity-100 transition-opacity">
              <span className="block text-[14px] font-extrabold whitespace-nowrap">Updates</span>
              {notifUnread > 0 && (
                <span className="block text-[11px] font-bold whitespace-nowrap text-[#DC2626]">{notifUnread} unread</span>
              )}
            </span>
          </button>
        </nav>
    </>
  );
}

export function DockNav(props: { activeTab: any, destinationAlerts: any, dockOn: any, goToDestination: any, isAnyModalActive: any, menuOpen: any, setDockOn: any, setMenuOpen: any }) {
  const { activeTab, destinationAlerts, dockOn, goToDestination, isAnyModalActive, menuOpen, setDockOn, setMenuOpen } = props;
  return (
    <>
      <button
        type="button"
        aria-label="Show navigation"
        onClick={() => setDockOn(true)}
        className={`md:hidden fixed bottom-3 left-1/2 z-[55] -translate-x-1/2 h-2 w-12 rounded-full bg-[color:var(--brief-line)] cursor-pointer transition-transform ${
          dockOn || isAnyModalActive ? 'translate-y-full pointer-events-none hidden' : ''
        } ${isAnyModalActive ? 'hidden' : ''}`}
        aria-hidden={dockOn || isAnyModalActive ? true : undefined}
      />

      {/* Floating dock — §11: a rounded, elevated pill that floats above the
          content instead of a full-width bar, with the selected item picked
          out by the bronze accent. Safe-area aware, high contrast. */}
      <nav
        aria-label="Primary"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
        className={`md:hidden fixed bottom-0 inset-x-0 z-[55] px-3 transition-transform duration-200 ${
          dockOn && !isAnyModalActive ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
      >
        <div className="mx-auto flex max-w-md items-stretch gap-0.5 rounded-[24px] bg-[rgba(255, 255, 255, 0.94)] px-1.5 py-1.5 shadow-[var(--room-light),var(--lift-4),inset_0_0_0_1px_var(--brief-line)] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => { setMenuOpen((v: any) => !v); setDockOn(true); }}
            aria-label="Menu"
            aria-expanded={menuOpen}
            title="Menu"
            className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl py-1.5 cursor-pointer transition-colors ${
              menuOpen ? 'text-[#40916C]' : 'text-[#7A8494] hover:text-[#5A6472]'
            }`}
          >
            <span className={`flex h-7 w-11 items-center justify-center rounded-full transition-colors ${menuOpen ? 'bg-[#40916C] text-[var(--accent-ink)]' : ''}`}>
              <Menu className="w-5 h-5" />
            </span>
            <span className="text-[12px] font-bold leading-none">Menu</span>
          </button>
          {DESTINATIONS.map((d) => {
            const active = activeTab === d.id;
            const Icon = DESTINATION_ICONS[d.id];
            return (
              <button
                key={d.id}
                onClick={() => goToDestination(d.id)}
                aria-current={active ? 'page' : undefined}
                title={d.hint}
                className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl py-1.5 cursor-pointer transition-colors ${
                  active ? 'text-[#40916C]' : 'text-[#7A8494] hover:text-[#5A6472]'
                }`}
              >
                <span className={`relative flex h-7 w-11 items-center justify-center rounded-full transition-colors ${active ? 'bg-[#40916C] text-[var(--accent-ink)]' : ''}`}>
                  <Icon className="w-5 h-5" />
                  <span className="absolute -right-1 -top-1">
                    <ActivityDot n={destinationAlerts[d.id] ?? 0} />
                  </span>
                </span>
                <span className="text-[12px] font-bold leading-none">
                  {d.label}
                </span>
                {(destinationAlerts[d.id] ?? 0) > 0 && (
                  <span className="sr-only">
                    {destinationAlerts[d.id]} update{(destinationAlerts[d.id] ?? 0) > 1 ? 's' : ''}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
