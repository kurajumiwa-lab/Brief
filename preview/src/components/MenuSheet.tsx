import React from 'react';
import {
  Copy, Share2, Plus, CalendarDays, MessageCircle, Briefcase, Zap,
  MapPin, Trophy, Sparkles, Send, Settings, Lock, ArrowRight, Bell, Search,
  Bookmark, Users, Store
} from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { AuthedUser } from '../api/briefApi';
import type { CommandCentre } from '../api/types';

// ---------------------------------------------------------------------------
// MENU — a navigation surface, not a modal from another product.
//
// Design rules (kept deliberately):
//   * The shared Brief visual system: lavender page, white
//     cards, deep-purple actions, one gold accent reserved for membership
//     status. No dark navy, no neon, no gradients fighting each other.
//   * ONE close control: the × in the header. No second giant button.
//   * Menu NAVIGATES (icons + typography, compact rows); the home screen
//     EXPLORES (imagery, shelves). The two jobs are deliberately different.
//   * The bottom navigation stays visible and tappable: Menu is a primary
//     destination, so it sits BENEATH the dock (z-50 < dock's z-55).
//   * Every row goes somewhere real. No dead buttons, no invented state.
// ---------------------------------------------------------------------------

export type MenuTarget =
  | { tab: 'nearby'; section?: 'stream' | 'tea' | 'market' | 'quests' | 'pursuits' | 'today' | 'events' | 'mshikano' }
  | { tab: 'mylayer'; section?:
      | 'saved' | 'activity' | 'points' | 'circles' | 'groups'
      | 'campaigns' | 'mediakit' | 'opportunities' | 'messages' | 'subscriptions'
      | 'verification' }
  | { tab: 'workflows'; section?:
      | 'cockpit' | 'command' | 'active' | 'completed' | 'inbox'
      | 'sources' | 'money' | 'vault' | 'gate' | 'tea' | 'fees'
      | 'campaigns' | 'matches' | 'distribution' | 'calendar' | 'vendors' | 'shop' | 'ai' }
  | { tab: 'capture' }
  | { tab: 'notifications' }
  | { tab: 'operate' };

export interface GeoCity {
  lat: number;
  lng: number;
  label: string;
}

export interface MenuSheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (target: MenuTarget) => void;
  onSelectCity: (city: GeoCity) => void;
  selectedLocation: string;
  /** Unread notification count passed to the Updates row; shown when > 0. */
  unread?: number;
  /** Operator desk entry (F4): offered only when the session may operate. */
  canOperate?: boolean;
}

type MediaKit = {
  displayName?: string;
  description?: string | null;
  contactMethod?: string | null;
  audience?: {
    publishedObjects?: number;
    views?: number;
    saves?: number;
    shares?: number;
    contributions?: number;
    engagementRate?: number | null;
  };
  note?: string;
} | null;

const REGIONS: { flag: string; label: string; city: GeoCity }[] = [
  { flag: '🇰🇪', label: 'Kenya', city: { lat: -1.2921, lng: 36.8219, label: 'Nairobi' } },
  { flag: '🇹🇿', label: 'Tanzania', city: { lat: -6.7924, lng: 39.2083, label: 'Dar es Salaam' } },
  { flag: '🇺🇬', label: 'Uganda', city: { lat: 0.3476, lng: 32.5825, label: 'Kampala' } },
  { flag: '🇷🇼', label: 'Rwanda', city: { lat: -1.9441, lng: 30.0619, label: 'Kigali' } }
];

const money = (n: number, c: string) => `${c} ${n.toLocaleString()}`;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'LO';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// --- LOCAL: the account, compressed to one honest card -----------------------
// The same information the old concierge hub carried — name, standing,
// membership, contact — at a fraction of the height, because the Menu's
// job is navigation, and the account is one destination among many.

function LocalCard({ onSelect }: { onSelect: (target: MenuTarget) => void }) {
  const [open, setOpen] = React.useState(false);
  const [me, setMe] = React.useState<AuthedUser | null>(null);
  const [kit, setKit] = React.useState<MediaKit>(null);
  const [command, setCommand] = React.useState<CommandCentre | null>(null);
  const [standingExtra, setStandingExtra] = React.useState<{ bought: number } | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    (async () => {
      const [who, media, centre] = await Promise.all([
        briefApi.whoAmI(),
        briefApi.getMyMediaKit(),
        briefApi.getCommandCentre()
      ]);
      if (!live) return;
      setMe(who.ok ? who.data : null);
      setKit(media.ok ? (media.data as MediaKit) : null);
      setCommand(centre.ok ? centre.data : null);
    })();
    briefApi.getPersonMe().then((res) => {
      if (!live || !res.ok) return;
      setStandingExtra({ bought: res.data.standing?.bought ?? 0 });
    });
    return () => { live = false; };
  }, []);

  const displayName = kit?.displayName || me?.displayName || 'Local';
  const audience = kit?.audience;
  const contact = kit?.contactMethod ?? null;
  const settled = command ? money(command.money.grossSettled, command.money.currency) : 'KES 0';

  const standing = [
    command ? { label: 'Settled', value: settled } : null,
    command ? { label: 'Arrived', value: String(command.people.checkedIn) } : null,
    audience && audience.views !== undefined ? { label: 'Views', value: String(audience.views) } : null,
    command ? { label: 'Hosted', value: String(command.campaigns.length) } : null,
    standingExtra && standingExtra.bought > 0 ? { label: 'Bought', value: String(standingExtra.bought) } : null
  ].filter(Boolean) as { label: string; value: string }[];

  const copyCard = async () => {
    const lines = [
      displayName,
      me?.handle ? `@${me.handle}` : '',
      standing.map((s) => `${s.label}: ${s.value}`).join(' · '),
      contact ? `Contact: ${contact}` : ''
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const shareCard = async () => {
    const text = `${displayName}${me?.handle ? ` (@${me.handle})` : ''}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: displayName, text });
        return;
      }
    } catch {}
    void copyCard();
  };

  return (
    <section aria-label="Your account" className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3.5">
      <div className="flex items-center gap-3">
        {/* §13 — the account identity doubles as the Profile door: tapping your
            name/avatar opens your full profile (My Layer). */}
        <button
          type="button"
          onClick={() => onSelect({ tab: 'mylayer', section: 'saved' })}
          aria-label="Open your profile"
          className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
        >
          <span className="h-10 w-10 rounded-xl bg-[#40916C] text-[var(--accent-ink)] flex items-center justify-center text-[14px] font-black shrink-0" aria-hidden="true">
            {initials(displayName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-extrabold text-[var(--brief-ink)] leading-tight">{displayName}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-none min-w-0">
              <span className="px-1.5 py-0.5 rounded-full bg-[#B45309] text-[var(--accent-ink)] font-extrabold tracking-wide shrink-0">
                Platinum Member
              </span>
              <span className="text-[var(--ink-55)] truncate">{settled} settled</span>
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-extrabold text-[#40916C] hover:bg-[color:var(--color-well)] cursor-pointer"
        >
          {open ? 'Close' : 'View'} →
        </button>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-[var(--brief-line)] space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {standing.map((s) => (
              <div key={s.label} className="rounded-xl bg-[color:var(--color-well)] px-2.5 py-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--ink-70)]">{s.label}</p>
                <p className="text-[13px] font-extrabold text-[var(--brief-ink)] mt-0.5 truncate">{s.value}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void shareCard()}
              className="flex-1 h-9 rounded-xl bg-[#40916C] text-[var(--accent-ink)] text-[11.5px] font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Share2 className="h-3.5 w-3.5" /> Share profile
            </button>
            <button
              type="button"
              onClick={() => void copyCard()}
              className="h-9 px-3.5 rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-[11.5px] font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {me && (
            <button
              type="button"
              onClick={() => void briefApi.logout().then(() => window.location.reload())}
              className="w-full h-9 rounded-xl border border-[var(--brief-line)] bg-transparent text-[var(--ink-60)] text-[11.5px] font-extrabold cursor-pointer hover:text-[var(--brief-ink)]"
            >
              Sign out
            </button>
          )}
          <p className="text-[11px] text-[var(--ink-60)] leading-snug">
            Standing is derived from what actually happened — settled money, arrivals, views. Nothing here is decorative.
          </p>
        </div>
      )}
    </section>
  );
}

// --- EXPLORE: doors, icons not photography ------------------------------------
// Every door goes to a real surface. No dead buttons, no invented state.

const EXPLORE: { label: string; detail: string; Icon: React.ComponentType<{ className?: string }>; target: MenuTarget }[] = [
  { label: 'Nearby', detail: 'Places, events and useful things', Icon: MapPin, target: { tab: 'nearby', section: 'stream' } },
  { label: 'Saved', detail: 'Things you kept', Icon: Bookmark, target: { tab: 'mylayer', section: 'saved' } },
  { label: 'Events', detail: 'Local happenings and gatherings', Icon: Trophy, target: { tab: 'nearby', section: 'events' } },
  { label: 'Communities', detail: 'Groups and circles', Icon: Users, target: { tab: 'mylayer', section: 'circles' } },
  { label: 'Marketplace', detail: 'Buy and sell nearby', Icon: Store, target: { tab: 'nearby', section: 'market' } },
  { label: 'Mshikano', detail: 'Community mutual support & trust', Icon: Sparkles, target: { tab: 'nearby', section: 'mshikano' } },
  { label: 'WhatsApp Shop', detail: 'Your price list, in WhatsApp', Icon: Send, target: { tab: 'workflows', section: 'shop' } }
];

function ExploreGrid({ onSelect }: { onSelect: (target: MenuTarget) => void }) {
  return (
    <section aria-label="Explore">
      <div className="grid grid-cols-2 gap-2">
        {EXPLORE.map(({ label, detail, Icon, target }) => (
          <button
            key={label}
            type="button"
            onClick={() => onSelect(target)}
            className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 text-left hover:border-[#40916C] transition-colors cursor-pointer"
          >
            <span className="h-8 w-8 rounded-xl bg-[color:var(--color-well)] flex items-center justify-center">
              <Icon className="h-4 w-4 text-[#40916C]" />
            </span>
            <p className="mt-2 text-[14px] font-extrabold text-[var(--brief-ink)] leading-tight">{label}</p>
            <p className="mt-0.5 text-[11px] text-[var(--ink-55)] leading-snug">{detail}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

// --- QUICK ACTIONS: one card, compact rows, fast to scan ----------------------

const QUICK: { label: string; detail: string; Icon: React.ComponentType<{ className?: string }>; target: MenuTarget; unread?: number }[] = [
  { label: 'Search', detail: 'Find a place, event or person', Icon: Search, target: { tab: 'nearby', section: 'stream' } },
  { label: 'New', detail: 'Capture something useful', Icon: Plus, target: { tab: 'capture' } },
  { label: 'Updates', detail: 'What changed while you were away', Icon: Bell, target: { tab: 'notifications' } },
  { label: 'Calendar', detail: 'Keep a date in view', Icon: CalendarDays, target: { tab: 'workflows', section: 'calendar' } },
  { label: 'Inbox', detail: 'Review what needs you', Icon: MessageCircle, target: { tab: 'workflows', section: 'inbox' } },
  { label: 'Records', detail: 'Open your vaults', Icon: Briefcase, target: { tab: 'workflows', section: 'vault' } },
  { label: 'Dashboard', detail: 'See what is moving', Icon: Zap, target: { tab: 'workflows', section: 'command' } }
];

function QuickActions({ onSelect, unread }: { onSelect: (target: MenuTarget) => void; unread: number }) {
  return (
    <section aria-label="Quick actions" className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl overflow-hidden">
      {QUICK.map(({ label, detail, Icon, target, unread: rowUnread }, i) => (
        <button
          key={label}
          type="button"
          onClick={() => onSelect(target)}
          className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[color:var(--color-well)] transition-colors cursor-pointer ${
            i > 0 ? 'border-t border-[var(--brief-line)]' : ''
          }`}
        >
          <span className="h-7 w-7 rounded-lg bg-[color:var(--color-well)] flex items-center justify-center shrink-0">
            <Icon className="h-3.5 w-3.5 text-[#40916C]" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[12.5px] font-extrabold text-[var(--brief-ink)] leading-tight">{label}</span>
            <span className="block text-[11px] text-[var(--ink-70)] truncate">{detail}</span>
          </span>
          {rowUnread !== undefined && unread > 0 && (
            <span className="shrink-0 rounded-full bg-[#DC2626] px-1.5 py-0.5 text-[11px] font-extrabold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
          <ArrowRight className="h-4 w-4 text-[var(--ink-60)] shrink-0" aria-hidden="true" />
        </button>
      ))}
    </section>
  );
}

// --- YOUR REGION --------------------------------------------------------------

function RegionGallery({
  selectedLocation,
  onSelect,
  onSelectCity
}: {
  selectedLocation: string;
  onSelect: (target: MenuTarget) => void;
  onSelectCity: (city: GeoCity) => void;
}) {
  return (
    <section aria-label="Your region" className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        {REGIONS.map((region) => {
          const selected =
            selectedLocation.toLowerCase().includes(region.city.label.toLowerCase()) ||
            selectedLocation.toLowerCase() === region.label.toLowerCase();
          return (
            <button
              key={region.label}
              type="button"
              onClick={() => {
                onSelectCity(region.city);
                onSelect({ tab: 'nearby', section: 'stream' });
              }}
              aria-pressed={selected}
              className={`rounded-xl border p-2.5 text-center transition-colors cursor-pointer ${
                selected
                  ? 'border-[#40916C] bg-[color:var(--color-paper)] shadow-sm'
                  : 'border-[var(--brief-line)] bg-[color:var(--color-paper)] hover:border-[#40916C]'
              }`}
            >
              <span className="block text-[32px] leading-none" aria-hidden="true">{region.flag}</span>
              <span className={`mt-1 block truncate text-[11px] font-extrabold ${selected ? 'text-[#40916C]' : 'text-[var(--brief-ink)]'}`}>
                {region.label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// --- The page ----------------------------------------------------------------

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="px-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--ink-60)]">{children}</p>
);

export function MenuSheet({ open, onClose, onSelect, onSelectCity, selectedLocation, unread = 0, canOperate = false }: MenuSheetProps) {
  React.useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [open]);

  if (!open) return null;

  return (
    // TWO-THIRDS, on purpose: the Menu sheet owns the lower 2/3 of the
    // screen and the top 1/3 stays the live app, dimmed just enough to read
    // the sheet — the Menu is part of this product, not a different screen
    // that replaces it. z-50 sits beneath the dock (z-55), so the bottom
    // navigation stays visible and tappable while the Menu is open.
    <div
      role="dialog"
      aria-label="Menu"
      className="fixed inset-0 z-[50] flex flex-col justify-end"
    >
      {/* The exposed third: the underlying screen, seen through a light
          scrim. Tapping it closes — the natural dismissal, not a control. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss menu"
        className="flex-1 min-h-0 bg-[rgba(10, 14, 20, 0.25)] backdrop-blur-[2px] cursor-pointer"
      />

      {/* The sheet: exactly two-thirds of the screen, sliding up from the
          bottom edge, safe-area aware so it never sits under a gesture bar. */}
      <div className="brief-sheet-up h-2/3 max-h-[calc(100vh*0.6667)] bg-[color:var(--surface-3)] border-t border-[var(--brief-line)] rounded-t-[28px] shadow-2xl flex flex-col overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="shrink-0 flex items-start justify-between gap-3 px-4 pt-5 pb-3 sm:max-w-3xl sm:w-full sm:mx-auto">
        <div className="flex items-center gap-2.5">
          {/* §13 — the Brief mark: a small, ownable brand mark, not another
              product's logo. */}
          <span className="h-8 w-8 shrink-0 rounded-lg bg-[#40916C] text-[var(--accent-ink)] flex items-center justify-center text-[15px] font-black" aria-hidden="true">B</span>
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[var(--ink-60)]">Brief · Menu</p>
            <h1 className="mt-0.5 text-[30px] sm:text-[21px] font-black tracking-tight text-[var(--brief-ink)]">
              Your shortcuts, tools and account
            </h1>
          </div>
        </div>
        {/* The ONE close control. Neutral, top-right, where it belongs. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--brief-ink)] text-[32px] font-light hover:border-[#40916C] transition-colors cursor-pointer"
        >
          ×
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[84px] md:pb-8 space-y-4 sm:max-w-3xl sm:w-full sm:mx-auto">
        <LocalCard onSelect={onSelect} />

        <div className="space-y-2">
          <SectionLabel>Explore</SectionLabel>
          <ExploreGrid onSelect={onSelect} />
        </div>

        <div className="space-y-2">
          <SectionLabel>Quick actions</SectionLabel>
          <QuickActions onSelect={onSelect} unread={unread} />
        </div>

        <div className="space-y-2">
          <SectionLabel>Your region</SectionLabel>
          <RegionGallery selectedLocation={selectedLocation} onSelect={onSelect} onSelectCity={onSelectCity} />
        </div>

        {canOperate && (
          <button
            type="button"
            onClick={() => onSelect({ tab: 'operate' })}
            className="w-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl px-3.5 py-2.5 flex items-center gap-3 hover:border-[#40916C] transition-colors cursor-pointer"
          >
            <span className="h-7 w-7 rounded-lg bg-[color:var(--color-well)] flex items-center justify-center shrink-0">
              <Settings className="h-3.5 w-3.5 text-[#40916C]" />
            </span>
            <span className="flex-1 min-w-0 text-left">
              <span className="block text-[12.5px] font-extrabold text-[var(--brief-ink)] leading-tight">Operate</span>
              <span className="block text-[11px] text-[var(--ink-70)] truncate">The operator desk — health, queues, commerce, audit</span>
            </span>
            <ArrowRight className="h-4 w-4 text-[var(--ink-60)] shrink-0" aria-hidden="true" />
          </button>
        )}

        <p className="flex items-center gap-1.5 px-1 pt-1 text-[11px] text-[var(--ink-60)]">
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
          Coming later — Courses · Data desk · Premium (regulatory review in progress)
        </p>

        {/* ── HOW BRIEF WORKS (NEIGHBORHOOD TRUST OS) ── */}
        <div className="p-4 rounded-2xl bg-[#F0EDE8] space-y-2 mt-4">
          <span className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)] block">
            How Brief Works · Neighborhood Trust OS
          </span>
          <ul className="text-[12px] text-[#4A5568] space-y-1.5 leading-relaxed">
            <li className="flex items-start gap-1.5">
              <span>•</span>
              <span><strong>Brief is not a bank:</strong> Brief does not hold your money or deposit funds.</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span>•</span>
              <span><strong>Direct M-Pesa Rails:</strong> Money moves directly between members using M-Pesa.</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span>•</span>
              <span><strong>Self-Governing Groups:</strong> Circles and Harambees govern themselves with transparent ledgers.</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span>•</span>
              <span><strong>Direct Peer Logistics:</strong> WAIRO connects senders with independent verified riders (90/10 split).</span>
            </li>
          </ul>
        </div>
      </div>
      </div>
    </div>
  );
}

export default MenuSheet;
