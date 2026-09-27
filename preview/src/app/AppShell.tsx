import '../ui/storefront.css';
import React, { useState, useEffect } from 'react';
import type { Space, Listing } from '../api/types';
import * as briefApi from '../api/briefApi';
import { Navigation, BriefNavigationTab } from './Navigation';
import { AppBelt, readPlace, PLACE_KEY } from './AppBelt';
import { NavSheet, type SheetTarget } from './NavSheet';
import { TAB_HASH, backLabel, shopHref, shopIdFromHash, surfaceFromHash } from './surfaces';
import { CreateSheet, type CreateActionId } from './CreateSheet';
import { HostEventSheet } from '../features/city/HostEventSheet';
const GroupBuyPortal = React.lazy(() => import('../components/GroupBuyPortal').then(m => ({ default: m.GroupBuyPortal })));
const SpaceModerationPanel = React.lazy(() => import('../components/SpaceModerationPanel').then(m => ({ default: m.SpaceModerationPanel })));
const SearchResults = React.lazy(() => import('../components/SearchResults').then(m => ({ default: m.SearchResults })));
const HomeSurface = React.lazy(() => import('../features/home/HomeSurface').then(m => ({ default: m.HomeSurface })));
const SpaceShell = React.lazy(() => import('../features/spaces/SpaceShell').then(m => ({ default: m.SpaceShell })));
import { SpaceMoney } from '../features/spaces/SpaceMoney';
import { CatalogView } from '../features/spaces/CatalogView';
const CityFeedView = React.lazy(() => import('../features/city/CityFeedView').then(m => ({ default: m.CityFeedView })));
import type { DiscoverRoom } from '../features/city/taxonomy';

const PublicSpacePage = React.lazy(() => import('../features/spaces/PublicSpacePage').then(m => ({ default: m.PublicSpacePage })));
const MarketStorefront = React.lazy(() => import('../features/market/MarketStorefront').then(m => ({ default: m.MarketStorefront })));
import { CreateFlowModal } from '../features/spaces/CreateFlowModal';
const PublicOfferModal = React.lazy(() => import('../features/offers/PublicOfferModal').then(m => ({ default: m.PublicOfferModal })));
import { JoinRoom } from '../features/city/JoinRoom';
const SupplyWorkspace = React.lazy(() => import('../features/supply/SupplyWorkspace').then(m => ({ default: m.SupplyWorkspace })));
import { RequestsWorkspace, requestPath } from '../features/requests/RequestsWorkspace';
const PartnerDesk = React.lazy(() => import('../features/partner/PartnerDesk').then(m => ({ default: m.PartnerDesk })));
import { YouSurface, YOU_SECTION_IDS, type YouSection } from '../features/you/YouSurface';
import { EntityDetail } from '../features/you/EntityDetail';
import { FirstRunChecklist } from '../features/you/FirstRunChecklist';
const PulseSurface = React.lazy(() => import('../features/pulse/PulseSurface').then(m => ({ default: m.PulseSurface })));
const MineSurface = React.lazy(() => import('../features/mine/MineSurface').then(m => ({ default: m.MineSurface })));
import { ShopBrief } from '../features/spaces/ShopBrief';
import { OverlayScreen } from '../ui/OverlayScreen';
import { soundEngine } from '../utils/SoundEngine';
import { SyncStatusDot } from '../ui/SyncStatusDot';

export interface AppShellProps {
  initialTab?: BriefNavigationTab;
  initialSpaceId?: string | null;
  onNavigateLegacyTab?: (tab: string) => void;
  className?: string;
}

export const AppShell: React.FC<AppShellProps> = ({
  initialTab = 'home',
  initialSpaceId = null,
  onNavigateLegacyTab,
  className = ''
}) => {
  const [canModerate, setCanModerate] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<BriefNavigationTab>(initialTab);
  const [supplyRoute, setSupplyRoute] = useState(() => window.location.hash.replace(/^#\/?supply\/?/, ''));
  const [requestRoute, setRequestRoute] = useState('');
  const [offerLinkId, setOfferLinkId] = useState('');
  // A join link pasted in a WhatsApp group opens a room's landing page for a
  // person with no account and no session. It is NOT a tab: the nav is hidden
  // while it is open, because a stranger deciding whether to join a room should
  // not be looking at the app's own furniture.
  const [joinCode, setJoinCode] = useState('');
  const [spaceLink, setSpaceLink] = useState('');
  const [storefrontOpen, setStorefrontOpen] = useState(false);
  const [spaceError, setSpaceError] = useState('');
  const [activeSpace, setActiveSpace] = useState<Space | null>(null);
  // Where the You tab opens. The ⓘ on a screen deep-links to the audit page
  // rather than putting the explanation in the reader's way.
  const [youSection, setYouSection] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authed, setAuthed] = useState<boolean>(true);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [firstRun, setFirstRun] = useState<boolean>(false);
  // Which Discover segment a jump from Home should land on ('pulse' is the
  // world's numbers; the rest are the browse surfaces).
  // One room per deep link, and the type comes from the taxonomy module so the
  // shell can never name a room the board does not have.
  const [discoverSubTab, setDiscoverSubTab] = useState<DiscoverRoom>('all');
  // The belt's two owned pieces of state: the sheet (the long list of
  // destinations, which is why the band above can stay short) and the search
  // query, which lives in the URL hash so a searched view can be pasted,
  // reloaded and shared like every other surface here.
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [place, setPlace] = useState<string>(readPlace);
  const [firstRunChecked, setFirstRunChecked] = useState<boolean>(false);
  // The one action in the bar: the create sheet, and the two real loops it
  // opens (host an event is a sheet of its own; group buys is the portal
  // overlay). The Selling tab and the errand composer are answered by nonce,
  // because they are signals to surfaces that already exist, not new screens.
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [hostSheetOpen, setHostSheetOpen] = useState<boolean>(false);
  const [groupBuysOpen, setGroupBuysOpen] = useState<boolean>(false);
  const [sellingNonce, setSellingNonce] = useState<number>(0);
  const [mineSellingNonce, setMineSellingNonce] = useState<number>(0);
  const [briefOpen, setBriefOpen] = useState<boolean>(false);
  const [errandSignal, setErrandSignal] = useState<{ nonce: number; kind: string | null } | null>(null);
  const [signalCounter, setSignalCounter] = useState<number>(0);

  // Modals
  const [createFlowOpen, setCreateFlowOpen] = useState<boolean>(false);
  const [createFlowInitialStep, setCreateFlowInitialStep] = useState<1 | 2>(1);
  const [publicOfferModalOpen, setPublicOfferModalOpen] = useState<boolean>(false);
  const [activePublicOffer, setActivePublicOffer] = useState<Listing | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Manual Walk-in Order State on Pipeline
  const [manualOrderOpen, setManualOrderOpen] = useState<boolean>(false);
  const [manualCustomerName, setManualCustomerName] = useState<string>('');
  const [manualCustomerPhone, setManualCustomerPhone] = useState<string>('');
  const [manualItemTitle, setManualItemTitle] = useState<string>('');
  const [manualPrice, setManualPrice] = useState<string>('');

  /**
   * Where a sheet entry goes. Every target lands on a surface that already
   * exists — a tab, a You section, or a sign-out — because a nav item that
   * opened nothing is worse than no nav item.
   */
  const goSheetTarget = (target: SheetTarget) => {
    if (target.kind === 'storefront') { window.location.hash = 'storefront'; setStorefrontOpen(true); return; }
    if (target.kind === 'moderation') { window.location.hash = 'moderation'; setModerationOpen(true); return; }
    if (target.kind === 'signout') {
      void (async () => {
        await briefApi.logout();
        setAuthed(false);
        setCanModerate(false);
        setModerationOpen(false);
        setYouSection(null);
        setActiveTab('home');
        window.location.hash = '';
        showToast('Signed out. The rows you wrote stay on the server.');
      })();
      return;
    }
    if (target.kind === 'tab') {
      setActiveTab(target.tab);
      window.location.hash = target.tab;
      return;
    }
    if (target.kind === 'discover') {
      setDiscoverSubTab(target.room);
      setActiveTab('city');
      window.location.hash = `city/${target.room}`;
      return;
    }
    setYouSection(target.section);
    setActiveTab('you');
    window.location.hash = `you/${target.section}`;
  };

  /**
   * The create sheet's four verbs, each landing on the flow that actually
   * writes the row. The sheet closes on every pick: it is a door, not a room.
   */
  const pickCreate = (id: CreateActionId) => {
    setCreateOpen(false);
    const nextNonce = signalCounter + 1;
    setSignalCounter(nextNonce);
    if (id === 'offer') {
      setMineSellingNonce(nextNonce);
      setActiveTab('mine');
      window.location.hash = 'mine';
    } else if (id === 'event') {
      setHostSheetOpen(true);
    } else if (id === 'run' || id === 'errand') {
      setDiscoverSubTab('errands');
      setErrandSignal({ nonce: nextNonce, kind: id === 'run' ? 'delivery' : null });
      setActiveTab('city');
      window.location.hash = 'city/errands';
    }
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  // ---------------------------------------------------------------------------
  // THE URL AS THE RECORD OF WHAT IS OPEN
  //
  // Two-way on purpose. Opening a surface writes its hash, so the back gesture
  // on a phone has something to step off; and a hash that names a surface opens
  // it, so a pasted or reloaded link lands where the person left off. The tab
  // underneath is remembered so that closing a sheet returns you to it instead
  // of dumping you on Home — which is what an app does when it clears the URL
  // to nothing, and what it looks like from a phone: a back button that works
  // and then throws you somewhere else.
  // ---------------------------------------------------------------------------
  const tabHashRef = React.useRef<string>('');
  const activeSpaceIdRef = React.useRef<string>('');
  const spaceFromRef = React.useRef<string>('');
  const spaceLinkRef = React.useRef<string>('');
  spaceLinkRef.current = spaceLink;

  /** The overlays, most recently actionable first: one of them owns the URL. */
  const surfaceState = () => {
    if (manualOrderOpen) return 'manual-order';
    if (createFlowOpen) return 'new-space';
    if (hostSheetOpen) return 'host';
    if (createOpen) return 'create';
    if (groupBuysOpen) return 'groupbuys';
    if (sheetOpen) return 'menu';
    return null;
  };

  useEffect(() => {
    const named = surfaceFromHash(window.location.hash);
    const want = surfaceState();
    if (want && want !== named) {
      window.location.hash = want;
      return;
    }
    if (!want && named) {
      const back = tabHashRef.current;
      if (back) window.location.hash = back;
      else window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [createOpen, hostSheetOpen, groupBuysOpen, sheetOpen, createFlowOpen, manualOrderOpen]);

  /** Open one space's workspace, and name it in the URL so back leaves it. */
  const openSpace = (id: string) => {
    if (activeSpaceIdRef.current !== id) spaceFromRef.current = tabHashRef.current || 'spaces';
    activeSpaceIdRef.current = id;
    setActiveTab('pipeline');
    void (async () => {
      const res = await briefApi.getSpace(id);
      if (res.ok && res.data?.space) setActiveSpace(res.data.space);
      else { activeSpaceIdRef.current = ''; loadSpaces(); }
    })();
    const href = shopHref(id);
    if (window.location.hash !== href) window.location.hash = href;
  };
  const openSpaceRef = React.useRef(openSpace);
  openSpaceRef.current = openSpace;

  /** Leave the shop back where it was opened from, not at the root. */
  const closeSpace = () => {
    const back = spaceFromRef.current || TAB_HASH.pipeline;
    activeSpaceIdRef.current = '';
    setActiveSpace(null);
    if (window.location.hash.replace(/^#/, '') !== back) window.location.hash = back;
    else setActiveTab('pipeline');
  };

  /**
   * The visible way out of a second screen. Offered only when one is open, and
   * it goes to the tab the screen was opened from — the same place the back
   * gesture goes, because both are only the URL moving. Nothing is read from the
   * hash here on purpose: whether the control exists is decided by the same
   * state that decides what is on screen, so the two can never disagree.
   */
  const anySurfaceOpen = createOpen || hostSheetOpen || groupBuysOpen
    || sheetOpen || createFlowOpen || manualOrderOpen;
  // Back is for a second screen. A space held in memory while Home is showing
  // is not a second screen — that is how a Back toggle appeared on Home.
  const viewingSpace = Boolean(activeSpace) && (activeTab === 'pipeline' || activeTab === 'spaces');
  const backTo = (anySurfaceOpen || viewingSpace)
    ? {
      label: viewingSpace && !anySurfaceOpen
        ? backLabel(spaceFromRef.current || TAB_HASH[activeTab] || '')
        : backLabel(tabHashRef.current || TAB_HASH[activeTab] || ''),
      onBack: () => {
        if (anySurfaceOpen) {
          const back = tabHashRef.current || TAB_HASH[activeTab] || 'home';
          if (window.location.hash.replace(/^#/, '') === back) {
            setCreateOpen(false);
            setHostSheetOpen(false);
            setGroupBuysOpen(false);
            setSheetOpen(false);
            setCreateFlowOpen(false);
            setManualOrderOpen(false);
          } else {
            window.location.hash = back;
          }
          return;
        }
        closeSpace();
      }
    }
    : null;

  const loadSpaces = async () => {
    setLoading(true);
    setSpaceError('');
    try {
      const res = await briefApi.listMySpaces();
      if (res.ok && res.data?.spaces && res.data.spaces.length > 0) {
        // Listing the shops is not opening the first one. Auto-opening put a
        // Back control on Home while the street was still the screen.
        setSpaceError('');
      } else {
        if (!shopIdFromHash(window.location.hash)) {
          activeSpaceIdRef.current = '';
          setActiveSpace(null);
        }
        setSpaceError(res.ok ? '' : res.error);
      }
    } catch {
      activeSpaceIdRef.current = '';
      setActiveSpace(null);
      setSpaceError('Could not load your spaces. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Deep link detection on mount / URL change
  useEffect(() => {
    loadSpaces();
    briefApi.whoAmI().then(async (res) => {
      setAuthed(res.ok);
      setCanModerate(res.ok && Boolean(res.data?.capabilities?.includes('moderate')));
      // First-run onboarding: a signed-in member with NO table-banking group
      // yet gets a guided checklist instead of a passive dashboard. Derived
      // from real rows (getMyTableBanking), dismissible once, never re-shown
      // after they dismiss it or once a group exists.
      if (res.ok && !firstRunChecked && typeof window !== 'undefined' && !window.localStorage.getItem('brief.firstRunDismissed')) {
        setFirstRunChecked(true);
        const tb = await briefApi.getMyTableBanking();
        if (tb.ok && tb.data.length === 0) setFirstRun(true);
      }
    });

    const navigate = () => {
      const hash = window.location.hash.slice(1);
      setModerationOpen(hash === 'moderation');
      if (hash === 'moderation') return;
      // An overlay's own hash: exactly the named one is open. This is the branch
      // the back gesture lands on, and it is the only place an overlay closes.
      const surface = surfaceFromHash(hash);
      if (surface) {
        setCreateOpen(surface === 'create');
        setHostSheetOpen(surface === 'host');
        setGroupBuysOpen(surface === 'groupbuys');
        setSheetOpen(surface === 'menu');
        setCreateFlowOpen(surface === 'new-space');
        setManualOrderOpen(surface === 'manual-order');
        return;
      }
      if (hash === 'storefront') {
        setStorefrontOpen(true);
        return;
      }
      const shopId = shopIdFromHash(hash);
      if (shopId) {
        if (activeSpaceIdRef.current !== shopId) void openSpaceRef.current(shopId);
        return;
      }
      // Anything else — a tab, or no hash at all — is a different screen, so
      // nothing that covers a screen stays open behind it. This is also what
      // closes a shop when the back gesture steps off `#shop/<id>`: the URL and
      // the screen are never allowed to disagree about which one is showing.
      setCreateOpen(false);
      setHostSheetOpen(false);
      setGroupBuysOpen(false);
      setSheetOpen(false);
      setCreateFlowOpen(false);
      setManualOrderOpen(false);
      setStorefrontOpen(false);
      if (spaceLinkRef.current) setSpaceLink('');
      if (activeSpaceIdRef.current) {
        activeSpaceIdRef.current = '';
        setActiveSpace(null);
      }
      if (hash === 'supply' || hash.startsWith('supply/')) {
        setActiveTab('supply');
        setSupplyRoute(hash.slice(7) || 'mine');
      } else if (hash === 'requests' || hash.startsWith('requests/')) {
        setActiveTab('requests');
        try { setRequestRoute(decodeURIComponent(hash.slice(9))); } catch { setRequestRoute('invalid'); }
      } else if (hash.startsWith('space/')) {
        try { setSpaceLink(decodeURIComponent(hash.slice(6))); } catch { setSpaceLink(''); }
      } else if (hash.startsWith('join/')) {
        try { setJoinCode(decodeURIComponent(hash.slice(5))); } catch { setJoinCode(''); }
      } else if (hash.startsWith('offer/')) {
        // Sellers copy this link from their catalog. It resolves to the real
        // public offer view — for a signed-in buyer, because ordering needs a
        // session. It is not presented as an anonymous storefront link.
        try { setOfferLinkId(decodeURIComponent(hash.slice(6))); } catch { setOfferLinkId('invalid'); }
      } else if (hash === 'search' || hash.startsWith('search/')) {
        // #search/<term> is a real surface: it renders /api/search's answer.
        // An empty term clears it rather than showing an empty results card.
        const term = hash === 'search' ? '' : decodeURIComponent(hash.slice(7));
        setSearchQuery(term);
        setEntityId(null);
      } else if (hash === 'entity' || hash.startsWith('entity/')) {
        const id = decodeURIComponent(hash.slice(7));
        if (id) { setEntityId(id); setActiveTab('you'); }
      } else if (hash === 'you' || hash.startsWith('you/')) {
        setJoinCode('');
        setSearchQuery('');
        setEntityId(null);
        setActiveTab('you');
        tabHashRef.current = hash.startsWith('you/') ? hash : 'you';
        let rest = '';
        if (hash.startsWith('you/')) {
          try { rest = decodeURIComponent(hash.slice(4)); } catch { rest = hash.slice(4); }
        }
        setYouSection((YOU_SECTION_IDS as string[]).includes(rest) ? rest : null);
        setBriefOpen(false);
      } else if (hash === 'spaces' || hash === 'shopbrief') {
        // The morning brief is a notification, not a Mine shelf. Tapping it
        // opens the read once; closing returns to Mine.
        setJoinCode('');
        setSearchQuery('');
        setEntityId(null);
        setActiveTab('mine');
        tabHashRef.current = 'mine';
        setBriefOpen(true);
      } else if (hash === 'city' || hash.startsWith('city/') || hash === 'discover' || hash === 'events') {
        // Events and Circles are rooms of the board, not aliases of Errands.
        // `#city/events` and `#city/circles` are the hashes Home's tiles write.
        setJoinCode('');
        setSearchQuery('');
        setEntityId(null);
        setActiveTab('city');
        const CITY_ROOMS: DiscoverRoom[] = ['all', 'bulk', 'direct', 'niche', 'group', 'events', 'circles', 'errands', 'shops'];
        let room: DiscoverRoom = 'all';
        if (hash.startsWith('city/')) {
          const rest = hash.slice(5);
          if (rest === 'groups') room = 'circles';
          else if ((CITY_ROOMS as string[]).includes(rest)) room = rest as DiscoverRoom;
        } else if (hash === 'events') {
          room = 'events';
        }
        setDiscoverSubTab(room);
        if (room !== 'errands') setErrandSignal(null);
        tabHashRef.current = hash === 'discover' ? 'city' : hash;
        setBriefOpen(false);
      } else if (hash === '' || (hash && hash !== 'join')) {
        setJoinCode('');
        setSearchQuery('');
        // 'activity' is the old bar's fourth door: its surface now lives in the
        // drawer's check-in, so the legacy hash resolves there. 'mine' and
        // 'pulse' are the new bar's doors and the drawer's check-in.
        const tabs: Record<string, BriefNavigationTab> = { home: 'home', spaces: 'mine', pipeline: 'pipeline', catalog: 'catalog', activity: 'pulse', mine: 'mine', pulse: 'pulse', ledger: 'ledger', partners: 'partners', you: 'you' };
        if (tabs[hash]) { setEntityId(null); setActiveTab(tabs[hash]); tabHashRef.current = hash; setBriefOpen(false); }
        else if (!hash) {
          // Empty hash IS home. Mapping it to `initialTab` (once 'city') made
          // the Home door — which writes hash '' — open Discover. A person
          // tapping Home then saw the board, and the board painted first on
          // a cold load. Home is the door labelled Home.
          setActiveTab('home');
          tabHashRef.current = 'home';
        }
      }
    };
    navigate();
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, [initialSpaceId, initialTab]);

  // The copied #offer/<id> link is answered by reading the listing from the
  // server. A 404 or a signed-out visitor is reported, not papered over.
  useEffect(() => {
    if (!offerLinkId) return;
    let live = true;
    if (offerLinkId === 'invalid') {
      showToast('That offer link is not a valid offer id.');
      setOfferLinkId('');
      return;
    }
    void briefApi.getListing(offerLinkId).then((res) => {
      if (!live) return;
      if (res.ok) {
        setActivePublicOffer(res.data);
        setPublicOfferModalOpen(true);
      } else {
        showToast(res.status === 401
          ? 'Sign in to open that offer — offer links are not anonymous pages yet.'
          : res.error ?? 'That offer is no longer available.');
      }
      if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname + window.location.search);
      setOfferLinkId('');
    });
    return () => { live = false; };
  }, [offerLinkId]);

  const handlePublishOffer = async (offerId: string) => {
    if (!activeSpace) return;
    try {
      const res = await briefApi.publishSpaceOffer(activeSpace.id, offerId);
      if (res.ok) {
        showToast('Offer published to catalog!');
        loadSpaces();
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to publish offer');
    }
  };

  // Contextual FAB triggers based on active tab
  const handleCreateManualOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSpace || !manualCustomerName.trim()) return;

    soundEngine.play('reward');
    try {
      const convRes = await briefApi.createSpaceConversation(activeSpace.id, {
        customerName: manualCustomerName.trim(),
        // Blank is blank. A contact is what the seller was given, and a recorded
        // walk-in with no number is a real, ordinary state — not a number to invent.
        customerContact: manualCustomerPhone.trim(),
        message: `Walk-in inquiry for ${manualItemTitle.trim() || 'Custom Order'}`
      });

      if (!convRes.ok) {
        // A silent failure here means the seller believes the walk-in is in the
        // book when nothing was written.
        showToast(convRes.error ?? 'The enquiry was not recorded.');
        return;
      }
      if (convRes.data?.conversation) {
        const conv = convRes.data.conversation;
        let quoted = false;
        if (manualPrice && Number(manualPrice) > 0) {
          const q = await briefApi.createSpaceQuote(activeSpace.id, conv.id, {
            title: manualItemTitle.trim() || 'Custom Order',
            priceKes: Number(manualPrice),
            notes: 'Walk-in customer order'
          });
          quoted = q.ok;
          if (!q.ok) showToast(`Enquiry recorded, but the quote was refused: ${q.error ?? 'unknown reason'}`);
        }
        // Not "Order created": what exists now is an enquiry, and maybe a quote.
        // An order is what the customer agrees to, and the ledger will say so.
        if (!quoted && !(manualPrice && Number(manualPrice) > 0)) {
          showToast(`Enquiry recorded for ${manualCustomerName.trim()}. No order yet.`);
        }
        setManualCustomerName('');
        setManualCustomerPhone('');
        setManualItemTitle('');
        setManualPrice('');
        setManualOrderOpen(false);
        loadSpaces();
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to create order');
    }
  };

  // First-run onboarding: a signed-in member with no group yet is intercepted
  // by a guided checklist (the "dedicated onboarding state" similar apps use).
  // "Start your group" drops them into the You tab, where the group flow lives;
  // "Skip for now" is remembered so they are never nagged again.
  if (firstRun) {
    return (
      <div className="min-h-screen w-full bg-[color:var(--color-bg)] text-[color:var(--color-text)] font-sans flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <FirstRunChecklist
            groups={[]}
            onStartGroup={() => {
              setFirstRun(false);
              setActiveTab('you');
              if (typeof window !== 'undefined') window.location.hash = '#you';
            }}
            onDismiss={() => {
              if (typeof window !== 'undefined') window.localStorage.setItem('brief.firstRunDismissed', '1');
              setFirstRun(false);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <React.Suspense fallback={<p role="status">Opening workspace…</p>}>
    <div className={`storefront-room min-h-screen w-full bg-[color:var(--color-bg)] text-[color:var(--color-text)] font-sans flex ${className}`}>
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-[color:var(--color-text)] text-white text-xs font-bold shadow-2xl animate-fadeIn border border-white/10">
          {toastMsg}
        </div>
      )}

      {/* Persistent, honest sync status: the offline queue's state, not a
          fake "synced". */}
      <div className="fixed top-3 right-3 z-40 md:top-4 md:right-4">
        <SyncStatusDot />
      </div>

      {/* Three doors and one action (Desktop Sidebar / Mobile Bottom Bar) */}
      <Navigation
        activeTab={activeTab}
        onSelectTab={(tab) => setActiveTab(tab)}
        onOpenCreate={() => setCreateOpen(true)}
        spaceName={activeSpace?.name || 'Your Trace'}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 min-w-0 px-4 sm:px-6 pt-0 pb-44 md:pb-8 overflow-y-auto min-h-screen">
        {/* The band: a location, a search that resolves, a hamburger that owns
            the long list, and a message slot. It lives inside the scroll
            column so it behaves the same on a phone and on a desktop. */}
        <AppBelt
          backTo={backTo}
          onOpenSheet={() => setSheetOpen(true)}
          onHome={() => { window.location.hash = 'home'; setActiveTab('home'); }}
          onSearch={(term) => { window.location.hash = `search/${encodeURIComponent(term)}`; }}
          className="-mx-4 sm:-mx-6 mb-3"
        />
        {activeTab === 'requests' ? <RequestsWorkspace route={requestRoute} /> : activeTab === 'supply' ? <SupplyWorkspace route={supplyRoute || 'mine'} /> : null}
        {/* SPACES with no space open is the STREET: the shopfronts you operate
            and the ones you follow. Circles and vaults are not here — belonging
            and filing are different nouns from operating a business. */}
        {/* The street of shops is Mine. Home → Shops and the Mine door are
            the same shelf, so there is no second SpacesLanding to hunt through
            for Create space. A shop still opens at #shop/<id>. */}

        {/* A shared space link resolves here, and only here does a view row get
            written — so the vendor's view count means page openings. */}
        {spaceLink && (
          <div className="fixed inset-0 z-40 bg-[color:var(--color-bg)] overflow-y-auto p-4 pb-24">
            <PublicSpacePage
              slug={spaceLink}
              onBack={() => {
                setSpaceLink('');
                const back = tabHashRef.current || 'spaces';
                if (window.location.hash.replace(/^#/, '') === back) window.location.hash = `${back}`;
                else window.location.hash = back;
              }}
              onOpenOffer={(id) => { window.location.hash = `offer/${encodeURIComponent(id)}`; }}
            />
          </div>
        )}
        {/* The e-commerce storefront — a full-screen view of the street. */}
        {storefrontOpen && (
          <div className="fixed inset-0 z-40 bg-[color:var(--color-bg)] overflow-y-auto">
            <React.Suspense fallback={<p className="p-6 text-sm">Loading the street…</p>}>
              <MarketStorefront onBack={() => { setStorefrontOpen(false); window.location.hash = 'home'; }} />
            </React.Suspense>
          </div>
        )}
        {['ledger', 'catalog'].includes(activeTab) && !activeSpace && (
          <section className="max-w-3xl mx-auto py-12">
            <h2 className="text-xl font-bold">{loading ? 'Loading your workspace…' : 'A space for what you offer'}</h2>
            {spaceError ? <><p role="alert" className="my-4">{spaceError}</p><button onClick={loadSpaces}>Retry</button><button className="ml-4 underline" onClick={() => requestPath()}>Sign in through My Requests</button></> : !loading && <><p className="my-4">No business space yet. Create a Request to describe what you need, or create a space for what you sell.</p><button className="px-4 py-3 rounded-xl bg-[color:var(--color-primary)] text-[color:var(--accent-ink)]" onClick={() => { setCreateFlowInitialStep(1); setCreateFlowOpen(true); }}>Create a space</button></>}
          </section>
        )}
        {/* Legacy Home Surface Compatibility for tests */}
        {activeTab === 'home' ? (
          <HomeSurface
            userName="there"
            onOpenSpace={openSpace}
            onExploreDiscover={(sub, startRun) => {
              const room = sub ?? 'all';
              setDiscoverSubTab(room);
              if (startRun) {
                const nextNonce = signalCounter + 1;
                setSignalCounter(nextNonce);
                setErrandSignal({ nonce: nextNonce, kind: 'delivery' });
              } else if (room !== 'errands') {
                setErrandSignal(null);
              }
              setActiveTab('city');
              window.location.hash = room === 'all' ? 'city' : `city/${room}`;
            }}
            onOpenPulse={() => { setActiveTab('pulse'); window.location.hash = 'pulse'; }}
            onOpenSpaces={() => { setActiveTab('mine'); window.location.hash = 'mine'; }}
            onOpenGroupBuys={() => setGroupBuysOpen(true)}
            onGetPaid={() => setActiveTab('ledger')}
            onOpenHow={() => { window.location.hash = 'you/how'; }}
            onOpenEarn={() => { window.location.hash = 'you/earn'; }}
          />
        ) : (
          <div>
            {/* ── CITY (the board: what's happening nearby) ── */}
            {(activeTab === 'city' || activeTab === 'discover') && (
              <CityFeedView
                key={discoverSubTab}
                initialSubTab={discoverSubTab}
                sellingSignal={sellingNonce}
                errandSignal={errandSignal}
                onOpenSpace={(id) => openSpace(id)}
              />
            )}

            {/* ── TAB 2: SPACES (the full workspace: build, sell, track) ── */}
            {(activeTab === 'pipeline' || activeTab === 'spaces') && activeSpace && (
              <SpaceShell
                spaceId={activeSpace.id}
                onBack={closeSpace}
                onShare={() => { /* SpaceShell copies and reports the truth itself */ }}
                onCreateOrder={() => setManualOrderOpen(true)}
              />
            )}

            {/* ── PULSE (the drawer's check-in: the world's numbers + your
                   activity. The old bar's Activity door resolves here.) ── */}
            {activeTab === 'pulse' && (
              <PulseSurface onOpenRequests={() => requestPath()} />
            )}

            {/* ── MINE (the bar's second door: your shops, orders, saved) ── */}
            {(activeTab === 'mine' || ((activeTab === 'pipeline' || activeTab === 'spaces') && !activeSpace)) && (
              <MineSurface
                onOpenSpace={openSpace}
                onOpenCreateSpace={() => {
                  setCreateFlowInitialStep(1);
                  setCreateFlowOpen(true);
                }}
                onOpenEntity={(id) => { setEntityId(id); setActiveTab('you'); window.location.hash = `entity/${id}`; }}
                onRequireAuth={() => showToast('Sign in to continue.')}
                sellingSignal={mineSellingNonce}
              />
            )}

            {/* ── OPERATOR: PARTNER DESK (distribution partners) ── */}
            {activeTab === 'partners' && <PartnerDesk />}

            {/* ── YOU (profile, follows, subscriptions) ── */}
            {activeTab === 'you' && (
              entityId ? (
                <EntityDetail
                  entityId={entityId}
                  authed={authed}
                  onClose={() => { setEntityId(null); window.location.hash = '#you'; }}
                  onRequireAuth={() => showToast('Sign in to follow entities.')}
                />
              ) : (
                <YouSurface
                  openSection={(youSection as YouSection | null) ?? null}
                  onOpenSection={(s) => { window.location.hash = s ? `you/${s}` : 'you'; }}
                  onOpenEntity={(id) => { setEntityId(id); window.location.hash = `#entity/${id}`; }}
                  onRequireAuth={() => showToast('Sign in to continue.')}
                />
              )
            )}

            {/* ── TAB 3: LEDGER (Financial Truth) ── */}
            {activeTab === 'ledger' && activeSpace && (
              <SpaceMoney
                spaceId={activeSpace.id}
                revenueKes={activeSpace.metrics?.revenueKes}
                pendingKes={0}
                ordersCount={activeSpace.metrics?.totalOrdersCount}
                onViewLedger={() => showToast('Opening ledger')}
              />
            )}

            {/* ── TAB 4: CATALOG (What You Sell) ── */}
            {activeTab === 'catalog' && activeSpace && (
              <CatalogView
                offers={activeSpace.offers}
                onAddOffer={() => {
                  setCreateFlowInitialStep(2);
                  setCreateFlowOpen(true);
                }}
                onPublishOffer={handlePublishOffer}
                onShareOffer={(o) => {
                  setActivePublicOffer(o);
                  setPublicOfferModalOpen(true);
                }}
                onOfferStatus={async (id, next) => {
                  const res = await briefApi.setListingStatus(id, next as any);
                  if (!res.ok) return res.error ?? 'That move was refused.';
                  loadSpaces();
                  return null;
                }}
                onSaveOffer={async (id, patch) => {
                  const res = await briefApi.updateListing(id, patch);
                  if (!res.ok) return res.error ?? 'Could not save that offer.';
                  loadSpaces();
                  return null;
                }}
              />
            )}
          </div>
        )}
      </main>


      {/* Manual Order Drawer on Pipeline FAB */}
      {manualOrderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-[color:var(--color-paper)] rounded-3xl shadow-2xl overflow-hidden p-6 space-y-4 border border-black/5 animate-scaleIn">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-black uppercase tracking-wider text-[color:var(--color-primary)]">
                  Quick Manual Order
                </span>
                <h3 className="text-base font-black text-[color:var(--color-text)]">New Walk-in Customer</h3>
              </div>
              <button
                type="button"
                onClick={() => setManualOrderOpen(false)}
                className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleCreateManualOrder} className="space-y-3">
              <input
                type="text"
                placeholder="Customer Name (e.g. John Kamau)"
                value={manualCustomerName}
                onChange={(e) => setManualCustomerName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[color:var(--color-surface)] text-xs border border-black/5 focus:outline-none"
                required
              />
              <input
                type="tel"
                placeholder="WhatsApp Phone (e.g. 0712345678)"
                value={manualCustomerPhone}
                onChange={(e) => setManualCustomerPhone(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[color:var(--color-surface)] text-xs border border-black/5 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Item Title (e.g. Birthday Cake)"
                  value={manualItemTitle}
                  onChange={(e) => setManualItemTitle(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-[color:var(--color-surface)] text-xs border border-black/5 focus:outline-none"
                />
                <input
                  type="number"
                  placeholder="Price (KES)"
                  value={manualPrice}
                  onChange={(e) => setManualPrice(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-[color:var(--color-surface)] text-xs border border-black/5 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-2xl bg-[color:var(--color-text)] hover:bg-black text-[color:var(--color-primary)] text-xs font-black shadow-md transition-all cursor-pointer"
              >
                Create Pipeline Order
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Unified Progressive Create Flow Modal */}
      {createFlowOpen && (
        <CreateFlowModal
          isOpen={createFlowOpen}
          initialStep={createFlowInitialStep}
          existingSpaceId={activeSpace?.id}
          onClose={() => setCreateFlowOpen(false)}
          onCompleted={(space) => {
            // Through openSpace, not just setActiveSpace: the screen you land on
            // has to be the screen the URL says, or the first back press leaves
            // you inside a space the address bar has never heard of.
            openSpace(space.id);
            showToast(`Space "${space.name}" active!`);
            void loadSpaces();
          }}
        />
      )}

      {/* A shared join link, opened cold, before an account exists. */}
      {joinCode && (
        <div className="fixed inset-0 z-[60] overflow-y-auto px-4 py-6" style={{ background: 'var(--color-bg)' }}>
          <JoinRoom
            code={joinCode}
            signedIn={authed}
            onRequireAuth={() => showToast('Sign in or create an account to join a room.')}
            onOpenCircles={() => { setJoinCode(''); setDiscoverSubTab('circles'); window.location.hash = 'city/circles'; setActiveTab('city'); }}
          />
        </div>
      )}

      {/* The one action: the create sheet. A verb, not a route — it closes
          the moment a pick has landed somewhere that writes a row. */}
      <CreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onPick={pickCreate}
      />

      {/* "Host an event": the real createCampaign → publish loop, owned by the
          sheet that opened it rather than by the one screen it used to float on. */}
      <HostEventSheet
        open={hostSheetOpen}
        onClose={() => setHostSheetOpen(false)}
        onPublished={(title) => showToast(`"${title}" is published and on the board.`)}
      />

      {/* "Group buys": the portal overlay, openable from Home's tile and the
          drawer, closed from inside. */}
      {groupBuysOpen && (
        <div className="fixed inset-0 z-[70] overflow-y-auto p-4 pb-24" style={{ background: 'var(--color-bg)' }} role="dialog" aria-modal="true" aria-label="Group buys">
          <GroupBuyPortal onClose={() => setGroupBuysOpen(false)} />
        </div>
      )}

      {/* The long list of destinations, held in one place so the band above
          stays short and the screens below stay uncluttered. */}
      {moderationOpen && <OverlayScreen title="Page moderation" onBack={() => { setModerationOpen(false); window.location.hash = activeTab; }}>{canModerate ? <SpaceModerationPanel /> : <p>This page requires the moderate capability. Sign in as an authorized reviewer.</p>}</OverlayScreen>}

      <NavSheet
        canModerate={canModerate}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        place={place}
        onSetPlace={(next) => {
          setPlace(next);
          try {
            if (next) window.localStorage.setItem(PLACE_KEY, next);
            else window.localStorage.removeItem(PLACE_KEY);
          } catch {
            showToast('This browser will not store the area, so the forecast stays on the default.');
          }
        }}
        onGo={(target) => goSheetTarget(target)}
      />

      {/* #search/<term>: the belt's box resolves here, on the real /api/search
          surface. A view that nothing can reach would have been a decoration,
          and a decoration in a search box is the fastest way to teach someone
          that the numbers on this app are also decorative. */}
      {searchQuery && (
        <div className="fixed inset-0 z-[60] overflow-y-auto px-4 py-6" style={{ background: 'var(--color-bg)' }} role="dialog" aria-modal="true" aria-label={`Search results for ${searchQuery}`}>
          <div className="max-w-2xl mx-auto space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                Search · {searchQuery}
              </p>
              <button
                type="button"
                onClick={() => { window.location.hash = ''; setSearchQuery(''); }}
                className="text-[12px] font-bold underline cursor-pointer"
                style={{ color: 'var(--color-primary)' }}
              >
                Back to the app
              </button>
            </div>
            <SearchResults
              query={searchQuery}
              onOpenObject={(o) => {
                // Objects open where the shell already shows an object: the
                // entity page. Anything without an id is left unclickable
                // rather than wired to a view that would show nothing.
                const id = o?.id ?? o?.objectId ?? null;
                if (!id) return;
                setSearchQuery('');
                window.location.hash = `entity/${encodeURIComponent(String(id))}`;
              }}
              onOpenEntity={(entityId) => {
                setSearchQuery('');
                window.location.hash = `entity/${encodeURIComponent(entityId)}`;
              }}
            />
          </div>
        </div>
      )}

      {briefOpen && (
        <OverlayScreen title="The morning brief" onBack={() => { setBriefOpen(false); window.location.hash = 'mine'; }}>
          <ShopBrief onOpenSpace={(id) => { setBriefOpen(false); openSpace(id); }} />
        </OverlayScreen>
      )}

      {/* Customer-Facing Public Offer View */}
      {publicOfferModalOpen && activePublicOffer && (
        <PublicOfferModal
          isOpen={publicOfferModalOpen}
          offer={activePublicOffer}
          spaceName={activeSpace?.name ?? 'Wairo seller'}
          onClose={() => setPublicOfferModalOpen(false)}
          onInquirySent={() => showToast('Inquiry submitted to seller!')}
        />
      )}
    </div>
    </React.Suspense>
  );
};

export default AppShell;
