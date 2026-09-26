import React from 'react';
import { Heart, ArrowRight, CalendarDays, Flame, Lock, MessageCircle, Plus, Sparkles, Trophy, Users } from 'lucide-react';
import type { MenuTarget } from './MenuSheet';
import type { Ladder } from '../api/briefApi';
import { serviceForSurface } from './ladder';
import { ShelfPlank } from './shelf/ShelfPlank';

import communityArt from '../assets/shelf/nairobi-community.webp';
import shareArt from '../assets/shelf/whatsapp-share.webp';
import createArt from '../assets/shelf/host-create.webp';
import eventArt from '../assets/shelf/event-gathering.webp';

// ---------------------------------------------------------------------------
// MAIN SHELF
//
// The first sheet is a gallery, not a directory of rows. It gives the high
// frequency doors a visual home, keeps the drawer for overflow, and makes the
// current product's strongest loop — discover -> host -> share -> return —
// legible at a glance.
//
// Images are editorial surfaces only. Actions still route into the real Brief
// destinations and the WhatsApp card routes into the server-backed campaign
// distribution UX; no card pretends that a provider or a campaign exists.
// ---------------------------------------------------------------------------

export interface MainShelfProps {
  onSelect: (target: MenuTarget) => void;
  compact?: boolean;
  theme?: 'light' | 'dark';
  /** Actual open eFootball challenges; null means the activity check has not returned. */
  playOpenCount?: number | null;
  /**
   * The service ladder. Optional on purpose: with no ladder loaded (offline,
   * dead API) every card behaves exactly as it always did. A gate that failed
   * closed would turn an outage into a locked product.
   */
  ladder?: Ladder | null;
  /** Tapped a card whose rung has not been climbed yet. */
  onLocked?: (info: { cardId: string; requires: string; unlocksAfter: string | null }) => void;
}

interface ShelfCard {
  id: string;
  eyebrow: string;
  title: string;
  detail: string;
  image: string;
  target: MenuTarget;
  Icon: React.ComponentType<{ className?: string }>;
  featured?: boolean;
  /** Listed first, ahead of the ordinary shelf order. */
  priority?: boolean;
}

/** Priority cards first, everything else in its declared order. */
function shelfOrder(cards: ShelfCard[]): ShelfCard[] {
  return [...cards.filter((c) => c.priority), ...cards.filter((c) => !c.priority)];
}

const SHELF_CARDS: ShelfCard[] = [
  {
    id: 'around',
    eyebrow: 'DISCOVER',
    title: 'Around you',
    detail: 'Places, events and useful signals',
    image: communityArt,
    target: { tab: 'nearby', section: 'stream' },
    Icon: Sparkles,
    priority: true
  },
  {
    id: 'mshikano',
    eyebrow: 'COOPERATE',
    title: 'Mshikano',
    detail: 'Have, need, can help, looking for — find your complement',
    image: communityArt,
    target: { tab: 'nearby', section: 'mshikano' },
    Icon: Heart
  },
  {
    id: 'events',
    eyebrow: 'GATHER',
    title: 'Events',
    detail: 'See what people are organising',
    image: eventArt,
    target: { tab: 'mylayer', section: 'campaigns' },
    Icon: CalendarDays
  },
  {
    id: 'create',
    eyebrow: 'MAKE',
    title: 'Create',
    detail: 'Turn a message into something useful',
    image: createArt,
    target: { tab: 'capture' },
    Icon: Plus
  },
  {
    id: 'share',
    eyebrow: 'REACH',
    title: 'WhatsApp link',
    detail: 'Make a shareable campaign banner',
    image: shareArt,
    target: { tab: 'workflows', section: 'distribution' },
    Icon: MessageCircle,
    featured: true
  },
  {
    id: 'groups',
    eyebrow: 'YOUR LAYER',
    title: 'Groups',
    detail: 'Return to communities you joined',
    image: communityArt,
    target: { tab: 'mylayer', section: 'groups' },
    Icon: Users
  }
];

function ShelfCardView({
  card,
  onSelect,
  compact,
  playOpenCount,
  theme = 'light',
  ladder = null,
  onLocked
}: {
  card: ShelfCard;
  onSelect: MainShelfProps['onSelect'];
  compact: boolean;
  playOpenCount: number | null;
  theme?: 'light' | 'dark';
  ladder?: Ladder | null;
  onLocked?: MainShelfProps['onLocked'];
}) {
  const Icon = card.Icon;
  const isDark = theme === 'dark';
  // Progressive disclosure: a card whose rung is not yet climbed still shows
  // — hiding it would make the product look smaller than it is — but it says
  // what opens it instead of dropping someone into a surface they have no use
  // for yet.
  const service = serviceForSurface(
    ladder ?? null,
    card.target.tab,
    'section' in card.target ? card.target.section ?? null : null
  );
  const locked = Boolean(service && !service.unlocked);
  const detail = card.detail;
  return (
    <button
      type="button"
      onClick={() => {
        if (locked && service) {
          onLocked?.({ cardId: card.id, requires: service.requires, unlocksAfter: service.unlocksAfter });
          return;
        }
        onSelect(card.target);
      }}
      aria-label={locked && service ? `${card.title}: opens after ${service.unlocksAfter}` : `${card.title}: ${detail}`}
      data-locked={locked ? 'true' : undefined}
      data-shelf-id={card.id}
      style={{
        boxShadow: isDark ? '0 6px 10px rgba(0, 0, 0, 0.85)' : undefined,
      }}
      className={`group relative shrink-0 overflow-hidden rounded-xl text-left transition-all hover:-translate-y-0.5 cursor-pointer ${
        isDark
          ? 'border border-[#222B3A] hover:border-[#059669] shadow-lg'
          : 'border border-[var(--brief-line)] hover:border-[#0891B2]'
      } ${
        compact ? 'w-full min-h-[76px] sm:min-h-[82px]' : 'w-[144px] min-h-[102px] sm:w-auto sm:min-h-[108px]'
      }`}
    >
      <img
        src={card.image}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
      />
      <div
        className="absolute inset-0"
        style={{
          background: isDark
            ? 'linear-gradient(180deg, rgba(8,11,16,0.2) 0%, rgba(8,11,16,0.92) 100%)'
            : 'linear-gradient(180deg, rgba(9,11,16,0.18) 0%, rgba(9,11,16,0.85) 100%)'
        }}
      />
      {locked && service && (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-[rgba(10, 14, 20, 0.85)] px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--accent-ink)]">
          <Lock className="h-2 w-2" /> {service.unlocksAfter}
        </span>
      )}
      {!locked && card.priority && (
        <span
          className={`absolute right-2 top-2 rounded-full px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.14em] ${
            isDark ? 'bg-[#059669] text-[var(--brief-ink)]' : 'bg-[#40916C] text-[var(--accent-ink)]'
          }`}
        >
          Free to play
        </span>
      )}
      {!locked && card.featured && (
        <span
          className={`absolute right-2 top-2 rounded-full px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.14em] ${
            isDark ? 'bg-[#059669] text-[var(--brief-ink)]' : 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]'
          }`}
        >
          Featured
        </span>
      )}
      {card.id === 'play' && playOpenCount === 0 && (
        <span className="absolute right-2 top-2 rounded-full border border-[rgba(220, 225, 232, 0.35)] bg-[rgba(10, 14, 20, 0.85)] px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--accent-ink)]">
          Quiet now
        </span>
      )}
      <span
        className={`absolute left-2 top-2 flex items-center justify-center rounded-md ${
          isDark
            ? 'bg-[#151D2A]/90 border border-[#2B374C] text-[#059669]'
            : 'bg-[#40916C]/85 text-[var(--accent-ink)]'
        } ${compact ? 'h-5 w-5' : 'h-6 w-6'}`}
      >
        <Icon className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      </span>
      <div className={`absolute inset-x-2.5 ${compact ? 'bottom-2' : 'bottom-2.5'}`}>
        <p
          className={`text-[11px] font-extrabold uppercase tracking-[0.16em] ${
            isDark ? 'text-[#059669]' : 'text-[var(--ink-75)]'
          }`}
        >
          {card.eyebrow}
        </p>
        <p className={`mt-0.5 font-extrabold leading-tight text-[var(--brief-ink)] ${compact ? 'text-[13px]' : 'text-[14px]'}`}>{card.title}</p>
        <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-[var(--ink-80)]">
          {locked && service ? `Opens after: ${service.unlocksAfter}` : detail}
        </p>
      </div>
    </button>
  );
}

export function MainShelf({
  onSelect,
  compact = false,
  playOpenCount = null,
  theme = 'light',
  ladder = null,
  onLocked
}: MainShelfProps) {
  const isDark = theme === 'dark';
  return (
    <section aria-labelledby="main-shelf-title" className="space-y-2.5">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <p
            className={`text-[11px] font-extrabold uppercase tracking-[0.18em] ${
              isDark ? 'text-[#059669]' : 'text-[var(--ink-70)]'
            }`}
          >
            Main shelf
          </p>
          <h2
            id="main-shelf-title"
            className={`mt-0.5 text-[16px] font-extrabold tracking-[-0.02em] ${
              isDark ? 'text-[var(--brief-ink)]' : 'text-[var(--brief-ink)]'
            }`}
          >
            What do you want to do?
          </h2>
        </div>
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-bold ${
            isDark ? 'text-[#5A6472]' : 'text-[var(--ink-60)]'
          }`}
        >
          <ArrowRight className="h-2.5 w-2.5" /> swipe or tap
        </span>
      </div>
      <div className="relative">
        <div className={compact ? 'grid grid-cols-2 gap-2' : 'flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory sm:grid sm:grid-cols-3 sm:overflow-visible items-end'}>
          {shelfOrder(SHELF_CARDS).map((card) => (
            <ShelfCardView
              key={card.id}
              card={card}
              onSelect={onSelect}
              compact={compact}
              playOpenCount={playOpenCount}
              theme={theme}
              ladder={ladder}
              onLocked={onLocked}
            />
          ))}
        </div>
        {isDark && <ShelfPlank className="mt-1" />}
      </div>
      {!compact && (
        <p className={`px-1 text-[11px] leading-snug ${isDark ? 'text-[#5A6472]' : 'text-[var(--ink-60)]'}`}>
          The shelf is the shortcut. Use the menu for less frequent tools and region settings.
        </p>
      )}
    </section>
  );
}

export default MainShelf;
