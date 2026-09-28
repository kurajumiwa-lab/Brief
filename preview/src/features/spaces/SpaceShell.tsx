import { ShopTeam } from './ShopTeam';
import React, { useState, useEffect } from 'react';
import type { Space, Listing, SpacePublicFace } from '../../api/types';
import * as briefApi from '../../api/briefApi';
import { ArrowLeft, Archive, RotateCcw, Globe, Lock, Link2, Pencil } from 'lucide-react';
import type { ListingUpdate } from '../../api/types';
import { PipelineView } from './PipelineView';
import { SpaceOperatingPanel } from './SpaceOperatingPanel';
import { SpaceStorefrontHeader } from './SpaceStorefrontHeader';
import { PublicFacePanel } from './PublicFacePanel';
import { GuardianNotice } from './GuardianNotice';
import { BroadcastRail } from './SpaceBroadcastRail';
import { SpaceTools } from './SpaceTools';
import type { SpaceAudienceView } from '../../api/briefApi';
import { SpaceMoney } from './SpaceMoney';
import { CatalogView } from './CatalogView';
import { CreateFlowModal } from './CreateFlowModal';
import { soundEngine } from '../../utils/SoundEngine';
import { needsAttention } from '../home/spaceSignals';
import { ShopDocuments, type ShopDocument } from './ShopDocuments';
import { ImageField } from '../../components/ImageField';
import { OverlayScreen } from '../../ui/OverlayScreen';

// The document store does not exist yet, so the list this section reads from
// is empty by design: the folder pattern is in place, and the moment the
// server files its first document this is the one place the rows come from,
// with their real names and real dates.
const SHOP_DOCUMENTS: ShopDocument[] = [];

export interface SpaceShellProps {
  spaceId: string;
  initialTab?: 'catalog' | 'pipeline' | 'ledger' | 'tools' | 'operating';
  onBack?: () => void;
  onShare?: (space: Space) => void;
  /** The walk-in enquiry loop: a customer at the counter, no order yet. */
  onCreateOrder?: () => void;
  className?: string;
}

export type SpaceSurfaceTab =
  | 'catalog' | 'pipeline' | 'ledger' | 'tools' | 'operating'
  | 'overview' | 'offers' | 'people' | 'cargo' | 'activity' | 'money';

export const SpaceShell: React.FC<SpaceShellProps> = ({
  spaceId,
  initialTab = 'catalog',
  onBack,
  onShare,
  onCreateOrder,
  className = ''
}) => {
  const [space, setSpace] = useState<Space | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // A freshly created space (nothing answered yet) opens on its own file, so
  // the first thing a vendor sees is the set of questions, not an empty inbox.
  const [activeTab, setActiveTab] = useState<SpaceSurfaceTab>(initialTab);
  const [createFlowOpen, setCreateFlowOpen] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  // The identity editor: a space is NOT frozen by publishing. Its name, goal,
  // target and cover stay editable by the owner, and the public directory is
  // derived per read, so the next look shows the change.
  const [identityOpen, setIdentityOpen] = useState<boolean>(false);
  const [identity, setIdentity] = useState<{ name: string; mode: string; goal: string; target: string; image: string | null }>({
    name: '', mode: '', goal: '', target: '', image: null
  });
  // The audience read: followers, live updates, insights, templates. Fetched
  // once per load so the header strip and the Tools panel never disagree.
  const [audience, setAudience] = useState<SpaceAudienceView | null>(null);
  // The owner's read of the public mirror: its path, what a stranger sees, any
  // reports. Fetched with the space so the panel and the header agree.
  const [face, setFace] = useState<SpacePublicFace | null>(null);
  // Making a space public publishes it to the open internet, so it is confirmed
  // in the panel rather than committed by a single tap on a chip.
  const [pendingPublic, setPendingPublic] = useState<boolean>(false);
  const [identityBusy, setIdentityBusy] = useState<boolean>(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  // The arms of a business, as the server names them, read with the space. Kept
  // here rather than in a client list so a picker can never offer — or refuse —
  // something the row would not accept.
  const [modes, setModes] = useState<Array<{ id: string; label: string; blurb: string }>>([]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const loadSpace = async () => {
    setIsLoading(true);
    try {
      const res = await briefApi.getSpace(spaceId);
      if (res.ok && res.data?.space) {
        setSpace(res.data.space);
        setModes(res.data.modes ?? []);
        const [aud, f] = await Promise.all([
          briefApi.getSpaceAudience(spaceId),
          briefApi.getSpacePublicFace(spaceId)
        ]);
        if (aud.ok) setAudience(aud.data);
        if (f.ok) setFace(f.data);
      }
    } catch {
      // Offline fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSpace();
  }, [spaceId]);

  const openIdentity = () => {
    soundEngine.play('tap');
    setIdentity({
      name: space?.name ?? '',
      mode: space?.mode ?? '',
      goal: space?.goal ?? '',
      target: space?.targetValueKes ? String(space.targetValueKes) : '',
      image: space?.image ?? null
    });
    setIdentityError(null);
    setIdentityOpen(true);
  };

  const saveIdentity = async () => {
    if (!space) return;
    if (!identity.name.trim()) { setIdentityError('A space needs a name.'); return; }
    setIdentityBusy(true);
    setIdentityError(null);
    const res = await briefApi.updateSpace(space.id, {
      name: identity.name.trim(),
      // '' is the owner taking the label off: the server stores null, and a
      // space with no mode renders as unstated instead of defaulting to retail.
      mode: identity.mode.trim() === '' ? null : identity.mode.trim(),
      goal: identity.goal.trim(),
      // null clears the target rather than silently meaning "zero".
      targetValueKes: identity.target.trim() === '' ? null : Number(identity.target),
      image: identity.image
    });
    setIdentityBusy(false);
    if (res.ok) {
      setSpace(res.data.space);
      setIdentityOpen(false);
      showToast(space.visibility === 'public'
        ? 'Saved. Your space is public, so the directory shows this on the next read.'
        : 'Saved.');
      // No refetch: PATCH returns the fully hydrated row, and re-reading it
      // straight back is how a UI ends up briefly showing the OLD name.
    } else {
      setIdentityError(res.error ?? 'Could not save those changes.');
    }
  };

  /**
   * Lifecycle moves go through the server's transition table. `changed:false`
   * is reported for what it is — a no-op, not a second publication — and a
   * refusal returns its reason so the card can show it.
   */
  const offerStatus = async (offerId: string, next: 'active' | 'paused' | 'sold_out' | 'archived') => {
    const res = await briefApi.setListingStatus(offerId, next);
    if (!res.ok) return res.error ?? 'That move was refused.';
    if (res.data.changed === false) showToast('It was already in that state — nothing changed.');
    loadSpace();
    return null;
  };

  const saveOffer = async (offerId: string, patch: ListingUpdate) => {
    const res = await briefApi.updateListing(offerId, patch);
    if (!res.ok) return res.error ?? 'Could not save that offer.';
    showToast('Offer saved.');
    loadSpace();
    return null;
  };

  /**
   * Sharing, honestly. A space has no page of its own — a public space is
   * found in the directory — so there is no "your space link" to copy, and the
   * button used to claim one. Now: copy what actually works, or say why there
   * is nothing to copy yet.
   */
  const copyText = async (value: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      /* the fallback below is the honest path */
    }
    return false;
  };

  const shareSpace = async () => {
    if (!space) return;
    soundEngine.play('tap');
    if (space.visibility !== 'public' || space.status !== 'active') {
      showToast(
        space.status !== 'active'
          ? 'This space is archived, so its page is closed. Restore it first.'
          : `This space is ${space.visibility}, so it has no public page to link to. Set it to Public first.`
      );
      return;
    }
    // The page's own address, from the server read — not a hash route inside the
    // app, and not a shorter domain the deployment does not own.
    const url = face?.view?.pageUrl ?? `${window.location.origin}${face?.path ?? `/s/${encodeURIComponent(space.slug ?? space.id)}`}`;
    const copied = await copyText(url);
    showToast(copied
      ? 'Link copied. Opening it writes the view that counts toward your strip.'
      : `Clipboard is blocked here, so copy it yourself: ${url}`);
    onShare?.(space);
  };

  const broadcast = async (text: string, kind: 'update' | 'stock' | 'hours' | 'drop') => {
    if (!space) return 'No space is open.';
    const res = await briefApi.postSpaceBroadcast(space.id, { text, kind });
    if (!res.ok) return res.error ?? 'The update was not sent.';
    showToast(res.data.delivery.note);
    loadSpace();
    return null;
  };

  const removeBroadcast = async (id: string) => {
    if (!space) return;
    const res = await briefApi.deleteSpaceBroadcast(space.id, id);
    showToast(res.ok ? 'Taken down. Anyone who already read it keeps what they read.' : res.error ?? 'Could not take it down.');
    loadSpace();
  };

  const handlePublishOffer = async (offerId: string) => {
    if (!space) return;
    try {
      const res = await briefApi.publishSpaceOffer(space.id, offerId);
      if (res.ok) {
        showToast('Offer published and live in catalog!');
        loadSpace();
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to publish offer');
    }
  };

  /**
   * Visibility, with the public case treated as what it is: a publication. The
   * panel confirms before calling this, and going back to private is stated as
   * taking the page down — which the server does on the next read, instantly.
   */
  const setVisibility = async (visibility: 'private' | 'unlisted' | 'public') => {
    if (!space) return;
    setBusy(true);
    const res = await briefApi.updateSpace(space.id, { visibility });
    setBusy(false);
    if (res.ok) {
      setSpace(res.data.space);
      setPendingPublic(false);
      const f = await briefApi.getSpacePublicFace(space.id);
      if (f.ok) setFace(f.data);
      showToast(visibility === 'public'
        ? `Published. Your page is at ${f.ok ? f.data.path : '/s/…'} — and it only shows what the space holds.`
        : visibility === 'unlisted'
        ? 'Unlisted: no public page, and it is not in the directory.'
        : 'Private again. The public page is down — nothing is cached behind it.');
    } else {
      showToast(res.error ?? 'Could not change visibility.');
    }
  };

  const toggleArchive = async () => {
    if (!space) return;
    setBusy(true);
    const next = space.status === 'archived' ? 'active' : 'archived';
    const res = await briefApi.updateSpace(space.id, { status: next });
    setBusy(false);
    if (res.ok) {
      setSpace(res.data.space);
      showToast(next === 'archived' ? `Archived "${space.name}".` : `Restored "${space.name}".`);
    } else {
      showToast(res.error ?? 'Could not update that space.');
    }
  };

  if (isLoading && !space) {
    return (
      <div className="p-10 text-center text-xs text-[color:var(--color-text-muted)]">
        Loading space...
      </div>
    );
  }

  if (!space) {
    return (
      <div className="p-10 text-center space-y-3">
        <p className="text-sm font-bold text-[color:var(--color-text)]">Space not found</p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 rounded-full bg-gray-200 text-xs font-bold text-[color:var(--color-text)] cursor-pointer"
          >
            Go Back
          </button>
        )}
      </div>
    );
  }

  // 4 Surfaces: the three operational ones, plus the maintained SPACE FILE.
  // The fourth is the one that keeps a space alive between orders — the schema,
  // its editorial queue, and how the pipeline is reading it. Its badge count is
  // the number of REAL open items the server derived, not a notification tally.
  const openItems = space?.editorialOpen ?? 0;
  // ORDER MATTERS: a shopfront is a catalog first, the customer relationship
  // second, the ledger third. The money tab is the RESULT of the first two, so
  // it does not get to be the landing screen anymore.
  const tabs: Array<{ id: 'catalog' | 'pipeline' | 'ledger' | 'tools' | 'operating'; label: string }> = [
    { id: 'catalog', label: `Catalog (${space.offers?.length || 0})` },
    { id: 'pipeline', label: space.recentConversations?.length ? `Inbox · ${space.recentConversations.length}` : 'Inbox' },
    { id: 'ledger', label: 'Money' },
    { id: 'tools', label: 'Tools' },
    { id: 'operating', label: openItems > 0 ? `To do · ${openItems}` : 'To do' }
  ];

  // Map legacy tabs to the consolidated surfaces
  const currentTab = (
    activeTab === 'overview' || activeTab === 'people' || activeTab === 'cargo' || activeTab === 'activity'
      ? 'pipeline'
      : activeTab === 'money'
      ? 'ledger'
      : activeTab === 'offers'
      ? 'catalog'
      : activeTab
  ) as 'catalog' | 'pipeline' | 'ledger' | 'tools' | 'operating';

  const vis = space?.visibility ?? 'private';

  return (
    <div className={`space-y-4 max-w-2xl mx-auto ${className}`}>
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-[color:var(--color-text)] text-white text-xs font-bold shadow-2xl animate-fadeIn border border-white/10">
          {toastMsg}
        </div>
      )}

      {/* Space identity + controls (this is the "portal", not a register) */}
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => { soundEngine.play('tap'); onBack?.(); }}
            className="flex items-center gap-1 text-xs font-bold text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> Spaces
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void shareSpace()}
              disabled={!space}
              className="p-2 rounded-full bg-[color:var(--color-paper)] text-[color:var(--color-text)] shadow-2xs border border-black/5 hover:bg-gray-100 transition-all cursor-pointer"
              aria-label="Copy the link that reaches this space"
              title="Copy link"
            >
              <Link2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={openIdentity}
              disabled={busy}
              className="inline-flex items-center gap-1 p-2 rounded-full bg-[color:var(--color-paper)] text-[color:var(--color-text)] shadow-2xs border border-black/5 hover:bg-gray-100 transition-all cursor-pointer"
              aria-label="Edit this space"
              title="Edit name, goal, target"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={toggleArchive}
              disabled={busy || !space}
              className="p-2 rounded-full bg-[color:var(--color-paper)] text-[color:var(--color-text)] shadow-2xs border border-black/5 hover:bg-gray-100 transition-all cursor-pointer"
              aria-label={space?.status === 'archived' ? 'Restore space' : 'Archive space'}
              title={space?.status === 'archived' ? 'Restore' : 'Archive'}
            >
              {space?.status === 'archived' ? <RotateCcw className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <SpaceStorefrontHeader
          space={space!}
          audience={audience}
          busy={busy}
          onAddOffer={() => { soundEngine.play('heavyTap'); setCreateFlowOpen(true); }}
          onOpenInbox={() => setActiveTab('pipeline')}
          onEdit={openIdentity}
          onShare={() => void shareSpace()}
          onCreateOrder={onCreateOrder}
        />

        {/* Somebody may have claimed they introduced this shop. Until the shop
            answers, that claim credits nothing — which is why the notice sits
            here, in the owner's own workspace, and nowhere public. */}
        <GuardianNotice spaceId={space!.id} />

        <details className="compact-disclosure">
          <summary>Public page & updates</summary>
        <PublicFacePanel
          space={space!}
          face={face}
          busy={busy}
          onPublish={() => void setVisibility('public')}
          onEditSpace={() => setActiveTab('operating')}
        />

        <BroadcastRail
          broadcasts={(audience?.broadcasts ?? []) as any}
          pastCount={audience?.pastBroadcasts ?? 0}
          followers={audience?.followers ?? space.followers ?? 0}
          canManage={audience?.canManage ?? true}
          busy={busy}
          onPost={broadcast}
          onDelete={(id) => void removeBroadcast(id)}
        />

        </details>

        {/* NEXT STEP — one obvious action, derived from real rows. Not a menu. */}
        {space && (
          <div className="p-3 rounded-2xl bg-[color:var(--color-primary-subtle)] border border-[color:var(--color-primary)] space-y-1">
            <span className="text-[11px] font-black uppercase tracking-wider text-[color:var(--color-primary)]">▶ Next step</span>
            {(space.offers?.length ?? 0) === 0 ? (
              <p className="text-xs font-bold text-[color:var(--color-text)]">Add your first offer to make this space sellable.</p>
            ) : (
              <p className="text-xs font-bold text-[color:var(--color-text)]">
                {(() => {
                  const items = needsAttention(space);
                  if (items.length === 0) return 'All caught up — open your inbox or add another offer.';
                  const first = items[0];
                  return first.label.charAt(0).toUpperCase() + first.label.slice(1) + '.';
                })()}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setCreateFlowOpen(true)}
                className="px-3 py-1.5 rounded-full bg-[color:var(--color-primary)] text-[color:var(--accent-ink)] text-xs font-bold cursor-pointer"
              >
                Add an offer
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('pipeline')}
                className="px-3 py-1.5 text-xs font-bold cursor-pointer"
                style={{ color: 'var(--color-primary)' }}
              >
                Open inbox
              </button>
            </div>
          </div>
        )}

        {identityOpen && (
          <div className="p-4 rounded-2xl border space-y-3" style={{ borderColor: 'var(--color-primary)' }}>
            <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
              Edit this space
            </p>
            <p className="text-[11px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
              Publishing does not freeze anything. These stay yours to change, and the public directory
              reads the current row on each look — there is no copy to update.
            </p>
            <input
              type="text"
              aria-label="Space name"
              value={identity.name}
              onChange={(e) => setIdentity((v) => ({ ...v, name: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl text-xs border border-black/10 bg-[color:var(--color-paper)]"
            />
            {modes.length > 0 && (
              <div className="space-y-1">
                <label htmlFor="space-mode" className="block text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                  Which part of the business is this?
                </label>
                <select
                  id="space-mode"
                  aria-label="Space mode"
                  value={identity.mode}
                  onChange={(e) => setIdentity((v) => ({ ...v, mode: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl text-xs border border-black/10 bg-[color:var(--color-paper)]"
                >
                  <option value="">Not stated</option>
                  {modes.map((m) => (
                    <option key={m.id} value={m.id}>{m.label} — {m.blurb}</option>
                  ))}
                </select>
                <p className="text-[11px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
                  One business, several rooms: the till, the ledger and the members stay shared. A label says who this room is for — it is not a ranking, and nothing is boosted by it.
                </p>
              </div>
            )}
            <ImageField
              label="Shop photo"
              hint="The cover on this shop. Only a photo you upload — nothing is filled in."
              value={identity.image}
              onChange={(url) => setIdentity((v) => ({ ...v, image: url }))}
              compact
            />
            <input
              type="text"
              aria-label="Space goal"
              value={identity.goal}
              onChange={(e) => setIdentity((v) => ({ ...v, goal: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl text-xs border border-black/10 bg-[color:var(--color-paper)]"
            />
            <input
              type="number"
              min={0}
              aria-label="Monthly target"
              placeholder="Monthly target (KES)"
              value={identity.target}
              onChange={(e) => setIdentity((v) => ({ ...v, target: e.target.value }))}
              className="w-40 px-3 py-2 rounded-xl text-xs font-mono border border-black/10 bg-[color:var(--color-paper)]"
            />
            {identityError && <p className="text-[12px] font-bold" role="alert" style={{ color: 'var(--color-danger)' }}>{identityError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={identityBusy}
                onClick={() => void saveIdentity()}
                className="px-3.5 py-2 rounded-full text-[12px] font-black cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
              >
                {identityBusy ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => { setIdentityOpen(false); setIdentityError(null); }}
                className="px-3.5 py-2 rounded-full text-[12px] font-bold cursor-pointer border border-black/10"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Visibility — the owner decides who can discover this space */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[color:var(--color-text-muted)]">Visibility</span>
          {(['private', 'unlisted', 'public'] as const).map((v) => {
            const active = vis === v;
            const Icon = v === 'private' ? Lock : v === 'unlisted' ? Link2 : Globe;
            return (
              <button
                key={v}
                type="button"
                onClick={() => {
                  // One tap must not publish a business to the open internet.
                  if (v === 'public' && vis !== 'public') { setPendingPublic(true); return; }
                  void setVisibility(v);
                }}
                disabled={busy}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                  active ? 'bg-[color:var(--color-primary)] text-[color:var(--accent-ink)]' : 'bg-[color:var(--color-paper)] text-[color:var(--color-text-muted)] border border-black/5 hover:text-[color:var(--color-text)]'
                }`}
              >
                <Icon className="w-3 h-3" />
                {v === 'private' ? 'Private' : v === 'unlisted' ? 'Unlisted' : 'Public'}
              </button>
            );
          })}
        </div>
      </header>

      {/* The publication warning, in the app's own words, before the write. */}
      {pendingPublic && (
        <div className="p-3.5 rounded-2xl" style={{ background: 'var(--color-well)' }} role="alert">
          <p className="text-[13px] leading-snug" style={{ color: 'var(--brief-ink)' }}>
            This puts <strong>{space?.name}</strong> on the open internet at{' '}
            <span className="font-mono">{face?.path ?? `/s/${space?.slug ?? ''}`}</span>: your name, cover photo, stated hours,
            and every live offer with its price. Anyone can read it. Orders, customers and money stay private.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void setVisibility('public')}
              className="px-3.5 py-2 rounded-full text-[13px] font-black cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
            >
              Publish it
            </button>
            <button
              type="button"
              onClick={() => setPendingPublic(false)}
              className="px-3.5 py-2 rounded-full text-[13px] font-bold cursor-pointer"
              style={{ background: 'var(--brief-card)', color: 'var(--brief-ink)' }}
            >
              Stay private
            </button>
          </div>
        </div>
      )}

      {/* Surface Navigation — Bolt contrast endplates: pills on a well, selected is navy */}
      <div className="flex items-center justify-between gap-3 p-2 rounded-2xl" style={{ background: 'var(--color-well)' }}>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => {
            const isSelected = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  soundEngine.play('tap');
                  setActiveTab(tab.id);
                }}
                className="px-3.5 py-2 rounded-full text-[12px] font-black whitespace-nowrap cursor-pointer transition-all"
                style={isSelected
                  ? { background: 'var(--navy)', color: '#fff', boxShadow: 'var(--lift-1)' }
                  : { background: 'var(--color-paper)', color: 'var(--muted-ink)' }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setCreateFlowOpen(true)}
          className="px-3 py-1.5 rounded-full bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-strong)] text-[color:var(--accent-ink)] text-xs font-bold shadow-xs transition-all cursor-pointer"
        >
          + Add Offer
        </button>
      </div>

      {/* ── SURFACE 1: INBOX — overlay, not a tab you scroll to. ── */}
      {currentTab === 'pipeline' && (
        <OverlayScreen title="Inbox" onBack={() => setActiveTab('catalog')}>
          <PipelineView
            space={space}
            onRefresh={loadSpace}
            onShareOffer={(t) => showToast(`Link for "${t}" copied!`)}
          />
        </OverlayScreen>
      )}

      {/* ── SURFACE 2: LEDGER (Financial Truth) ── */}
      {currentTab === 'ledger' && (
        <div className="animate-fadeIn">
          <SpaceMoney
            spaceId={space.id}
            revenueKes={space.metrics?.revenueKes}
            pendingKes={0}
            ordersCount={space.metrics?.totalOrdersCount}
            onViewLedger={() => showToast('Opening authoritative ledger')}
          />
        </div>
      )}

      {/* ── SURFACE 3: CATALOG (What You Sell) ── */}
      {currentTab === 'catalog' && (
        <div className="animate-fadeIn">
          <CatalogView
            offers={space.offers}
            onAddOffer={() => setCreateFlowOpen(true)}
            onPublishOffer={handlePublishOffer}
            onShareOffer={(o, copied) => showToast(copied
              ? `Link for "${o.title}" copied — buyers sign in to open it.`
              : `Clipboard is blocked here, so copy the link the card is showing for "${o.title}".`)}
            onOfferStatus={(id, next) => offerStatus(id, next)}
            onSaveOffer={(id, patch) => saveOffer(id, patch)}
            featured={space.featured ?? []}
          />
        </div>
      )}

      {/* ── SURFACE 4: TOOLS — hours, pinned offers, templates ── */}
      {currentTab === 'tools' && (
        <div className="animate-fadeIn p-4 rounded-3xl bg-[color:var(--color-paper)] border border-black/5 shadow-2xs">
          <ShopTeam spaceId={space.id} />
          <SpaceTools
            space={space}
            offers={space.offers ?? []}
            templates={(audience?.templates ?? []) as any}
            featured={space.featured ?? []}
            onChanged={loadSpace}
          />
        </div>
      )}

      {/* ── SURFACE 5: THE SPACE FILE — documents, schema, queue, pipeline.
              The documents folder sits atop the file: the paper a shopfront
              stands on, in the folder pattern. Brief has no document store
              yet, so every folder is the honest empty state — the pattern is
              in place, nothing pretends a row exists. ── */}
      {currentTab === 'operating' && (
        <div className="animate-fadeIn space-y-4">
          <ShopDocuments documents={SHOP_DOCUMENTS} />
          <SpaceOperatingPanel
            spaceId={space.id}
            maintenance={space.maintenance ?? null}
            onSwitchTab={(t) => setActiveTab(t)}
            onChanged={loadSpace}
          />
        </div>
      )}

      {/* ── STICKY RESULT BAR — the outcome of the first two tabs, kept in view.
              The label is the BASIS, not a nicer word for it. This figure is the
              sum of orders whose status says paid or settled — NOT money whose
              ledger row reached settled, which is what the old caption promised and
              what `getSpaceMoneySummary` does not compute. An owner who marks an
              order settled without recording a payment is inside this number, so
              the bar says "marked" and the audit page says the rest. */}
      <div
        className="sticky bottom-20 md:bottom-4 z-30 rounded-2xl px-4 py-3 flex items-center gap-3"
        style={{ background: 'var(--color-paper)', boxShadow: 'var(--room-light), var(--lift-3), inset 0 0 0 1px var(--brief-line)' }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--brief-muted)' }}>
            Marked settled · {space.metrics?.scope === 'this space only' ? 'this space' : 'all of it'}
          </p>
          <p className="font-mono text-[32px] font-extrabold leading-none" style={{ color: 'var(--color-success)' }}>
            KES {Number(space.metrics?.revenueKes ?? 0).toLocaleString('en-KE')}
          </p>

        </div>
        <span className="text-[12px] font-mono shrink-0" style={{ color: 'var(--brief-muted)' }}>
          {space.metrics?.activeOrdersCount ?? 0} active · {space.metrics?.offersCount ?? 0} live
          {/* An order of this business that belongs to no space is counted
              nowhere rather than in every space — but it is said out loud here,
              so a smaller number never looks like a finished one. */}
          {(space.metrics?.unattachedOrderCount ?? 0) > 0 && (
            <span className="font-bold"> · {space.metrics!.unattachedOrderCount} not in a space</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setActiveTab('ledger')}
          className="shrink-0 text-[12px] font-black cursor-pointer"
          style={{ color: 'var(--color-primary)' }}
        >
          Money
        </button>
      </div>

      {/* Unified Create Flow Modal */}
      {createFlowOpen && (
        <CreateFlowModal
          isOpen={createFlowOpen}
          existingSpaceId={space.id}
          onClose={() => setCreateFlowOpen(false)}
          onCompleted={(updatedSpace) => {
            setSpace(updatedSpace);
            showToast('Catalog offer added and published!');
            loadSpace();
          }}
        />
      )}
    </div>
  );
};

export default SpaceShell;
