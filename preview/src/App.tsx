import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import * as briefApi from './api/briefApi';
import {
  parsePath,
  toPath,
  objectShareUrl,
  isBriefRoute,
  explorePath,
  collectionPath,
  DEFAULT_ROUTE,
  type BriefRoute
} from './nav/routes';

import QRCode from 'qrcode';
import { deriveDestinationAlerts, readLastSeen, writeLastSeen, alertLabel, type DestinationAlerts } from './nav/alerts';
import { EntityPage } from './components/EntityPage';
import { FollowingSurface } from './components/FollowingSurface';
import { NotificationCenter } from './components/NotificationCenter';
import { LocationPage } from './components/LocationPage';
import { RelatedContent } from './components/RelatedContent';
import { CollectionsSurface } from './components/CollectionsSurface';
import { CollectionPage } from './components/CollectionPage';
import { CollectionPicker } from './components/CollectionPicker';
import { EntityChip } from './components/EntityChip';
import { CampaignDistribution } from './components/CampaignDistribution';
import { AwaitingPayment } from './components/AwaitingPayment';
import { SourcesPanel } from './components/SourcesPanel';
import { ConnectedGroups } from './components/ConnectedGroups';
import { MoneyPanel } from './components/MoneyPanel';
import { ResaleDesk } from './components/ResaleDesk';
import { MyTickets } from './components/MyTickets';
import { EventsHub } from './components/EventsHub';
import { MshikanoDesk } from './components/MshikanoDesk';
import { VerificationPanel } from './components/VerificationPanel';
import { Vault } from './components/vault/Vault';
import ServiceFees from './components/ServiceFees';
import { WhatsAppShopBuilder } from './components/WhatsAppShopBuilder';
import RewardsDesk from './components/RewardsDesk';
import { CheckIn } from './components/CheckIn';
import { HostCommand } from './components/HostCommand';
import { TickerBanner, PromptBanner } from "./components/SignalBanner";
import { ActionsEngine } from './components/ActionsEngine';
import { Circles } from './components/Circles';
import { Marketplace } from './components/Marketplace';
import { Pursuits } from './components/Pursuits';
import { Inbox } from './components/Inbox';
import { TriageQueue } from './components/TriageQueue';
import { Quests } from './components/Quests';
import { LocationChip } from './components/LocationChip';
import type { GeoPoint } from './components/LocationChip';
import { MainShelf } from './components/MainShelf';
import { Onboarding } from './components/Onboarding';
import { NextStep } from './components/NextStep';
import { isSurfaceUnlocked, shouldOpenFirstRun, showsLadder, unlockHint } from './components/ladder';
import { WairoBookmark, WairoFloatingWidget } from './components/ui';
import { arrivalSource, linkTokenFrom, urlWithoutArrivalParams, type ArrivalChannel } from './components/arrival';
import { EnginePanel } from './components/EnginePanel';
import { GroupBuyPortal } from './components/GroupBuyPortal';
import { TicketBar } from './components/TicketBar';

import { FeedComposer } from './components/FeedComposer';
import { WireSection } from './components/WireSection';
import { TeaDesk } from './components/TeaDesk';
import { CreatorCockpit } from './components/CreatorCockpit';
import { CreatorProfilePanel, OpportunitiesPanel, MessagesPanel, SubscriptionsPanel } from './components/CreatorPanels';
import { SearchResults } from './components/SearchResults';
import { YardEngineDesk } from './components/YardEngineDesk';
import type { YardSection } from './components/YardEngineDesk';
import { TeaReader } from './components/TeaReader';
import type { CircleDetail as ApiCircleDetail } from './api/briefApi';
import type {
  Campaign as ApiCampaign,
  CampaignType as ApiCampaignType,
  PublicCampaign as ApiPublicCampaign,
  Registration as ApiRegistration
} from './api/types';
import {
  Building2,
  Search,
  Sparkles,
  FolderPlus,
  Plus,
  Terminal,
  Activity,
  MapPin,
  Users,
  Briefcase,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Bookmark,
  Share2,
  Bell,
  Flag,
  MoreHorizontal,
  Clock,
  Tag,
  Megaphone,
  AlertTriangle,
  BadgePercent,
  Globe,
  Trash2,
  Circle,
  Award,
  TrendingUp,
  User,
  Store,
  Landmark,
  Sun,
  Sunset,
  CalendarDays,
  Newspaper,
  Heart,
  MessageCircle,
  ExternalLink,
  Eye,
  X,
  Menu,
  ChevronLeft
} from 'lucide-react';
import { MenuSheet } from './components/MenuSheet';
import { AdminDesk } from './components/AdminDesk';
import type { MenuTarget } from './components/MenuSheet';

import type { LucideIcon } from 'lucide-react';
import {
  ROOM, HOME_MORE, SAVED_TABS, INBOX_TABS, FILTERS,
  WORKFLOW_BUNDLES, SAVED_BUNDLES, QUEUE_LABEL, QUEUE_CHIP, QUEUE_HINT
} from './ui/names';
import { MoneyBand } from './components/MoneyBand';
import { MyLayerScreen } from './screens/MyLayerScreen';
import { NearbyScreen } from './screens/NearbyScreen';
import { WorkflowsScreen } from './screens/WorkflowsScreen';
import { OverlaysShell } from './screens/OverlaysShell';
import { StatusToasts, DesktopRail, DockNav } from './shell/Chrome';
import { useTuning } from './shell/hooks/useTuning';
import { useAlertsPulse } from './shell/hooks/useAlertsPulse';
import { useSessionBoot } from './shell/hooks/useSessionBoot';
import { useSessionLocation } from './shell/hooks/useSessionLocation';
import { useProtocolActions } from './shell/hooks/useProtocolActions';
import { useBriefItFlow } from './shell/hooks/useBriefItFlow';
import { useGroupsDesk } from './shell/hooks/useGroupsDesk';
import { useQuestsAndRewards } from './shell/hooks/useQuestsAndRewards';
import { useDiscoveryFeed } from './shell/hooks/useDiscoveryFeed';
import { useWatchAndShare } from './shell/hooks/useWatchAndShare';
import { usePersonalLayer } from './shell/hooks/usePersonalLayer';
import { useIngestionDesk } from './shell/hooks/useIngestionDesk';
import { useCaptureFlow } from './shell/hooks/useCaptureFlow';
import { useCampaignHub } from './shell/hooks/useCampaignHub';
import { ALL_GROUPS, ActivityDot, DESTINATIONS, DESTINATION_ICONS, DESTINATION_STATE_LABELS, EXPLICIT_LINK_FLOOR, GROUP_MESSAGES, INITIAL_JOURNEYS, INITIAL_OBJECTS, INITIAL_POSTS, INITIAL_QUESTS, INITIAL_SOURCES, REPORT_REASONS, REWARD_CATALOGUE, SAVE_LABELS, TEA_EDITIONS, areTypesAffine, bootRoute, briefWhenLabel, buildCaptureMessage, buildDailyBrief, buildDiscoveryBrief, buildGroupIndex, buildKeyFacts, buildMapsHref, buildPersonalSections, buildTelHref, campaignSlugFromPath, canRedeem, canUserAccessGroup, countKeywordOverlap, createBriefGraph, createPursuit, diffObjects, entityChipsFor, extractTitle, formatCount, formatSourceDate, getActionNote, getAppearanceReasons, getBriefRank, getCardLevel, getCorroborationLabel, getCurrentEdition, getDestinationAccess, getDestinationState, getDestinationVendors, getDistanceLabel, getEditionMeta, getFreshness, getKeywords, getLifecycleBadge, getNextRankRequirement, getObjectTypeMeta, getPivotMessage, getPostKindMeta, getPublishedLine, getReasonChip, getRelatedHeading, getRelativeTime, getSourceChip, getSourceHealth, getSourceHealthLabel, getSourceKindChip, getSuggestedActions, getUnansweredQuestions, getVendorDestinations, getVendorOfferings, isDestinationObject, matchPursuit, objectFromServer, parseInboundMessage, resolveAction, runGroupCommand, scoreObjectForPhrase, summariseContribution } from "./model/core";
import type { BriefObject, BriefPost, CandidateStatus, ConnectedSource, Destination, FlowState, GroupAccess, GroupCommandResult, GroupKnowledgeEntry, IngestionCandidate, Journey, MyLayerSection, NearbySection, ObjectRelationship, ObjectType, ProtocolAction, Pursuit, PursuitMatch, PursuitStatus, Quest, QuestStatus, RelationReason, Reward, SaveLabel, ScoredRelation, Source, SourceType, TeaEdition, WatchCondition, WorkflowSection } from "./model/core";
// Public surface preserved: components import these names from '../App'.
export * from './model/core';

export function App() {
  // Public campaign links open the public page, not the app shell. Checked
  // once at render: a stranger with a link is not a Brief user.
  const publicSlug =
    typeof window !== 'undefined' && window.location
      ? campaignSlugFromPath(window.location.pathname)
      : null;
  const [objects, setObjects] = useState<BriefObject[]>(INITIAL_OBJECTS);
  const [journeys, setJourneys] = useState<Journey[]>(INITIAL_JOURNEYS);
  // Derived, never stored. Nothing can set a civic metric by hand.
  // My Activity starts empty. The two seeded relationships claimed the user
  // had "discovered" and "engaged with" specific objects they had never seen
  // -- a fabricated claim about the person using Brief, and one that pointed
  // at seed objects that no longer exist. Relationships are created by real
  // interaction from here on.

  const [posts] = useState<BriefPost[]>(INITIAL_POSTS);
  const [activeEdition, setActiveEdition] = useState<TeaEdition>(() =>
    getCurrentEdition()
  );

  const [activeTab, setActiveTab] = useState<Destination>(bootRoute.dest);
  const [homeFeedStatus, setHomeFeedStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [nearbySection, setNearbySection] = useState<NearbySection>(bootRoute.nearby);
  // The discovery experience navigation: Home, Events, Explore, Offers,
  // Places, News, Opportunities. Categories only appear when the real data
  // has meaningful rows for them.
  // --- Personal Brief ----------------------------------------------------
  // The personal layer is the same object store re-ranked per user: we keep
  // the server's ORDERED ids plus the per-row boost, and map them onto the
  // existing `objects` list — never a second object store on the client.
  const [personalFeedIds, setPersonalFeedIds] = useState<string[] | null>(null);
  const [personalBoostMap, setPersonalBoostMap] = useState<Record<string, { boost: number; reasons: string[] }>>({});
  // Onboarding is optional and never blocks: skipping just closes the card.
  const [personalBriefDismissed, setPersonalBriefDismissed] = useState(false);
  const [personalBusy, setPersonalBusy] = useState(false);
  const [personalPicks, setPersonalPicks] = useState<{ locations: string[]; types: string[]; topics: string[] }>({
    locations: [], types: [], topics: []
  });
  const [myLayerSection, setMyLayerSection] = useState<MyLayerSection>(bootRoute.mylayer);
  const [workflowSection, setWorkflowSection] = useState<WorkflowSection>(bootRoute.workflow);
  // Which bundle each desk is showing is DERIVED from the open section rather
  // than stored: a deep link, a URL change or a notification jump cannot then
  // disagree with the chips, and there is no second source of truth to sync.
  // 'queue' is the landing view: one list of everything waiting on you. A tool
  // is only one tap deeper, filed under the bundle it belongs to.
  const [workflowView, setWorkflowView] = useState<'queue' | 'screen'>(
    bootRoute.workflow !== 'active' ? 'screen' : 'queue'
  );
  const [menuOpen, setMenuOpen] = useState(false);

  // The offline queue drains itself the moment the browser says the signal is
  // back. Server-side idempotency keys make a double-flush harmless.
  React.useEffect(() => {
    const flush = () => { void briefApi.flushOfflineQueue(); };
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, []);
  const [adminOpen, setAdminOpen] = useState(false);

  // --- Onboarding & the service ladder ---------------------------------------
  // The ladder is DERIVED server-side from real rows; the client only holds
  // the answer and decides where it may be shown. Null means "not loaded",
  // which every ladder helper reads as "nothing is locked" — an outage must
  // never turn into a product that refuses to open.
  const arrivalChannel: ArrivalChannel = React.useMemo(
    () =>
      typeof window === 'undefined'
        ? 'browser'
        : arrivalSource(window.location.href, window.navigator?.userAgent ?? ''),
    []
  );

  /** Report a step that leaves no server row of its own. Never blocks the UI. */
  const noteActivation = React.useCallback(
    (name: briefApi.ActivationEventName, meta: Record<string, unknown> = {}) => {
      void briefApi.recordActivation(name, meta).then((res) => {
        if (res.ok) {
          setOnboardingState((prev) => (prev ? { ...prev, ladder: res.data.ladder } : prev));
        }
      });
    },
    []
  );
  const [dockOn, setDockOn] = useState(true);
  const dockLastY = React.useRef(0);

  // --- Ingestion backend (real connectors) ---------------------------------
  // The client holds no tokens. It talks to the ingestion server, which owns
  // every secret. When the server is not running these panels degrade to an
  // explicit "not connected" state rather than pretending. The proxy prefix
  // lives in src/api/briefApi.ts, which is the only place that fetches.



  // --- Objects from the server ----------------------------------------------
  // Brief holds no seeded objects. Everything discoverable arrives from the
  // ingestion pipeline, so this is the only way the stream gets populated.
  // A failure leaves the list empty and records why, rather than substituting
  // placeholder content.

  // --- Session bootstrap -----------------------------------------------------
  // In production the development auth fallback is off and there is no login
  // screen, which made every write (capture, brief-it, confirm) return 401.
  // This silently provisions a real, persisted local account on first run so
  // the whole product is exercisable on the deployed site — a genuine account
  // with a real server session, not a fake. A returning device logs back in.
  /**
   * A device-only account.
   *
   * This used to run silently on every first boot, which meant the very first
   * thing Brief did for a new person was invent an anonymous identity they
   * could never move to another phone. It is now an explicit choice on the
   * first screen: "just look around on this device". Still a real server
   * account with a real session — just one with no email attached to it.
   */



  // What this deployment may honestly offer on the sign-in screen.

  // Onboarding state + ladder follow the session. Signed out, there is
  // nothing to load and nothing to lock.


  // The ladder card renders on the Home stream, and its rungs are derived
  // server-side from REAL rows — a saved object, a confirmed one. Those rows
  // change while the app is open, so the ladder is re-read from the server
  // every time Home comes back into view. getLadder() is exactly that half:
  // the ladder alone, without dragging onboarding state along with it.

  // Seeing a populated feed is the moment Brief has shown its point. Recorded
  // once per session, and only when real rows actually arrived.
  const feedSeenRef = React.useRef(false);
  const {
    authProviders,
    bootstrapSession,
    firstRunOpen,
    nextStepHidden,
    onboardingState,
    provisionGuest,
    refreshOnboarding,
    sessionChecked,
    sessionUser,
    setAuthProviders,
    setFirstRunOpen,
    setNextStepHidden,
    setOnboardingState,
    setSessionChecked,
    setSessionUser,
    ladder,
  } = useSessionBoot({
    activeTab,
    arrivalChannel,
    dockLastY,
    feedSeenRef,
    homeFeedStatus,
    menuOpen,
    noteActivation,
    setDockOn,
  });


  // Attribute the visit to the link that produced it, once, when it was not
  // an ordinary browser.

  // Open the first run only when there is a real reason to: no session, or a
  // session that has never answered the one question and never skipped it.

  // Mobile dock: hide while reading, pull the nub to bring the five tabs back.


  // --- Location & geo --------------------------------------------------------
  // A viewer's coarse position, for "what's around me". Set only by an
  // explicit device-location grant or a manual city tap — never inferred,
  // never fabricated. Null means "everywhere" (the global ranked feed).
  // A named locality scope for the discovery feed (a city or district tap).
  // Null means the feed is geo- or globally scoped, never inferred.


  const chooseCity = React.useCallback((c: GeoPoint) => {
    setLocError(null);
    setUserLocation(c);
    // Named places scope the discovery feed by area (county/area matching),
    // which is far more precise for districts than a raw point + radius.
    setFeedArea(c.area ?? null);
    setSelectedLocation(c.label);
  }, []);





  // Personal Brief: interests, saves, controls and the personal re-ranking.
  // All private to the signed-in user; anonymous callers simply stay global.
  const loadPersonal = React.useCallback(async () => {
    if (!sessionUser) return;
    const [st, fd] = await Promise.all([
      briefApi.getPersonalState(),
      briefApi.getPersonalFeed({ limit: 60 })
    ]);
    if (st.ok) setPersonalState(st.data);
    if (fd.ok) {
      setPersonalFeedIds(fd.data.objects.map((o: any) => o.id));
      const map: Record<string, { boost: number; reasons: string[] }> = {};
      for (const o of fd.data.objects as any[]) {
        map[o.id] = o.personal ?? { boost: 0, reasons: [] };
      }
      setPersonalBoostMap(map);
    }
  }, [sessionUser]);

  React.useEffect(() => { void loadPersonal(); }, [loadPersonal]);

  // Seed server-persisted saves into the client relationship graph — the
  // durable copy, so saves survive across devices. Only ADDS missing edges;
  // the relationship graph stays the single live source for the UI.





  /** Unfollow an entity (venue/business/publisher/organizer/community). */

  /** Open an entity page from a chip or card link. */
  const openEntityPage = (id: string) => {
    setEntityPageId(id);
  };

  /** Open the public location discovery page (/explore/:name). */
  const openLocationPage = (name: string) => {
    setLocationName(name);
  };

  // An explicit relevance control, persisted. Tapping an active control
  // undoes it — the user can always change their mind.



  // Named runBriefItSave, not saveBriefIt: the latter is now the briefApi
  // binding, and shadowing it would be a trap for the next edit.

  // Both navs call this, so selecting a destination behaves identically on
  // desktop and mobile: you land on that destination's main section.
  // --- Destination activity alerts (the red dots on the sidebar titles) ------
  // Derived ONLY from real data: unread notifications (routed by kind) plus
  // public feed items / EPL rooms newer than the last time this viewer
  // opened that destination. First visit baselines silently; unreachable
  // services contribute zero. Never a decorative dot.



  const goToDestination = (id: Destination) => {
    setMenuOpen(false);
    // Opening a destination is the user SEEING it: baseline its freshness
    // clock and drop the dot immediately (notifications keep their own
    // unread state until read on the activity surface).
    writeLastSeen(id, Date.now());
    setDestinationAlerts((prev) => (prev[id] === 0 ? prev : { ...prev, [id]: 0 }));
    setCaptureOpen(false);
    setSelectedTeaSlug(null);
    setOpenCampaignId(null);
    setSelectedObjectForDetailRaw(null);
    setPendingObjectId(null);
    setActiveTab(id);
    if (id === 'nearby') setNearbySection('stream');
    if (id === 'mylayer') setMyLayerSection('saved');
    if (id === 'workflows') {
      setWorkflowSection('active');
      setWorkflowView('queue');
    }
  };
  const [selectedObjectType, setSelectedObjectType] = useState<string>('all');
  const [selectedLocation, setSelectedLocation] = useState<string>('Your area');
  const {
    connectorStatus,
    feedArea,
    loadObjects,
    locError,
    locate,
    locating,
    objectsLoad,
    refreshConnectors,
    setConnectorStatus,
    setFeedArea,
    setLocError,
    setLocating,
    setObjectsLoad,
    setUserLocation,
    userLocation,
  } = useSessionLocation({
    activeTab,
    setObjects,
    setSelectedLocation,
    workflowSection,
  });

  const {
    briefItBusy,
    briefItPreview,
    briefItSaved,
    briefItText,
    runBriefItSave,
    setBriefItBusy,
    setBriefItPreview,
    setBriefItSaved,
    setBriefItText,
  } = useBriefItFlow({
    loadObjects,
    noteActivation,
    refreshConnectors,
  });

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [architectMode, setArchitectMode] = useState<boolean>(false);
  // Seen tracking for the Daily Brief: "New" means genuinely not yet opened.
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

  const [selectedObjectForDetail, setSelectedObjectForDetailRaw] = useState<BriefObject | null>(null);
  /** The object graph (related content) for the open detail modal. */
  const [selectedTeaSlug, setSelectedTeaSlug] = useState<string | null>(bootRoute.teaSlug);
  const [pendingObjectId, setPendingObjectId] = useState<string | null>(bootRoute.objectId);
  /** The followable entity page (venue/business/publisher/organizer/community). */
  const [entityPageId, setEntityPageId] = useState<string | null>(bootRoute.entityId);
  /** The public location discovery page (/explore/:name). */
  const [locationName, setLocationName] = useState<string | null>(bootRoute.locationName);
  /** The Following surface overlay (feed + management). */
  const [followingOpen, setFollowingOpen] = useState(bootRoute.following);
  /** The personal Collections surface overlay. */
  const [collectionsOpen, setCollectionsOpen] = useState(bootRoute.collections);
  /** The in-app notification center overlay (the return loop). */
  const [notificationsOpen, setNotificationsOpen] = useState(bootRoute.notifications);
  /** Unread notification count; only shown when non-zero ("subtle nav entry"). */
  const [notifUnread, setNotifUnread] = useState(0);

  const {
    alertsTick,
    destinationAlerts,
    setDestinationAlerts,
  } = useAlertsPulse({
    setNotifUnread,
  });

  /** A shared collection page opened from /collections/:id. */
  const [collectionRouteId, setCollectionRouteId] = useState<string | null>(bootRoute.collectionId);
  /** "Add to collection" picker open inside the detail modal. */
  const [collectionPickerFor, setCollectionPickerFor] = useState<string | null>(null);

  // Opening an object marks it seen, which is what keeps the Daily Brief's
  // "New" section honest instead of showing the same items forever.
  const setSelectedObjectForDetail = (object: BriefObject | null) => {
    setSelectedObjectForDetailRaw(object);
    setPendingObjectId(object ? object.id : null);
    if (object) {
      setSeenIds((prev) => {
        if (prev.has(object.id)) return prev;
        const next = new Set(prev);
        next.add(object.id);
        return next;
      });
    }
  };
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // The spring-animated empty-state overlay ("Nothing to do here?"). Opened by
  // an explicit trigger so it never covers content unprompted; the physics is
  // the same springIntro curve the design system specifies.
  const [springOverlayOpen, setSpringOverlayOpen] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // ==========================================================================
  // CAMPAIGNS (Creator Campaign Desk)
  //
  // A campaign is a distribution wrapper over an existing Brief object, so
  // this is a VIEW over the backend, not a second product. Everything shown
  // here -- counts, capacity, money -- arrives from the server on each load.
  // There is deliberately no local mutation of any metric: the only way a
  // number changes is a refetch. That is what keeps `82 / 100` honest.
  // ==========================================================================

  // Canonical public origin, from the server. Null until loaded, and null
  // when the deployment has not configured one -- in which case the UI says
  // so instead of inventing a URL from the current browser host.
  const [publicOrigin, setPublicOrigin] = useState<string | null>(null);
  const [runtimeCheck, setRuntimeCheck] = useState<'checking' | 'current' | 'old' | 'unavailable'>('checking');

  // A lightweight release handshake prevents an older API from looking like a
  // broken button later. Old deployments still return the original config, so
  // a missing contract version is a clear "update before testing" signal.
  useEffect(() => {
    let live = true;
    Promise.all([briefApi.getConfig(), briefApi.getRelease()]).then(([config, release]) => {
      if (!live) return;
      if (config.ok) setPublicOrigin(config.data.publicOrigin);
      if (release.ok) {
        setRuntimeCheck(release.data.apiContractVersion === briefApi.CLIENT_API_CONTRACT ? 'current' : 'old');
      } else {
        // A 200 config + missing release endpoint is an older server. If both
        // probes fail, this is connectivity rather than a version mismatch.
        setRuntimeCheck(config.ok ? 'old' : 'unavailable');
      }
    });
    return () => { live = false; };
  }, []);

  const {
    attachObjectToCampaign,
    beginEdit,
    campaignActionError,
    campaignBusy,
    campaignCircle,
    campaignDetail,
    campaignRegs,
    campaignState,
    confirmPayment,
    copyCampaignLink,
    createStep,
    draft,
    editDraft,
    handleRemoveCampaign,
    loadAttachableObjects,
    loadCampaigns,
    objectPicker,
    openCampaign,
    openCampaignId,
    postUpdate,
    publishDraft,
    publishedCampaign,
    saveCampaignEdit,
    setCampaignActionError,
    setCampaignBusy,
    setCampaignCircle,
    setCampaignDetail,
    setCampaignRegs,
    setCampaignState,
    setCreateStep,
    setDraft,
    setEditDraft,
    setObjectPicker,
    setOpenCampaignId,
    setPublishedCampaign,
    setRegStatus,
    setUpdateBody,
    setUpdateBusy,
    setUpdateNote,
    setUpdateTitle,
    shareCampaign,
    submitDraft,
    updateBody,
    updateBusy,
    updateNote,
    updateTitle,
  } = useCampaignHub({
    loadObjects,
    setObjects,
    publicOrigin,
    setPublicOrigin,
    showToast,
  });




  // Create flow. `preview` is a screen, not a stored object: nothing is sent
  // to the server between 'form' and the user pressing Publish.

  // Attachable existing objects. Loaded only when the creator asks, because
  // most campaigns are something new and the list is noise until it is wanted.


  // Editing an existing draft. Separate from `draft` (the create flow) so a
  // half-finished new campaign is never confused with an edit in progress.

  // The Circle a campaign is attached to, if any. Read separately because the
  // campaign row carries only `circleId`; the target's progress lives on the
  // Circle and is derived there from settled transactions.



  /**
   * Save an edit to a draft. Only the fields the server declares writable are
   * sent. Capacity is included only while the campaign is still a draft,
   * because the backend rejects it after publication.
   */
/**
   * Attach an existing Brief item to a campaign that already exists.
   *
   * The backend has supported this since Phase 7B (PATCH objectId, authorised
   * by the caller's existing access to the item's source) but nothing in the
   * UI reached it -- an item could only be linked at create time. Reuses the
   * same picker as the create flow; adds no new primitive and copies no
   * object data.
   */




  /** Share uses the platform sheet where it exists, clipboard otherwise. */



  /**
   * Publish goes through the real transition endpoint. If the server refuses
   * the transition the campaign stays a draft on screen: there is no local
   * `status = 'live'` anywhere in this file.
   */

  /**
   * The organiser confirms money actually arrived for a held spot.
   *
   * This does NOT set a registration status from the client. The server
   * creates a real transaction, settles it through the ordinary ledger state
   * machine, and promotes the registration off that settled row. The UI then
   * refetches rather than optimistically patching, so what is displayed is
   * always what the server derived.
   */

  // --- T3: the organiser authors updates the public page shows -------------




  // Card button. Uses the same resolver as the detail view so a given label
  // means the same thing in both places. Anything without a real destination
  // opens the detail view rather than dead-ending.

  // Primary action from INSIDE the detail view: retarget the stream at this
  // object's type. A navigation decision, never a simulated transaction.


  const {
    followOne,
    likedPostIds,
    personalState,
    relatedToSavedIds,
    relationships,
    savePersonalBrief,
    savedIdSet,
    savedObjects,
    setLikedPostIds,
    setPersonalState,
    setRelationships,
    togglePersonalPick,
    unfollowEntityOne,
    unfollowOne,
    watchedIds,
    getRelatedObjects,
  } = usePersonalLayer({
    loadPersonal,
    objects,
    personalPicks,
    setPersonalBriefDismissed,
    setPersonalBusy,
    setPersonalPicks,
    showToast,
  });
  const {
    tuneObject,
  } = useTuning({
    loadPersonal,
    personalState,
    setPersonalState,
    showToast,
  });

  const {
    detailGraph,
    handleConfirmObject,
    handleReportObject,
    handleShare,
    handleToggleWatch,
    objectCheckBusy,
    reportForObject,
    setDetailGraph,
    setObjectCheckBusy,
    setReportForObject,
  } = useWatchAndShare({
    loadObjects,
    publicOrigin,
    setRelationships,
    showToast,
    watchedIds,
  });



  // Discovery ranking (destination rework 16). A destination happening today
  // with vendors in it outranks an old generic listing -- but this is time and
  // vendor density, never popularity. Only applied to the unfiltered browse:
  // once the user types a query, relevance wins.


  // STEP 4 My Layer: saved objects grouped by type, derived from the existing
  // relationships state. No parallel data structure.


  // One graph instance over the live state. Components ask it questions
  // instead of re-deriving relationship rules inline.
  const graph = useMemo(
    () => createBriefGraph(objects, relationships),
    [objects, relationships]
  );


  // Watch (prompt 21): records intent to monitor. No polling, no fake alerts --
  // diffObjects is the engine this will drive once ingestion supplies a second
  // version of a record.
  // --- §8 verify / report: the crowd-checking half of object trust ----------
  // "I was there" (confirm) and "this is wrong" (report) had server routes
  // and no buttons. Both hit the real endpoints; both show the server's own
  // answer or refusal.




  // Optional personal label on an existing saved edge (prompt 10).

  // Share (prompt 11): a plain, honest text payload. Web Share when the
  // browser offers it, clipboard otherwise. No invented links, no marketing.

  // --- Pursuits --------------------------------------------------------------
  // Standing intents. Matching is recomputed from live objects rather than
  // stored, so a pursuit created before an object was ingested picks it up the
  // moment that object exists.
  const [pursuits, setPursuits] = useState<Pursuit[]>([]);
  const {
    handleCreatePursuit,
    handleExecuteProtocolAction,
    handlePivotToType,
  } = useProtocolActions({
    noteActivation,
    objects,
    pursuits,
    setActiveTab,
    setNearbySection,
    setPersonalState,
    setPursuits,
    setRelationships,
    setSearchQuery,
    setSelectedObjectForDetail,
    setSelectedObjectType,
    showToast,
  });

  const {
    dailyBrief,
    editionPosts,
    filteredObjects,
    openPostSubject,
    pursuitResults,
    rankForDiscovery,
    toggleLike,
  } = useDiscoveryFeed({
    savedIdSet,
    posts,
    activeEdition,
    objects,
    pursuits,
    searchQuery,
    seenIds,
    selectedObjectType,
    setLikedPostIds,
    setSelectedObjectForDetail,
    watchedIds,
  });








  // --- Ingestion review state ------------------------------------------------
  // Candidates are parsed on demand and held here. They are NOT objects: until
  // a reviewer accepts one, nothing reaches the graph, search, or My Layer.
  const {
    candidates,
    handleAcceptCandidate,
    handleReceiveInbound,
    handleRejectCandidate,
    inboundBusy,
    reviewed,
    setCandidates,
    setInboundBusy,
    setReviewed,
  } = useIngestionDesk({
    objects,
    setObjects,
    showToast,
    connectorStatus,
  });


  // Pulls the real inbound queue: messages as they actually arrived from
  // connected sources. Brief ships with no sample traffic, so on a system with
  // nothing connected this correctly finds nothing -- "no new messages" is a
  // true report about an empty queue, not a UI that failed to load.


  // Accepting is the ONLY path from message to object, and it is manual.


  // --- Group intelligence layer ----------------------------------------------
  // Access state is live: revoking a group must immediately remove it and its
  // information, which is why groups are state rather than a constant.
  const {
    groupIndex,
    groupIndexes,
    groups,
    openGroup,
    openGroupId,
    setGroups,
    setOpenGroupId,
    visibleGroups,
  } = useGroupsDesk({
    connectorStatus,
  });

  // --- Connected sources ----------------------------------------------------
  // The groups Brief may read. Derived from the server's source rows: a
  // source with a granted membership is one the user is in, anything else is
  // only readable if it is public. Access is never assumed.

  // The ONLY list any part of the UI may iterate. Everything else is invisible.

  // Indexes are built per accessible group. An inaccessible group yields an
  // empty index by construction, so there is nothing to leak.





  // Saving keeps the group record intact and points back at it. Brief does not
  // claim authorship of anything a member wrote.


  // --- Participation ---------------------------------------------------------
  const {
    handleRedeem,
    handleSubmitQuest,
    myContribution,
    nextRank,
    quests,
    rewards,
    setQuests,
    setRewards,
  } = useQuestsAndRewards({
    showToast,
  });

  const [discoveryTab, setDiscoveryTab] = useState<
    'home' | 'events' | 'explore' | 'offers' | 'places' | 'news' | 'opportunities'
  >('home');
  const [moreFilters, setMoreFilters] = useState<boolean>(false);
  const [pursuitDraft, setPursuitDraft] = useState<string>('');
  const [feedReload, setFeedReload] = useState(0);
  const [boardMode, setBoardMode] = useState<'contributors' | 'earners'>('contributors');



  // The wallet is derived from settled quests only. Submitted work is visible
  // but deliberately worth nothing until reviewed.



  // Sub-navigation. Sections live INSIDE a destination, so the top
  // primary bar stays on Home, Selling, Spaces and You as features grow.

  // Challenges addressed to this user, awaiting a decision.
  // Gaming activity detected in groups the user is ALREADY a member of.
  // Runs over the access-checked indexes, so an inaccessible group can never
  // contribute a signal.
  // Workflows secondary is derived from real Journey data, not a new store.






  // Abandon: the honest exit for a match that never happened. The server
  // decides who may abandon (and when); a refusal says why.

  // Venues that actually host the selected game, nearest first.
  // Live activity per game: open challenges plus players checked in at a
  // venue. Drives the count on each game chip, so the selector is dynamic.
  const [savedGroupEntryIds, setSavedGroupEntryIds] = useState<string[]>([]);


  // --- Sources ---------------------------------------------------------------
  const [sources, setSources] = useState<Source[]>(INITIAL_SOURCES);

  // --- Capture ---------------------------------------------------------------
  // Pasted text runs through the ingestion parser, then waits for confirmation
  // exactly like anything else. Capture is a doorway, not a shortcut.
  const {
    captureMode,
    captureOpen,
    capturePreview,
    captureText,
    directCategory,
    directLocation,
    directTitle,
    directType,
    handleCaptureCancel,
    handleCaptureConfirm,
    handleCaptureParse,
    handleDirectPost,
    setCaptureMode,
    setCaptureOpen,
    setCapturePreview,
    setCaptureText,
    setDirectCategory,
    setDirectLocation,
    setDirectTitle,
    setDirectType,
  } = useCaptureFlow({
    loadObjects,
    objects,
    refreshConnectors,
    setObjects,
    showToast,
  });









  // The discovery-experience Daily Brief: TODAY / NEAR YOU / NOW / COMING UP
  // from real persisted rows. Only rendered when it has data.

  // --- Personal Brief derivations -----------------------------------------
  // The personal order is the server's re-ranking of the SAME objects — the
  // ids are mapped onto `objects`, never duplicated into a second store.

  const personalInterests = personalState?.interests ?? { locations: [], types: [], topics: [] };
  const personalHasInterests = personalInterests.locations.length > 0 || personalInterests.types.length > 0 || personalInterests.topics.length > 0;


  // Types that really exist in the loaded data — the onboarding chips are
  // never a hard-coded taxonomy, only what the objects themselves say.

  // The Personal Brief Saved surface: Upcoming / Active / News / Places /
  // Offers from the existing saved relationship graph. Expired or past rows
  // read as expired — they are never disguised as active.
  const personalSavedGroups = useMemo(() => {
    const nowMs = Date.now();
    const groups: { key: string; title: string; items: BriefObject[]; expired: BriefObject[] }[] = [
      { key: 'upcoming', title: 'Upcoming', items: [], expired: [] },
      { key: 'active', title: 'Active', items: [], expired: [] },
      { key: 'news', title: 'News', items: [], expired: [] },
      { key: 'places', title: 'Places', items: [], expired: [] },
      { key: 'offers', title: 'Offers', items: [], expired: [] }
    ];
    for (const o of savedObjects) {
      const t = o.temporal;
      const status = t?.status ?? '';
      const startsAt = t?.startsAt ? Date.parse(t.startsAt) : NaN;
      const deadlineAt = t?.deadlineAt ? Date.parse(t.deadlineAt) : NaN;
      const isEvent = o.type === 'experience' || o.type === 'event';
      const expired = status === 'expired' || status === 'past'
        || (Number.isFinite(deadlineAt) && deadlineAt < nowMs)
        || (isEvent && Number.isFinite(startsAt) && startsAt < nowMs);
      let group: { key: string; title: string; items: BriefObject[]; expired: BriefObject[] };
      if (isEvent) group = groups[0];                       // Upcoming
      else if (o.type === 'news' || o.type === 'announcement' || o.type === 'alert') group = groups[2]; // News
      else if (o.type === 'place' || o.type === 'business') group = groups[3];   // Places
      else if (o.type === 'offer') group = groups[4];       // Offers
      else group = groups[1];                               // Active (opportunities, services, ...)
      if (expired) group.expired.push(o); else group.items.push(o);
    }
    return groups.filter((g) => g.items.length > 0 || g.expired.length > 0);
  }, [savedObjects]);



  // Computed once per render instead of on every call site in the modal.
  const relatedObjects = selectedObjectForDetail
    ? getRelatedObjects(selectedObjectForDetail)
    : [];


  // Newest first, promoted posts kept inline rather than pinned to the top --
  // paid distribution earns a slot in the feed, not the whole masthead.



  const handleMenuSelect = (target: MenuTarget) => {
    setMenuOpen(false);
    // The operator desk is not a consumer destination and is not ladder-gated:
    // authority is the session's capabilities, checked again per call.
    if (target.tab === 'operate') {
      setAdminOpen(true);
      return;
    }
    // The notification center is an account surface, not a ladder rung:
    // what shows there is whatever the server says changed for THIS user.
    if (target.tab === 'notifications') {
      setNotificationsOpen(true);
      return;
    }
    // The ladder shapes what is OFFERED, never what is permitted: authority
    // still lives on the server. A surface whose rung has not been climbed
    // says which step opens it and points at that step instead of dropping
    // someone into a desk they have nothing to put on yet.
    //
    // Saved (Your Layer) and Actions (Workflows) are exempt by design — see
    // showsLadder(). Those two index screens list what exists; they are not a
    // shop window and never carry lock chrome.
    const section = 'section' in target ? target.section ?? null : null;
    if (!isSurfaceUnlocked(ladder, target.tab, section)) {
      const hint = unlockHint(ladder, target.tab, section);
      noteActivation('service_locked_tapped', { tab: target.tab, section, requires: hint });
      showToast(hint ? `Opens after: ${hint}` : 'Not open yet');
      setNextStepHidden(false);
      setCaptureOpen(false);
      setActiveTab('nearby');
      setNearbySection('stream');
      return;
    }
    if (target.tab === 'capture') {
      setCaptureOpen(true);
      return;
    }
    setCaptureOpen(false);
    setSelectedTeaSlug(null);
    setActiveTab(target.tab);
    if (target.tab === 'nearby') setNearbySection(target.section ?? 'stream');
    if (target.tab === 'mylayer') setMyLayerSection(target.section ?? 'saved');
    if (target.tab === 'workflows') {
      setWorkflowSection(target.section ?? 'cockpit');
      setWorkflowView(target.section ? 'screen' : 'queue');
    }
  };

  const skipUrl = useRef(false);

  const currentRoute = useCallback((): BriefRoute => ({
    dest: activeTab,
    nearby: nearbySection,
    mylayer: myLayerSection,
    workflow: workflowSection,
    objectId: selectedObjectForDetail?.id ?? pendingObjectId,
    teaSlug: selectedTeaSlug,
    campaignId: openCampaignId,
    entityId: entityPageId,
    locationName,
    collectionId: collectionRouteId,
    capture: captureOpen,
    menu: menuOpen,
    following: followingOpen,
    collections: collectionsOpen,
    notifications: notificationsOpen,
    admin: adminOpen,
    landed: false
  }), [
    activeTab, nearbySection, myLayerSection, workflowSection,
    selectedObjectForDetail, pendingObjectId, selectedTeaSlug, openCampaignId,
    entityPageId, locationName, collectionRouteId, captureOpen, menuOpen,
    followingOpen, collectionsOpen, notificationsOpen, adminOpen
  ]);

  const writeUrl = useCallback((route: BriefRoute, mode: 'push' | 'replace') => {
    if (typeof window === 'undefined' || !window.history) return;
    const url = toPath(route);
    if (mode === 'push') window.history.pushState(route, '', url);
    else window.history.replaceState(route, '', url);
  }, []);

  const applyRoute = useCallback((route: BriefRoute) => {
    skipUrl.current = true;
    setActiveTab(route.dest);
    setNearbySection(route.nearby);
    setMyLayerSection(route.mylayer);
    setWorkflowSection(route.workflow);
    setWorkflowView(route.dest === 'workflows' && route.workflow !== 'active' ? 'screen' : 'queue');
    setMenuOpen(route.menu);
    setAdminOpen(route.admin);
    setCaptureOpen(route.capture);
    setSelectedTeaSlug(route.teaSlug);
    setOpenCampaignId(route.campaignId);
    setEntityPageId(route.entityId);
    setLocationName(route.locationName);
    setCollectionRouteId(route.collectionId);
    setFollowingOpen(route.following);
    setCollectionsOpen(route.collections);
    setNotificationsOpen(route.notifications);
    if (route.objectId) setPendingObjectId(route.objectId);
    else {
      setPendingObjectId(null);
      setSelectedObjectForDetailRaw(null);
    }
  }, []);

  const dismissOverlay = useCallback(() => {
    const st = typeof window !== 'undefined' ? window.history.state : null;
    const overlayState = isBriefRoute(st) && (st.menu || st.capture || st.admin || st.objectId || st.teaSlug || st.campaignId || st.entityId || st.locationName || st.collectionId || st.following || st.collections || st.notifications);
    if (overlayState && !st.landed && typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }
    skipUrl.current = true;
    setMenuOpen(false);
    setAdminOpen(false);
    setCaptureOpen(false);
    setSelectedTeaSlug(null);
    setOpenCampaignId(null);
    setPendingObjectId(null);
    setSelectedObjectForDetailRaw(null);
    setEntityPageId(null);
    setLocationName(null);
    setCollectionRouteId(null);
    setFollowingOpen(false);
    setCollectionsOpen(false);
    setNotificationsOpen(false);
    setCollectionPickerFor(null);
    writeUrl({ ...currentRoute(), menu: false, admin: false, capture: false, objectId: null, teaSlug: null, campaignId: null, entityId: null, locationName: null, collectionId: null, following: false, collections: false, notifications: false }, 'replace');
  }, [currentRoute, writeUrl]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    writeUrl({ ...bootRoute, landed: true }, 'replace');
    const onPop = (event: PopStateEvent) => {
      const route = isBriefRoute(event.state)
        ? event.state
        : parsePath(window.location.pathname, window.location.search);
      applyRoute(route);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyRoute, writeUrl]);

  useEffect(() => {
    if (skipUrl.current) {
      skipUrl.current = false;
      return;
    }
    const overlay = menuOpen || adminOpen || captureOpen || Boolean(selectedTeaSlug) || Boolean(openCampaignId) || Boolean(selectedObjectForDetail) || Boolean(pendingObjectId) || Boolean(entityPageId) || Boolean(locationName) || Boolean(collectionRouteId) || followingOpen || collectionsOpen || notificationsOpen;
    writeUrl(currentRoute(), overlay ? 'push' : 'replace');
  }, [
    activeTab, nearbySection, myLayerSection, workflowSection,
    menuOpen, adminOpen, captureOpen, selectedTeaSlug, openCampaignId,
    selectedObjectForDetail, pendingObjectId, entityPageId, locationName, collectionRouteId,
    followingOpen, collectionsOpen, notificationsOpen,
    currentRoute, writeUrl
  ]);

  useEffect(() => {
    const tg = (typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : null);
    if (!tg?.BackButton) return;
    const show = menuOpen || captureOpen || Boolean(selectedTeaSlug) || Boolean(openCampaignId) || Boolean(selectedObjectForDetail) || Boolean(entityPageId) || Boolean(locationName) || Boolean(collectionRouteId) || followingOpen || collectionsOpen || notificationsOpen;
    try {
      if (show) tg.BackButton.show();
      else tg.BackButton.hide();
    } catch { /* Mini App host without BackButton */ }
    const handler = () => dismissOverlay();
    try { tg.BackButton.onClick(handler); } catch { /* */ }
    return () => {
      try { tg.BackButton.offClick?.(handler); } catch { /* */ }
    };
  }, [menuOpen, captureOpen, selectedTeaSlug, openCampaignId, selectedObjectForDetail, entityPageId, locationName, collectionRouteId, followingOpen, collectionsOpen, notificationsOpen, dismissOverlay]);

  useEffect(() => {
    if (!pendingObjectId) return;
    const hit = objects.find((o) => o.id === pendingObjectId);
    if (hit) {
      if (selectedObjectForDetail?.id !== hit.id) setSelectedObjectForDetailRaw(hit);
      return;
    }
    let live = true;
    briefApi.getObject(pendingObjectId).then((res) => {
      if (!live || !res.ok) return;
      setSelectedObjectForDetailRaw(objectFromServer(res.data));
    });
    return () => { live = false; };
  }, [pendingObjectId, objects, selectedObjectForDetail]);

  // The LOCAL ACTIVITY GRAPH for the open detail modal: related content from
  // real relationships only (the server never keyword-matches). Cleared when
  // the modal closes so stale edges never linger on the next object.
  useEffect(() => {
    if (!selectedObjectForDetail?.id) { setDetailGraph(null); return; }
    let live = true;
    briefApi.getObjectGraph(selectedObjectForDetail.id).then((res) => {
      if (live) setDetailGraph(res.ok ? res.data.edges : []);
    });
    return () => { live = false; };
  }, [selectedObjectForDetail?.id]);

  const isAnyModalActive = Boolean(openCampaignId) || createStep !== 'closed' || captureOpen || Boolean(selectedObjectForDetail) || Boolean(selectedTeaSlug) || Boolean(entityPageId) || Boolean(locationName) || Boolean(collectionRouteId) || followingOpen || collectionsOpen || notificationsOpen;

  // THE APP GATE (product decision 2026-08-29): NO ACCESS WITHOUT AN ACCOUNT.
  // Signed out, the app does not render at all -- no feed, no shelf, no
  // navigation, nothing in the DOM to leak. The sign-in flow IS the screen.
  // The server enforces the same rule on every data route (401
  // account_required); this is the client half.
  if (sessionChecked && !sessionUser) {
    return (
      <div className="min-h-screen bg-[#D8D2E1] text-[#251045]">
        <div className="min-h-screen flex flex-col items-center justify-center px-5 py-10">
          <div className="w-full max-w-sm text-center">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#251045]/50">Brief · Nairobi</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight mt-2">
              An account opens everything
            </h1>
            <p className="mt-3 text-[13px] leading-relaxed text-[#251045]/70">
              Brief is members-only: the live feed, the Tea studio,
              the marketplace and every tool behind this wall need an account.
            </p>
            <ul className="mt-4 space-y-1.5 text-left mx-auto w-fit">
              {[
                'Write and publish your own stories',
                'Keep your business demand in Requests',
                'Sell, campaign and run groups',
                'Sign in with Google, email link, or your Brief handle'
              ].map((line) => (
                <li key={line} className="flex items-start gap-2 text-[12px] leading-snug text-[#251045]/80">
                  <span aria-hidden="true" className="mt-[3px] h-1.5 w-1.5 rounded-full bg-[#5B2EA6] shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11px] leading-relaxed text-[#251045]/50">
              No real money moves on Brief yet (no payment provider connected), and
              Google sign-in activates once this deployment registers its Google
              credentials. Your Brief account — the primary registry — works today.
            </p>
          </div>
        </div>
        <Onboarding
          open
          providers={authProviders}
          state={onboardingState}
          user={sessionUser}
          channel={arrivalChannel}
          placeLabel={userLocation?.label ?? null}
          onSignedIn={(user) => {
            setSessionUser(user);
            void refreshOnboarding();
          }}
          onGuest={provisionGuest}
          onStateChange={setOnboardingState}
          onUseLocation={locate}
          onChooseCity={(city) => chooseCity(city)}
          onDone={() => {
            setFirstRunOpen(false);
            setActiveTab('nearby');
            setNearbySection('stream');
            void refreshOnboarding();
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#D8D2E1] text-[#251045] flex flex-col font-sans selection:bg-[#5B2EA6] selection:text-[#FFFFFF]">

      <StatusToasts setSpringOverlayOpen={setSpringOverlayOpen} springOverlayOpen={springOverlayOpen} toastMessage={toastMessage} />

      {/* Toast */}

      {/* Spring-animated empty-state overlay */}

      {/* Roofless: no top bar. The page opens onto the sky. Menu, capture
          and place live on the dock / shelf, not as a lid over the house. */}
      <div className="flex-1 flex w-full">

      <DesktopRail activeTab={activeTab} destinationAlerts={destinationAlerts} goToDestination={goToDestination} menuOpen={menuOpen} setMenuOpen={setMenuOpen} notificationsOpen={notificationsOpen} notifUnread={notifUnread} setNotificationsOpen={setNotificationsOpen} />

        {/* DESKTOP / TABLET RAIL. Full height now the header is gone. */}

        {/* Main Stream. pb-24 on mobile clears the bottom bar. */}
        <main className="flex-1 min-w-0 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-6">

        {/* Main Content */}
        {/* Sub-navigation. Sections live INSIDE a destination, so the top
            bar stays five doors wide no matter how much is built. */}
        {activeTab === 'mylayer' && (
          <MyLayerScreen
            activeTab={activeTab}
            beginEdit={beginEdit}
            campaignBusy={campaignBusy}
            campaignState={campaignState}
            draft={draft}
            graph={graph}
            groupIndex={groupIndex}
            groupIndexes={groupIndexes}
            groups={groups}
            handleCreatePursuit={handleCreatePursuit}
            handleExecuteProtocolAction={handleExecuteProtocolAction}
            handleRemoveCampaign={handleRemoveCampaign}
            loadCampaigns={loadCampaigns}
            myContribution={myContribution}
            myLayerSection={myLayerSection}
            objects={objects}
            openCampaign={openCampaign}
            openGroup={openGroup}
            relationships={relationships}
            savedObjects={savedObjects}
            setActiveTab={setActiveTab}
            setCampaignActionError={setCampaignActionError}
            setCampaignBusy={setCampaignBusy}
            setCreateStep={setCreateStep}
            setDraft={setDraft}
            setMyLayerSection={setMyLayerSection}
            setObjectPicker={setObjectPicker}
            setOpenGroupId={setOpenGroupId}
            setPublishedCampaign={setPublishedCampaign}
            setSelectedObjectForDetail={setSelectedObjectForDetail}
            setWorkflowSection={setWorkflowSection}
            setWorkflowView={setWorkflowView}
            shareCampaign={shareCampaign}
            showToast={showToast}
            visibleGroups={visibleGroups}
            openGroupId={openGroupId}
            quests={quests}
            sessionUser={sessionUser}
            selectedLocation={selectedLocation}
            setGroups={setGroups}
            setPersonalState={setPersonalState}
            setRelationships={setRelationships}
            setSavedGroupEntryIds={setSavedGroupEntryIds}
          />
        )}



        {activeTab === 'nearby' && (
          <NearbyScreen
            posts={posts}
            activeEdition={activeEdition}
            activeTab={activeTab}
            chooseCity={chooseCity}
            dailyBrief={dailyBrief}
            editionPosts={editionPosts}
            feedArea={feedArea}
            filteredObjects={filteredObjects}
            followOne={followOne}
            handleCreatePursuit={handleCreatePursuit}
            handleExecuteProtocolAction={handleExecuteProtocolAction}
            handleMenuSelect={handleMenuSelect}
            handleSubmitQuest={handleSubmitQuest}
            homeFeedStatus={homeFeedStatus}
            ladder={ladder}
            likedPostIds={likedPostIds}
            locError={locError}
            locate={locate}
            locating={locating}
            nearbySection={nearbySection}
            nextStepHidden={nextStepHidden}
            noteActivation={noteActivation}
            objects={objects}
            openEntityPage={openEntityPage}
            openPostSubject={openPostSubject}
            personalBriefDismissed={personalBriefDismissed}
            personalBusy={personalBusy}
            personalHasInterests={personalHasInterests}
            personalInterests={personalInterests}
            personalPicks={personalPicks}
            personalSavedGroups={personalSavedGroups}
            personalState={personalState}
            pursuitResults={pursuitResults}
            pursuits={pursuits}
            quests={quests}
            runtimeCheck={runtimeCheck}
            savePersonalBrief={savePersonalBrief}
            searchQuery={searchQuery}
            selectedLocation={selectedLocation}
            selectedObjectType={selectedObjectType}
            sessionUser={sessionUser}
            setActiveEdition={setActiveEdition}
            setActiveTab={setActiveTab}
            setCaptureOpen={setCaptureOpen}
            setCollectionsOpen={setCollectionsOpen}
            notificationsOpen={notificationsOpen}
            notifUnread={notifUnread}
            setNotificationsOpen={setNotificationsOpen}
            setFirstRunOpen={setFirstRunOpen}
            setFollowingOpen={setFollowingOpen}
            setHomeFeedStatus={setHomeFeedStatus}
            setNearbySection={setNearbySection}
            setNextStepHidden={setNextStepHidden}
            setPersonalBriefDismissed={setPersonalBriefDismissed}
            setSearchQuery={setSearchQuery}
            setSelectedObjectForDetail={setSelectedObjectForDetail}
            setSelectedObjectType={setSelectedObjectType}
            setSelectedTeaSlug={setSelectedTeaSlug}
            setWorkflowSection={setWorkflowSection}
            setWorkflowView={setWorkflowView}
            showToast={showToast}
            toggleLike={toggleLike}
            togglePersonalPick={togglePersonalPick}
            unfollowEntityOne={unfollowEntityOne}
            unfollowOne={unfollowOne}
            userLocation={userLocation}
            setFeedArea={setFeedArea}
            setLocError={setLocError}
            setPursuits={setPursuits}
            setSelectedLocation={setSelectedLocation}
            setUserLocation={setUserLocation}
            personalFeedIds={personalFeedIds}
            personalBoostMap={personalBoostMap}
            boardMode={boardMode}
            discoveryTab={discoveryTab}
            feedReload={feedReload}
            moreFilters={moreFilters}
            pursuitDraft={pursuitDraft}
            setBoardMode={setBoardMode}
            setDiscoveryTab={setDiscoveryTab}
            setFeedReload={setFeedReload}
            setMoreFilters={setMoreFilters}
            setPursuitDraft={setPursuitDraft}
          />
        )}




        {/* TEA */}

        {/* MY LAYER */}

        {/* WORKFLOWS */}
        {activeTab === 'workflows' && (
          <WorkflowsScreen
            activeTab={activeTab}
            briefItBusy={briefItBusy}
            briefItPreview={briefItPreview}
            briefItSaved={briefItSaved}
            briefItText={briefItText}
            connectorStatus={connectorStatus}
            handleAcceptCandidate={handleAcceptCandidate}
            handleReceiveInbound={handleReceiveInbound}
            handleRejectCandidate={handleRejectCandidate}
            inboundBusy={inboundBusy}
            loadObjects={loadObjects}
            objects={objects}
            refreshConnectors={refreshConnectors}
            reviewed={reviewed}
            runBriefItSave={runBriefItSave}
            setBriefItPreview={setBriefItPreview}
            setBriefItSaved={setBriefItSaved}
            setBriefItText={setBriefItText}
            setWorkflowSection={setWorkflowSection}
            setWorkflowView={setWorkflowView}
            showToast={showToast}
            sources={sources}
            workflowSection={workflowSection}
            workflowView={workflowView}
            candidates={candidates}
            journeys={journeys}
            setBriefItBusy={setBriefItBusy}
          />
        )}






























        </main>
      </div>

      {/* MOBILE DOCK. Five tabs. Hides while you read; a pull nub brings it back. */}

      <DockNav activeTab={activeTab} destinationAlerts={destinationAlerts} dockOn={dockOn} goToDestination={goToDestination} isAnyModalActive={isAnyModalActive} menuOpen={menuOpen} setDockOn={setDockOn} setMenuOpen={setMenuOpen} />

      {/* CAMPAIGN DASHBOARD. Every number is server-derived. Where the
          backend does not measure something, this says so rather than
          printing a zero that looks like a measurement. */}
      <OverlaysShell
        attachObjectToCampaign={attachObjectToCampaign}
        beginEdit={beginEdit}
        campaignActionError={campaignActionError}
        campaignBusy={campaignBusy}
        campaignCircle={campaignCircle}
        campaignDetail={campaignDetail}
        campaignRegs={campaignRegs}
        captureMode={captureMode}
        captureOpen={captureOpen}
        capturePreview={capturePreview}
        captureText={captureText}
        collectionPickerFor={collectionPickerFor}
        confirmPayment={confirmPayment}
        copyCampaignLink={copyCampaignLink}
        createStep={createStep}
        detailGraph={detailGraph}
        directLocation={directLocation}
        directTitle={directTitle}
        directType={directType}
        dismissOverlay={dismissOverlay}
        draft={draft}
        editDraft={editDraft}
        graph={graph}
        handleCaptureCancel={handleCaptureCancel}
        handleCaptureConfirm={handleCaptureConfirm}
        handleCaptureParse={handleCaptureParse}
        handleConfirmObject={handleConfirmObject}
        handleCreatePursuit={handleCreatePursuit}
        handleDirectPost={handleDirectPost}
        handleExecuteProtocolAction={handleExecuteProtocolAction}
        handlePivotToType={handlePivotToType}
        handleRemoveCampaign={handleRemoveCampaign}
        handleReportObject={handleReportObject}
        handleShare={handleShare}
        handleToggleWatch={handleToggleWatch}
        loadAttachableObjects={loadAttachableObjects}
        loadCampaigns={loadCampaigns}
        loadPersonal={loadPersonal}
        locationName={locationName}
        objectCheckBusy={objectCheckBusy}
        objectPicker={objectPicker}
        objects={objects}
        openCampaign={openCampaign}
        openCampaignId={openCampaignId}
        openLocationPage={openLocationPage}
        personalState={personalState}
        postUpdate={postUpdate}
        publicOrigin={publicOrigin}
        publishDraft={publishDraft}
        publishedCampaign={publishedCampaign}
        pursuitResults={pursuitResults}
        pursuits={pursuits}
        relatedObjects={relatedObjects}
        relatedToSavedIds={relatedToSavedIds}
        reportForObject={reportForObject}
        saveCampaignEdit={saveCampaignEdit}
        savedIdSet={savedIdSet}
        selectedObjectForDetail={selectedObjectForDetail}
        selectedTeaSlug={selectedTeaSlug}
        sessionUser={sessionUser}
        setCampaignActionError={setCampaignActionError}
        setCampaignBusy={setCampaignBusy}
        setCampaignCircle={setCampaignCircle}
        setCampaignDetail={setCampaignDetail}
        setCaptureMode={setCaptureMode}
        setCapturePreview={setCapturePreview}
        setCaptureText={setCaptureText}
        setCollectionPickerFor={setCollectionPickerFor}
        setCreateStep={setCreateStep}
        setDirectCategory={setDirectCategory}
        setDirectLocation={setDirectLocation}
        setDirectTitle={setDirectTitle}
        setDirectType={setDirectType}
        setDraft={setDraft}
        setEditDraft={setEditDraft}
        setObjectPicker={setObjectPicker}
        setOpenCampaignId={setOpenCampaignId}
        setRegStatus={setRegStatus}
        setReportForObject={setReportForObject}
        setSelectedObjectForDetail={setSelectedObjectForDetail}
        setUpdateBody={setUpdateBody}
        setUpdateTitle={setUpdateTitle}
        shareCampaign={shareCampaign}
        showToast={showToast}
        sources={sources}
        tuneObject={tuneObject}
        updateBody={updateBody}
        updateBusy={updateBusy}
        updateNote={updateNote}
        updateTitle={updateTitle}
        watchedIds={watchedIds}
        chooseCity={chooseCity}
        collectionRouteId={collectionRouteId}
        collectionsOpen={collectionsOpen}
        notificationsOpen={notificationsOpen}
        notifUnread={notifUnread}
        setNotificationsOpen={setNotificationsOpen}
        setNotifUnread={setNotifUnread}
        setCollectionRouteId={setCollectionRouteId}
        entityPageId={entityPageId}
        followOne={followOne}
        followingOpen={followingOpen}
        handleMenuSelect={handleMenuSelect}
        menuOpen={menuOpen}
        selectedLocation={selectedLocation}
        setActiveTab={setActiveTab}
        setCollectionsOpen={setCollectionsOpen}
        setEntityPageId={setEntityPageId}
        setFollowingOpen={setFollowingOpen}
        setMyLayerSection={setMyLayerSection}
      />

      {/* CREATE CAMPAIGN. Type -> details -> preview -> publish. The preview
          is a screen, not a saved object: nothing reaches the server until
          Publish, and publication itself is the real transition endpoint. */}

      {/* CAPTURE: the easiest way into Brief. Quick drop or direct post creation. */}

      {/* Package 3: the dynamic ticket bar — the active gate pass, locked to
          the bottom of the screen, with inline delta alerts. */}
      <TicketBar
        onOpenTickets={() => {
          setActiveTab('mylayer');
          setMyLayerSection('tickets');
        }}
      />

      {/* DETAIL LAYER */}


      {/* First run. An OVERLAY, not a replacement: the feed loads behind it,
          so the screen after the flow is already warm. */}
      <Onboarding
        open={firstRunOpen}
        providers={authProviders}
        state={onboardingState}
        user={sessionUser}
        channel={arrivalChannel}
        placeLabel={userLocation?.label ?? null}
        onSignedIn={(user) => {
          setSessionUser(user);
          void refreshOnboarding();
        }}
        onGuest={provisionGuest}
        onStateChange={setOnboardingState}
        onUseLocation={locate}
        onChooseCity={(city) => chooseCity(city)}
        onDone={() => {
          setFirstRunOpen(false);
          setActiveTab('nearby');
          setNearbySection('stream');
          void refreshOnboarding();
        }}
      />

      <AdminDesk open={adminOpen} onClose={dismissOverlay} me={sessionUser} />

      {/* ENTITY LAYER — the followable entity page and the Following surface. */}

      {/* LOCAL ACTIVITY GRAPH — the public location discovery page. */}

      {/* COLLECTIONS — the personal layer. The surface opens from the header;
          a shared /collections/:id link renders the public page directly. */}
      {/* WAIRO QUANTUM DELIVERY MINI APP EMBEDDED COMPANION (Minimal Top-Right Bookmark Knob & Full Logistics Suite) */}
      <WairoFloatingWidget triggerMode="bookmark" />

      <footer className="border-t border-[#D6CFE4] mt-12 py-6 text-xs text-[#251045]/60 text-center">
        Everything Happening Around You
      </footer>

    </div>
  );
}

export default App;
