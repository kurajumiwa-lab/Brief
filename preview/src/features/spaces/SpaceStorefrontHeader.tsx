import '../../ui/compact.css';
import { mediaFileUrl } from '../../api/briefApi';
import React from 'react';
import { Bell, BellOff, MessageCircle, Pencil, Plus, Share2 } from 'lucide-react';
import type { Space } from '../../api/types';
import type { SpaceAudienceView } from '../../api/briefApi';

// ---------------------------------------------------------------------------
// SPACE HEADER — the storefront front, not a settings page.
//
// Cover, avatar, name, one line of truth about where and when, then the CTA
// trio, then the stats strip. The order is deliberate: a buyer decides in about
// four seconds whether this shop is real and near them, and the vendor needs to
// see at a glance whether their own shopfront is working.
//
// The stats strip is the part every product is tempted to invent. So:
//   * views are the count of real `space_viewed` rows on the public page, with
//     the owner's own opens taken out — your look at your own shop is not demand;
//   * follows are rows people wrote by tapping follow;
//   * inquiries and orders are counted from those tables;
//   * conversion is a ratio of two of those counts and renders as an em dash
//     when the denominator is empty;
//   * there is NO sector average, no "3 buyers missed", no percentile. Brief
//     holds no industry data, and the strip says that out loud instead of
//     leaving the vendor to wonder whether the missing number is bad news.
//
// A cover with no photo is a plain gradient, not somebody's stock image: a fake
// photograph of a shop that does not exist is a lie a buyer would walk into.
// ---------------------------------------------------------------------------


const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-KE'));

export interface SpaceStorefrontHeaderProps {
  space: Space;
  audience?: SpaceAudienceView | null;
  /** Owner view by default; the public page passes true. */
  asVisitor?: boolean;
  onAddOffer?: () => void;
  onEdit?: () => void;
  onShare?: () => void;
  onFollow?: () => void;
  onMessage?: () => void;
  onOpenInbox?: () => void;
  /** Records a walk-in enquiry. Named for what it actually does. */
  onCreateOrder?: () => void;
  busy?: boolean;
}

export function SpaceStorefrontHeader({
  space,
  audience = null,
  asVisitor = false,
  onAddOffer,
  onEdit,
  onShare,
  onFollow,
  onMessage,
  onOpenInbox,
  onCreateOrder,
  busy = false
}: SpaceStorefrontHeaderProps) {
  const insights = audience?.insights ?? null;
  const isOwner = !asVisitor;
  const followers = audience?.followers ?? space.followers ?? 0;
  const initials = (space.name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  // Read the labels the server rendered. Re-formatting the shapes here is how a
  // header and a space file end up disagreeing about the same answer.
  const where = space.profileLabels?.where ?? null;
  const when = space.profileLabels?.when ?? null;
  const openInquiries = (space.recentConversations ?? []).filter((c) => ['new', 'active'].includes(c.status)).length;

  return (
    <header className="shop-identity-header compact-identity">
      <div className="flex items-center gap-3">
        <span className="compact-avatar">{space.image ? <img src={mediaFileUrl(space.image)} alt="" /> : initials}</span>
        <span className="text-xs" style={{ color: 'var(--brief-muted)' }}>{space.visibility === 'public' ? 'Public space' : space.visibility === 'unlisted' ? 'Unlisted space' : 'Private space'}</span>
      </div>
      <div className="pt-3">
        <div className="flex items-end gap-3">
          <div className="min-w-0 pb-1 flex-1">
            <h1 className="text-[22px] font-extrabold leading-tight truncate" style={{ color: 'var(--brief-ink)' }}>
              {space.name}
            </h1>
            {/* Which arm of the business this row is, in the server's word for it.
                Printed only when the owner chose one: an unmarked space is not
                "Retail" by default, and this line is not a badge — it grants
                nothing, ranks nothing, and disappears when the owner takes it
                back off. */}
            {space.modeLabel && (
              <p className="text-[12px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--brief-muted)' }}>
                {space.modeLabel}
              </p>
            )}
            <p className="text-[14px] truncate" style={{ color: 'var(--brief-muted)' }}>
              {space.goal || (space.type ?? 'business').replace('_', ' ')}
            </p>
            <p className="text-[12px] font-medium tracking-wide truncate" style={{ color: 'var(--brief-muted)' }}>
              {[where, when].filter(Boolean).join(' · ') || 'No place or hours stated yet'}
            </p>
          </div>
        </div>

        {/* CTAs. One primary (the doing-button), the rest quiet links. The owner
            gets Add offer as the button; a visitor gets follow/message, and
            follow only exists on a public, active space. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3.5">
          {isOwner ? (
            <>
              <button
                type="button"
                onClick={onAddOffer}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[14px] font-black cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
              >
                <Plus className="w-4 h-4" /> Add offer
              </button>
              <button
                type="button"
                onClick={onOpenInbox}
                className="inline-flex items-center gap-1.5 text-[14px] font-bold cursor-pointer"
                style={{ color: 'var(--color-primary)' }}
              >
                <MessageCircle className="w-4 h-4" /> Inbox
                {openInquiries > 0 && <span className="font-mono">· {openInquiries}</span>}
              </button>
              {onCreateOrder && (
                <button
                  type="button"
                  onClick={onCreateOrder}
                  className="inline-flex items-center gap-1.5 text-[14px] font-bold cursor-pointer"
                  style={{ color: 'var(--color-primary)' }}
                  title="Record who walked in, what they wanted, and what you quoted"
                >
                  <Plus className="w-4 h-4" /> Walk-in enquiry
                </button>
              )}
              <button
                type="button"
                onClick={onEdit}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-[14px] font-bold cursor-pointer disabled:opacity-50"
                style={{ color: 'var(--color-primary)' }}
              >
                <Pencil className="w-4 h-4" /> Edit space
              </button>
            </>
          ) : (
            <>
              {audience?.followable && (
                space.iAmFollowing || audience.iAmFollowing ? (
                  <button
                    type="button"
                    onClick={onFollow}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-[14px] font-bold cursor-pointer disabled:opacity-50"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    <BellOff className="w-4 h-4" /> Following
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onFollow}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[14px] font-black cursor-pointer disabled:opacity-50"
                    style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
                  >
                    <Bell className="w-4 h-4" /> Follow
                  </button>
                )
              )}
              <button
                type="button"
                onClick={onMessage}
                className="inline-flex items-center gap-1.5 text-[14px] font-bold cursor-pointer"
                style={{ color: 'var(--color-primary)' }}
              >
                <MessageCircle className="w-4 h-4" /> Message
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onShare}
            className="inline-flex items-center gap-1.5 text-[14px] font-bold cursor-pointer"
            style={{ color: 'var(--color-primary)' }}
          >
            <Share2 className="w-4 h-4" /> Share
          </button>
        </div>

        <details className="compact-disclosure mt-3">
          <summary>Activity & insights <span>{num(space.metrics?.offersCount)} offers · {num(followers)} followers</span></summary>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 rounded-xl overflow-hidden" style={{ background: 'var(--color-surface-elevated)' }}>
          {(isOwner
            ? [
                // The views figure is a count of rows: one per opening of the public page.
// What it is NOT is a headcount, so no sentence about headcounts sits under it.
// A sub-line saying "people not counted" read as a confession two pixels below a
// number that is perfectly true, and made the owner distrust the good figure. The
// explanation belongs on the audit screen, where the rest of them are — so the
// sub-line is either a real second count or nothing at all.
{ label: 'views · 7d', value: num(insights?.views.count), sub: insights?.views.distinctViewers != null ? `${num(insights.views.distinctViewers)} people` : null },
                { label: 'new follows', value: num(insights?.follows.newInWindow), sub: `${num(insights?.follows.total ?? followers)} total` },
                { label: 'inquiries', value: num(insights?.inquiries.newInWindow), sub: `${num(insights?.inquiries.awaitingYourReply)} awaiting you` },
                { label: 'orders', value: num(insights?.orders.newInWindow), sub: `${num(insights?.orders.total)} all time` },
                {
                  label: 'view → order',
                  value: insights && insights.conversion.viewsToOrdersPct !== null ? `${insights.conversion.viewsToOrdersPct}%` : '—',
                  sub: 'no benchmark exists'
                }
              ]
            : [
                { label: 'followed by', value: num(followers), sub: 'people, counted' },
                { label: 'offers', value: num(space.metrics?.offersCount ?? null), sub: 'active now' },
                { label: 'updates', value: num(audience?.broadcasts?.length ?? space.broadcastsLive ?? null), sub: 'live in 24h' }
              ]
          ).map((tile) => (
            <div key={tile.label} className="flex-1 px-2 py-2.5 text-center" style={{ background: 'transparent' }}>
              <p className="font-mono text-[18px] font-extrabold leading-none" style={{ color: 'var(--brief-ink)' }}>
                {tile.value}
              </p>
              <p className="text-[10px] font-black tracking-wide uppercase mt-1" style={{ color: 'var(--brief-muted)' }}>
                {tile.label}
              </p>
              {tile.sub && (
                <p className="text-[10px] font-mono mt-0.5 truncate" style={{ color: 'var(--brief-muted)' }}>
                  {tile.sub}
                </p>
              )}
            </div>
          ))}
        </div>
        </details>


      </div>
    </header>
  );
}

export default SpaceStorefrontHeader;
