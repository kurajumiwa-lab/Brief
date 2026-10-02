import React, { useState } from 'react';
import type { Listing, ListingUpdate } from '../../api/types';
import { Tag, Plus, ShoppingBag, X, Package, ImagePlus, Trash2 } from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';
import { MicroBadge } from '../../ui/MicroBadge';
import { ContextMenu } from '../../ui/ContextMenu';
import { ImageField } from '../../components/ImageField';
import * as briefApi from '../../api/briefApi';
import { PLASTER, plateGlow } from '../city/room';
import { StockAddSheet } from './StockAddSheet';

// ---------------------------------------------------------------------------
// CATALOG VIEW — the seller's own offers, with REAL controls.
//
// Two rules this screen exists to honour:
//
//   1. NOTHING HERE IS COSMETIC. This used to carry a Pause/Resume button that
//      only flipped local React state — the offer stayed live to buyers, so
//      the control was a lie with a checkmark. Status now goes through
//      POST /api/listings/:id/status and the card re-renders from the row the
//      server sends back. A no-op is reported as a no-op (`changed: false`).
//
//   2. AN OFFER IS EDITABLE AFTER PUBLISHING, WITHIN ITS LAWFUL MOVES.
//      Content (title, description, price, stock, place) PATCHes the listing;
//      the lifecycle moves through the transition table. `archived` is
//      terminal by design — withdrawn offers do not come back, because orders
//      already placed refer to what the listing was. Re-listing means a new
//      offer, and the UI says so instead of offering a button that would be
//      refused.
//
// The transition map below is a COURTESY, so a menu never offers what the
// server will refuse. The server stays authoritative and its refusal is shown
// word for word.
//
//   3. THE ROW EDITOR MUST COVER EVERY FIELD THE PATCH ALLOWS. It used to
//      carry title, description, price, stock and place — so the photos, which
//      `PATCH /api/listings/:id` accepts and which buyers see first, were
//      uneditable after publishing: an offer could never be re-photographed.
//      And a published price change needs a stated reason from the seller, so
//      the row now collects one instead of bouncing the seller off the
//      server's refusal with no way to answer it.
// ---------------------------------------------------------------------------

type LifecycleMove = 'active' | 'paused' | 'sold_out' | 'archived';

const NEXT_MOVES: Record<string, Array<{ to: LifecycleMove; label: string; tone?: 'default' | 'danger' }>> = {
  // A draft has nothing to pause — it is already invisible to buyers. It can
  // be published (the inline primary action) or withdrawn.
  draft: [{ to: 'archived', label: 'Withdraw this offer', tone: 'danger' }],
  active: [
    { to: 'paused', label: 'Pause — hidden from buyers' },
    { to: 'sold_out', label: 'Mark sold out' },
    { to: 'archived', label: 'Withdraw this offer', tone: 'danger' }
  ],
  paused: [
    { to: 'active', label: 'Resume — live again' },
    { to: 'archived', label: 'Withdraw this offer', tone: 'danger' }
  ],
  sold_out: [
    { to: 'active', label: 'Back in stock — relist' },
    { to: 'archived', label: 'Withdraw this offer', tone: 'danger' }
  ],
  archived: []
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'DRAFT', active: 'ACTIVE', paused: 'PAUSED', sold_out: 'SOLD OUT', archived: 'WITHDRAWN'
};

/**
 * The money fields, mirrored from the server's MONEY_FIELDS in
 * `server/src/domain/listing.js`, and the same minimum length the server
 * requires of the reason. Mirrored, not invented: the only fields that raise
 * the reason row here are the ones the server demands a reason for, the prompt
 * is no stricter than the gate, and the PATCH never carries a reason the server
 * did not ask for. `spaceedit.jsx` compares both against the server's source,
 * so the two cannot drift apart quietly.
 */
const MONEY_FIELDS: Array<keyof ListingUpdate> = ['price', 'currency', 'unitLabel', 'minOrderQuantity'];
const REASON_MIN = 6;
const MONEY_LABEL: Record<string, string> = {
  price: 'price', currency: 'currency', unitLabel: 'the unit it is priced per', minOrderQuantity: 'the minimum order'
};
const moneyChangedIn = (offer: Listing, draft: ListingUpdate) => {
  const row = offer as unknown as Record<string, unknown>;
  return MONEY_FIELDS.filter((f) => (
    JSON.stringify(row[f as string] ?? null) !== JSON.stringify(draft[f] ?? null)
  ));
};

export interface CatalogViewProps {
  offers: Listing[];
  onAddOffer: () => void;
  /** The space the shelf belongs to. With it, the fast stock-add sheet (photo
      + note, or a template) can write real rows; without it the full form is
      the only honest path, so the button falls back to `onAddOffer`. */
  spaceId?: string;
  /** Re-read the shelf after the stock-add sheet wrote rows. */
  onStockAdded?: () => void;
  onPublishOffer?: (offerId: string) => void;
  /**
   * The link was copied, or the browser refused to copy it. `false` means the
   * host must NOT say "copied" — it should point at the link shown on the card.
   */
  onShareOffer?: (offer: Listing, copied: boolean) => void;
  /** A real lifecycle move. Resolves to an error string, or null on success. */
  onOfferStatus?: (offerId: string, next: LifecycleMove) => Promise<string | null | undefined> | void;
  /** A real content edit. Resolves to an error string, or null on success. */
  onSaveOffer?: (offerId: string, patch: ListingUpdate) => Promise<string | null | undefined> | void;
  /** The ids the VENDOR pinned to the front of this catalog. */
  featured?: string[];
  className?: string;
}

export const CatalogView: React.FC<CatalogViewProps> = ({
  offers = [],
  onAddOffer,
  spaceId,
  onStockAdded,
  onPublishOffer,
  onShareOffer,
  onOfferStatus,
  onSaveOffer,
  featured,
  className = ''
}) => {
  const [stockSheetOpen, setStockSheetOpen] = useState(false);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const categories = [...new Set(offers.map(o => o.type).filter((t): t is Listing['type'] => typeof t === 'string' && t.length > 0))];
  const shownOffers = offers.filter(o => (category === 'all' || o.type === category) && (!search.trim() || `${o.title} ${o.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /** The link the last share produced, per offer — shown when a clipboard refuses. */
  const [shareUrl, setShareUrl] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ListingUpdate>({});
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  // "A money field moved, so the next save needs your words." An inline note,
  // not an error: nothing was refused yet, and a false alert on a legal draft
  // teaches the seller to ignore alerts.
  const [notice, setNotice] = useState<Record<string, string>>({});

  const move = async (offerId: string, to: LifecycleMove) => {
    soundEngine.play('tap');
    if (!onOfferStatus) return;
    setBusy(true);
    const err = await onOfferStatus(offerId, to);
    setBusy(false);
    // A refusal stays on the card it belongs to — the server's words, not ours.
    setRowError((p) => (err ? { ...p, [offerId]: String(err) } : (() => { const n = { ...p }; delete n[offerId]; return n; })()));
  };

  const startEdit = (offer: Listing) => {
    soundEngine.play('tap');
    setDraft({
      title: offer.title,
      description: offer.description ?? '',
      price: offer.price,
      currency: offer.currency ?? 'KES',
      quantityAvailable: offer.quantityAvailable ?? null,
      locationName: (offer as { locationName?: string }).locationName ?? null,
      // Photos ride along, or the editor silently deletes them on save.
      media: offer.media ?? [],
      reason: ''
    });
    setNotice((p) => { const n = { ...p }; delete n[offer.id]; return n; });
    setEditingId(offer.id);
  };

  /** Any edit clears the note: it describes the draft as it stood a moment ago. */
  const editDraft = (patch: ListingUpdate, offerId: string) => {
    setDraft((d) => ({ ...d, ...patch }));
    setNotice((p) => { const n = { ...p }; delete n[offerId]; return n; });
  };

  const saveEdit = async (offer: Listing) => {
    if (!onSaveOffer) return;
    const why = String(draft.reason ?? '').trim();
    const touched = moneyChangedIn(offer, draft);
    // A draft has no buyers to explain anything to — a reason there would be a
    // fee for a form field, so the row asks only once the offer is published.
    if (offer.status !== 'draft' && touched.length) {
      if (why.length < REASON_MIN) {
        setNotice((p) => ({
          ...p,
          [offer.id]: `Say why ${touched.length === 1 ? `the ${MONEY_LABEL[touched[0]] ?? touched[0]} is changing` : 'the terms are changing'} — at least ${REASON_MIN} characters.`
        }));
        return;
      }
    }
    const payload: ListingUpdate = { ...draft, reason: why };
    if (!why) delete payload.reason;
    setBusy(true);
    const err = await onSaveOffer(offer.id, payload);
    setBusy(false);
    if (err) {
      setRowError((p) => ({ ...p, [offer.id]: String(err) }));
      return;
    }
    setEditingId(null);
    setNotice((p) => { const n = { ...p }; delete n[offer.id]; return n; });
    setRowError((p) => { const n = { ...p }; delete n[offer.id]; return n; });
  };

  /**
   * The link a seller pastes into WhatsApp. `#offer/<id>` is a real route in
   * this app (AppShell reads it), so it resolves wherever this bundle is
   * served. What is NOT allowed here is a brand domain: this file used to hand
   * out `https://brief.africa/offers/<id>` whenever the window was missing, and
   * nobody owns that host any more — a seller would paste a dead link into a
   * buyer's chat and Trace would be the one who wrote it.
   */
  const linkFor = (offer: Listing) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/#offer/${encodeURIComponent(offer.id)}`;
  };

  const handleCopyLink = (offer: Listing) => {
    soundEngine.play('tap');
    const url = linkFor(offer);
    setShareUrl((p) => ({ ...p, [offer.id]: url }));

    // "Link copied" must not be printed for a clipboard that was never
    // written to. jsdom and a denied Android permission both land here, and in
    // both cases the honest answer is: show the link so it can be copied by
    // hand. `copied` follows the promise, not the click.
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      return navigator.clipboard.writeText(url).then(
        () => { setCopiedId(offer.id); setTimeout(() => setCopiedId(null), 2500); return true; },
        () => false
      );
    }
    return Promise.resolve(false);
  };

  return (
    <section className={`space-y-4 max-w-2xl mx-auto ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Tag className="w-4 h-4 text-[color:var(--color-primary)]" />
          <h3 className="text-sm font-black uppercase tracking-wider text-[color:var(--color-text)]">
            Catalog & Offers ({offers.length})
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              soundEngine.play('heavyTap');
              // The fast path is the stock sheet (photo + note, or a template).
              // Without a space id the sheet has nowhere to write, so the full
              // form stays the fallback rather than a dead button.
              if (spaceId) setStockSheetOpen(true);
              else onAddOffer();
            }}
            className="px-3.5 py-1.5 rounded-full bg-[color:var(--color-text)] hover:bg-black text-white font-bold text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Add Stock</span>
          </button>
          {spaceId && (
            <button
              type="button"
              onClick={() => { soundEngine.play('tap'); onAddOffer(); }}
              className="px-3 py-1.5 rounded-full text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] font-bold text-xs cursor-pointer"
              title="The full offer form"
            >
              Full form
            </button>
          )}
        </div>
      </div>

      {stockSheetOpen && spaceId && (
        <StockAddSheet
          spaceId={spaceId}
          onClose={() => setStockSheetOpen(false)}
          onAdded={() => { onStockAdded?.(); }}
        />
      )}

      {offers.length > 0 && <div className="space-y-2">
        <input aria-label="Search shop catalog" placeholder="Search this shop" value={search} onChange={e => setSearch(e.target.value)} className="w-full p-3 rounded-2xl" />
        <div className="shop-category-row" aria-label="Catalog categories">{['all', ...categories].map(c => <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}>{c === 'all' ? 'All offers' : c.charAt(0).toUpperCase() + c.slice(1) + 's'}</button>)}</div>
        {shownOffers.length === 0 && <p className="text-sm p-4 bg-white rounded-xl">No offers match this search.</p>}
      </div>}
      {offers.length === 0 ? (
        <div className="p-8 rounded-3xl bg-[color:var(--color-paper)] border border-black/5 text-center space-y-3 shadow-sm">
          <ShoppingBag className="w-8 h-8 text-[color:var(--color-text-muted)] mx-auto opacity-40" />
          <p className="text-xs font-bold text-[color:var(--color-text)]">No offers created yet</p>
          <p className="text-[12px] text-[color:var(--color-text-muted)] max-w-sm mx-auto">
            Add your goods or skills to publish them to your public catalog and generate WhatsApp share links.
          </p>
          <button
            type="button"
            onClick={() => {
              if (spaceId) setStockSheetOpen(true);
              else onAddOffer();
            }}
            className="px-4 py-2 rounded-full bg-[color:var(--color-text)] text-white text-xs font-bold shadow-xs cursor-pointer"
          >
            Add your first stock
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {shownOffers.map((offer) => {
            // Status is read from the row the server returned — never from a
            // local optimistic flip, which is how a control ends up lying.
            const currentStat = offer.status;
            const isDraft = currentStat === 'draft';
            const isPaused = currentStat === 'paused';
            const isArchived = currentStat === 'archived';
            const pinned = (featured ?? []).includes(offer.id);
            const raw = (offer.media ?? [])[0] ?? (offer as { image?: string | null }).image ?? null;
            const mediaUrl = raw ? briefApi.mediaFileUrl(raw) : null;
            // An action with nowhere to go is a lie with an icon, so lifecycle
            // moves are offered only when the host wired the real transition.
            const moves = onOfferStatus ? (NEXT_MOVES[currentStat] ?? []) : [];
            const price = (offer as any).priceKes ?? offer.price ?? 0;
            const stock = offer.quantityAvailable;

            return (
              <div
                key={offer.id}
                className={`rounded-3xl overflow-hidden bg-[color:var(--color-paper)] border shadow-2xs flex flex-col justify-between transition-all ${
                  isPaused ? 'opacity-60 bg-[color:var(--color-surface)]' : ''
                } ${pinned ? 'ring-2' : ''}`}
                style={{
                  borderColor: 'var(--brief-line)',
                  ...(pinned ? { boxShadow: '0 0 0 2px var(--color-primary)' } : {})
                }}
              >
                {/* The photo, when there is one. A real photo of the actual
                    goods, or no photo at all: never a stock image standing in
                    for a shop nobody has photographed. */}
                <div className="relative h-28 w-full" style={{ background: 'var(--color-well)' }}>
                  {mediaUrl ? (
                    <img src={mediaUrl} alt={offer.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    /* No photo is a plate in the room's own plaster carrying the
                       goods' mark — a design decision, not a gap to be captioned. */
                    <div className="absolute inset-0" style={{ background: PLASTER }}>
                      <span className="absolute inset-0" style={{ background: plateGlow('var(--color-primary)') }} />
                      <Package className="absolute bottom-2 left-2 w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                    </div>
                  )}
                  {pinned && (
                    <span
                      className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider"
                      style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
                    >
                      Pinned
                    </span>
                  )}
                </div>

                <div className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center space-x-2 min-w-0">
                      {/* No emoji. There used to be a cake here, printed on every
                          offer in the catalog regardless of what it was — which is
                          how "Meals" turned up wearing a birthday cake on the public
                          page. A glyph that describes nothing is decoration, and a
                          decoration that looks like data is what people trust by
                          mistake. The photo plate above is the only visual an offer
                          gets, and only when the seller took it. */}
                      <span className="text-xs font-black text-[color:var(--color-text)] leading-tight truncate">
                        {offer.title}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0">
                      {/* Metadata offloaded to micro-badges: status + stock,
                          one line, token-based (bronze border per spec). */}
                      <MicroBadge tone={isPaused || isDraft || isArchived ? "warning" : "success"}>
                        {STATUS_LABEL[currentStat] ?? String(currentStat).toUpperCase()}
                      </MicroBadge>
                      <MicroBadge tone="neutral">
                        {stock == null ? "Stock not specified" : `${stock} in stock`}
                      </MicroBadge>
                    </div>
                  </div>

                  {offer.description && (
                    <p className="text-[12px] text-[color:var(--color-text-muted)] line-clamp-2">
                      {offer.description}
                    </p>
                  )}


                </div>

                <div className="flex items-center justify-between pt-2 border-t border-black/5">
                  <span className="text-sm font-black text-[color:var(--color-text)]">
                    {offer.currency || 'KES'} {price.toLocaleString()}
                  </span>

                  <div className="flex items-center space-x-1.5">
                    {/* The consequential PRIMARY action stays inline. */}
                    {isDraft && onPublishOffer && (
                      <button
                        type="button"
                        onClick={() => {
                          soundEngine.play('reward');
                          onPublishOffer(offer.id);
                        }}
                        className="px-2.5 py-1 rounded-xl bg-[color:var(--color-text)] text-[color:var(--color-primary)] text-[11px] font-bold hover:bg-black transition-all cursor-pointer"
                      >
                        Publish
                      </button>
                    )}

                    {!isArchived && onSaveOffer && (
                      <button
                        type="button"
                        onClick={() => (editingId === offer.id ? setEditingId(null) : startEdit(offer))}
                        className="px-2.5 py-1 rounded-xl border border-black/10 text-[11px] font-bold text-[color:var(--color-text)] hover:bg-black/5 transition-all cursor-pointer"
                      >
                        {editingId === offer.id ? 'Close' : 'Edit'}
                      </button>
                    )}
                    {isArchived && (
                      <span className="text-[11px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
                        Withdrawn — a new offer re-lists it
                      </span>
                    )}

                    {/* Secondary actions collapse behind a context menu. */}
                    <ContextMenu
                      ariaLabel={`Actions for ${offer.title}`}
                      actions={[
                        {
                          label: copiedId === offer.id ? "Link copied" : "Share link",
                          onSelect: async () => onShareOffer?.(offer, await handleCopyLink(offer))
                        },
                        ...moves.map((m) => ({
                          label: m.label,
                          tone: m.tone,
                          onSelect: () => void move(offer.id, m.to)
                        }))
                      ]}
                    />
                  </div>
                </div>

                {rowError[offer.id] && (
                  <p className="text-[11px] font-bold" role="alert" style={{ color: 'var(--color-danger)' }}>
                    {rowError[offer.id]}
                  </p>
                )}

                {/* Nothing was copied, so nothing is claimed as copied: the
                    link is simply shown, and the seller takes it by hand. */}
                {shareUrl[offer.id] && copiedId !== offer.id && (
                  <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    Clipboard unavailable here — copy it yourself: <span className="font-mono break-all">{shareUrl[offer.id]}</span>
                  </p>
                )}

                {editingId === offer.id && (
                  <div className="pt-3 border-t border-black/5 space-y-2">
                    <input
                      type="text"
                      aria-label="Offer title"
                      value={draft.title ?? ''}
                      onChange={(e) => editDraft({ title: e.target.value }, offer.id)}
                      className="w-full px-3 py-2 rounded-xl text-xs border border-black/10 bg-[color:var(--color-paper)]"
                    />
                    <textarea
                      aria-label="Offer description"
                      rows={2}
                      value={draft.description ?? ''}
                      onChange={(e) => editDraft({ description: e.target.value }, offer.id)}
                      className="w-full px-3 py-2 rounded-xl text-[12px] border border-black/10 bg-[color:var(--color-paper)] resize-none"
                    />
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={0}
                        aria-label="Offer price"
                        value={draft.price ?? 0}
                        onChange={(e) => editDraft({ price: Number(e.target.value) }, offer.id)}
                        className="w-28 px-3 py-2 rounded-xl text-xs font-mono border border-black/10 bg-[color:var(--color-paper)]"
                      />
                      <input
                        type="number"
                        min={0}
                        aria-label="Stock available"
                        placeholder="stock"
                        value={draft.quantityAvailable ?? ''}
                        onChange={(e) => editDraft({ quantityAvailable: e.target.value === '' ? null : Number(e.target.value) }, offer.id)}
                        className="w-24 px-3 py-2 rounded-xl text-xs font-mono border border-black/10 bg-[color:var(--color-paper)]"
                      />
                      <input
                        type="text"
                        aria-label="Offer location"
                        placeholder="Place (optional)"
                        value={draft.locationName ?? ''}
                        onChange={(e) => editDraft({ locationName: e.target.value }, offer.id)}
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl text-xs border border-black/10 bg-[color:var(--color-paper)]"
                      />
                    </div>

                    {/* The photos. Uploaded, not linked: the field refuses to
                        show a preview it did not receive from the server, and a
                        photo nobody took is a plate that says so, not stock
                        imagery standing in for goods. */}
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                        Photos ({(draft.media ?? []).length})
                      </p>
                      {(draft.media ?? []).map((src, i) => (
                        <div key={`${src}-${i}`} className="flex items-center gap-2 rounded-xl px-2 py-1.5" style={{ background: 'var(--color-well)' }}>
                          <img src={briefApi.mediaFileUrl(src)} alt="" loading="lazy" className="h-10 w-14 shrink-0 rounded-lg object-cover" />
                          <p className="min-w-0 flex-1 truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{src}</p>
                          <button
                            type="button"
                            aria-label={`Remove photo ${i + 1} from ${offer.title}`}
                            onClick={() => editDraft({ media: (draft.media ?? []).filter((_, j) => j !== i) }, offer.id)}
                            className="shrink-0 rounded-lg p-1.5 cursor-pointer"
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {!(draft.media ?? []).length && (
                        <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          <ImagePlus className="w-3.5 h-3.5" /> No photo yet — buyers see the name and the price alone.
                        </p>
                      )}
                      <ImageField
                        compact
                        multiple
                        label="Photos of these goods"
                        hint="The file, not a link. The server decides what the bytes really are."
                        onAdd={(url) => editDraft({ media: [...(draft.media ?? []), url] }, offer.id)}
                      />
                    </div>

                    {/* A published money change is free — it only has to be
                        explained. The reason is stored on the offer's record,
                        so a buyer can see what it cost before, and why. */}
                    {moneyChangedIn(offer, draft).length > 0 && (
                      <div className="space-y-1.5 rounded-xl p-2.5" style={{ background: 'var(--color-well)' }}>
                        <label className="block text-[11px] font-black uppercase tracking-wider" htmlFor={`reason-${offer.id}`} style={{ color: 'var(--color-text-muted)' }}>
                          Why is the price changing?
                        </label>
                        <input
                          id={`reason-${offer.id}`}
                          type="text"
                          aria-label="Reason for the price change"
                          placeholder="e.g. Sugar went up at the mill this week"
                          value={draft.reason ?? ''}
                          onChange={(e) => editDraft({ reason: e.target.value }, offer.id)}
                          className="w-full px-3 py-2 rounded-xl text-[12px] border border-black/10 bg-[color:var(--color-paper)]"
                        />
                        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {offer.status === 'draft'
                            ? 'This one is still a draft, so no reason is needed to save it.'
                            : 'Goes on the offer’s record. Buyers can read it; orders already placed keep the price they were quoted.'}
                        </p>
                      </div>
                    )}
                    {notice[offer.id] && (
                      <p className="text-[11px] font-bold" role="alert" style={{ color: 'var(--color-danger)' }}>
                        {notice[offer.id]}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void saveEdit(offer)}                        className="px-3 py-1.5 rounded-full text-[12px] font-black cursor-pointer disabled:opacity-50"
                        style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
                      >
                        {busy ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-bold cursor-pointer border border-black/10"
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        Buyers see the new price on their next look
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default CatalogView;

/**
 * The mirror, exposed for the suite only: `spaceedit.jsx` reads the server's
 * own MONEY_FIELDS / REASON_MIN out of `server/src/domain/listing.js` and
 * fails if these two no longer match. A gate that drifts from the rule it
 * mirrors is worse than no gate, because it refuses legal edits.
 */
export const MIRROR_MONEY_FIELDS: string[] = MONEY_FIELDS;
export const MIRROR_REASON_MIN: number = REASON_MIN;

