import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, CircleAlert, MessageCircle, Package, RefreshCw, ShoppingBag } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { MyPosition } from '../../api/briefApi';
import type { ApiResult, Listing, ShopBrief, ShopBriefFlag, Space } from '../../api/types';
import { soundEngine } from '../../utils/SoundEngine';
import '../../ui/seller-home.css';

// ---------------------------------------------------------------------------
// THE ATTENTION READ — what needs you today, across the shops you run.
//
// This was the top of the Home atrium (`SellerHome`). When the atrium left the
// bar and its slot became the Shops door, this is the one part of it that a
// seller actually came back for, so it moved with the seller's own door and
// now opens Shops. Everything on it is derived from live rows — Spaces, today's
// business brief, the offer list, the member's position — and every figure that
// cannot be read is a dash, never a sample zero.
//
// It is self-contained on purpose: it does its own reads and reports its own
// failures, so the host that mounts it cannot accidentally paint a clean
// "nothing urgent" over a read that did not happen.
// ---------------------------------------------------------------------------

export type AttentionWorkspaceTab = 'catalog' | 'pipeline' | 'ledger';
type ReadStatus = 'loading' | 'ready' | 'error' | 'denied';
type AttentionKind = 'inquiry' | 'order' | 'offer' | 'record';

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  actionLabel: string;
  count?: number;
  onOpen: () => void;
}

export interface AttentionStripProps {
  /** Open one Space at the workspace tab the item points at. */
  onOpenSpace: (spaceId: string, initialTab?: AttentionWorkspaceTab) => void;
  /** Open the offers-and-orders desk (the Shops door's Selling section). */
  onOpenSelling: () => void;
  /** Open a section of the trade desk. Falls back to writing the hash. */
  onOpenTrade?: (section?: string) => void;
  onRequireAuth?: () => void;
  /** Bump to re-read; the strip also carries its own refresh control. */
  refreshSignal?: number;
  className?: string;
}

const EAT = 'Africa/Nairobi';
const DASH = '—';
const TODAY_KEY = new Intl.DateTimeFormat('en-KE', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: EAT });

function nairobiDayKey(now = new Date()): string {
  const parts = TODAY_KEY.formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatKES(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
}

function statusOf<T>(result: ApiResult<T>): ReadStatus {
  return result.ok ? 'ready' : result.status === 401 ? 'denied' : 'error';
}

function flagTab(flag: ShopBriefFlag): AttentionWorkspaceTab {
  if (flag.action?.surface === 'ledger') return 'ledger';
  if (flag.action?.surface === 'pipeline') return 'pipeline';
  return 'catalog';
}

function AttentionIcon({ kind }: { kind: AttentionKind }) {
  const props = { size: 18, 'aria-hidden': true as const };
  if (kind === 'inquiry') return <MessageCircle {...props} />;
  if (kind === 'order') return <ShoppingBag {...props} />;
  if (kind === 'offer') return <Package {...props} />;
  return <CircleAlert {...props} />;
}

function Metric({ label, value, detail, testId, accent = false }: {
  label: string; value: string; detail: string; testId: string; accent?: boolean;
}) {
  return (
    <div className={`seller-home__metric${accent ? ' seller-home__metric--accent' : ''}`}>
      <p className="seller-home__metric-label">{label}</p>
      <p className="seller-home__metric-value" data-testid={testId}>{value}</p>
      <p className="seller-home__metric-detail">{detail}</p>
    </div>
  );
}

/**
 * The pure derivation: which items are waiting, given what the reads said.
 * Exported so a suite can pin the rules without a DOM.
 */
export function deriveAttentionItems(input: {
  activeSpaces: Space[];
  inboxCount: number | null;
  openOrders: number | null;
  agedOrders: number | null;
  draftOffers: number | null;
  flags: ShopBriefFlag[];
  openGaps: number;
}, act: {
  onOpenSpace: AttentionStripProps['onOpenSpace'];
  onOpenSelling: () => void;
  onOpenTrade: (section?: string) => void;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { activeSpaces, inboxCount, openOrders, agedOrders, draftOffers, flags, openGaps } = input;
  const inboxSpace = activeSpaces.find((space) => (space.metrics?.inquiriesAwaitingReply ?? 0) > 0);

  if (inboxCount !== null && inboxCount > 0) {
    items.push({
      id: 'inquiries',
      kind: 'inquiry',
      count: inboxCount,
      title: `${plural(inboxCount, 'inquiry', 'inquiries')} waiting for a reply`,
      detail: inboxSpace ? `Across your Spaces · start with ${inboxSpace.name}` : 'Across your active Spaces.',
      actionLabel: 'Open inbox',
      onOpen: () => { if (inboxSpace) act.onOpenSpace(inboxSpace.id, 'pipeline'); }
    });
  }

  if (typeof openOrders === 'number' && openOrders > 0) {
    const aged = typeof agedOrders === 'number' && agedOrders > 0;
    const count = aged ? (agedOrders as number) : openOrders;
    items.push({
      id: 'orders',
      kind: 'order',
      count,
      title: aged ? `${plural(count, 'older order')} still open` : `${plural(openOrders, 'open order')} to review`,
      detail: aged ? 'These were placed before today and remain open.' : 'Check fulfilment and the next step for each order.',
      actionLabel: 'Review orders',
      onOpen: act.onOpenSelling
    });
  }

  if (draftOffers !== null && draftOffers > 0) {
    items.push({
      id: 'draft-offers',
      kind: 'offer',
      count: draftOffers,
      title: `${plural(draftOffers, 'offer')} not published`,
      detail: 'Drafts are not visible to buyers yet.',
      actionLabel: 'Review offers',
      onOpen: act.onOpenSelling
    });
  }

  for (const flag of flags.filter((f) => f.kind !== 'orders_aged').slice(0, 3)) {
    items.push({
      id: `brief-${flag.id}`,
      kind: 'record',
      title: flag.message,
      detail: flag.detail,
      actionLabel: flag.action?.label || 'Review',
      onOpen: () => {
        if (flag.spaceId) act.onOpenSpace(flag.spaceId, flagTab(flag));
        else act.onOpenSelling();
      }
    });
  }

  // Demand the reader is positioned to answer is the one attention item the
  // operational reads cannot see, because it is not about a Space. It is
  // derived server-side in domain/position.js from real request rows.
  if (openGaps > 0) {
    items.push({
      id: 'open-demand',
      kind: 'record',
      count: openGaps,
      title: `${plural(openGaps, 'open request')} the ledger can match to you`,
      detail: 'Open demand on your position. Quoting is optional; ignoring it is visible to nobody but you.',
      actionLabel: 'Open the trade desk',
      onOpen: () => act.onOpenTrade('open')
    });
  }

  return items;
}

export function AttentionStrip({
  onOpenSpace,
  onOpenSelling,
  onOpenTrade,
  onRequireAuth,
  refreshSignal = 0,
  className = ''
}: AttentionStripProps) {
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [brief, setBrief] = useState<ShopBrief | null>(null);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [position, setPosition] = useState<MyPosition | null>(null);
  const [spacesStatus, setSpacesStatus] = useState<ReadStatus>('loading');
  const [briefStatus, setBriefStatus] = useState<ReadStatus>('loading');
  const [listingsStatus, setListingsStatus] = useState<ReadStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setSpacesStatus('loading');
    setBriefStatus('loading');
    setListingsStatus('loading');
    void Promise.all([
      briefApi.listMySpaces(),
      briefApi.getShopBrief(nairobiDayKey()),
      briefApi.getMyListings(),
      briefApi.getMyPosition()
    ]).then(([spaceResult, briefResult, listingResult, positionResult]) => {
      if (!live) return;
      setSpacesStatus(statusOf(spaceResult));
      setBriefStatus(statusOf(briefResult));
      setListingsStatus(statusOf(listingResult));
      setSpaces(spaceResult.ok ? spaceResult.data.spaces : null);
      setBrief(briefResult.ok ? briefResult.data : null);
      setListings(listingResult.ok ? listingResult.data.listings : null);
      // The position is allowed to be absent: it adds one item when it can be
      // read and adds nothing when it cannot. It never blanks the rest.
      setPosition(positionResult.ok ? positionResult.data : null);
    }).catch(() => {
      if (!live) return;
      setSpaces(null); setBrief(null); setListings(null); setPosition(null);
      setSpacesStatus('error'); setBriefStatus('error'); setListingsStatus('error');
    });
    return () => { live = false; };
  }, [attempt, refreshSignal]);

  const openTrade = (section?: string) => {
    if (onOpenTrade) return onOpenTrade(section);
    soundEngine.play('tap');
    if (typeof window !== 'undefined') window.location.hash = section ? `trade/${section}` : 'trade';
  };

  const activeSpaces = useMemo(() => (spaces ?? []).filter((space) => space.status !== 'archived'), [spaces]);
  const inboxCount = useMemo(() => {
    if (spacesStatus !== 'ready' || !spaces) return null;
    if (activeSpaces.some((space) => typeof space.metrics?.inquiriesAwaitingReply !== 'number')) return null;
    return activeSpaces.reduce((sum, space) => sum + (space.metrics.inquiriesAwaitingReply ?? 0), 0);
  }, [activeSpaces, spaces, spacesStatus]);
  const activeOffers = listingsStatus === 'ready' && listings ? listings.filter((l) => l.status === 'active').length : null;
  const draftOffers = listingsStatus === 'ready' && listings ? listings.filter((l) => l.status === 'draft').length : null;
  const briefHasShop = briefStatus === 'ready' && brief?.reason !== 'no_spaces';
  const openOrders = briefHasShop ? brief?.orders?.open ?? null : null;
  const agedOrders = briefHasShop ? brief?.orders?.aged ?? null : null;
  const markedInToday = briefStatus === 'ready' && brief && !brief.empty && brief.money
    ? formatKES(brief.money.currency, brief.money.inKes)
    : DASH;

  const anyLoading = spacesStatus === 'loading' || briefStatus === 'loading' || listingsStatus === 'loading';
  const anyFailure = [spacesStatus, briefStatus, listingsStatus].some((status) => status === 'error');
  const needsSignIn = [spacesStatus, briefStatus, listingsStatus].some((status) => status === 'denied');
  const allReadsReady = spacesStatus === 'ready' && briefStatus === 'ready' && listingsStatus === 'ready';
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  const attentionItems = useMemo(() => deriveAttentionItems({
    activeSpaces,
    inboxCount,
    openOrders,
    agedOrders,
    draftOffers,
    flags: briefStatus === 'ready' ? brief?.flags ?? [] : [],
    openGaps: position?.open?.total ?? 0
  }, { onOpenSpace, onOpenSelling, onOpenTrade: openTrade }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [activeSpaces, inboxCount, openOrders, agedOrders, draftOffers, brief, briefStatus, position, onOpenSpace, onOpenSelling, onOpenTrade]);

  const retry = () => { soundEngine.play('tap'); setAttempt((n) => n + 1); };

  return (
    <div className={`attention-strip ${className}`} data-testid="attention-strip">
      <div className="attention-strip__head">
        <div>
          <p className="seller-home__kicker">THE OPERATIONAL READ</p>
          <h2 id="attention-strip-title">What needs your attention today?</h2>
        </div>
        <button type="button" onClick={retry} aria-label="Refresh business activity" title="Refresh business activity">
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>

      {needsSignIn && (
        <div className="seller-home__status seller-home__status--auth" role="status">
          <p><strong>Sign in to see what is waiting across your shops.</strong> No activity is filled in from examples.</p>
          {onRequireAuth && <button type="button" onClick={onRequireAuth}>Sign in <ArrowRight size={15} aria-hidden="true" /></button>}
        </div>
      )}

      {anyFailure && !needsSignIn && (
        <div className="seller-home__status seller-home__status--error" role="alert">
          <p><strong>{offline ? 'You appear to be offline.' : 'Some activity could not be refreshed.'}</strong> Unavailable counts stay blank; nothing is replaced with sample figures.</p>
          <button type="button" onClick={retry}>Try again</button>
        </div>
      )}

      <section className="seller-home__metrics" aria-label="Business activity summary" aria-busy={anyLoading}>
        <Metric
          label="Inquiries waiting"
          value={inboxCount === null ? DASH : String(inboxCount)}
          detail={spacesStatus === 'loading' ? 'Reading Spaces…' : inboxCount === null ? 'Inbox count unavailable' : inboxCount === 0 ? 'No open conversations' : 'Across active Spaces'}
          testId="metric-inquiries-value"
          accent={inboxCount !== null && inboxCount > 0}
        />
        <Metric
          label="Open orders"
          value={openOrders === null ? DASH : String(openOrders)}
          detail={briefStatus === 'loading' ? 'Reading today’s business brief…' : openOrders === null ? 'Order read unavailable' : openOrders === 0 ? 'None currently open' : 'Check fulfilment next steps'}
          testId="metric-orders-value"
          accent={typeof agedOrders === 'number' && agedOrders > 0}
        />
        <Metric
          label="Active offers"
          value={activeOffers === null ? DASH : String(activeOffers)}
          detail={listingsStatus === 'loading' ? 'Reading your offer list…' : activeOffers === null ? 'Offer list unavailable' : 'Published across your business'}
          testId="metric-offers-value"
        />
        <Metric
          label="Marked in today"
          value={markedInToday}
          detail={briefStatus === 'loading' ? 'Reading today’s business brief…' : briefStatus !== 'ready' ? 'Today’s money read unavailable' : brief?.empty ? 'No activity rows recorded today' : 'Orders marked paid or settled · not rail settlement'}
          testId="metric-marked-in-value"
        />
      </section>

      <section className="seller-home__attention" aria-labelledby="attention-strip-list-title">
        <div className="seller-home__section-heading seller-home__section-heading--attention">
          <div>
            <p className="seller-home__kicker">THE NEXT GOOD MOVE</p>
            <h2 id="attention-strip-list-title">Needs your attention</h2>
          </div>
          <span className="seller-home__attention-orbit" aria-hidden="true">✳</span>
        </div>

        {attentionItems.length > 0 ? (
          <ul className="seller-home__attention-list" data-testid="attention-list">
            {attentionItems.map((item) => (
              <li key={item.id} data-attention-id={item.id}>
                <span className={`seller-home__attention-icon seller-home__attention-icon--${item.kind}`} aria-hidden="true">
                  <AttentionIcon kind={item.kind} />
                </span>
                <div className="seller-home__attention-copy">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </div>
                <button type="button" onClick={item.onOpen} aria-label={`${item.actionLabel}: ${item.title}`}>
                  {item.actionLabel}<ArrowRight size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : spacesStatus === 'ready' && activeSpaces.length === 0 ? (
          <div className="seller-home__attention-empty">
            <p>No Spaces to monitor yet. Create one below to start routing offers, conversations and orders into this workspace.</p>
          </div>
        ) : allReadsReady ? (
          <div className="seller-home__attention-empty seller-home__attention-empty--clear">
            <span className="seller-home__clear-mark" aria-hidden="true"><Check size={17} /></span>
            <p><strong>Nothing urgent is waiting.</strong> New conversations, open orders and drafts will show up here.</p>
          </div>
        ) : (
          <p className="seller-home__attention-loading" role="status">
            {anyLoading ? 'Reading your live activity…' : 'Could not confirm what needs attention. Retry to refresh the available reads.'}
          </p>
        )}
      </section>
    </div>
  );
}

export default AttentionStrip;
