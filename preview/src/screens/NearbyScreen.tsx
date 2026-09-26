import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { 
  Bell, 
  ArrowRight, 
  Bookmark, 
  FolderPlus, 
  Heart, 
  MapPin, 
  Newspaper, 
  Plus, 
  Search, 
  ShieldCheck, 
  Users, 
  X, 
  Sparkles,
  Bike,
  Truck,
  TrendingUp,
  Clock,
  Briefcase,
  Zap,
  CheckCircle2,
  ChevronRight
} from 'lucide-react';
import * as briefApi from '../api/briefApi';
import { 
  DESTINATION_STATE_LABELS, 
  TEA_EDITIONS, 
  briefWhenLabel, 
  entityChipsFor, 
  formatCount, 
  getCardLevel, 
  getDestinationState, 
  getDestinationVendors, 
  getDistanceLabel, 
  getEditionMeta, 
  getLifecycleBadge, 
  getObjectTypeMeta, 
  getPostKindMeta, 
  getPublishedLine, 
  getRelativeTime, 
  getSourceChip, 
  isDestinationObject, 
  objectFromServer, 
  resolveAction, 
  buildDiscoveryBrief, 
  buildPersonalSections, 
  getCurrentEdition 
} from '../model/core';
import type { ObjectType, PursuitStatus, WatchCondition } from '../model/core';
import type { BriefPost } from '../model/core';
import { FILTERS, HOME_MORE } from '../ui/names';
import { showsLadder } from '../components/ladder';
import { EntityChip } from '../components/EntityChip';
import { EventsHub } from '../components/EventsHub';
import { FeedComposer } from '../components/FeedComposer';
import { LocationChip } from '../components/LocationChip';
import { MainShelf } from '../components/MainShelf';
import { Marketplace } from '../components/Marketplace';
import { MoneyBand } from '../components/MoneyBand';
import { MshikanoDesk } from '../components/MshikanoDesk';
import { NextStep } from '../components/NextStep';
import { Pursuits } from '../components/Pursuits';
import { Quests } from '../components/Quests';
import { SearchResults } from '../components/SearchResults';
import { TickerBanner } from '../components/SignalBanner';
import { TodayOpportunities } from '../components/home/TodayOpportunities';
import { CommitteeDesk } from '../components/life/CommitteeDesk';
import { WellbeingDesk } from '../components/wellbeing/WellbeingDesk';

import { InterCountyDesk } from '../components/wairo/InterCountyDesk';
import { PrivateCarrierAuctionDesk } from '../components/wairo/PrivateCarrierAuctionDesk';
import { OfflineSyncQueueDesk } from '../components/offline/OfflineSyncQueueDesk';
import { UniversalCreatePostModal } from '../components/posts/UniversalCreatePostModal';
import { WairoMiniApp } from '../components/wairo/WairoMiniApp';
import { LiveTelemetryModal } from '../components/wairo/LiveTelemetryModal';
import { LocationModal } from '../components/wairo/LocationModal';
import { DispatchModal } from '../components/wairo/DispatchModal';
import { EmbedSDKModal } from '../components/wairo/EmbedSDKModal';
import { UssdSimulatorDesk } from '../components/offline/UssdSimulatorDesk';
import { LOCATIONS, INITIAL_ACTIVE_DELIVERY, WairoLocation, WairoDelivery } from '../components/wairo/wairoData';
import { DiscoverScreen, DiscoverSection } from './DiscoverScreen';
import {
  BriefBuilderSection,
  WairoBookmark,
  DiscoverBookmark,
  WelcomingMat,
  GroupDemandRunDesk,
  GroupEventLogisticsDesk,
  CreatorPartnerDesk,
  CBCTextbookBundleCheckoutModal,
  OptimizelyHeroSection,
  AnnouncementPinkBanner,
  TrustedPartnerRibbon,
  PartnerPill,
  AgenticFeatureGrid,
  AgenticCalloutBanner,
  IntegrationsStackSection
} from '../components/ui';
import {
  NEIGHBORHOODS,
  Neighborhood,
  getPrimaryNeighborhood,
  setPrimaryNeighborhood
} from '../model/neighborhoods';
import { NeighborhoodPickerModal } from '../components/neighborhood/NeighborhoodPickerModal';
import { CommunityChampionModal } from '../components/neighborhood/CommunityChampionModal';
import { soundEngine } from '../utils/SoundEngine';
import type { BriefObject, Destination, NearbySection, Pursuit, Quest, TeaEdition, WorkflowSection } from '../model/core';
import type { AuthedUser, PersonalState } from '../api/briefApi';
import type { GeoPoint } from '../components/LocationChip';

export interface NearbyScreenProps {
  boardMode: 'contributors' | 'earners';
  discoveryTab: 'home' | 'events' | 'explore' | 'offers' | 'places' | 'news' | 'opportunities';
  feedReload: number;
  moreFilters: boolean;
  pursuitDraft: string;
  setBoardMode: React.Dispatch<React.SetStateAction<'contributors' | 'earners'>>;
  setDiscoveryTab: React.Dispatch<React.SetStateAction<'home' | 'events' | 'explore' | 'offers' | 'places' | 'news' | 'opportunities'>>;
  setFeedReload: React.Dispatch<React.SetStateAction<number>>;
  setMoreFilters: React.Dispatch<React.SetStateAction<boolean>>;
  setPursuitDraft: React.Dispatch<React.SetStateAction<string>>;
  personalFeedIds: string[] | null;
  personalBoostMap: Record<string, { boost: number; reasons: string[] }>;
  setFeedArea: React.Dispatch<React.SetStateAction<string | null>>;
  setLocError: React.Dispatch<React.SetStateAction<string | null>>;
  setPursuits: React.Dispatch<React.SetStateAction<Pursuit[]>>;
  setSelectedLocation: React.Dispatch<React.SetStateAction<string>>;
  setUserLocation: React.Dispatch<React.SetStateAction<GeoPoint | null>>;
  activeEdition: TeaEdition;
  activeTab: Destination;
  chooseCity: any;
  dailyBrief: any;
  editionPosts: any;
  feedArea: string | null;
  filteredObjects: any;
  followOne: any;
  handleCreatePursuit: any;
  handleExecuteProtocolAction: any;
  handleMenuSelect: any;
  handleSubmitQuest: any;
  homeFeedStatus: 'loading' | 'ready' | 'unavailable';
  ladder: any;
  likedPostIds: string[];
  locError: string | null;
  locate: any;
  locating: any;
  nearbySection: NearbySection;
  nextStepHidden: any;
  noteActivation: any;
  objects: BriefObject[];
  openEntityPage: any;
  openPostSubject: any;
  posts: BriefPost[];
  personalBriefDismissed: any;
  personalBusy: any;
  personalHasInterests: any;
  personalInterests: any;
  personalPicks: { locations: string[]; types: string[]; topics: string[] };
  personalSavedGroups: any;
  personalState: briefApi.PersonalState | null;
  pursuitResults: any;
  pursuits: Pursuit[];
  quests: Quest[];
  runtimeCheck: 'checking' | 'current' | 'old' | 'unavailable';
  savePersonalBrief: any;
  searchQuery: string;
  selectedLocation: string;
  selectedObjectType: string;
  sessionUser: briefApi.AuthedUser | null;
  setActiveEdition: React.Dispatch<React.SetStateAction<TeaEdition>>;
  setActiveTab: React.Dispatch<React.SetStateAction<Destination>>;
  setCaptureOpen: any;
  setCollectionsOpen: any;
  notificationsOpen: any;
  notifUnread: any;
  setNotificationsOpen: any;
  setFirstRunOpen: any;
  setFollowingOpen: any;
  setHomeFeedStatus: React.Dispatch<React.SetStateAction<'loading' | 'ready' | 'unavailable'>>;
  setNearbySection: React.Dispatch<React.SetStateAction<NearbySection>>;
  setNextStepHidden: any;
  setPersonalBriefDismissed: any;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setSelectedObjectForDetail: any;
  setSelectedObjectType: React.Dispatch<React.SetStateAction<string>>;
  setSelectedTeaSlug: React.Dispatch<React.SetStateAction<string | null>>;
  setWorkflowSection: React.Dispatch<React.SetStateAction<WorkflowSection>>;
  setWorkflowView: React.Dispatch<React.SetStateAction<'queue' | 'screen'>>;
  showToast: any;
  toggleLike: any;
  togglePersonalPick: any;
  unfollowEntityOne: any;
  unfollowOne: any;
  userLocation: GeoPoint | null;
}

export function NearbyScreen(props: NearbyScreenProps) {
  const {
    posts,
    activeEdition,
    activeTab,
    chooseCity,
    dailyBrief,
    editionPosts,
    feedArea,
    filteredObjects,
    followOne,
    handleCreatePursuit,
    handleExecuteProtocolAction,
    handleMenuSelect,
    handleSubmitQuest,
    homeFeedStatus,
    ladder,
    likedPostIds,
    locError,
    locate,
    locating,
    nearbySection,
    nextStepHidden,
    noteActivation,
    objects,
    openEntityPage,
    openPostSubject,
    personalBriefDismissed,
    personalBusy,
    personalHasInterests,
    personalInterests,
    personalPicks,
    personalSavedGroups,
    personalState,
    pursuitResults,
    pursuits,
    quests,
    runtimeCheck,
    savePersonalBrief,
    searchQuery,
    selectedLocation,
    selectedObjectType,
    sessionUser,
    setActiveEdition,
    setActiveTab,
    setCaptureOpen,
    setCollectionsOpen,
    notificationsOpen,
    notifUnread,
    setNotificationsOpen,
    setFirstRunOpen,
    setFollowingOpen,
    setHomeFeedStatus,
    setNearbySection,
    setNextStepHidden,
    setPersonalBriefDismissed,
    setSearchQuery,
    setSelectedObjectForDetail,
    setSelectedObjectType,
    setSelectedTeaSlug,
    setWorkflowSection,
    setWorkflowView,
    showToast,
    toggleLike,
    togglePersonalPick,
    unfollowEntityOne,
    unfollowOne,
    userLocation,
    setFeedArea,
    setLocError,
    setPursuits,
    setSelectedLocation,
    setUserLocation,
    personalFeedIds,
    personalBoostMap,
    boardMode,
    discoveryTab,
    feedReload,
    moreFilters,
    pursuitDraft,
    setBoardMode,
    setDiscoveryTab,
    setFeedReload,
    setMoreFilters,
    setPursuitDraft,
  } = props;

  const RECENT_KEY = 'brief.recentSearches.v1';
  const [cbcCheckoutOpen, setCbcCheckoutOpen] = useState(false);
  const [activeCbcBundleId, setActiveCbcBundleId] = useState('cbc-g7');
  const [recentSearches, setRecentSearches] = React.useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string').slice(0, 6) : [];
    } catch { return []; }
  });
  const [searchFocused, setSearchFocused] = React.useState(false);
  const [activeNeighborhood, setActiveNeighborhood] = useState<Neighborhood>(() => getPrimaryNeighborhood());
  const [isNeighborhoodPickerOpen, setIsNeighborhoodPickerOpen] = useState(false);
  const [isChampionModalOpen, setIsChampionModalOpen] = useState(false);
  const [committeeOpen, setCommitteeOpen] = useState(false);
  const [circleOpen, setCircleOpen] = useState(false);
  const [wellbeingOpen, setWellbeingOpen] = useState(false);
  const [interCountyOpen, setInterCountyOpen] = useState(false);
  const [carrierAuctionOpen, setCarrierAuctionOpen] = useState(false);
  const [offlineSyncOpen, setOfflineSyncOpen] = useState(false);
  const [createPostModalOpen, setCreatePostModalOpen] = useState(false);
  const [discoverViewOpen, setDiscoverViewOpen] = useState(false);
  const [demandRunOpen, setDemandRunOpen] = useState(false);
  const [eventLogisticsOpen, setEventLogisticsOpen] = useState(false);
  const [creatorDeskOpen, setCreatorDeskOpen] = useState(false);

  // WAIRO & Errands Companion State
  const [wairoMiniAppOpen, setWairoMiniAppOpen] = useState(false);
  const [wairoLocation, setWairoLocation] = useState<WairoLocation>(LOCATIONS[0]);
  const [wairoDelivery, setWairoDelivery] = useState<WairoDelivery>(INITIAL_ACTIVE_DELIVERY);
  const [isTelemetryOpen, setIsTelemetryOpen] = useState(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  const [isSDKModalOpen, setIsSDKModalOpen] = useState(false);
  const [isUssdOpen, setIsUssdOpen] = useState(false);

  // Sync wairo location with active neighborhood
  useEffect(() => {
    const matchedLoc = LOCATIONS.find(l => 
      l.name.toLowerCase().includes(activeNeighborhood.name.toLowerCase()) ||
      activeNeighborhood.name.toLowerCase().includes(l.name.toLowerCase())
    );
    if (matchedLoc) {
      setWairoLocation(matchedLoc);
    }
  }, [activeNeighborhood]);

  const commitRecentSearch = React.useCallback((term: string) => {
    const t = term.trim();
    if (!t) return;
    setRecentSearches((prev) => {
      const next = [t, ...prev.filter((p) => p.toLowerCase() !== t.toLowerCase())].slice(0, 6);
      try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const nearbyCategories = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of objects) {
      const c = (o as any).category;
      if (typeof c === 'string' && c.trim()) counts.set(c.trim(), (counts.get(c.trim()) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 8);
  }, [objects]);

  const clearLocation = React.useCallback(() => {
    setLocError(null);
    setUserLocation(null);
    setFeedArea(null);
    setSelectedLocation('Your area');
  }, [setLocError, setUserLocation, setFeedArea, setSelectedLocation]);

  const handlePrimaryAction = (object: BriefObject) => {
    const action = resolveAction(object);

    switch (action.kind) {
      case 'external':
      case 'map':
        window.open(action.href, '_blank', 'noopener,noreferrer');
        handleExecuteProtocolAction('discover', object, { silent: true });
        return;

      case 'phone':
        window.location.href = action.href;
        handleExecuteProtocolAction('contact', object, { silent: true });
        return;

      default:
        setSelectedObjectForDetail(object);
    }
  };

  const handleSetPursuitStatus = (id: string, status: PursuitStatus) => {
    setPursuits((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, status, lastUpdatedAt: new Date().toISOString() }
          : p
      )
    );
  };

  const handleTogglePursuitWatch = (id: string) => {
    setPursuits((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              watchChanges: !p.watchChanges,
              lastUpdatedAt: new Date().toISOString()
            }
          : p
      )
    );
  };

  const handleTogglePursuitCondition = (id: string, condition: WatchCondition) => {
    setPursuits((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const current = p.watchConditions ?? [];
        return {
          ...p,
          watchConditions: current.includes(condition)
            ? current.filter((c) => c !== condition)
            : [...current, condition],
          lastUpdatedAt: new Date().toISOString()
        };
      })
    );
  };

  const handleRemovePursuit = (id: string) => {
    setPursuits((prev) => prev.filter((p) => p.id !== id));
    showToast('Pursuit removed');
  };

  const openQuests = useMemo(
    () => quests.filter((q) => q.status === 'open'),
    [quests]
  );

  const discoveryBrief = useMemo(
    () =>
      buildDiscoveryBrief({
        objects,
        area: feedArea,
        geo: userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null
      }),
    [objects, feedArea, userLocation]
  );

  const personalOrdered = useMemo(() => {
    if (!personalFeedIds) return null;
    const byId = new Map(objects.map((o) => [o.id, o]));
    const out: { object: BriefObject; boost: number; reasons: string[] }[] = [];
    for (const id of personalFeedIds) {
      const object = byId.get(id);
      if (!object) continue;
      const p = personalBoostMap[id];
      out.push({ object, boost: p?.boost ?? 0, reasons: p?.reasons ?? [] });
    }
    return out;
  }, [personalFeedIds, personalBoostMap, objects]);

  const personalSections = useMemo(() => {
    if (!personalOrdered || personalOrdered.length === 0) return [];
    return buildPersonalSections({
      ordered: personalOrdered,
      interests: personalInterests,
      topics: personalState?.topics ?? [],
      personalized: personalHasInterests
    });
  }, [personalOrdered, personalInterests, personalState, personalHasInterests]);

  const availableTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of objects) counts[o.type] = (counts[o.type] ?? 0) + 1;
    return Object.keys(counts) as ObjectType[];
  }, [objects]);

  const liveEdition = getCurrentEdition();

  return (
    <>
      {/* ================= FLOATING DUAL BOOKMARKS (TOP-RIGHT) ================= */}
      <div className="fixed top-2 right-4 z-40 flex items-start space-x-1.5 pointer-events-auto">
        <DiscoverBookmark
          onTap={() => {
            soundEngine.play('tap');
            setDiscoverViewOpen(true);
          }}
        />
        <WairoBookmark
          status="IN TRANSIT"
          location={activeNeighborhood.name}
          onTap={() => {
            soundEngine.play('heavyTap');
            setInterCountyOpen(true);
          }}
        />
      </div>

      <div className="max-w-5xl mx-auto px-2 sm:px-4 pt-2">
        <div className="mb-5">
          {/* Top Neighborhood Identity Header */}
          <div className="flex items-center justify-between gap-3 px-1 pb-3 pr-28 sm:pr-32">
            <div className="flex min-w-0 items-center gap-3">
              {sessionUser && (
                <button
                  type="button"
                  onClick={() => setActiveTab('mylayer')}
                  aria-label="Your profile"
                  title="Your profile"
                  className="shrink-0 flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#8B4FFF] to-[#E85D75] text-[14px] font-black text-white shadow-md cursor-pointer transition-transform duration-150 hover:scale-105 active:scale-95"
                >
                  {(sessionUser.displayName || sessionUser.handle || '?').charAt(0).toUpperCase()}
                </button>
              )}
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#7A8494]">
                  {activeNeighborhood.name.toUpperCase()} · HOME
                </p>
                <h1 className="truncate font-display text-xl font-black leading-tight tracking-tight text-[var(--brief-ink)] sm:text-2xl">
                  {activeNeighborhood.name} Feed
                </h1>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { soundEngine.play('heavyTap'); setCreatePostModalOpen(true); }}
                className="px-3.5 py-1.5 rounded-xl bg-[color:var(--brief-ink)] hover:bg-black text-white font-bold text-xs flex items-center space-x-1.5 shadow-sm cursor-pointer transition-all active:scale-95"
                title="Publish Event, Product or Announcement"
              >
                <Plus className="w-3.5 h-3.5 text-[#E8985E]" />
                <span>Post</span>
              </button>

              <button
                type="button"
                onClick={() => { soundEngine.play('tap'); setIsNeighborhoodPickerOpen(true); }}
                className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-black/10 text-[var(--brief-ink)] font-bold text-xs flex items-center space-x-1.5 shadow-sm cursor-pointer transition-all active:scale-95"
                title={`Current neighborhood: ${activeNeighborhood.name} (${activeNeighborhood.county})`}
              >
                <MapPin className="w-3.5 h-3.5 text-[#B8621F]" />
                <span className="truncate max-w-[120px]">Ward · {activeNeighborhood.name}</span>
              </button>
            </div>
          </div>

          {/* Ladder Next Step (Home View) */}
          {nearbySection === 'stream' && (
            <>
              {!nextStepHidden && showsLadder('nearby') && (
                <div className="mb-3">
                  <NextStep
                    ladder={ladder}
                    onDismiss={() => setNextStepHidden(true)}
                    onAct={(rungId) => {
                      if (rungId === 'identity' || rungId === 'orient') {
                        setFirstRunOpen(true);
                        return;
                      }
                      if (rungId === 'value') {
                        setActiveTab('nearby');
                        setNearbySection('stream');
                        return;
                      }
                      if (rungId === 'contribute') {
                        setCaptureOpen(true);
                        return;
                      }
                      setActiveTab('workflows');
                      setWorkflowSection('campaigns');
                      setWorkflowView('screen');
                    }}
                  />
                </div>
              )}

              {/* ================= OPTIMIZELY HERO & TRUST BANNER ================= */}
              {discoveryTab === 'home' && (
                <div className="space-y-4 mb-6">
                  <OptimizelyHeroSection
                    locationName={activeNeighborhood.name}
                    onExploreWard={() => {
                      soundEngine.play('tap');
                      setDiscoveryTab('explore');
                    }}
                    onOpenCargo={() => {
                      soundEngine.play('heavyTap');
                      setInterCountyOpen(true);
                    }}
                    onOpenCircle={() => {
                      soundEngine.play('heavyTap');
                      setCircleOpen(true);
                    }}
                    onOpenCbc={() => {
                      setActiveCbcBundleId('cbc-g7');
                      setCbcCheckoutOpen(true);
                    }}
                  />

                  <AnnouncementPinkBanner
                    tag="LIVE WARD RUNS"
                    title="Save your spot at Ward Circle & CBC Bulk Runs"
                    buttonText="Register now"
                    onAction={() => {
                      soundEngine.play('heavyTap');
                      setDemandRunOpen(true);
                    }}
                  />

                  <TrustedPartnerRibbon
                    onPartnerClick={(p: PartnerPill) => {
                      if (p.id === 'fargo' || p.id === 'lori' || p.id === 'sendy') {
                        setInterCountyOpen(true);
                      } else if (p.id === 'pezesha' || p.id === 'mpesa') {
                        setCircleOpen(true);
                      } else if (p.id === 'kicd') {
                        setActiveCbcBundleId('cbc-g7');
                        setCbcCheckoutOpen(true);
                      } else {
                        showToast(`Verified integration: ${p.name}`);
                      }
                    }}
                  />

                  <AgenticFeatureGrid
                    onOpenCbc={() => {
                      setActiveCbcBundleId('cbc-g7');
                      setCbcCheckoutOpen(true);
                    }}
                    onOpenCircle={() => {
                      soundEngine.play('heavyTap');
                      setCircleOpen(true);
                    }}
                    onOpenCargo={() => {
                      soundEngine.play('heavyTap');
                      setInterCountyOpen(true);
                    }}
                  />
                </div>
              )}

              {/* ================= TODAY'S OPPORTUNITIES STRIP ================= */}
              {discoveryTab === 'home' && (
                <div className="mb-6">
                  <TodayOpportunities
                    onSelectOpportunity={(opp) => {
                      if (opp.category === 'gigs') {
                        setSelectedObjectType('opportunity');
                        setDiscoveryTab('opportunities');
                      } else if (opp.category === 'cargo') {
                        setInterCountyOpen(true);
                      } else if (opp.category === 'demand') {
                        setActiveCbcBundleId('cbc-g7');
                        setCbcCheckoutOpen(true);
                      } else if (opp.category === 'circle') {
                        setCircleOpen(true);
                      } else if (opp.category === 'events') {
                        setSelectedObjectType('experience');
                        setDiscoveryTab('events');
                      } else if (opp.category === 'creator') {
                        setCreatorDeskOpen(true);
                      }
                    }}
                  />
                </div>
              )}

              {/* ================= TOWN CENTRE DISTRICTS & SERVICES (6 PILLARS) ================= */}
              {discoveryTab === 'home' && (
                <section className="mb-6 space-y-2.5" aria-label="Town Centre Districts">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-[#0891B2] animate-pulse" />
                      <h3 className="text-xs font-black uppercase tracking-[0.16em] text-[var(--brief-ink)]">
                        Town Centre Districts & Services
                      </h3>
                    </div>
                    <span className="text-[11px] font-mono text-gray-500 font-bold">6 Verified Desks</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                    {/* 1. WAIRO Cargo Desk */}
                    <button
                      type="button"
                      onClick={() => { soundEngine.play('heavyTap'); setInterCountyOpen(true); }}
                      className="p-3.5 rounded-2xl bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0A101D] text-left text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex flex-col justify-between group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xl">🚚</span>
                        <span className="text-[11px] font-mono uppercase bg-[#0891B2] text-[var(--brief-ink)] px-1.5 py-0.5 rounded font-black">
                          WAIRO 90/10
                        </span>
                      </div>
                      <div className="mt-3">
                        <span className="font-black text-xs block text-white leading-tight group-hover:text-cyan-300 transition-colors">
                          WAIRO Cargo
                        </span>
                        <span className="text-[11px] text-cyan-200/70 block mt-0.5 font-medium">
                          47 Counties Courier
                        </span>
                      </div>
                    </button>

                    {/* 2. Circle & Table Banking */}
                    <button
                      type="button"
                      onClick={() => { soundEngine.play('heavyTap'); setCircleOpen(true); }}
                      className="p-3.5 rounded-2xl bg-gradient-to-br from-[#311042] via-[#240c31] to-[#1E092B] text-left text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex flex-col justify-between group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xl">🌸</span>
                        <span className="text-[11px] font-mono uppercase bg-purple-400/25 text-purple-300 px-1.5 py-0.5 rounded font-bold">
                          Cycle 5 (KES 60k)
                        </span>
                      </div>
                      <div className="mt-3">
                        <span className="font-black text-xs block text-white leading-tight group-hover:text-purple-300 transition-colors">
                          Circle & Table Bank
                        </span>
                        <span className="text-[11px] text-purple-200/70 block mt-0.5 font-medium">
                          Pezesha Scoring
                        </span>
                      </div>
                    </button>

                    {/* 3. CBC School Books & Bulk Runs */}
                    <button
                      type="button"
                      onClick={() => { soundEngine.play('heavyTap'); setDemandRunOpen(true); }}
                      className="p-3.5 rounded-2xl bg-gradient-to-br from-[#292524] via-[#1C1917] to-[#0C0A09] text-left text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex flex-col justify-between group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xl">📚</span>
                        <span className="text-[11px] font-mono uppercase bg-[#B8621F] text-white px-1.5 py-0.5 rounded font-black">
                          Save 28%
                        </span>
                      </div>
                      <div className="mt-3">
                        <span className="font-black text-xs block text-white leading-tight group-hover:text-amber-300 transition-colors">
                          CBC School Books
                        </span>
                        <span className="text-[11px] text-amber-200/70 block mt-0.5 font-medium">
                          Fargo KES 50 Pickup
                        </span>
                      </div>
                    </button>

                    {/* 4. Paid Gigs & Errand Runner (With Live Blinking Signal) */}
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.play('tap');
                        setSelectedObjectType('opportunity');
                        setDiscoveryTab('opportunities');
                      }}
                      className="relative p-3.5 rounded-2xl bg-gradient-to-br from-[#064E3B] via-[#043d2e] to-[#022C22] text-left text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex flex-col justify-between group overflow-hidden"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xl">💼</span>
                        <div className="flex items-center space-x-1 bg-emerald-500/30 text-emerald-300 px-1.5 py-0.5 rounded text-[11px] font-mono font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                          <span>2 Live Gigs</span>
                        </div>
                      </div>
                      <div className="mt-3">
                        <span className="font-black text-xs block text-white leading-tight group-hover:text-emerald-300 transition-colors">
                          Paid Gigs & Errands
                        </span>
                        <span className="text-[11px] text-emerald-200/70 block mt-0.5 font-medium">
                          Boda & Micro-work
                        </span>
                      </div>
                    </button>

                    {/* 5. Group Events & Touring */}
                    <button
                      type="button"
                      onClick={() => { soundEngine.play('heavyTap'); setEventLogisticsOpen(true); }}
                      className="p-3.5 rounded-2xl bg-gradient-to-br from-[#1E1B4B] via-[#312E81] to-[#1E1B4B] text-left text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex flex-col justify-between group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xl">🚌</span>
                        <span className="text-[11px] font-mono uppercase bg-emerald-400/30 text-emerald-300 px-1.5 py-0.5 rounded font-bold">
                          Touring Ops
                        </span>
                      </div>
                      <div className="mt-3">
                        <span className="font-black text-xs block text-white leading-tight group-hover:text-emerald-300 transition-colors">
                          Group Touring
                        </span>
                        <span className="text-[11px] text-emerald-200/70 block mt-0.5 font-medium">
                          Choirs & Charters
                        </span>
                      </div>
                    </button>

                    {/* 6. Creator Partner Desk */}
                    <button
                      type="button"
                      onClick={() => { soundEngine.play('heavyTap'); setCreatorDeskOpen(true); }}
                      className="p-3.5 rounded-2xl bg-gradient-to-br from-[#451A03] via-[#78350F] to-[#451A03] text-left text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex flex-col justify-between group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xl">🏅</span>
                        <span className="text-[11px] font-mono uppercase bg-amber-400/30 text-amber-300 px-1.5 py-0.5 rounded font-bold">
                          15% Cut
                        </span>
                      </div>
                      <div className="mt-3">
                        <span className="font-black text-xs block text-white leading-tight group-hover:text-amber-300 transition-colors">
                          Creator Partner
                        </span>
                        <span className="text-[11px] text-amber-200/70 block mt-0.5 font-medium">
                          Living Groups
                        </span>
                      </div>
                    </button>
                  </div>
                </section>
              )}

              {/* Main Shelf Component */}
              <MainShelf
                onSelect={handleMenuSelect}
                ladder={ladder}
                onLocked={(info) => {
                  noteActivation('service_locked_tapped', { card: info.cardId, requires: info.requires });
                  showToast(info.unlocksAfter ? `Opens after: ${info.unlocksAfter}` : 'Not open yet');
                }}
              />

              {/* ================= OPTIMIZELY CALLOUT & INTEGRATIONS STACK ================= */}
              {discoveryTab === 'home' && (
                <div className="space-y-6 my-8">
                  <AgenticCalloutBanner
                    onAction={() => {
                      soundEngine.play('tap');
                      setDiscoveryTab('explore');
                    }}
                  />

                  <IntegrationsStackSection
                    onOpenIntegrations={() => {
                      showToast('Brief integrates directly with M-Pesa, Pezesha Credit, Fargo Courier, Lori Systems, Sendy, WhatsApp & KICD.');
                    }}
                  />
                </div>
              )}

              {/* MY BRIEF SECTION (For signed-in users) */}
              {discoveryTab === 'home' && sessionUser && personalState && (
                <section className="mb-8" aria-label="My Brief">
                  <BriefBuilderSection
                    suggestedLocations={personalState.suggestedLocations?.length ? personalState.suggestedLocations : ['Machakos', 'Nairobi', 'Kilimani', 'Westlands', 'Eastlands']}
                    availableTypes={availableTypes.map(t => ({ id: t, label: getObjectTypeMeta(t).label }))}
                    topics={personalState.topics ?? []}
                    initialCities={personalPicks.locations}
                    initialTypes={personalPicks.types}
                    initialInterests={personalPicks.topics}
                    initialExpanded={!personalHasInterests && !personalBriefDismissed}
                    followedCount={(personalState.followed ?? []).length}
                    updatesCount={notifUnread}
                    onCityToggle={(city) => togglePersonalPick('locations', city)}
                    onTypeToggle={(typeId) => togglePersonalPick('types', typeId)}
                    onTopicToggle={(topicId) => togglePersonalPick('topics', topicId)}
                    onSkip={() => setPersonalBriefDismissed(true)}
                    onBuildBrief={({ cities, types, topics: selectedTopics }) => {
                      void savePersonalBrief({
                        locations: cities ?? personalPicks.locations,
                        types: types ?? personalPicks.types,
                        topics: selectedTopics ?? personalPicks.topics
                      });
                    }}
                    onOpenCollections={() => setCollectionsOpen(true)}
                    onOpenFollowing={() => setFollowingOpen(true)}
                    onOpenUpdates={() => setNotificationsOpen(true)}
                  />

                  {!personalHasInterests && personalBriefDismissed && (
                    <p className="rounded-2xl bg-white/70 shadow-sm px-4 py-3 text-[12px] text-[var(--ink-70)] mt-3">
                      Your Brief is global until you follow places or topics.{' '}
                      <button
                        type="button"
                        onClick={() => setPersonalBriefDismissed(false)}
                        className="font-black text-[#B8621F] cursor-pointer"
                      >
                        Personalize
                      </button>
                    </p>
                  )}

                  {/* FOLLOWING Chips */}
                  {personalHasInterests && (
                    <div className="mb-4 flex flex-wrap items-center gap-1.5">
                      {personalInterests.locations.map((loc: any) => (
                        <button
                          key={`loc_${loc}`}
                          type="button"
                          onClick={() => void unfollowOne('location', loc)}
                          title={`Stop following ${loc}`}
                          className="flex items-center gap-1 rounded-full bg-[color:var(--brief-ink)] px-3 py-1.5 text-[12px] font-bold text-white cursor-pointer shadow-sm"
                        >
                          {loc} <X className="h-3 w-3" />
                        </button>
                      ))}
                      {personalInterests.types.map((t: any) => (
                        <button
                          key={`typ_${t}`}
                          type="button"
                          onClick={() => void unfollowOne('type', t)}
                          title={`Stop following ${getObjectTypeMeta(t as ObjectType).label}`}
                          className="flex items-center gap-1 rounded-full bg-[#F0EDE8] px-3 py-1.5 text-[12px] font-bold text-[var(--brief-ink)] cursor-pointer"
                        >
                          {getObjectTypeMeta(t as ObjectType).label} <X className="h-3 w-3" />
                        </button>
                      ))}
                      {personalInterests.topics.map((topicId: any) => {
                        const topic = personalState.topics.find((t: any) => t.id === topicId);
                        if (!topic) return null;
                        return (
                          <button
                            key={`top_${topicId}`}
                            type="button"
                            onClick={() => void unfollowOne('topic', topicId)}
                            title={`Stop following ${topic.label}`}
                            className="flex items-center gap-1 rounded-full bg-[#F0EDE8] px-3 py-1.5 text-[12px] font-bold text-[var(--brief-ink)] cursor-pointer"
                          >
                            {topic.label} <X className="h-3 w-3" />
                          </button>
                        );
                      })}
                      {(personalState.followed ?? []).map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => openEntityPage(f.id)}
                          title={`Open ${f.name}`}
                          className="flex items-center gap-1 rounded-full bg-white shadow-sm px-3 py-1.5 text-[12px] font-bold text-[var(--brief-ink)] cursor-pointer"
                        >
                          {f.name}
                        </button>
                      ))}
                      {(personalState.followed ?? []).map((f) => (
                        <button
                          key={`unf_${f.id}`}
                          type="button"
                          onClick={() => void unfollowEntityOne(f.id)}
                          title={`Stop following ${f.name}`}
                          className="flex items-center gap-1 rounded-full bg-black/5 px-2 py-1 text-[11px] font-bold text-[var(--ink-60)] cursor-pointer hover:bg-rose-50 hover:text-rose-600 transition-colors"
                        >
                          <X className="h-2.5 w-2.5" /> {f.kind}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* PERSONAL SECTIONS */}
                  {personalSections.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {personalSections.map((section: any) => (
                        <div
                          key={section.key}
                          className="rounded-2xl bg-white p-3.5 shadow-sm"
                        >
                          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--ink-60)]">
                            {section.title}
                          </p>
                          <div className="mt-2 space-y-1">
                            {section.objects.slice(0, 4).map((obj: any) => (
                              <button
                                key={obj.id}
                                type="button"
                                onClick={() => setSelectedObjectForDetail(obj)}
                                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[#F7F7F5] cursor-pointer"
                              >
                                {obj.imageUrl ? (
                                  <img
                                    src={obj.imageUrl}
                                    alt=""
                                    aria-hidden="true"
                                    loading="lazy"
                                    className="h-9 w-9 shrink-0 rounded-lg object-cover"
                                  />
                                ) : (
                                  <span
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[15px] bg-[#F0EDE8] text-[#B8621F] font-bold"
                                    aria-hidden="true"
                                  >
                                    {getObjectTypeMeta(obj.type).label.charAt(0)}
                                  </span>
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-bold text-[var(--brief-ink)]">
                                    {obj.title}
                                  </span>
                                  {briefWhenLabel(obj) && (
                                    <span className="block truncate text-[11px] font-medium text-[var(--brief-muted)]">
                                      {briefWhenLabel(obj)}
                                    </span>
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* SAVED GROUPS PANEL */}
                  {personalSavedGroups && personalSavedGroups.length > 0 && (
                    <div className="mt-4 rounded-2xl bg-white p-3.5 shadow-sm">
                      <div className="mb-2 flex items-center gap-2">
                        <Bookmark className="h-3.5 w-3.5 text-[var(--ink-60)]" />
                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--ink-70)]">
                          Saved
                        </p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {personalSavedGroups.map((group: any) => (
                          <div key={group.key}>
                            <p className="text-[11px] font-black text-[var(--ink-70)]">
                              {group.title}
                              <span className="ml-1.5 text-[11px] font-bold text-[var(--ink-60)]">
                                {group.items.length + group.expired.length}
                              </span>
                            </p>
                            <div className="mt-1.5 space-y-0.5">
                              {group.items.slice(0, 3).map((obj: any) => (
                                <button
                                  key={obj.id}
                                  type="button"
                                  onClick={() => setSelectedObjectForDetail(obj)}
                                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[#F0EDE8] cursor-pointer"
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[12px] font-bold text-[var(--brief-ink)]">
                                      {obj.title}
                                    </span>
                                    {briefWhenLabel(obj) && (
                                      <span className="block truncate text-[11px] font-medium text-[var(--brief-muted)]">
                                        {briefWhenLabel(obj)}
                                      </span>
                                    )}
                                  </span>
                                </button>
                              ))}
                              {group.expired.slice(0, 3).map((obj: any) => (
                                <button
                                  key={obj.id}
                                  type="button"
                                  onClick={() => setSelectedObjectForDetail(obj)}
                                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[#F0EDE8] cursor-pointer opacity-60"
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[12px] font-bold text-[var(--brief-ink)] line-through">
                                      {obj.title}
                                    </span>
                                    <span className="block truncate text-[11px] font-black text-[#B8621F]">
                                      Expired
                                    </span>
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* TODAY'S BRIEF */}
              {discoveryTab === 'home' && discoveryBrief.length > 0 && (
                <section className="mb-8" aria-label="Today's Brief">
                  <h2 className="mb-3 px-1 text-[12px] font-black uppercase tracking-[0.22em] text-[var(--ink-70)]">
                    Today's Brief
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {discoveryBrief.map((section: any) => (
                      <div
                        key={section.key}
                        className="rounded-2xl bg-white p-3.5 shadow-sm"
                      >
                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--ink-60)]">
                          {section.title}
                        </p>
                        <div className="mt-2 space-y-1">
                          {section.objects.slice(0, 4).map((obj: any) => (
                            <button
                              key={obj.id}
                              type="button"
                              onClick={() => setSelectedObjectForDetail(obj)}
                              className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[#F7F7F5] cursor-pointer"
                            >
                              {obj.imageUrl ? (
                                <img
                                  src={obj.imageUrl}
                                  alt=""
                                  aria-hidden="true"
                                  loading="lazy"
                                  className="h-9 w-9 shrink-0 rounded-lg object-cover"
                                />
                              ) : (
                                <span
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[15px] bg-[#F0EDE8] text-[#B8621F] font-bold"
                                  aria-hidden="true"
                                >
                                  {getObjectTypeMeta(obj.type).label.charAt(0)}
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-bold text-[var(--brief-ink)]">
                                  {obj.title}
                                </span>
                                {briefWhenLabel(obj) && (
                                  <span className="block truncate text-[11px] font-medium text-[var(--brief-muted)]">
                                    {briefWhenLabel(obj)}
                                  </span>
                                )}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* DYNAMIC ERRAND & GIG NOTIFICATION BANNER (When Opportunities/Gigs active) */}
              {discoveryTab === 'opportunities' && (
                <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-[#0F172A] to-[#1E293B] text-white shadow-md animate-fadeIn">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start space-x-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                        <Bike className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                          <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-300">
                            WAIRO Boda Gig Dispatch
                          </span>
                          <span className="text-[11px] px-1.5 py-0.2 rounded bg-emerald-500/30 text-emerald-200 font-bold">
                            90% Payout
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-white mt-0.5">
                          2 Courier & Errand Runs Ready in {activeNeighborhood.name}
                        </h4>
                        <p className="text-xs text-gray-300 mt-0.5">
                          Westlands Sarit ➔ CBD Kencom (KES 250) · Kilimani Drop (KES 320)
                        </p>
                      </div>
                    </div>
                    
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.play('heavyTap');
                        setWairoMiniAppOpen(true);
                      }}
                      className="px-4 py-2 rounded-xl bg-[#10B981] hover:bg-[#059669] text-white font-bold text-xs flex items-center justify-center space-x-1.5 shadow-md cursor-pointer transition-transform active:scale-95"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Open Courier Mini App</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Feed Composer Magazine */}
              <FeedComposer
                key={feedReload}
                typeFilter={selectedObjectType}
                onFeedStatus={setHomeFeedStatus}
                area={feedArea}
                geo={userLocation ? { lat: userLocation.lat, lng: userLocation.lng, radiusKm: 40 } : null}
                type={discoveryTab === 'events' ? 'experience'
                  : discoveryTab === 'offers' ? 'offer'
                    : discoveryTab === 'places' ? 'place'
                      : discoveryTab === 'news' ? 'news'
                        : discoveryTab === 'opportunities' ? 'opportunity'
                          : null}
                browse={discoveryTab === 'explore'}
                onOpen={(raw) => {
                  if (!raw?.id) return;
                  const local = objects.find((object) => object.id === String(raw.id));
                  setSelectedObjectForDetail(local ?? objectFromServer(raw));
                }}
                onOpenTea={(slug) => setSelectedTeaSlug(slug)}
                onOpenTag={(tag: any) => {
                  setSearchQuery(tag);
                  setNearbySection('stream');
                }}
              />
            </>
          )}
        </div>

        {/* Discovery Navigation Pill Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2">
          {(() => {
            const counts: Record<string, number> = {};
            for (const o of objects) {
              counts[o.type] = (counts[o.type] ?? 0) + 1;
            }
            const has = (types: string[]) => types.some((t: any) => (counts[t] ?? 0) > 0);
            const tabs = [
              { id: 'home', label: 'Home', types: null as string[] | null },
              { id: 'events', label: 'Events', types: ['experience', 'event'] },
              { id: 'explore', label: 'Explore', types: null as string[] | null },
              { id: 'offers', label: 'Offers', types: ['offer'] },
              { id: 'places', label: 'Places', types: ['place'] },
              { id: 'news', label: 'News', types: ['news'] },
              { id: 'opportunities', label: 'Opportunities', types: ['opportunity'] }
            ];
            return tabs
              .filter((tab) => !tab.types || has(tab.types))
              .map((tab) => {
                const isActive = nearbySection === 'stream' && discoveryTab === tab.id;
                const isOpportunities = tab.id === 'opportunities';

                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      soundEngine.play('tap');
                      setDiscoveryTab(tab.id as typeof discoveryTab);
                      const type = tab.id === 'events' ? 'experience'
                        : tab.id === 'offers' ? 'offer'
                          : tab.id === 'places' ? 'place'
                            : tab.id === 'news' ? 'news'
                              : tab.id === 'opportunities' ? 'opportunity'
                                : 'all';
                      setSelectedObjectType(type);
                      setNearbySection('stream');
                    }}
                    className={`shrink-0 relative px-3.5 py-1.5 rounded-full text-[12px] font-black transition-all cursor-pointer flex items-center space-x-1.5 ${
                      isActive
                        ? 'bg-[color:var(--brief-ink)] text-white shadow-sm scale-[1.02]'
                        : 'bg-white text-[var(--ink-75)] hover:bg-[#F0EDE8] hover:text-[var(--brief-ink)]'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {isOpportunities && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                    )}
                  </button>
                );
              });
          })()}

          <button
            onClick={() => {
              soundEngine.play('tap');
              setMoreFilters((v) => !v);
            }}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-black transition-all cursor-pointer ${
              moreFilters
                ? 'bg-[#B8621F] text-white shadow-sm'
                : 'bg-white text-[var(--ink-75)] hover:bg-[#F0EDE8]'
            }`}
          >
            More
          </button>
        </div>

        {/* More Filters Panel */}
        {moreFilters && (
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar pt-2 animate-fadeIn">
            {([
              ['tea', HOME_MORE.tea],
              ['today', `${HOME_MORE.today}${dailyBrief.length > 0 ? ' *' : ''}`],
              ['pursuits', `${HOME_MORE.pursuits}${pursuits.length > 0 ? ` (${pursuits.length})` : ''}`],
              ['quests', `${HOME_MORE.quests}${openQuests.length > 0 ? ` (${openQuests.length})` : ''}`],
              ['market', HOME_MORE.market],
              ['events', HOME_MORE.events]
            ] as [NearbySection, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  soundEngine.play('tap');
                  setNearbySection(id);
                }}
                className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold cursor-pointer transition-all ${
                  nearbySection === id
                    ? 'bg-[#B8621F] text-white shadow-sm'
                    : 'bg-white text-[var(--ink-70)] hover:bg-[#F0EDE8]'
                }`}
              >
                {label}
              </button>
            ))}
            {[
              { id: 'service', label: FILTERS.service },
              { id: 'product', label: FILTERS.product },
            ].map((filter) => (
              <button
                key={filter.id}
                onClick={() => {
                  soundEngine.play('tap');
                  setSelectedObjectType(filter.id);
                  setNearbySection('stream');
                }}
                className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold cursor-pointer transition-all ${
                  nearbySection === 'stream' && selectedObjectType === filter.id
                    ? 'bg-[color:var(--brief-ink)] text-white shadow-sm'
                    : 'bg-white text-[var(--ink-70)] hover:bg-[#F0EDE8]'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ================= STREAM SECTION ================= */}
      {nearbySection === 'stream' && (
        <div className="max-w-5xl mx-auto px-2 sm:px-4 mt-6">
          {/* Money Band */}
          <MoneyBand
            objects={objects}
            areaHint={feedArea}
            onOpenSection={(section: any) => setNearbySection(section)}
          />

          {/* Happening Nearby Rail */}
          {(() => {
            const active = objects
              .filter((obj: any) => {
                if (!isDestinationObject(obj)) return false;
                const state = getDestinationState(obj);
                return state === 'live' || state === 'today';
              })
              .sort((a, b) => {
                const da = a.metadata?.distanceKm ?? Number.MAX_SAFE_INTEGER;
                const db = b.metadata?.distanceKm ?? Number.MAX_SAFE_INTEGER;
                return da - db;
              })
              .slice(0, 3);
            if (active.length === 0) return null;
            return (
              <section className="mx-auto mb-8 max-w-5xl">
                <h2 className="mb-3 px-1 text-[12px] font-black uppercase tracking-[0.22em] text-[var(--ink-70)]">
                  Happening nearby
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {active.map((obj: any) => {
                    const vendors = getDestinationVendors(obj, objects);
                    return (
                      <button
                        key={obj.id}
                        type="button"
                        onClick={() => setSelectedObjectForDetail(obj)}
                        aria-label={obj.title}
                        className="group relative min-h-[170px] overflow-hidden rounded-2xl bg-white text-left transition-transform duration-200 hover:-translate-y-0.5 shadow-sm"
                      >
                        {obj.imageUrl ? (
                          <img
                            src={obj.imageUrl}
                            alt=""
                            aria-hidden="true"
                            loading="lazy"
                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <div className="absolute inset-0 bg-gradient-to-br from-[#1E293B] to-[var(--brief-ink)]" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                        <div className="absolute inset-x-3 bottom-3">
                          <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-white">
                            {obj.title}
                          </h3>
                          {(() => {
                            const dist = getDistanceLabel(obj);
                            const loc = obj.locationName ? String(obj.locationName).trim() : null;
                            if (!dist && !loc) return null;
                            return (
                              <p className="mt-0.5 text-[11px] font-medium text-white/80">
                                {[dist, loc].filter(Boolean).join(' · ')}
                              </p>
                            );
                          })()}
                          {vendors.length > 0 && (
                            <p className="mt-1 text-[11px] font-bold text-amber-300">
                              {vendors.length} {vendors.length === 1 ? 'vendor' : 'vendors'} inside
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          {/* Search Input Box */}
          {homeFeedStatus === 'ready' && (
            <div className="mx-auto mb-4 max-w-5xl px-1">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-50)]" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRecentSearch(searchQuery); }}
                  placeholder="Search venues, businesses, organizers, areas…"
                  aria-label="Search Brief"
                  className="w-full rounded-2xl bg-white shadow-sm py-2.5 pl-10 pr-10 text-[14px] font-bold text-[var(--brief-ink)] outline-none transition-colors placeholder:text-[var(--ink-40)] focus:ring-2 focus:ring-[#B8621F]/20"
                />
                {searchQuery !== '' && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--ink-50)] transition-colors hover:text-[var(--brief-ink)] cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </label>

              {searchQuery === '' && searchFocused && (recentSearches.length > 0 || nearbyCategories.length > 0) && (
                <div className="mt-3 space-y-3 p-3 rounded-2xl bg-white shadow-md animate-fadeIn">
                  {recentSearches.length > 0 && (
                    <div>
                      <p className="mb-1.5 px-1 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--ink-60)]">Recent</p>
                      <div className="flex flex-wrap gap-1.5">
                        {recentSearches.map((term) => (
                          <button
                            key={term}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => setSearchQuery(term)}
                            className="rounded-full bg-[#F0EDE8] px-3 py-1.5 text-[13px] font-bold text-[var(--brief-ink)] transition-colors hover:bg-[#B8621F] hover:text-white cursor-pointer"
                          >
                            {term}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {nearbyCategories.length > 0 && (
                    <div>
                      <p className="mb-1.5 px-1 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--ink-60)]">Nearby categories</p>
                      <div className="flex flex-wrap gap-1.5">
                        {nearbyCategories.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => setSearchQuery(cat)}
                            className="rounded-full bg-[#F7F7F5] px-3 py-1.5 text-[13px] font-bold text-[var(--ink-80)] transition-colors hover:bg-[color:var(--brief-ink)] hover:text-white cursor-pointer"
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Search Results */}
          {searchQuery.trim() !== '' && (
            <SearchResults
              query={searchQuery}
              onOpenObject={(o) => setSelectedObjectForDetail(objectFromServer(o))}
              onOpenEntity={openEntityPage}
            />
          )}

          {/* Legacy Objects Fallback Stream */}
          {(homeFeedStatus !== 'ready' || searchQuery.trim() !== '') && (
            <>
              {filteredObjects.length > 0 ? (
                <section className="mx-auto max-w-5xl">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {filteredObjects.map((obj: any) => {
                      const destVendors = isDestinationObject(obj)
                        ? getDestinationVendors(obj, objects)
                        : [];
                      const level = getCardLevel(obj, destVendors.length);
                      const destState = getDestinationState(obj);
                      const status = level >= 2
                        ? DESTINATION_STATE_LABELS[destState]
                        : obj.metadata?.statusBadge;
                      return (
                        <div
                          key={obj.id}
                          onClick={() => setSelectedObjectForDetail(obj)}
                          className={`group relative min-h-[210px] cursor-pointer overflow-hidden rounded-2xl bg-white transition-transform duration-200 hover:-translate-y-0.5 shadow-sm ${
                            level === 3 ? 'sm:col-span-2 sm:row-span-2 min-h-[270px]' : ''
                          }`}
                        >
                          {obj.imageUrl ? (
                            <img
                              src={obj.imageUrl}
                              alt=""
                              aria-hidden="true"
                              loading="lazy"
                              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                            />
                          ) : (
                            <div className="absolute inset-0 bg-gradient-to-br from-[#1E293B] to-[var(--brief-ink)]" />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent" />
                          <div className="absolute left-3 top-3 flex max-w-[calc(100%-24px)] flex-wrap gap-1.5">
                            <span className="rounded-full bg-white/90 backdrop-blur-sm px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-[var(--brief-ink)]">
                              {getObjectTypeMeta(obj.type).label}
                            </span>
                            {!obj.imageUrl && obj.category && (
                              <span className="rounded-full bg-white/90 backdrop-blur-sm px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-[var(--brief-ink)]">
                                {obj.category}
                              </span>
                            )}
                            {obj.isVerified && (
                              <span className="rounded-full bg-[#10B981] px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-white">
                                VERIFIED
                              </span>
                            )}
                            {status && (
                              <span className="rounded-full bg-white/90 backdrop-blur-sm px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-[var(--brief-ink)]">
                                {status}
                              </span>
                            )}
                            {(() => {
                              const life = getLifecycleBadge(obj);
                              if (!life) return null;
                              return (
                                <span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${
                                  life.expired
                                    ? 'bg-[rgba(10, 14, 20, 0.80)] text-[var(--brief-ink)]'
                                    : 'bg-[#F0EDE8] text-[var(--brief-ink)]'
                                }`}>
                                  {life.label}
                                </span>
                              );
                            })()}
                          </div>
                          <div className="absolute inset-x-3 bottom-3">
                            <h3 className="line-clamp-3 pr-2 text-[15px] font-bold leading-snug text-white">
                              {obj.title}
                            </h3>
                            {(() => {
                              const sourceChip = getSourceChip(obj);
                              const published = getPublishedLine(obj);
                              if (!sourceChip && !published) return null;
                              const bits = [sourceChip, published].filter(Boolean);
                              return (
                                <p className="mt-1 text-[11px] font-semibold text-white/80 truncate">
                                  {bits.join(' · ')}
                                </p>
                              );
                            })()}
                            {(() => {
                              const chips = entityChipsFor(obj);
                              if (chips.length === 0) return null;
                              return (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {chips.map((chip, i) => (
                                    <EntityChip
                                      key={`${chip.kind}_${chip.name ?? chip.directId}_${i}`}
                                      kind={chip.kind}
                                      name={chip.name}
                                      directId={chip.directId}
                                      onOpenEntity={openEntityPage}
                                      className="bg-black/60 text-white hover:bg-[#B8621F]"
                                    />
                                  ))}
                                </div>
                              );
                            })()}
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (level === 3 && destVendors.length > 0) {
                                    setSelectedObjectForDetail(obj);
                                  } else {
                                    handlePrimaryAction(obj);
                                  }
                                }}
                                className="rounded-full bg-white/90 backdrop-blur-sm px-3 py-1 text-[11px] font-bold text-[var(--brief-ink)] transition-colors hover:bg-[#B8621F] hover:text-white"
                              >
                                {level === 3 && destVendors.length > 0 ? "See what's here" : resolveAction(obj).label}
                              </button>
                              <button
                                type="button"
                                aria-label={`Save ${obj.title}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleExecuteProtocolAction('save', obj);
                                }}
                                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm text-[var(--brief-ink)] transition-colors hover:bg-[#B8621F] hover:text-white"
                              >
                                <Bookmark className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : (
                <section className="mx-auto max-w-5xl py-10 text-center rounded-3xl bg-white p-8 shadow-sm">
                  {searchQuery.trim() !== '' ? (
                    <>
                      <h2 className="text-base font-bold text-[var(--brief-ink)]">Nothing nearby matching "{searchQuery}"</h2>
                      <p className="mt-1 text-xs text-[var(--brief-muted)]">Start a verified neighborhood pursuit to track updates automatically.</p>
                      <button
                        type="button"
                        onClick={() => handleCreatePursuit(searchQuery)}
                        className="mt-4 rounded-xl bg-[color:var(--brief-ink)] text-white px-4 py-2 text-[12px] font-bold shadow-sm"
                      >
                        Keep pursuing "{searchQuery}"
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-2xl bg-[#B8621F]/10 text-[#B8621F] flex items-center justify-center mx-auto mb-3">
                        <Sparkles className="w-6 h-6" />
                      </div>
                      <h2 className="text-base font-black text-[var(--brief-ink)]">Welcome to {activeNeighborhood.name} Feed</h2>
                      <p className="mt-1 text-xs text-[var(--brief-muted)] max-w-sm mx-auto">
                        Your neighbors' gigs, bulk runs, and events appear here in real time.
                      </p>
                      <div className="mt-4 flex justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setCreatePostModalOpen(true)}
                          className="rounded-xl bg-[#B8621F] px-4 py-2 text-[12px] font-bold text-white shadow-sm hover:bg-[#8B4513] transition-colors"
                        >
                          Post to {activeNeighborhood.name}
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}
            </>
          )}

          {/* Welcoming Mat Component */}
          <div className="mt-8">
            <WelcomingMat
              onOpenSolidarity={() => setCommitteeOpen(true)}
              onOpenWellbeing={() => setWellbeingOpen(true)}
              className="max-w-5xl mx-auto px-1"
            />
          </div>

          {/* Curated Neighborhood Discovery Matrix */}
          <section className="mx-auto my-10 max-w-5xl px-1">
            <div className="rounded-[28px] bg-white p-6 sm:p-8 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-6 border-b border-black/[0.06]">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-[#B8621F]" />
                    <h2 className="text-sm font-black uppercase tracking-widest text-[var(--brief-ink)]">
                      {activeNeighborhood.name} Discovery & Operations
                    </h2>
                  </div>
                  <p className="text-xs text-[var(--brief-muted)] mt-1 ml-4 font-medium">
                    Verified community desks, bulk supply runs, and logistics corridors in {activeNeighborhood.county}
                  </p>
                </div>
                <span className="self-start sm:self-auto text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[#B8621F]/15 text-[#B8621F]">
                  47 Counties Active
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                {/* Card 1: Circles & Table Banking */}
                <button
                  type="button"
                  onClick={() => { soundEngine.play('heavyTap'); setCircleOpen(true); }}
                  className="p-5 rounded-[20px] bg-[#F7F7F5] hover:bg-white shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer group flex flex-col justify-between text-left"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">🌸</span>
                      <span className="text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                        Table Bank
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-[var(--brief-ink)] mt-3 group-hover:text-[#B8621F] transition-colors">
                      Circles & Merry-Go-Rounds
                    </h3>
                    <p className="text-xs text-[var(--brief-muted)] mt-1 leading-relaxed">
                      Join verified neighborhood savings circles, rotating payouts, and table banking pools.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-black/[0.04] flex items-center justify-between w-full">
                    <span className="text-[12px] font-bold text-[#B8621F]">Open Circle Desk →</span>
                    <span className="text-[11px] text-[var(--color-quiet)] font-medium">Cycle 5 Live</span>
                  </div>
                </button>

                {/* Card 2: Bulk CBC Textbook & Demand Runs */}
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.play('heavyTap');
                    setActiveCbcBundleId('cbc-g7');
                    setCbcCheckoutOpen(true);
                  }}
                  className="p-5 rounded-[20px] bg-[#F7F7F5] hover:bg-white shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer group flex flex-col justify-between text-left"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">📚</span>
                      <span className="text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        CBC Run
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-[var(--brief-ink)] mt-3 group-hover:text-[#B8621F] transition-colors">
                      CBC School Books & Wholesale
                    </h3>
                    <p className="text-xs text-[var(--brief-muted)] mt-1 leading-relaxed">
                      Direct textbook and bulk supply orders aggregated at wholesale discount for PTAs & schools.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-black/[0.04] flex items-center justify-between w-full">
                    <span className="text-[12px] font-bold text-[#B8621F]">View Bulk Runs →</span>
                    <span className="text-[11px] text-[var(--color-quiet)] font-medium">Save 28%</span>
                  </div>
                </button>

                {/* Card 3: WAIRO Cargo & Inter-County Gate */}
                <button
                  type="button"
                  onClick={() => { soundEngine.play('heavyTap'); setInterCountyOpen(true); }}
                  className="p-5 rounded-[20px] bg-[#F7F7F5] hover:bg-white shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer group flex flex-col justify-between text-left"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">🚚</span>
                      <span className="text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800">
                        47 Counties
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-[var(--brief-ink)] mt-3 group-hover:text-[#B8621F] transition-colors">
                      WAIRO Cargo & Logistics Gate
                    </h3>
                    <p className="text-xs text-[var(--brief-muted)] mt-1 leading-relaxed">
                      Inter-county parcel booking, direct carrier auctions, and town gate collection.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-black/[0.04] flex items-center justify-between w-full">
                    <span className="text-[12px] font-bold text-[#B8621F]">Send / Track Parcel →</span>
                    <span className="text-[11px] text-[var(--color-quiet)] font-medium">Door & Stage</span>
                  </div>
                </button>

                {/* Card 4: Group Event Touring & Logistics */}
                <button
                  type="button"
                  onClick={() => { soundEngine.play('heavyTap'); setEventLogisticsOpen(true); }}
                  className="p-5 rounded-[20px] bg-[#F7F7F5] hover:bg-white shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer group flex flex-col justify-between text-left"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">🚌</span>
                      <span className="text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        Touring Ops
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-[var(--brief-ink)] mt-3 group-hover:text-[#B8621F] transition-colors">
                      Choir, Sports & Retreat Charters
                    </h3>
                    <p className="text-xs text-[var(--brief-muted)] mt-1 leading-relaxed">
                      Group transport charters, member roster check-ins, and target funding trackers.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-black/[0.04] flex items-center justify-between w-full">
                    <span className="text-[12px] font-bold text-[#B8621F]">Coordinate Event →</span>
                    <span className="text-[11px] text-[var(--color-quiet)] font-medium">Live Rosters</span>
                  </div>
                </button>

                {/* Card 5: Paid Gigs & Local Micro-Work */}
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.play('tap');
                    setSelectedObjectType('opportunity');
                    setDiscoveryTab('opportunities');
                  }}
                  className="p-5 rounded-[20px] bg-[#F7F7F5] hover:bg-white shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer group flex flex-col justify-between text-left"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">💼</span>
                      <span className="text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        Micro-Work
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-[var(--brief-ink)] mt-3 group-hover:text-[#B8621F] transition-colors">
                      Local Verified Gigs
                    </h3>
                    <p className="text-xs text-[var(--brief-muted)] mt-1 leading-relaxed">
                      Handyman tasks, inventory counters, event ushers, and local tutoring assignments.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-black/[0.04] flex items-center justify-between w-full">
                    <span className="text-[12px] font-bold text-[#B8621F]">Browse Gigs →</span>
                    <span className="text-[11px] text-[var(--color-quiet)] font-medium">Daily Payouts</span>
                  </div>
                </button>

                {/* Card 6: Creator Partner Program */}
                <button
                  type="button"
                  onClick={() => { soundEngine.play('heavyTap'); setCreatorDeskOpen(true); }}
                  className="p-5 rounded-[20px] bg-[#F7F7F5] hover:bg-white shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer group flex flex-col justify-between text-left"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">🏅</span>
                      <span className="text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                        15% Net Cut
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-[var(--brief-ink)] mt-3 group-hover:text-[#B8621F] transition-colors">
                      Creator Partner Program
                    </h3>
                    <p className="text-xs text-[var(--brief-muted)] mt-1 leading-relaxed">
                      Earn 15% net commission on every bulk supply run, ticket sale, and cargo run for your community.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-black/[0.04] flex items-center justify-between w-full">
                    <span className="text-[12px] font-bold text-[#B8621F]">Open Creator Desk →</span>
                    <span className="text-[11px] text-[var(--color-quiet)] font-medium">Instant Ledger</span>
                  </div>
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ================= TEA SECTION ================= */}
      {nearbySection === 'tea' && (
        <section className="max-w-4xl mx-auto px-3 py-4 space-y-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Newspaper className="w-4 h-4 text-[var(--brief-ink)]" />
              <span className="text-[11px] font-black uppercase tracking-wider text-[var(--ink-60)]">
                Tea
              </span>
            </div>

            <h2 className="text-xl font-black text-[var(--brief-ink)]">
              What people are talking about
            </h2>

            <p className="text-xs text-[var(--brief-muted)] mt-1">
              News, notices and neighbourhood chatter, alongside the directory. Posts link back to the places they are about.
            </p>
          </div>

          <TickerBanner
            items={objects.slice(0, 12).map((o: any) => ({
              id: o.id,
              label: o.title,
              accent: o.category === 'Offer' || o.category === 'Opportunity' ? 'var(--tea)' : undefined
            }))}
            onOpen={(id) => {
              const obj = objects.find((o: any) => o.id === id);
              if (obj) setSelectedObjectForDetail(obj);
            }}
          />

          {/* Edition switcher */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {TEA_EDITIONS.map(({ edition, label, Icon }) => {
              const isActive = edition === activeEdition;
              const count = posts.filter((p: any) => p.edition === edition).length;

              return (
                <button
                  key={edition}
                  onClick={() => {
                    soundEngine.play('tap');
                    setActiveEdition(edition);
                  }}
                  className={`shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition cursor-pointer ${
                    isActive
                      ? 'bg-[color:var(--brief-ink)] text-white shadow-sm font-bold'
                      : 'bg-white text-[var(--ink-70)] hover:bg-[#F0EDE8]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[12px] font-bold whitespace-nowrap">
                    {label}
                  </span>
                  <span className="text-[11px] opacity-70">
                    {count}
                  </span>
                  {edition === liveEdition && !isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#B8621F] shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[11px] text-[var(--brief-muted)] px-1">
            <span className="font-bold">
              {getEditionMeta(activeEdition).label}
            </span>
            <span>
              {activeEdition === liveEdition
                ? 'Live now'
                : getEditionMeta(activeEdition).window}
            </span>
          </div>

          {/* Posts */}
          {editionPosts.map((post: any) => {
            const kindMeta = getPostKindMeta(post.kind);
            const subject = objects.find(
              (item) => item.id === post.relatedObjectId
            );
            const isLiked = likedPostIds.includes(post.id);

            return (
              <article
                key={post.id}
                className="bg-white rounded-2xl p-4 shadow-sm"
              >
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span
                    className={`text-[11px] font-black px-2 py-0.5 rounded-full bg-[#F0EDE8] ${kindMeta.tone}`}
                  >
                    {kindMeta.label}
                  </span>

                  <span className="text-[12px] font-bold text-[var(--brief-ink)]">
                    {post.authorName}
                  </span>

                  {post.authorIsVerified && (
                    <ShieldCheck className="w-3 h-3 text-[#10B981] shrink-0" />
                  )}

                  <span className="text-[11px] text-[var(--brief-muted)]">
                    {getRelativeTime(post.publishedAt)}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-[var(--brief-ink)] leading-snug">
                  {post.title}
                </h3>

                <p className="text-xs text-[var(--brief-muted)] mt-1.5 leading-relaxed">
                  {post.body}
                </p>

                {subject && (
                  <button
                    onClick={() => openPostSubject(post)}
                    className="mt-3 w-full flex items-center gap-2 bg-[#F7F7F5] hover:bg-[#F0EDE8] rounded-xl p-2.5 transition cursor-pointer group text-left"
                  >
                    {subject.imageUrl && (
                      <img
                        src={subject.imageUrl}
                        alt=""
                        className="w-9 h-9 rounded-lg object-cover shrink-0"
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-[var(--brief-muted)]">
                        About this {getObjectTypeMeta(subject.type).label}
                      </div>
                      <div className="text-[12px] font-bold truncate group-hover:text-[#B8621F]">
                        {subject.title}
                      </div>
                    </div>

                    <ArrowRight className="w-3.5 h-3.5 text-[var(--brief-muted)] shrink-0" />
                  </button>
                )}

                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-black/[0.04]">
                  <button
                    onClick={() => toggleLike(post)}
                    className={`flex items-center gap-1.5 text-[12px] font-bold cursor-pointer transition ${
                      isLiked ? 'text-rose-600' : 'text-[var(--brief-muted)] hover:text-[var(--brief-ink)]'
                    }`}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${isLiked ? 'fill-current text-rose-600' : ''}`}
                    />
                    {formatCount(post.reactionsCount + (isLiked ? 1 : 0))}
                  </button>

                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--brief-muted)]">
                    No discussion yet
                  </span>
                </div>
              </article>
            );
          })}

          {editionPosts.length === 0 && (
            <div className="py-16 text-center bg-white rounded-2xl shadow-sm">
              <Newspaper className="w-8 h-8 mx-auto mb-3 text-[var(--brief-muted)]" />
              <p className="text-sm font-bold text-[var(--brief-ink)]">No tea in this edition yet.</p>
            </div>
          )}

          <div className="mt-8 border-t border-black/5 pt-4">
            <DiscoverSection onSelectPost={(p) => showToast(`Selected "${p.title}"`)} />
          </div>
        </section>
      )}

      {/* ================= QUESTS SECTION ================= */}
      {nearbySection === 'quests' && (
        <Quests
          quests={quests}
          boardMode={boardMode}
          setBoardMode={setBoardMode}
          handleSubmitQuest={handleSubmitQuest}
          setActiveTab={setActiveTab}
        />
      )}

      {/* ================= EVENTS SECTION ================= */}
      {nearbySection === 'events' && (
        <div className="max-w-3xl mx-auto px-4 py-6">
          <EventsHub />
        </div>
      )}

      {/* ================= MARKETPLACE SECTION ================= */}
      {nearbySection === 'market' && (
        <div className="max-w-3xl mx-auto px-4 py-6">
          <Marketplace />
        </div>
      )}

      {/* ================= MSHIKANO SECTION ================= */}
      {nearbySection === 'mshikano' && (
        <MshikanoDesk />
      )}

      {/* ================= TODAY SECTION ================= */}
      {nearbySection === 'today' && (
        <div className="max-w-4xl mx-auto px-3 py-4 space-y-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h2 className="text-lg font-black text-[var(--brief-ink)]">Today</h2>
            <p className="text-[12px] text-[var(--brief-muted)] leading-snug mt-1">
              Only what relates to your pursuits, saved and watched things.
            </p>
          </div>

          {dailyBrief.length === 0 && (
            <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
              <div className="w-10 h-10 rounded-full bg-[#F0EDE8] text-[#B8621F] flex items-center justify-center mx-auto mb-2">
                <Bookmark className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-[var(--brief-ink)]">Nothing to report yet.</p>
              <p className="text-[11px] text-[var(--brief-muted)] mt-1">
                Save something, or start a pursuit, and this fills itself in.
              </p>
            </div>
          )}

          {dailyBrief.map((section: any) => (
            <div key={section.key} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[12px] font-black uppercase tracking-wider text-[var(--brief-ink)]">
                  {section.title}
                </h3>
                <span className="text-[11px] font-bold text-[var(--brief-muted)]">
                  {section.objects.length + section.pursuits.length}
                </span>
              </div>

              {section.objects.map((obj: any) => (
                <button
                  key={obj.id}
                  onClick={() => setSelectedObjectForDetail(obj)}
                  className="w-full text-left bg-white rounded-xl p-3.5 cursor-pointer shadow-sm hover:shadow-md transition-all"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#B8621F]">
                      {getObjectTypeMeta(obj.type).label}
                    </span>
                    {getDistanceLabel(obj) && (
                      <span className="text-[11px] text-[var(--brief-muted)]">
                        {getDistanceLabel(obj)}
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] font-bold text-[var(--brief-ink)] leading-snug mt-0.5">
                    {obj.title}
                  </p>
                </button>
              ))}

              {section.pursuits.map((pursuit: any) => (
                <button
                  key={pursuit.id}
                  onClick={() => { setActiveTab('nearby'); setNearbySection('pursuits'); }}
                  className="w-full text-left bg-white rounded-xl p-3.5 cursor-pointer shadow-sm hover:shadow-md transition-all"
                >
                  <p className="text-[12px] font-bold text-[var(--brief-ink)]">{pursuit.query}</p>
                  <p className="text-[11px] text-[var(--brief-muted)] mt-0.5">
                    Brief is actively matching signals in {activeNeighborhood.name}…
                  </p>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ================= PURSUITS SECTION ================= */}
      {nearbySection === 'pursuits' && (
        <Pursuits
          pursuits={pursuits}
          pursuitResults={pursuitResults}
          pursuitDraft={pursuitDraft}
          setPursuitDraft={setPursuitDraft}
          handleCreatePursuit={handleCreatePursuit}
          handleRemovePursuit={handleRemovePursuit}
          handleSetPursuitStatus={handleSetPursuitStatus}
          handleTogglePursuitWatch={handleTogglePursuitWatch}
          handleTogglePursuitCondition={handleTogglePursuitCondition}
          setSelectedObjectForDetail={setSelectedObjectForDetail}
        />
      )}

      {/* ================= WAIRO MINI APP MODAL (ERRANDS / RUNNER SUITE) ================= */}
      {wairoMiniAppOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fadeIn">
          <div className="relative w-full max-w-lg h-[88vh] rounded-[32px] overflow-hidden bg-white shadow-2xl flex flex-col">
            <button
              type="button"
              onClick={() => {
                soundEngine.play('tap');
                setWairoMiniAppOpen(false);
              }}
              className="absolute top-3 right-3 z-50 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center cursor-pointer hover:bg-black transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <WairoMiniApp
              onOpenTelemetry={() => setIsTelemetryOpen(true)}
              onOpenLocationModal={() => setIsLocationModalOpen(true)}
              onOpenDispatchModal={() => setIsDispatchModalOpen(true)}
              onOpenSDKModal={() => setIsSDKModalOpen(true)}
              onOpenUssdSim={() => setIsUssdOpen(true)}
              onOpenInterCounty={() => {
                setWairoMiniAppOpen(false);
                setInterCountyOpen(true);
              }}
              onOpenCarrierAuction={() => {
                setWairoMiniAppOpen(false);
                setCarrierAuctionOpen(true);
              }}
              onOpenOfflineSync={() => {
                setWairoMiniAppOpen(false);
                setOfflineSyncOpen(true);
              }}
              selectedLocation={wairoLocation}
              activeDelivery={wairoDelivery}
            />
          </div>
        </div>
      )}

      {/* ================= WAIRO SUB-MODALS ================= */}
      <LiveTelemetryModal 
        isOpen={isTelemetryOpen} 
        onClose={() => setIsTelemetryOpen(false)}
        activeDelivery={wairoDelivery}
        selectedLocation={wairoLocation}
      />

      <LocationModal 
        isOpen={isLocationModalOpen}
        onClose={() => setIsLocationModalOpen(false)}
        selectedLocation={wairoLocation}
        onSelectLocation={(loc) => {
          setWairoLocation(loc);
          setWairoDelivery(prev => ({
            ...prev,
            destination: loc.fullName,
            locationId: loc.id,
            etaMinutes: loc.etaMins
          }));
        }}
      />

      <DispatchModal 
        isOpen={isDispatchModalOpen}
        onClose={() => setIsDispatchModalOpen(false)}
        onDispatchSuccess={(newOrder) => {
          setWairoDelivery(newOrder);
          const found = LOCATIONS.find(l => l.id === newOrder.locationId);
          if (found) setWairoLocation(found);
        }}
        currentLocation={wairoLocation}
      />

      <EmbedSDKModal 
        isOpen={isSDKModalOpen}
        onClose={() => setIsSDKModalOpen(false)}
      />

      {isUssdOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-auto">
            <UssdSimulatorDesk onClose={() => setIsUssdOpen(false)} />
          </div>
        </div>
      )}

      {/* ================= MODAL: LIFE-EVENTS COMMITTEE HUB ================= */}
      {committeeOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-2xl my-auto">
            <CommitteeDesk
              onClose={() => setCommitteeOpen(false)}
              onOpenVendor={(vendor) => {
                setCommitteeOpen(false);
                showToast(`Opening ${vendor} profile in town directory`);
              }}
            />
          </div>
        </div>
      )}

      {/* ================= MODAL: CIRCLE & TABLE BANKING HUB ================= */}
      {circleOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-md my-auto bg-white rounded-3xl p-6 text-center text-[var(--brief-ink)]">
            <p className="text-sm font-black">Table banking lives in your You tab</p>
            <p className="text-xs text-gray-500 mt-1">Open the You tab to run contributions, rotation, loans, welfare and minutes — every number derived from real rows.</p>
            <button onClick={() => setCircleOpen(false)} className="mt-4 px-4 py-2 rounded-xl bg-[#40916C] text-white text-xs font-bold">Close</button>
          </div>
        </div>
      )}

      {/* ================= MODAL: EMOTIONAL WELLBEING HUB ================= */}
      {wellbeingOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-2xl my-auto">
            <WellbeingDesk
              onClose={() => setWellbeingOpen(false)}
              onBookTherapist={(doc) => {
                showToast(`Booking request sent to ${doc}`);
              }}
            />
          </div>
        </div>
      )}

      {/* ================= MODAL: INTER-COUNTY CARGO & TRAVELER MATCHING ================= */}
      {interCountyOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-auto">
            <InterCountyDesk
              onClose={() => setInterCountyOpen(false)}
              onBookingComplete={(bkg) => {
                showToast(`Cargo booking ${bkg.id} placed! Escrow secured via M-Pesa.`);
              }}
            />
          </div>
        </div>
      )}

      {/* ================= MODAL: PRIVATE CARRIER REVERSE AUCTION ================= */}
      {carrierAuctionOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-auto">
            <PrivateCarrierAuctionDesk
              onClose={() => setCarrierAuctionOpen(false)}
              onDispatchSelected={(carrier) => {
                showToast(`Assigned ${carrier.carrierName} for KES ${carrier.bidPriceKes}`);
              }}
            />
          </div>
        </div>
      )}

      {/* ================= MODAL: OFFLINE PWA INDEXEDDB SYNC ================= */}
      {offlineSyncOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-auto">
            <OfflineSyncQueueDesk
              onClose={() => setOfflineSyncOpen(false)}
              onActionSynced={(act) => {
                showToast(`Reconciled offline mutation ${act.title}`);
              }}
            />
          </div>
        </div>
      )}

      {/* ================= MODAL: 3D DISCOVER VIEW ================= */}
      {discoverViewOpen && (
        <div className="fixed inset-0 z-50 bg-[#F0EDE8] overflow-y-auto animate-fadeIn">
          <div className="sticky top-3 left-3 z-50 p-3">
            <button
              type="button"
              onClick={() => { soundEngine.play('tap'); setDiscoverViewOpen(false); }}
              className="px-3.5 py-1.5 rounded-full bg-[color:var(--brief-ink)] text-white text-xs font-bold shadow-xl flex items-center space-x-1.5 cursor-pointer hover:bg-black transition-colors"
            >
              <X className="w-4 h-4" />
              <span>Exit Discover</span>
            </button>
          </div>
          <DiscoverScreen />
        </div>
      )}

      {/* ================= MODAL: UNIVERSAL CREATE POST ================= */}
      {createPostModalOpen && (
        <UniversalCreatePostModal
          isOpen={createPostModalOpen}
          onClose={() => setCreatePostModalOpen(false)}
          onPostCreated={(post) => {
            showToast(`Published ${post.type.toUpperCase()}: "${post.title}"`);
          }}
        />
      )}

      {/* ================= MODAL: NEIGHBORHOOD PICKER ================= */}
      <NeighborhoodPickerModal
        isOpen={isNeighborhoodPickerOpen}
        selectedId={activeNeighborhood.id}
        onSelect={(nh: Neighborhood) => {
          setActiveNeighborhood(nh);
          setPrimaryNeighborhood(nh.id);
          showToast(`Neighborhood updated to ${nh.name}`);
        }}
        onClose={() => setIsNeighborhoodPickerOpen(false)}
      />

      {/* ================= MODAL: COMMUNITY CHAMPION ================= */}
      <CommunityChampionModal
        isOpen={isChampionModalOpen}
        neighborhood={activeNeighborhood}
        onClose={() => setIsChampionModalOpen(false)}
        onCallChampion={(phone: string) => showToast(`Calling ${activeNeighborhood.champion.name} (${phone})`)}
        onVouchRider={() => showToast(`Vouch form opened for ${activeNeighborhood.name}`)}
      />

      {/* ================= MODAL: GROUP DEMAND RUNS ================= */}
      {demandRunOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-auto">
            <GroupDemandRunDesk
              onClose={() => setDemandRunOpen(false)}
              onPledgeRun={(runId, qty) => {
                showToast(`Pledged ${qty} bundle(s) on bulk run ${runId}`);
              }}
            />
          </div>
        </div>
      )}

      {/* ================= MODAL: GROUP EVENT LOGISTICS ================= */}
      {eventLogisticsOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-auto">
            <GroupEventLogisticsDesk
              onClose={() => setEventLogisticsOpen(false)}
              onContributeBudget={(evtId, amt) => {
                showToast(`Contributed KES ${amt.toLocaleString()} to group event pool`);
              }}
            />
          </div>
        </div>
      )}

      {/* ================= MODAL: CREATOR PARTNER DESK ================= */}
      {creatorDeskOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-auto">
            <CreatorPartnerDesk
              onClose={() => setCreatorDeskOpen(false)}
              onShareLink={(code) => {
                showToast(`Attribution code ${code} generated`);
              }}
            />
          </div>
        </div>
      )}

      {/* ================= MODAL: 1-CLICK CBC TEXTBOOK BUNDLE CHECKOUT ================= */}
      {cbcCheckoutOpen && (
        <CBCTextbookBundleCheckoutModal
          isOpen={cbcCheckoutOpen}
          initialBundleId={activeCbcBundleId}
          onClose={() => setCbcCheckoutOpen(false)}
          onOrderSuccess={(order) => {
            showToast(`Confirmed ${order.grade} Textbooks order! Waybill: ${order.wairoTrackingCode}`);
          }}
        />
      )}
    </>
  );
}
