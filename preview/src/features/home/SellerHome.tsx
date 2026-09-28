import React, { useEffect, useMemo, useState } from 'react';
import {
  CircleAlert,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Briefcase,
  Check,
  Compass,
  Inbox,
  MessageCircle,
  Package,
  RefreshCw,
  ShoppingBag,
  Store,
  X
} from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { ApiResult, CampaignBanner, Listing, ShopBrief, ShopBriefFlag, Space, SpaceActivity } from '../../api/types';
import '../../ui/seller-home.css';

export type SpaceWorkspaceTab = 'catalog' | 'pipeline' | 'ledger';
type ReadStatus = 'loading' | 'ready' | 'error' | 'denied';

type AttentionKind = 'inquiry' | 'order' | 'offer' | 'record';
interface AttentionItem {
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  actionLabel: string;
  count?: number;
  onOpen: () => void;
}

export interface SellerHomeProps {
  onOpenSpace: (spaceId: string, initialTab?: SpaceWorkspaceTab) => void;
  onOpenSelling: () => void;
  onOpenSpaces: () => void;
  onCreateSpace: () => void;
  onExplore: () => void;
  onOpenWorkforce: () => void;
  onRequireAuth?: () => void;
  announcements?: CampaignBanner[] | null;
}

const EAT = 'Africa/Nairobi';
const DASH = '—';
const TODAY_KEY = new Intl.DateTimeFormat('en-KE', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: EAT
});
const TODAY_LABEL = new Intl.DateTimeFormat('en-KE', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: EAT
});
const ACTIVITY_TIME = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: EAT
});

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

function flagTab(flag: ShopBriefFlag): SpaceWorkspaceTab {
  if (flag.action?.surface === 'ledger') return 'ledger';
  if (flag.action?.surface === 'pipeline') return 'pipeline';
  return 'catalog';
}

function activityTime(value: string): string {
  const at = Date.parse(value);
  return Number.isFinite(at) ? ACTIVITY_TIME.format(new Date(at)) : 'Date not recorded';
}

function activityRows(spaces: Space[]): Array<{ space: Space; activity: SpaceActivity }> {
  return spaces
    .flatMap((space) => (space.recentActivities ?? []).map((activity) => ({ space, activity })))
    .filter(({ activity }) => Number.isFinite(Date.parse(activity.createdAt)))
    .sort((a, b) => Date.parse(b.activity.createdAt) - Date.parse(a.activity.createdAt))
    .slice(0, 5);
}

function AttentionIcon({ kind }: { kind: AttentionKind }) {
  const props = { size: 18, 'aria-hidden': true as const };
  if (kind === 'inquiry') return <MessageCircle {...props} />;
  if (kind === 'order') return <ShoppingBag {...props} />;
  if (kind === 'offer') return <Package {...props} />;
  return <CircleAlert {...props} />;
}

function Metric({
  label,
  value,
  detail,
  testId,
  accent = false
}: {
  label: string;
  value: string;
  detail: string;
  testId: string;
  accent?: boolean;
}) {
  return (
    <div className={`seller-home__metric${accent ? ' seller-home__metric--accent' : ''}`}>
      <p className="seller-home__metric-label">{label}</p>
      <p className="seller-home__metric-value" data-testid={testId}>{value}</p>
      <p className="seller-home__metric-detail">{detail}</p>
    </div>
  );
}

function SpaceRow({
  space,
  onOpenSpace
}: {
  space: Space;
  onOpenSpace: SellerHomeProps['onOpenSpace'];
}) {
  const inquiries = space.metrics?.inquiriesAwaitingReply;
  const offerCount = space.metrics?.offersCount;
  const name = space.name || 'Space';
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();

  return (
    <article className="seller-home__space-row" data-testid={`seller-space-${space.id}`}>
      <button
        type="button"
        className="seller-home__space-identity"
        onClick={() => onOpenSpace(space.id, 'catalog')}
        aria-label={`Open ${name}`}
      >
        <span className="seller-home__space-mark" aria-hidden="true">
          {space.image ? <img src={briefApi.mediaFileUrl(space.image)} alt="" loading="lazy" /> : initials || <Store size={18} />}
        </span>
        <span className="seller-home__space-copy">
          <strong>{name}</strong>
          <small>
            {typeof offerCount === 'number' ? `${plural(offerCount, 'active offer')}` : 'Offer count unavailable'}
            {space.modeLabel ? ` · ${space.modeLabel}` : ''}
          </small>
        </span>
        <ArrowUpRight size={17} aria-hidden="true" />
      </button>
      <div className="seller-home__space-actions">
        {typeof inquiries === 'number' && inquiries > 0 ? (
          <button
            type="button"
            className="seller-home__text-action seller-home__text-action--reply"
            onClick={() => onOpenSpace(space.id, 'pipeline')}
            aria-label={`Reply to ${plural(inquiries, 'open inquiry', 'open inquiries')} in ${name}`}
          >
            <Inbox size={15} aria-hidden="true" /> Reply <span>{inquiries}</span>
          </button>
        ) : (
          <span className="seller-home__space-status">
            {typeof inquiries === 'number' ? <><Check size={14} aria-hidden="true" /> Inbox clear</> : 'Inbox count unavailable'}
          </span>
        )}
      </div>
    </article>
  );
}

export function SellerHome({
  onOpenSpace,
  onOpenSelling,
  onOpenSpaces,
  onCreateSpace,
  onExplore,
  onOpenWorkforce,
  onRequireAuth,
  announcements = []
}: SellerHomeProps) {
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [brief, setBrief] = useState<ShopBrief | null>(null);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [spacesStatus, setSpacesStatus] = useState<ReadStatus>('loading');
  const [briefStatus, setBriefStatus] = useState<ReadStatus>('loading');
  const [listingsStatus, setListingsStatus] = useState<ReadStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSpacesStatus('loading');
    setBriefStatus('loading');
    setListingsStatus('loading');
    const day = nairobiDayKey();

    void Promise.all([
      briefApi.listMySpaces(),
      briefApi.getShopBrief(day),
      briefApi.getMyListings()
    ]).then(([spaceResult, briefResult, listingResult]) => {
      if (!live) return;
      setSpacesStatus(statusOf(spaceResult));
      setBriefStatus(statusOf(briefResult));
      setListingsStatus(statusOf(listingResult));
      setSpaces(spaceResult.ok ? spaceResult.data.spaces : null);
      setBrief(briefResult.ok ? briefResult.data : null);
      setListings(listingResult.ok ? listingResult.data.listings : null);
      setVendorName(listingResult.ok ? listingResult.data.vendor?.displayName ?? '' : '');
    }).catch(() => {
      if (!live) return;
      setSpaces(null);
      setBrief(null);
      setListings(null);
      setVendorName('');
      setSpacesStatus('error');
      setBriefStatus('error');
      setListingsStatus('error');
    });

    return () => { live = false; };
  }, [attempt]);

  const activeSpaces = useMemo(
    () => (spaces ?? []).filter((space) => space.status !== 'archived'),
    [spaces]
  );
  const inboxCount = useMemo(() => {
    if (spacesStatus !== 'ready' || !spaces) return null;
    if (activeSpaces.some((space) => typeof space.metrics?.inquiriesAwaitingReply !== 'number')) return null;
    return activeSpaces.reduce((sum, space) => sum + (space.metrics.inquiriesAwaitingReply ?? 0), 0);
  }, [activeSpaces, spaces, spacesStatus]);
  const activeOffers = listingsStatus === 'ready' && listings
    ? listings.filter((listing) => listing.status === 'active').length
    : null;
  const draftOffers = listingsStatus === 'ready' && listings
    ? listings.filter((listing) => listing.status === 'draft').length
    : null;
  const openOrders = briefStatus === 'ready' && brief?.reason !== 'no_spaces'
    ? brief?.orders?.open ?? null
    : null;
  const agedOrders = briefStatus === 'ready' && brief?.reason !== 'no_spaces'
    ? brief?.orders?.aged ?? null
    : null;
  const markedInToday = briefStatus === 'ready' && brief && !brief.empty && brief.money
    ? formatKES(brief.money.currency, brief.money.inKes)
    : DASH;
  const businessName = (brief && brief.reason !== 'no_spaces' ? brief.shop.name : null)
    || vendorName
    || activeSpaces[0]?.name
    || 'Your business';
  const currentDay = brief?.dayLabel || TODAY_LABEL.format(new Date());
  const anyFailure = [spacesStatus, briefStatus, listingsStatus].some((status) => status === 'error');
  const needsSignIn = [spacesStatus, briefStatus, listingsStatus].some((status) => status === 'denied');
  const allReadsReady = spacesStatus === 'ready' && briefStatus === 'ready' && listingsStatus === 'ready';
  const latestActivities = useMemo(() => activityRows(activeSpaces), [activeSpaces]);

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    const inboxSpace = activeSpaces.find((space) => (space.metrics?.inquiriesAwaitingReply ?? 0) > 0);
    if (inboxCount !== null && inboxCount > 0) {
      items.push({
        id: 'inquiries',
        kind: 'inquiry',
        count: inboxCount,
        title: `${plural(inboxCount, 'inquiry', 'inquiries')} waiting for a reply`,
        detail: inboxSpace ? `Across your Spaces · start with ${inboxSpace.name}` : 'Across your active Spaces.',
        actionLabel: 'Open inbox',
        onOpen: () => { if (inboxSpace) onOpenSpace(inboxSpace.id, 'pipeline'); }
      });
    }

    if (typeof openOrders === 'number' && openOrders > 0) {
      const count = typeof agedOrders === 'number' && agedOrders > 0 ? agedOrders : openOrders;
      const aged = typeof agedOrders === 'number' && agedOrders > 0;
      items.push({
        id: 'orders',
        kind: 'order',
        count,
        title: aged ? `${plural(count, 'older order')} still open` : `${plural(openOrders, 'open order')} to review`,
        detail: aged ? 'These were placed before today and remain open.' : 'Check fulfilment and the next step for each order.',
        actionLabel: 'Review orders',
        onOpen: onOpenSelling
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
        onOpen: onOpenSelling
      });
    }

    const flags = (briefStatus === 'ready' ? brief?.flags ?? [] : [])
      .filter((flag) => flag.kind !== 'orders_aged')
      .slice(0, 3);
    for (const flag of flags) {
      items.push({
        id: `brief-${flag.id}`,
        kind: 'record',
        title: flag.message,
        detail: flag.detail,
        actionLabel: flag.action?.label || 'Review',
        onOpen: () => {
          if (flag.spaceId) onOpenSpace(flag.spaceId, flagTab(flag));
          else onOpenSelling();
        }
      });
    }

    return items;
  }, [activeSpaces, agedOrders, brief, briefStatus, draftOffers, inboxCount, onOpenSelling, onOpenSpace, openOrders]);

  const announcement = (announcements ?? []).find((item) => item.status === 'active' && item.id !== dismissedAnnouncement);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  return (
    <div className="seller-home" data-testid="seller-home">
      <header className="seller-home__header">
        <div className="seller-home__heading-copy">
          <p className="seller-home__eyebrow"><span className="seller-home__eyebrow-mark" aria-hidden="true">✳</span> WAIRO <span aria-hidden="true">/</span> BUSINESS WORKSPACE</p>
          <h1>What needs your attention today?</h1>
          <p className="seller-home__intro">A live read across <strong>{businessName}</strong> and the Spaces your team runs.</p>
        </div>
        <div className="seller-home__date-stamp">
          <span>NAIROBI · TODAY</span>
          <strong>{currentDay}</strong>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} aria-label="Refresh business activity" title="Refresh business activity">
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {needsSignIn && (
        <div className="seller-home__status seller-home__status--auth" role="status">
          <p><strong>Sign in to see your complete business workspace.</strong> No activity is filled in from examples.</p>
          <button type="button" onClick={onRequireAuth}>Sign in <ArrowRight size={15} aria-hidden="true" /></button>
        </div>
      )}
      {anyFailure && (
        <div className="seller-home__status" role="alert">
          <p><strong>{offline ? 'You appear to be offline.' : 'Some activity could not be refreshed.'}</strong> Unavailable counts stay blank; nothing is replaced with sample figures.</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      )}

      <section className="seller-home__metrics" aria-label="Business activity summary" aria-busy={spacesStatus === 'loading' || briefStatus === 'loading' || listingsStatus === 'loading'}>
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

      <section className="seller-home__attention" aria-labelledby="seller-attention-title">
        <div className="seller-home__section-heading seller-home__section-heading--attention">
          <div>
            <p className="seller-home__kicker">THE NEXT GOOD MOVE</p>
            <h2 id="seller-attention-title">Needs your attention</h2>
          </div>
          <span className="seller-home__attention-orbit" aria-hidden="true">✳</span>
        </div>

        {attentionItems.length > 0 ? (
          <ul className="seller-home__attention-list">
            {attentionItems.map((item) => (
              <li key={item.id}>
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
            {spacesStatus === 'loading' || briefStatus === 'loading' || listingsStatus === 'loading'
              ? 'Reading your live activity…'
              : 'Could not confirm what needs attention. Retry to refresh the available reads.'}
          </p>
        )}
      </section>

      <section className="seller-home__quick-actions" aria-labelledby="seller-actions-title">
        <div className="seller-home__section-heading">
          <div><p className="seller-home__kicker">MAKE A MOVE</p><h2 id="seller-actions-title">Quick actions</h2></div>
        </div>
        <div className="seller-home__action-row">
          <button type="button" onClick={onOpenSelling}>
            <span><Package size={17} aria-hidden="true" /></span><strong>Post an offer</strong><ArrowRight size={15} aria-hidden="true" />
          </button>
          <button type="button" onClick={onOpenWorkforce}>
            <span><Briefcase size={17} aria-hidden="true" /></span><strong>People &amp; roles</strong><ArrowRight size={15} aria-hidden="true" />
          </button>
          <button type="button" onClick={onExplore}>
            <span><Compass size={17} aria-hidden="true" /></span><strong>Explore Wairo</strong><ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="seller-home__spaces" aria-labelledby="seller-spaces-title">
        <div className="seller-home__section-heading">
          <div>
            <p className="seller-home__kicker">YOUR BUSINESS, IN CONTEXT</p>
            <h2 id="seller-spaces-title">Spaces</h2>
            <p className="seller-home__section-note">Where offers, conversations and community come together.</p>
          </div>
          <button type="button" className="seller-home__view-all" onClick={onOpenSpaces}>
            All Spaces <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>

        {spacesStatus === 'loading' ? (
          <p className="seller-home__read-state" role="status">Reading your Spaces…</p>
        ) : spacesStatus === 'denied' ? (
          <p className="seller-home__read-state">Sign in to see the Spaces you operate.</p>
        ) : spacesStatus === 'error' ? (
          <div className="seller-home__read-state">
            <span>Your Spaces could not be read just now.</span>
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </div>
        ) : activeSpaces.length === 0 ? (
          <div className="seller-home__empty-spaces">
            <div className="seller-home__empty-illustration" aria-hidden="true"><Store size={22} /></div>
            <div>
              <strong>No active Spaces yet.</strong>
              <p>Create one for your products or services, then use it to keep orders, conversations and people in one place.</p>
            </div>
            <button type="button" onClick={onCreateSpace}>Create a Space <ArrowRight size={15} aria-hidden="true" /></button>
          </div>
        ) : (
          <div className="seller-home__space-list" data-testid="seller-space-list">
            {activeSpaces.slice(0, 4).map((space) => <SpaceRow key={space.id} space={space} onOpenSpace={onOpenSpace} />)}
            {activeSpaces.length > 4 && (
              <button type="button" className="seller-home__more-spaces" onClick={onOpenSpaces}>
                View all {activeSpaces.length} Spaces <ArrowRight size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </section>

      <section className="seller-home__activity" aria-labelledby="seller-activity-title">
        <div className="seller-home__section-heading">
          <div><p className="seller-home__kicker">REAL ROWS, RECENTLY</p><h2 id="seller-activity-title">Recent activity</h2></div>
        </div>
        {spacesStatus === 'ready' && latestActivities.length > 0 ? (
          <ul className="seller-home__activity-list">
            {latestActivities.map(({ space, activity }) => (
              <li key={`${space.id}:${activity.id}`}>
                <span className="seller-home__activity-pin" aria-hidden="true" />
                <div className="seller-home__activity-copy">
                  <strong>{activity.title}</strong>
                  <small>{space.name}{activity.description ? ` · ${activity.description}` : ''}</small>
                </div>
                <time dateTime={activity.createdAt}>{activityTime(activity.createdAt)}</time>
              </li>
            ))}
          </ul>
        ) : spacesStatus === 'ready' ? (
          <p className="seller-home__read-state">No activity has been recorded in your active Spaces yet.</p>
        ) : (
          <p className="seller-home__read-state">Recent activity is unavailable until your Spaces can be read.</p>
        )}
      </section>

      {announcement && (
        <aside className="seller-home__announcement" aria-label="Announcement">
          <span className="seller-home__announcement-mark" aria-hidden="true">
            {announcement.imageUrl ? <img src={briefApi.mediaFileUrl(announcement.imageUrl)} alt="" loading="lazy" /> : <Bell size={17} />}
          </span>
          <div className="seller-home__announcement-copy">
            <p className="seller-home__kicker">FROM THE WAIRO BOARD</p>
            <strong>{announcement.title}</strong>
            {announcement.body && <small>{announcement.body}</small>}
            {announcement.location && <small>{announcement.location}</small>}
          </div>
          {announcement.share.available && <a href={announcement.share.url}>Open <ArrowUpRight size={14} aria-hidden="true" /></a>}
          <button type="button" aria-label="Dismiss announcement" onClick={() => setDismissedAnnouncement(announcement.id)}><X size={16} aria-hidden="true" /></button>
        </aside>
      )}
    </div>
  );
}

export default SellerHome;
