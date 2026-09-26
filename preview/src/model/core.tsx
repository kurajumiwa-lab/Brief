import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import * as briefApi from '../api/briefApi';
import {
  parsePath,
  toPath,
  objectShareUrl,
  isBriefRoute,
  explorePath,
  collectionPath,
  DEFAULT_ROUTE,
  type BriefRoute
} from '../nav/routes';

import QRCode from 'qrcode';
import { deriveDestinationAlerts, readLastSeen, writeLastSeen, alertLabel, type DestinationAlerts } from '../nav/alerts';
import { EntityPage } from '../components/EntityPage';
import { FollowingSurface } from '../components/FollowingSurface';
import { LocationPage } from '../components/LocationPage';
import { RelatedContent } from '../components/RelatedContent';
import { CollectionsSurface } from '../components/CollectionsSurface';
import { CollectionPage } from '../components/CollectionPage';
import { CollectionPicker } from '../components/CollectionPicker';
import { EntityChip } from '../components/EntityChip';
import { CampaignDistribution } from '../components/CampaignDistribution';
import { AwaitingPayment } from '../components/AwaitingPayment';
import { SourcesPanel } from '../components/SourcesPanel';
import { ConnectedGroups } from '../components/ConnectedGroups';
import { MoneyPanel } from '../components/MoneyPanel';
import { ResaleDesk } from '../components/ResaleDesk';
import { MyTickets } from '../components/MyTickets';
import { EventsHub } from '../components/EventsHub';
import { MshikanoDesk } from '../components/MshikanoDesk';
import { VerificationPanel } from '../components/VerificationPanel';
import { Vault } from '../components/vault/Vault';
import ServiceFees from '../components/ServiceFees';
import { WhatsAppShopBuilder } from '../components/WhatsAppShopBuilder';
import RewardsDesk from '../components/RewardsDesk';
import { CheckIn } from '../components/CheckIn';
import { HostCommand } from '../components/HostCommand';
import { TickerBanner, PromptBanner } from "../components/SignalBanner";
import { ActionsEngine } from '../components/ActionsEngine';
import { Circles } from '../components/Circles';
import { Marketplace } from '../components/Marketplace';
import { Pursuits } from '../components/Pursuits';
import { QR_COLORS } from '../ui/qrPalette';
import { PLASTER, PHOTO_FILTER, PHOTO_SCRIM } from '../features/city/room';
import { categoryWash, categoryAccent } from '../features/city/categoryPalette';
import { Inbox } from '../components/Inbox';
import { TriageQueue } from '../components/TriageQueue';
import { Quests } from '../components/Quests';
import { LocationChip } from '../components/LocationChip';
import type { GeoPoint } from '../components/LocationChip';
import { MainShelf } from '../components/MainShelf';
import { Onboarding } from '../components/Onboarding';
import { NextStep } from '../components/NextStep';
import { isSurfaceUnlocked, shouldOpenFirstRun, showsLadder, unlockHint } from '../components/ladder';
import { arrivalSource, linkTokenFrom, urlWithoutArrivalParams, type ArrivalChannel } from '../components/arrival';
import { EnginePanel } from '../components/EnginePanel';
import { GroupBuyPortal } from '../components/GroupBuyPortal';
import { TicketBar } from '../components/TicketBar';

import { FeedComposer } from '../components/FeedComposer';
import { WireSection } from '../components/WireSection';
import { TeaDesk } from '../components/TeaDesk';
import { CreatorCockpit } from '../components/CreatorCockpit';
import { CreatorProfilePanel, OpportunitiesPanel, MessagesPanel, SubscriptionsPanel } from '../components/CreatorPanels';
import { SearchResults } from '../components/SearchResults';
import { YardEngineDesk } from '../components/YardEngineDesk';
import type { YardSection } from '../components/YardEngineDesk';
import { TeaReader } from '../components/TeaReader';
import type { CircleDetail as ApiCircleDetail, EventListing, PublicCampaignContext } from '../api/briefApi';
import type {
  Campaign as ApiCampaign,
  CampaignType as ApiCampaignType,
  PublicCampaign as ApiPublicCampaign,
  Registration as ApiRegistration
} from '../api/types';
import {
  Building2,
  Search,
  Sparkles,
  FolderPlus,
  Plus,
  Terminal,
  Activity,
  MapPin,
  Navigation,
  CalendarPlus,
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
import { MenuSheet } from '../components/MenuSheet';
import { AdminDesk } from '../components/AdminDesk';
import type { MenuTarget } from '../components/MenuSheet';

import type { LucideIcon } from 'lucide-react';
import {
  ROOM, HOME_MORE, SAVED_TABS, INBOX_TABS, FILTERS,
  WORKFLOW_BUNDLES, SAVED_BUNDLES, QUEUE_LABEL, QUEUE_CHIP, QUEUE_HINT
} from '../ui/names';


export const bootRoute: BriefRoute = (() => {
  try {
    if (typeof window === 'undefined') return DEFAULT_ROUTE;
    return parsePath(window.location.pathname, window.location.search);
  } catch {
    return DEFAULT_ROUTE;
  }
})();

// ============================================================================
// 1. TYPES & ENUMS
// ============================================================================

export type ObjectType =
  | 'place'
  | 'identity'
  | 'experience'
  | 'event'
  | 'opportunity'
  | 'knowledge'
  | 'community'
  | 'product'
  | 'service'
  | 'document'
  | 'conversation'
  | 'business'
  | 'offer'
  | 'alert'
  | 'announcement'
  | 'news';

export type ProtocolAction =
  | 'discover'
  | 'read'
  | 'save'
  | 'share'
  | 'contact'
  | 'book'
  | 'buy'
  | 'report'
  | 'verify'
  | 'follow';

// --- Navigation -------------------------------------------------------------
// Four screens. Menu is an overlay, not a fifth room. Pulse was removed by
// product decision (2026-08-29): its change-feed read duplicated what the
// surfaces themselves now say. The notifications API remains server-complete;
// it simply has no dedicated page any more.
export type Destination =
  | 'nearby'
  | 'mylayer'
  | 'workflows';

// The screens, defined once and consumed by both the desktop rail and the
// mobile dock so the two can never drift apart.
export const DESTINATIONS: {
  id: Destination;
  label: string;
  hint: string;
}[] = [
  { id: 'nearby', label: ROOM.nearby.label, hint: ROOM.nearby.hint },
  { id: 'mylayer', label: ROOM.mylayer.label, hint: ROOM.mylayer.hint },
  { id: 'workflows', label: ROOM.workflows.label, hint: ROOM.workflows.hint }
];

// The red activity dot for a sidebar title. Dot for 1 update, dot + count
// from 2 (capped at 9+). Pure presentation; counts come from real data only.
export function ActivityDot({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="brief-alert-dot inline-flex items-center justify-center min-w-[15px] h-[15px] px-[3px] rounded-full bg-[#DC2626] text-[var(--accent-ink)] text-[11px] font-extrabold leading-none shadow-[0_0_0_1.5px_#0D1117]"
    >
      {n > 1 ? alertLabel(n) : ''}
    </span>
  );
}

// Icons kept separate from DESTINATIONS so the data stays plain and the
// component layer owns the visuals.
export const DESTINATION_ICONS: Record<Destination, LucideIcon> = {
  nearby: MapPin,
  mylayer: Bookmark,
  workflows: Briefcase
};

export type NearbySection = 'stream' | 'tea' | 'today' | 'pursuits' | 'quests' | 'market' | 'events' | 'mshikano';
export type MyLayerSection =
  | 'saved' | 'activity' | 'points' | 'circles' | 'groups' | 'campaigns'
  | 'mediakit' | 'opportunities' | 'messages' | 'subscriptions' | 'tickets'
  | 'verification';
// Workflows secondary: a Journey is either in progress or finished. Inbox and
// Sources are kept -- they are existing workflow surfaces, not new screens.
export type WorkflowSection = 'cockpit' | 'command' | 'active' | 'completed' | 'inbox' | 'sources' | 'money' | 'vault' | 'gate' | 'tea' | 'campaigns' | 'matches' | 'distribution' | 'calendar' | 'vendors' | 'shop' | 'ai' | 'engine' | 'groupbuy' | 'resale' | 'fees';
// Pulse secondary. Pulse is the information layer: freshness, local signals,
// what groups are surfacing, and emerging activity. It is not an assistant.
export type PulseSection = 'now' | 'local' | 'groups' | 'signals';

export type FlowState = 'discovered' | 'engaged' | 'committed' | 'completed' | 'archived';
export type AccessPortal = 'citizen' | 'merchant' | 'civic_admin' | 'moderator';

export interface BriefObject {
  id: string;
  type: ObjectType;
  title: string;
  category: string;
  summary: string;
  locationName?: string;
  creatorName?: string;
  // NO trustScore. Trust is an evidence list -- who provided this, when it
  // was last verified, what it is linked to -- never a single invented
  // percentage. The server stores no such score and Brief does not compute
  // one, so the field is gone rather than left dangling as dead UI.
  lastVerifiedAt?: string;
  validityWindowDays?: number;
  isVerified?: boolean;
  imageUrl?: string;
  /** A provider image reference (e.g. a Telegram file_id) awaiting server-side
   *  resolution; the render URL is derived from it, never the raw id. */
  imageReference?: string;
  imageNeedsResolution?: boolean;
  /** Real additional source images (news galleries, event photo sets). Never
   *  fabricated — the server only projects images that exist in provenance. */
  gallery?: { url: string; alt?: string; attribution?: string | null }[];
  /** When the story was first published anywhere in its provenance. */
  publishedAt?: string;
  /** The server's temporal lifecycle projection (status/startsAt/deadlineAt). */
  temporal?: {
    status?: string;
    startsAt?: string | null;
    endsAt?: string | null;
    deadlineAt?: string | null;
    dayOfWeek?: string | null;
  };
  /** Real source names for attribution ("From Telegram" = the actual name). */
  sourceNames?: string[];
  sourceCount?: number;
  /** Source channel kinds ("telegram", "web", ...) — "Source · Telegram". */
  sourcePlatforms?: string[];
  /** The server's verification standing: unverified | source_confirmed |
   *  cross_source_confirmed | community_confirmed. Corroboration, not truth. */
  verificationStatus?: string;
  /** How many independent people confirmed this object. Derived server-side. */
  confirmationCount?: number;
  /** Operator corrections applied to this object (original vs corrected). */
  corrections?: {
    id: string;
    field: string;
    isMeta?: boolean;
    originalValue: string | null;
    correctedValue: string;
    reason: string;
    createdAt: string;
  }[];
  /** Open (unresolved) user reports currently flagging this object. */
  openReportCount?: number;
  /** Server-labelled temporary demo content; never a client-side fixture flag. */
  testContent?: { label: string; expiresAt: string | null };

  // --- Provenance ------------------------------------------------------------
  // Where this record came from: the listing, register entry or page an
  // ingestor scraped or a contributor cited. Distinct from actionUrl -- this
  // answers "how do we know this?", not "where do we send the user?".
  //
  // sourceType names the channel it arrived through, so an ingestor can be
  // attributed, rate-limited and trust-weighted per channel: a county register
  // is not a Telegram forward.
  sourceType?: SourceType | 'user';
  sourceUrl?: string;

  // Ingestion plumbing (prompt 22). Not rendered anywhere yet -- these exist so
  // a future pipeline can attribute, de-duplicate and re-fetch a record without
  // another migration. No seed object sets them; none are back-filled.
  sourceId?: string;
  sourceMessageId?: string;
  ingestedAt?: string;

  // --- Destination / action layer -------------------------------------------
  // How Brief routes a user to the real thing. When absent, the destination is
  // derived from locationName / metadata.contactPhone where possible; when
  // nothing can be derived, the UI says so instead of faking a transaction.
  //   'external' -- opens a URL in a new tab (checkout, application portal, doc)
  //   'phone'    -- tel: link, uses actionUrl or falls back to contactPhone
  //   'map'      -- Maps search, uses actionUrl or falls back to locationName
  //   'internal' -- stays in Brief and pivots the stream to this object's type
  actionUrl?: string;
  actionType?: 'internal' | 'external' | 'phone' | 'map';
  actionLabel?: string;

  // --- Explicit object graph --------------------------------------------------
  // Only ever set deliberately (by a curator or an ingestor that genuinely
  // knows the link). Discovery ranks these above inferred similarity, so a
  // wrong value here is worse than no value. Never populate by guessing.
  //   parentObjectId   -- this belongs to / is part of that
  //   providerObjectId -- the identity that sells or operates this
  //   locationObjectId -- the place this physically happens at
  //   relatedObjectIds -- hand-curated siblings
  parentObjectId?: string;
  providerObjectId?: string;
  locationObjectId?: string;
  relatedObjectIds?: string[];
  metadata?: {
    price?: number;
    currency?: string;
    deadline?: string;
    capacity?: number;
    attendeesCount?: number;
    contactPhone?: string;
    operatingHours?: string;
    rating?: number;
    reviewsCount?: number;
    distanceKm?: number;
    statusBadge?: string;
    [key: string]: any;
  };
  createdAt: string;
}

export interface ObjectRelationship {
  id: string;
  sourceType: ObjectType;
  sourceId: string;
  verb: string;
  targetType: ObjectType;
  targetId: string;
  state: FlowState;
  updatedAt: string;
  // Optional personal note on WHY this was saved (prompt 10). Lives on the
  // relationship, not on a parallel saved-object store. Absent on every
  // pre-existing edge, and everything must keep working when it is.
  label?: SaveLabel;
}

// Deliberately a closed list: freeform tags become a taxonomy nobody maintains.
export type SaveLabel = 'Later' | 'Important' | 'Visit' | 'Buy' | 'Apply' | 'Follow up';

export const SAVE_LABELS: SaveLabel[] = [
  'Later',
  'Important',
  'Visit',
  'Buy',
  'Apply',
  'Follow up'
];

export interface JourneyStep {
  id: string;
  order: number;
  title: string;
  description: string;
  targetObjectType: ObjectType;
  targetObjectId?: string;
  isCompleted: boolean;
  statusLabel?: string;
}

export interface Journey {
  id: string;
  title: string;
  category: string;
  description: string;
  estimatedDays: number;
  steps: JourneyStep[];
  progressPercent: number;
  isCompleted: boolean;
  imageUrl?: string;
}

// ---------------------------------------------------------------------------
// Tea / news layer.
//
// Posts are deliberately NOT BriefObjects. An object is a durable local thing
// (a market exists for years); a post is a moment (true for hours). They carry
// different fields, age differently, and are moderated differently -- but they
// link: a post can point at the object it is about via relatedObjectId.
// ---------------------------------------------------------------------------
export type TeaEdition = 'morning' | 'evening' | 'weekend';

export type PostKind = 'news' | 'chatter' | 'notice' | 'question' | 'promo';

export interface BriefPost {
  id: string;
  edition: TeaEdition;
  kind: PostKind;
  title: string;
  body: string;
  authorName: string;
  authorHandle?: string;
  authorIsVerified?: boolean;
  publishedAt: string;
  reactionsCount: number;
  commentsCount: number;
  /** Paid distribution. Always surfaced in the UI, never disguised as editorial. */
  isPromoted?: boolean;
  promotedBy?: string;
  /** Links this post to the durable object it is about. */
  relatedObjectId?: string;
  tags?: string[];
}

/**
 * A single civic metric.
 *
 * Brief used to hardcode these ("412 businesses helped", "97.4% fresh") and
 * render them as measured civic activity. They were invented. The type now
 * makes that impossible to repeat: a metric is EITHER derived from records
 * Brief actually holds, or it is explicitly unavailable and says why.
 *
 * There is no third case, and no numeric default. `available: false` carries
 * no `value` field at all, so a surface cannot read a number that was never
 * measured -- it is a compile error, not a runtime 0.
 */
// ----------------------------------------------------------------------------
// Type-derived helpers (must live BELOW the type declarations above)
// ----------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DESTINATIONS (as distinct from ordinary objects).
//
// Brief is not a marketplace. It is the information layer that tells you
// something is happening near you; the commerce lives INSIDE that context.
// A destination is a place-in-time with people and vendors in it: a popup, a
// market day, a meetup, a fair. A government office is not a destination --
// it is a service you transact with, and inflating it into a "hub" would be
// a lie about what is there.
//
// This is entirely derived from data the objects already carry. No object
// gained a new stored field, and nothing here invents vendors, attendance,
// prices or live status. If the data is not there, the UI says so.
// ---------------------------------------------------------------------------

/** Categories that describe a controlled, vendor-bearing gathering. */
const DESTINATION_CATEGORIES = [
  'event',
  'popup',
  'market',
  'marketplace',
  'fair',
  'festival',
  'meetup',
  'exhibition',
  'activation',
  'networking'
];

/**
 * A destination is either an experience (an event is always a destination) or
 * a place whose category says it is a trading/gathering venue. Civic spaces,
 * offices and co-working desks stay ordinary objects.
 *
 * Deliberately conservative: when in doubt, an object stays LEVEL 1.
 */
export const isDestinationObject = (object: BriefObject): boolean => {
  if (object.type === 'experience') return true;
  if (object.type !== 'place') return false;
  // NULL-SAFE: the server projects category through stringOrNull(), so a place
  // can arrive with category === null. An unguarded `.toLowerCase()` here threw
  // on the first search keystroke (the filtered stream renders
  // isDestinationObject per row), crashing the tree → a frozen blank screen.
  const category = String(object.category ?? '').toLowerCase();
  return DESTINATION_CATEGORIES.some((word) => category.includes(word));
};

export type DestinationState =
  | 'live'
  | 'today'
  | 'upcoming'
  | 'scheduled'
  | 'ended';

/**
 * Live state, read from statusBadge and operatingHours only.
 *
 * Rule from the brief: never claim "LIVE" without real timing data. When the
 * record only says "Upcoming", that is what we show. When it says nothing at
 * all we fall back to 'scheduled', which promises nothing.
 */
export const getDestinationState = (
  object: BriefObject,
  now: Date = new Date()
): DestinationState => {
  const badge = (object.metadata?.statusBadge ?? '').toLowerCase();
  if (badge.includes('ended') || badge.includes('closed')) return 'ended';
  if (badge.includes('live') || badge.includes('now')) return 'live';

  const hours = (object.metadata?.operatingHours ?? '').toLowerCase();
  const today = now
    .toLocaleDateString('en-US', { weekday: 'long' })
    .toLowerCase();

  // "Saturdays, 06:00-18:30" on a Saturday is genuinely on today. This is a
  // real reading of a real field, not a guess.
  if (hours.includes(today) || hours.includes(today.slice(0, 3))) {
    return 'today';
  }

  if (badge.includes('upcoming')) return 'upcoming';
  if (badge.includes('open')) return 'today';
  return 'scheduled';
};

export const DESTINATION_STATE_LABELS: Record<DestinationState, string> = {
  live: 'Live now',
  today: 'Today',
  upcoming: 'Upcoming',
  scheduled: 'Scheduled',
  ended: 'Ended'
};

/**
 * Visual weight. LEVEL 3 is reserved for a destination that is actually on
 * today AND has something inside it worth walking to; LEVEL 2 is an upcoming
 * destination; everything else stays LEVEL 1 so the stream does not turn into
 * a wall of billboards.
 */
/**
 * Who is trading at this destination, read from real graph edges only.
 *
 * An identity counts as a vendor here when it explicitly states it is located
 * at, part of, or related to this destination -- or at the place the
 * destination happens at (a market day inherits the market's traders, which
 * is how the world actually works). Nothing is inferred from keywords, so a
 * destination with no stated vendors correctly reports zero and the UI says
 * "Vendor information unavailable" instead of inventing a line-up.
 */
export const getDestinationVendors = (
  object: BriefObject,
  all: BriefObject[]
): BriefObject[] => {
  const hostIds = new Set<string>([object.id]);
  if (object.locationObjectId) hostIds.add(object.locationObjectId);
  if (object.parentObjectId) hostIds.add(object.parentObjectId);

  return all.filter((item) => {
    if (item.id === object.id) return false;
    if (item.type !== 'identity') return false;
    return (
      (item.locationObjectId && hostIds.has(item.locationObjectId)) ||
      (item.parentObjectId && hostIds.has(item.parentObjectId)) ||
      (item.relatedObjectIds ?? []).some((id) => hostIds.has(id)) ||
      (object.relatedObjectIds ?? []).includes(item.id)
    );
  });
};

/** What a vendor actually sells: products and services that name it as provider. */
export const getVendorOfferings = (
  vendor: BriefObject,
  all: BriefObject[]
): BriefObject[] =>
  all.filter(
    (item) =>
      item.providerObjectId === vendor.id &&
      (item.type === 'product' || item.type === 'service')
  );

/**
 * Where a vendor can be found. Powers the vendor -> destinations hop, so
 * discovering a trader at one popup can lead you to the next one.
 */
export const getVendorDestinations = (
  vendor: BriefObject,
  all: BriefObject[]
): BriefObject[] => {
  const anchors = new Set<string>(
    [
      vendor.locationObjectId,
      vendor.parentObjectId,
      ...(vendor.relatedObjectIds ?? [])
    ].filter(Boolean) as string[]
  );
  if (anchors.size === 0) return [];

  return all.filter((item) => {
    if (item.id === vendor.id) return false;
    if (!isDestinationObject(item)) return false;
    return (
      anchors.has(item.id) ||
      (item.locationObjectId ? anchors.has(item.locationObjectId) : false) ||
      (item.parentObjectId ? anchors.has(item.parentObjectId) : false)
    );
  });
};

/** Distinct vendor categories, for the horizontal strip. */
const getVendorCategories = (vendors: BriefObject[]): string[] =>
  Array.from(new Set(vendors.map((v) => v.category)));

export type CardLevel = 1 | 2 | 3;

export const getCardLevel = (
  object: BriefObject,
  vendorCount: number,
  now: Date = new Date()
): CardLevel => {
  if (!isDestinationObject(object)) return 1;
  const state = getDestinationState(object, now);
  if (state === 'ended') return 1;
  if ((state === 'live' || state === 'today') && vendorCount > 0) return 3;
  if (state === 'live' || state === 'today' || state === 'upcoming') return 2;
  return 1;
};

/**
 * Access model, read from what the record already states. Most objects say
 * nothing, and silence is not "public" -- we return undefined and render
 * nothing rather than asserting an access policy Brief does not know.
 */
export const getDestinationAccess = (object: BriefObject): string | undefined => {
  const badge = object.metadata?.statusBadge ?? '';
  const lowered = badge.toLowerCase();
  if (lowered.includes('open access')) return 'Open';
  if (lowered.includes('ticket')) return 'Ticketed';
  if (lowered.includes('invite')) return 'Invite';
  if (lowered.includes('member')) return 'Members';
  if (lowered.includes('private')) return 'Private';
  return undefined;
};

const getObjectActionLabel = (type: ObjectType): string => {
  switch (type) {
    case 'place':
      return 'Find More';
    case 'experience':
      return 'Join';
    case 'opportunity':
      return 'Apply';
    case 'service':
      return 'Book';
    case 'product':
      return 'Buy';
    case 'knowledge':
      return 'Read';
    case 'identity':
      return 'View';
    case 'community':
      return 'Join';
    case 'conversation':
      return 'Discuss';
    case 'document':
      return 'Open';
    case 'business':
      return 'View';
    case 'offer':
      return 'View';
    case 'alert':
      return 'Read';
    case 'announcement':
      return 'Read';
    case 'news':
      return 'Read';
    default:
      return 'View';
  }
};

// Real, derivable destination for an object -- or null when Brief genuinely
// has nowhere to send the user yet. Never invent a route.
// --- Tea helpers -----------------------------------------------------------

export const TEA_EDITIONS: {
  edition: TeaEdition;
  label: string;
  Icon: typeof Sun;
}[] = [
  { edition: 'morning', label: 'Morning', Icon: Sun },
  { edition: 'evening', label: 'Evening', Icon: Sunset },
  { edition: 'weekend', label: 'Weekend', Icon: CalendarDays }
];

// Which edition is "live" right now. Weekend wins on Sat/Sun; otherwise the
// clock decides. Editions are windows over one feed, not separate publications,
// so a reader can always page back to the others.
export const getCurrentEdition = (now: Date = new Date()): TeaEdition => {
  const day = now.getDay();
  if (day === 0 || day === 6) return 'weekend';
  return now.getHours() < 14 ? 'morning' : 'evening';
};

export const getEditionMeta = (
  edition: TeaEdition
): { label: string; window: string } => {
  switch (edition) {
    case 'morning':
      return { label: 'Morning Tea', window: 'Weekdays before 2pm' };
    case 'evening':
      return { label: 'Evening Tea', window: 'Weekdays after 2pm' };
    case 'weekend':
      return { label: 'Weekend Tea', window: 'Saturday and Sunday' };
  }
};

export const getPostKindMeta = (
  kind: PostKind
): { label: string; tone: string } => {
  switch (kind) {
    case 'news':
      return { label: 'News', tone: 'text-[var(--brief-ink)] border-[var(--brief-line)]' };
    case 'notice':
      return { label: 'Notice', tone: 'text-[var(--brief-ink)] border-[#0891B2]' };
    case 'chatter':
      return { label: 'Chatter', tone: 'text-[var(--brief-ink)] border-[var(--brief-line)]' };
    case 'question':
      return { label: 'Question', tone: 'text-[var(--brief-ink)] border-[#0891B2]' };
    case 'promo':
      return { label: 'Promoted', tone: 'text-[var(--brief-ink)] border-[#0891B2]' };
  }
};

// Compact relative time: 40m, 6h, 3d.
export const getRelativeTime = (iso: string, now: Date = new Date()): string => {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

// ---------------------------------------------------------------------------
// TRUST DISPLAY (trust layer). Every label is derived from real fields the
// server already projects (publishedAt, sourceNames/sourceCount, temporal,
// verificationStatus) — never invented, never a raw confidence number.
// ---------------------------------------------------------------------------

/** Human publication freshness: "Just now", "18 min ago", "Today", "Yesterday",
 *  "3 days ago", else the date. Null when there is no timestamp to read. */
export const getRelativeFreshness = (iso?: string | null, now: Date = new Date()): string | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMs = now.getTime() - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24 && new Date(t).toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now.getTime() - 86400000);
  if (new Date(t).toDateString() === yesterday.toDateString()) return 'Yesterday';
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;
  return new Date(t).toISOString().slice(0, 10);
};

/**
 * The compact source indicator: "Source · Nation" for a single source,
 * "Sources · 3" for several. Null when provenance says nothing.
 */
export const getSourceChip = (object: BriefObject): string | null => {
  const names = object.sourceNames ?? [];
  const count = object.sourceCount ?? names.length;
  if (count >= 2) return `Sources · ${count}`;
  if (names.length === 1) return `Source · ${names[0]}`;
  return null;
};

/** "Source · Telegram" — the channel kind, when known. */
export const getSourceKindChip = (object: BriefObject): string | null => {
  const kind = object.sourcePlatforms?.[0];
  if (!kind) return null;
  const label = kind === 'telegram_channel' || kind === 'telegram_group'
    ? 'Telegram'
    : kind === 'whatsapp_channel' || kind === 'whatsapp_group'
      ? 'WhatsApp'
      : kind;
  return label;
};

/**
 * The entity links a card may carry — "Hosted by X" (organizer from
 * structured metadata), "Venue · X" (structured venue field, or the card's
 * own entity when the object IS a place), "Source · X" (single-source
 * provenance). Each is resolved to a real entity by EntityChip; nothing is
 * linked unless an entity exists.
 */
export const entityChipsFor = (object: BriefObject): { kind: 'venue' | 'organizer' | 'publisher' | 'business' | 'community'; name?: string; directId?: string }[] => {
  const chips: { kind: 'venue' | 'organizer' | 'publisher' | 'business' | 'community'; name?: string; directId?: string }[] = [];
  const meta = object.metadata ?? {};
  if (object.type === 'place') {
    chips.push({ kind: 'venue', name: object.title, directId: `venue:${object.id}` });
  }
  const venueName = typeof meta.venue === 'string' && meta.venue.trim() ? meta.venue.trim() : null;
  if (venueName && object.type !== 'place') {
    chips.push({ kind: 'venue', name: venueName });
  }
  const hostName = typeof meta.hostedBy === 'string' && meta.hostedBy.trim()
    ? meta.hostedBy.trim()
    : (typeof meta.organizer === 'string' && meta.organizer.trim() ? meta.organizer.trim() : null);
  if (hostName) chips.push({ kind: 'organizer', name: hostName });
  if ((object.sourceCount ?? object.sourceNames?.length ?? 0) === 1 && object.sourceNames?.[0]) {
    chips.push({ kind: 'publisher', name: object.sourceNames[0] });
  }
  const bizName = typeof meta.businessName === 'string' && meta.businessName.trim() ? meta.businessName.trim() : null;
  if (bizName && object.type === 'offer') {
    chips.push({ kind: 'business', name: bizName });
  }
  const communityName = typeof meta.community === 'string' && meta.community.trim() ? meta.community.trim() : null;
  if (communityName) {
    chips.push({ kind: 'community', name: communityName });
  }
  return chips;
};

/** Corroboration, explicitly not certainty: "Confirmed across 2 sources". */
export const getCorroborationLabel = (object: BriefObject): string | null => {
  const count = object.sourceCount ?? object.sourceNames?.length ?? 0;
  if (count >= 2) return `Confirmed across ${count} sources`;
  if (object.verificationStatus === 'community_confirmed' && object.confirmationCount) {
    return `Confirmed by ${object.confirmationCount} people`;
  }
  return null;
};

/**
 * §9 — the trust state as a DISTINCT visual tier. The server's lifecycle is
 *   unverified -> source_confirmed -> cross_source_confirmed ->
 *   community_confirmed. Each corroborated tier maps to its own honest label
 *   and tone, so a single source is never dressed up as "verified", and the
 *   community tier (human confirmation) is visually distinct from the
 *   cross-source tier (corroboration). Corroboration, not truth — every word
 *   comes straight off the projected row, never invented.
 */
export interface TrustState {
  tier: 'unverified' | 'source_confirmed' | 'cross_source_confirmed' | 'community_confirmed';
  /** The badge word, or null when the tier shows no badge (unverified). */
  label: string | null;
  /** Semantic tone for distinct visual states (§9). */
  tone: 'none' | 'muted' | 'cyan' | 'green';
}

export const trustStateOf = (object: BriefObject): TrustState => {
  const status = object.verificationStatus;
  if (status === 'community_confirmed') {
    return { tier: 'community_confirmed', label: 'Community confirmed', tone: 'green' };
  }
  if (status === 'cross_source_confirmed' || status === 'verified') {
    return { tier: 'cross_source_confirmed', label: 'Verified', tone: 'cyan' };
  }
  if (status === 'source_confirmed') {
    return { tier: 'source_confirmed', label: 'Source confirmed', tone: 'muted' };
  }
  return { tier: 'unverified', label: null, tone: 'none' };
};

/**
 * The lifecycle badge for time-sensitive types. For offers: Expired only when
 * the server's temporal says so; for events: Ended when past, Upcoming with a
 * "tomorrow · 8:00 PM" preview when a start time exists. Never claims a state
 * the data does not back.
 */
export const getLifecycleBadge = (object: BriefObject, now: Date = new Date()): { label: string; expired: boolean } | null => {
  const temporal = object.temporal;
  if (!temporal) return null;
  const status = temporal.status;
  const type = object.type;

  if (type === 'offer') {
    if (status === 'expired') return { label: 'Expired', expired: true };
    if (status === 'active') return { label: 'Offer active', expired: false };
    return null;
  }

  // The pipeline classifies events as 'experience'; 'event' is accepted too
  // for rows a connector may still label that way.
  if (type === 'experience' || type === 'event') {
    if (status === 'past') return { label: 'Ended', expired: true };
    if (status === 'happening') return { label: 'Happening now', expired: false };
    if (status === 'upcoming' && temporal.startsAt) {
      return { label: getEventStartPreview(temporal.startsAt, now), expired: false };
    }
    if (status === 'upcoming') return { label: 'Upcoming', expired: false };
    if (status === 'recurring') return { label: 'Recurring', expired: false };
    return null;
  }

  if (type === 'opportunity' && status === 'past') {
    return { label: 'Closed', expired: true };
  }
  if (type === 'alert' || type === 'announcement' || type === 'news') {
    if (status === 'expired') return { label: 'Expired', expired: true };
  }
  return null;
};

/** "Tomorrow · 8:00 PM" / "Today · 4:00 PM" / "Saturday · 10:00 AM". */
export const getEventStartPreview = (startsAt: string, now: Date = new Date()): string => {
  const t = new Date(startsAt).getTime();
  if (!Number.isFinite(t)) return 'Upcoming';
  const time = new Date(t).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' });
  const day = new Date(t).toDateString() === now.toDateString()
    ? 'Today'
    : new Date(t).toDateString() === new Date(now.getTime() + 86400000).toDateString()
      ? 'Tomorrow'
      : new Date(t).toLocaleDateString('en-KE', { weekday: 'long' });
  return `${day} · ${time}`;
};

/** "Published {freshness}" — publication age, never confused with event time. */
export const getPublishedLine = (object: BriefObject, now: Date = new Date()): string | null => {
  const stamp = object.publishedAt ?? object.createdAt;
  if (!stamp) return null;
  const fresh = getRelativeFreshness(stamp, now);
  if (!fresh) return null;
  return `Published ${fresh.toLowerCase()}`;
};

export const formatCount = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);

// Types whose primary action navigates the stream instead of leaving Brief.
const PIVOT_TYPES: ObjectType[] = ['place', 'product', 'service'];

export const buildMapsHref = (query: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

/**
 * A data-URI .ics download for an event, built client-side from the public
 * campaign fields. Honest: it renders only what the campaign actually carries
 * (a missing end time falls back to +1h; a missing description is empty). No
 * server round-trip, no fabricated data — just a standards-compliant VEVENT.
 */
export function eventIcsUrl({ title, description, location, startsAt, endsAt }: {
  title: string; description: string | null; location: string | null;
  startsAt: string | null; endsAt: string | null;
}): string | null {
  if (!startsAt) return null; // a calendar entry needs a start time
  const toIcs = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(0, 15) + 'Z';
  const start = toIcs(startsAt);
  const end = endsAt ? toIcs(endsAt) : toIcs(new Date(Date.parse(startsAt) + 3600000).toISOString());
  const esc = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Brief//EN',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@brief`,
    `DTSTAMP:${toIcs(new Date().toISOString())}`,
    `DTSTART:${start}`, `DTEND:${end}`,
    `SUMMARY:${esc(title)}`,
    ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
    ...(location ? [`LOCATION:${esc(location)}`] : []),
    'END:VEVENT', 'END:VCALENDAR'
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}

export const buildTelHref = (phone: string): string =>
  `tel:${phone.replace(/[^\d+]/g, '')}`;

export type ResolvedAction =
  | { kind: 'external'; href: string; label: string }
  | { kind: 'phone'; href: string; label: string }
  | { kind: 'map'; href: string; label: string }
  | { kind: 'internal'; label: string }
  | { kind: 'none'; label: string };

// Single source of truth for "what does the primary button do?".
// Explicit actionType on the object always wins; otherwise we derive what we
// safely can from existing data; otherwise we admit there is no route.
export const resolveAction = (object: BriefObject): ResolvedAction => {
  const phone = object.metadata?.contactPhone;
  // `||` not `??` on purpose: an empty-string actionLabel from an ingestor
  // should fall back to the generic label, not render a blank button.
  const label = object.actionLabel || getObjectActionLabel(object.type);

  switch (object.actionType) {
    case 'external':
      // A URL is mandatory here -- fall through to 'none' rather than
      // rendering a link that goes nowhere.
      if (object.actionUrl) {
        return { kind: 'external', href: object.actionUrl, label };
      }
      break;

    case 'phone': {
      const number = object.actionUrl ?? phone;
      if (number) {
        return { kind: 'phone', href: buildTelHref(number), label };
      }
      break;
    }

    case 'map': {
      const query = object.actionUrl ?? object.locationName;
      if (query) {
        const href = query.startsWith('http') ? query : buildMapsHref(query);
        return { kind: 'map', href, label };
      }
      break;
    }

    case 'internal':
      return { kind: 'internal', label };
  }

  // --- No explicit routing: derive what we can ------------------------------
  if (PIVOT_TYPES.includes(object.type)) {
    return { kind: 'internal', label };
  }

  if (phone && (object.type === 'identity' || object.type === 'service')) {
    return { kind: 'phone', href: buildTelHref(phone), label: 'Call' };
  }

  if (
    object.locationName &&
    (object.type === 'place' ||
      object.type === 'experience' ||
      object.type === 'identity')
  ) {
    return { kind: 'map', href: buildMapsHref(object.locationName), label };
  }

  return { kind: 'none', label };
};

// Types that belong to the same real-world errand. Buying a stall kit,
// booking the inspection and applying for the grant are one job to the user,
// even though Brief models them as three different object types.
const TYPE_AFFINITY: Partial<Record<ObjectType, ObjectType[]>> = {
  product: ['service', 'opportunity', 'identity'],
  service: ['product', 'opportunity', 'knowledge', 'identity'],
  opportunity: ['service', 'product', 'knowledge'],
  knowledge: ['service', 'opportunity', 'identity'],
  experience: ['place', 'community', 'identity'],
  identity: ['product', 'service', 'knowledge'],
  place: ['experience', 'identity'],
  business: ['product', 'service', 'opportunity', 'identity'],
  offer: ['product', 'service', 'opportunity', 'knowledge'],
  alert: ['knowledge', 'announcement', 'news'],
  announcement: ['knowledge', 'news', 'experience', 'opportunity'],
  news: ['announcement', 'alert', 'knowledge', 'experience', 'opportunity']
};

export const areTypesAffine = (a: ObjectType, b: ObjectType): boolean =>
  (TYPE_AFFINITY[a] ?? []).includes(b);

// Plural noun for a type, used when the stream pivots to it.
const getTypePlural = (type: ObjectType): string => {
  switch (type) {
    case 'place':
      return 'places';
    case 'product':
      return 'items';
    case 'service':
      return 'services';
    case 'experience':
      return 'events';
    case 'opportunity':
      return 'opportunities';
    case 'knowledge':
      return 'guides';
    case 'identity':
      return 'organisations';
    case 'business':
      return 'businesses';
    case 'offer':
      return 'offers';
    case 'alert':
      return 'alerts';
    case 'announcement':
      return 'announcements';
    case 'news':
      return 'updates';
    default:
      return 'objects';
  }
};

// Message shown when the primary action retargets the stream.
// `others` is how many OTHER objects share this type -- if none, say so
// rather than announcing a list that turns out to be just this object.
export const getPivotMessage = (object: BriefObject, others: number): string => {
  const plural = getTypePlural(object.type);
  if (others === 0) {
    return `No other ${plural} listed nearby yet.`;
  }
  return `Showing ${others} more ${others === 1 ? plural.replace(/s$/, '') : plural} nearby.`;
};

// Why an object was surfaced. Drives the section heading and per-tile chips,
// so the rail can explain itself instead of being an unlabelled grid.
export type RelationReason =
  | 'linked'
  | 'provider'
  | 'location'
  | 'nearby'
  | 'complementary'
  | 'similar';

export interface ScoredRelation {
  item: BriefObject;
  score: number;
  reason: RelationReason;
}

// Any explicit relationship must beat any inferred one. The inferred signals in
// getRelatedObjects sum to at most ~24, so this floor is deliberately clear of
// that ceiling rather than tuned to it.
export const EXPLICIT_LINK_FLOOR = 100;

const STOP_WORDS = new Set([
  'and','the','for','with','from','this','that','their','are','was','not',
  'open','new','all','any','out','use','via','per','its','has','you','your'
]);

// Words worth matching on, drawn from the fields a human would skim.
export const getKeywords = (object: BriefObject): Set<string> => {
  const raw = `${object.title} ${object.category} ${object.summary} ${
    object.metadata?.statusBadge ?? ''
  }`.toLowerCase();

  return new Set(
    raw
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
  );
};

export const countKeywordOverlap = (a: Set<string>, b: Set<string>): number => {
  let n = 0;
  a.forEach((word) => {
    if (b.has(word)) n += 1;
  });
  return n;
};

// Heading reflects what the rail actually contains, not just the source type.
export const getRelatedHeading = (
  object: BriefObject,
  relations: ScoredRelation[]
): string => {
  if (relations.length === 0) return 'Related';

  const reasons = relations.map((relation) => relation.reason);

  if (reasons.every((reason) => reason === 'nearby')) return 'Nearby';
  if (reasons.some((reason) => reason === 'linked' || reason === 'provider')) {
    switch (object.type) {
      case 'product':
        return 'Sellers and related services';
      case 'service':
        return 'Providers and related places';
      case 'knowledge':
        return 'Related services and guides';
      case 'opportunity':
        return 'Guides and services to apply';
      default:
        return 'Directly related';
    }
  }

  switch (object.type) {
    case 'place':
      return 'Nearby places and vendors';
    case 'product':
      return 'More products and sellers';
    case 'service':
      return 'Other providers nearby';
    case 'opportunity':
      return 'Related opportunities';
    case 'experience':
      return 'Related places and events';
    case 'identity':
      return 'Other vendors and organisations';
    case 'knowledge':
      return 'Related guides';
    default:
      return 'More like this';
  }
};

export const getReasonChip = (reason: RelationReason): string | null => {
  switch (reason) {
    case 'provider':
      return 'Provider';
    case 'location':
      return 'Location';
    case 'linked':
      return 'Related';
    case 'complementary':
      return 'Goes with this';
    case 'nearby':
      return 'Nearby';
    default:
      return null;
  }
};

// STEP 5 Proximity: only ever from real distanceKm. Never computed, never guessed.
export const getDistanceLabel = (object: BriefObject): string | null => {
  const distance = object.metadata?.distanceKm;
  if (distance === undefined) return null;
  if (distance < 0.1) return 'Right here';
  if (distance < 1) return `${Math.round(distance * 1000)} m away`;
  return `${distance} km away`;
};

// STEP 2 Key facts, generated from whatever metadata exists. Adding a metadata key
// to an object surfaces it here without touching the JSX.
export interface KeyFact {
  key: string;
  label: string;
  value: string;
}

export const buildKeyFacts = (object: BriefObject): KeyFact[] => {
  const meta = object.metadata ?? {};
  const facts: KeyFact[] = [];
  const push = (key: string, label: string, value?: string | null) => {
    if (value) facts.push({ key, label, value });
  };

  if (meta.price !== undefined) {
    push(
      'price',
      object.type === 'opportunity' ? 'Value' : 'Price',
      `${meta.currency || 'KES'} ${meta.price.toLocaleString()}`
    );
  }

  push('operatingHours', object.type === 'experience' ? 'When' : 'Hours', meta.operatingHours);
  push('deadline', 'Deadline', meta.deadline);

  if (!meta.deadline) {
    push(
      'statusBadge',
      object.type === 'product' ? 'Availability' : 'Status',
      meta.statusBadge
    );
  }

  if (meta.rating !== undefined) {
    push('rating', 'Rating', `${meta.rating} / 5`);
  }
  if (meta.reviewsCount !== undefined) {
    push('reviewsCount', 'Reviews', `${meta.reviewsCount.toLocaleString()}`);
  }
  if (meta.capacity !== undefined) {
    push('capacity', 'Capacity', meta.capacity.toLocaleString());
  }
  if (meta.attendeesCount !== undefined) {
    push('attendeesCount', 'Attending', meta.attendeesCount.toLocaleString());
  }

  push('distanceKm', 'Distance', getDistanceLabel(object));

  return facts;
};

// Honest description of what pressing the primary button will do.
// Describes what the primary button will actually do, derived from the
// resolved action so the caption can never drift from the behaviour.
export const getActionNote = (object: BriefObject): string => {
  const action = resolveAction(object);

  switch (action.kind) {
    case 'phone':
      return 'Opens your phone dialler.';
    case 'map':
      return 'Opens this location in Maps.';
    case 'external':
      return 'Opens the official page in a new tab.';
    case 'internal':
      switch (object.type) {
        case 'place':
          return 'Shows other places like this one.';
        case 'product':
          return 'No online checkout yet. Shows other items in the Market.';
        case 'service':
          return 'No online booking yet. Shows other services nearby.';
        default:
          return `Shows other ${getTypePlural(object.type)} nearby.`;
      }
    default:
      return 'Brief has no direct route for this yet. Details are below.';
  }
};

// ----------------------------------------------------------------------------
// Freshness (prompt 13). Derived ONLY from lastVerifiedAt + validityWindowDays.
// If either is missing we return null and the UI shows nothing -- an unverified
// record must never be dressed up as a fresh one.
// ----------------------------------------------------------------------------
export type FreshnessLevel = 'recent' | 'verified' | 'aging' | 'stale';

export interface Freshness {
  level: FreshnessLevel;
  label: string;
  verifiedOn: string;
  daysAgo: number;
}

const DAY_MS = 86400000;

export const getFreshness = (
  object: BriefObject,
  now: Date = new Date()
): Freshness | null => {
  if (!object.lastVerifiedAt || object.validityWindowDays === undefined) {
    return null;
  }

  const verified = new Date(object.lastVerifiedAt);
  if (Number.isNaN(verified.getTime())) return null;

  const daysAgo = Math.max(0, Math.floor((now.getTime() - verified.getTime()) / DAY_MS));
  const windowDays = object.validityWindowDays;
  const ratio = windowDays > 0 ? daysAgo / windowDays : 1;

  // "stale" is only ever claimed when the supplied dates actually prove it.
  const level: FreshnessLevel =
    ratio > 1 ? 'stale' : ratio > 0.66 ? 'aging' : daysAgo <= 7 ? 'recent' : 'verified';

  const label =
    level === 'stale'
      ? 'Verification expired'
      : level === 'aging'
      ? 'Verification aging'
      : level === 'recent'
      ? 'Recently verified'
      : 'Verified';

  const verifiedOn = verified.toISOString().slice(0, 10);

  return { level, label, verifiedOn, daysAgo };
};

// ----------------------------------------------------------------------------
// Change detection (prompt 23). Pure: compares two versions of the same object
// and reports meaningful differences. Timestamps and unrelated metadata are
// deliberately ignored. This is what Watch will eventually consume.
// ----------------------------------------------------------------------------
export interface ObjectChange {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
}

const CHANGE_FIELDS: { key: string; label: string; fromMeta?: boolean }[] = [
  { key: 'title', label: 'Title' },
  { key: 'summary', label: 'Summary' },
  { key: 'locationName', label: 'Location' },
  { key: 'price', label: 'Price', fromMeta: true },
  { key: 'statusBadge', label: 'Status', fromMeta: true },
  { key: 'deadline', label: 'Deadline', fromMeta: true },
  { key: 'operatingHours', label: 'Hours', fromMeta: true },
  { key: 'capacity', label: 'Capacity', fromMeta: true },
  { key: 'contactPhone', label: 'Contact', fromMeta: true }
];

const readField = (object: BriefObject, key: string, fromMeta?: boolean): string | null => {
  const raw = fromMeta
    ? object.metadata?.[key]
    : (object as unknown as Record<string, unknown>)[key];
  if (raw === undefined || raw === null || raw === '') return null;
  return String(raw);
};

export const diffObjects = (before: BriefObject, after: BriefObject): ObjectChange[] => {
  const changes: ObjectChange[] = [];
  for (const field of CHANGE_FIELDS) {
    const from = readField(before, field.key, field.fromMeta);
    const to = readField(after, field.key, field.fromMeta);
    if (from !== to) {
      changes.push({ field: field.key, label: field.label, from, to });
    }
  }
  return changes;
};

// ----------------------------------------------------------------------------
// Duplicate detection (prompt 15). Returns candidates only -- never deletes,
// never merges. Pure string work, no dependencies.
// ----------------------------------------------------------------------------
export interface DuplicateCandidate {
  item: BriefObject;
  similarity: number;
}

const normaliseTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Dice coefficient over character bigrams: cheap, dependency-free, and much
// steadier on short business names than raw edit distance.
const titleSimilarity = (a: string, b: string): number => {
  const x = normaliseTitle(a);
  const y = normaliseTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;

  const bigrams = (v: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < v.length - 1; i++) {
      const g = v.slice(i, i + 2);
      map.set(g, (map.get(g) ?? 0) + 1);
    }
    return map;
  };

  const ax = bigrams(x);
  const by = bigrams(y);
  let shared = 0;
  ax.forEach((count, g) => {
    const other = by.get(g);
    if (other) shared += Math.min(count, other);
  });

  const total = x.length - 1 + (y.length - 1);
  return total > 0 ? (2 * shared) / total : 0;
};

const findPotentialDuplicates = (
  object: BriefObject,
  pool: BriefObject[],
  threshold = 0.82
): DuplicateCandidate[] =>
  pool
    .filter((item) => item.id !== object.id && item.type === object.type)
    .map((item) => {
      let similarity = titleSimilarity(object.title, item.title);
      // Same stated location corroborates; it cannot manufacture a match.
      if (
        similarity > 0.5 &&
        object.locationName &&
        item.locationName &&
        normaliseTitle(object.locationName) === normaliseTitle(item.locationName)
      ) {
        similarity = Math.min(1, similarity + 0.08);
      }
      return { item, similarity };
    })
    .filter(({ similarity }) => similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);

// ----------------------------------------------------------------------------
// Contextual actions (prompt 8). Every suggestion is derived from data the
// object actually carries and routed through resolveAction where it maps to a
// real destination. Nothing here invents a URL or a number.
// ----------------------------------------------------------------------------
export interface SuggestedAction {
  key: string;
  label: string;
  kind: 'primary' | 'link' | 'internal';
  href?: string;
}

export const getSuggestedActions = (object: BriefObject): SuggestedAction[] => {
  const out: SuggestedAction[] = [];
  const primary = resolveAction(object);
  const phone = object.metadata?.contactPhone;

  if (primary.kind !== 'none') {
    out.push({
      key: 'primary',
      label: primary.label,
      kind: 'primary',
      href: 'href' in primary ? primary.href : undefined
    });
  }

  // Directions: only when this object has a real place to point at, and only
  // when it is not already the primary action.
  if (object.locationName && primary.kind !== 'map') {
    out.push({
      key: 'directions',
      label: 'Get directions',
      kind: 'link',
      href: buildMapsHref(object.locationName)
    });
  }

  if (phone && primary.kind !== 'phone') {
    const label = object.type === 'product' ? 'Contact seller' : 'Call';
    out.push({ key: 'call', label, kind: 'link', href: buildTelHref(phone) });
  }

  if (object.sourceUrl) {
    out.push({ key: 'source', label: 'View source', kind: 'link', href: object.sourceUrl });
  }

  return out;
};

// ----------------------------------------------------------------------------
// The Brief graph (prompt 24). Pure functions over the objects and
// relationships that already exist -- no graph database, no new state, no UI.
// Every question the product asks about an object is answered in one place, so
// the components stay dumb and the rules stay testable.
// ----------------------------------------------------------------------------
export interface BriefGraph {
  get: (id: string) => BriefObject | undefined;
  providerOf: (object: BriefObject) => BriefObject | undefined;
  locationOf: (object: BriefObject) => BriefObject | undefined;
  offeringsBy: (provider: BriefObject) => BriefObject[];
  eventsAt: (place: BriefObject) => BriefObject[];
  nearby: (object: BriefObject, limit?: number) => BriefObject[];
  saved: () => BriefObject[];
  watching: () => BriefObject[];
  savedLabel: (id: string) => SaveLabel | undefined;
  activity: (limit?: number) => { object: BriefObject; verb: string; updatedAt: string }[];
  duplicatesOf: (object: BriefObject) => DuplicateCandidate[];
  changes: (before: BriefObject, after: BriefObject) => ObjectChange[];
}

// Verbs that represent a deliberate user commitment, in the order we would
// narrate them. 'discovered' is passive noise and stays out of Activity.
const ACTIVITY_VERBS: Record<string, string> = {
  saved: 'Saved',
  watched: 'Watching',
  engaged_with: 'Opened',
  interacted_with: 'Opened',
  contacted: 'Contacted',
  booked: 'Booked',
  bought: 'Bought',
  shared: 'Shared'
};

export const createBriefGraph = (
  objects: BriefObject[],
  relationships: ObjectRelationship[]
): BriefGraph => {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const get = (id: string) => byId.get(id);

  const edgesWith = (verb: string) =>
    relationships.filter((r) => r.verb === verb);

  const targetsOf = (verb: string): BriefObject[] =>
    edgesWith(verb)
      .map((r) => byId.get(r.targetId))
      .filter((o): o is BriefObject => Boolean(o));

  return {
    get,

    providerOf: (object) =>
      object.providerObjectId ? byId.get(object.providerObjectId) : undefined,

    locationOf: (object) =>
      object.locationObjectId ? byId.get(object.locationObjectId) : undefined,

    // Everything this identity is recorded as providing, either by explicit
    // link or by carrying its name. No inference beyond an exact name match.
    offeringsBy: (provider) =>
      objects.filter(
        (o) =>
          o.id !== provider.id &&
          (o.providerObjectId === provider.id ||
            (Boolean(o.creatorName) && o.creatorName === provider.creatorName))
      ),

    eventsAt: (place) =>
      objects.filter(
        (o) =>
          o.type === 'experience' &&
          (o.locationObjectId === place.id || o.parentObjectId === place.id)
      ),

    // Same stated location first, then genuine distance. Objects with no
    // distance data are simply absent -- never sorted as if they were at 0 km.
    nearby: (object, limit = 4) => {
      const here = object.locationName?.toLowerCase() ?? null;
      return objects
        .filter((o) => o.id !== object.id)
        .map((o) => {
          const sameLocation =
            here && o.locationName && o.locationName.toLowerCase() === here ? 1 : 0;
          const distance = o.metadata?.distanceKm;
          return { o, sameLocation, distance };
        })
        .filter(({ sameLocation, distance }) => sameLocation === 1 || distance !== undefined)
        .sort((a, b) => {
          if (a.sameLocation !== b.sameLocation) return b.sameLocation - a.sameLocation;
          const da = a.distance ?? Number.MAX_SAFE_INTEGER;
          const db = b.distance ?? Number.MAX_SAFE_INTEGER;
          return da - db;
        })
        .slice(0, limit)
        .map(({ o }) => o);
    },

    saved: () => targetsOf('saved'),
    watching: () => targetsOf('watched'),

    savedLabel: (id) =>
      relationships.find((r) => r.targetId === id && r.verb === 'saved')?.label,

    activity: (limit = 6) =>
      relationships
        .filter((r) => ACTIVITY_VERBS[r.verb] && byId.has(r.targetId))
        .slice()
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, limit)
        .map((r) => ({
          object: byId.get(r.targetId) as BriefObject,
          verb: ACTIVITY_VERBS[r.verb],
          updatedAt: r.updatedAt
        })),

    duplicatesOf: (object) => findPotentialDuplicates(object, objects),

    changes: (before, after) => diffObjects(before, after)
  };
};

// ============================================================================
// PURSUITS
// ----------------------------------------------------------------------------
// A Pursuit is something the user has asked Brief to find, monitor or keep
// organising -- "a good plumber near me", "cattle auctions this week", "watch
// the green grant". It is the standing intent; objects are what satisfy it.
//
// Brief only ever matches a Pursuit against information it actually holds. It
// does not search the internet, does not invent results, and an empty Pursuit
// is reported as empty rather than padded with weak guesses.
// ============================================================================

export type PursuitStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface Pursuit {
  id: string;
  query: string;
  status: PursuitStatus;
  createdAt: string;
  lastUpdatedAt: string;
  // Which channels this pursuit is allowed to draw on. Present so an ingestion
  // pipeline can scope a pursuit to, say, one Telegram group later.
  sourceTypes: NonNullable<BriefObject['sourceType']>[];
  matchedObjectIds: string[];
  // When true, the pursuit should re-check as new information arrives. The
  // monitoring loop is not built yet; this records the intent.
  watchChanges: boolean;
  // Which changes matter. Optional so every pursuit created before this
  // existed keeps working; absent means "any new match".
  watchConditions?: WatchCondition[];
}

// ----------------------------------------------------------------------------
// One scoring brain, shared by the search box and by pursuit matching, so a
// phrase means the same thing in both places.
// ----------------------------------------------------------------------------
export const scoreObjectForPhrase = (object: BriefObject, phrase: string): number => {
  const query = phrase.trim().toLowerCase();
  if (query === '') return 0;

  // NULL-SAFE by construction. The feed can carry objects whose title/type
  // are absent and whose category is stringOrNull(...) on the server — an
  // unguarded `.toLowerCase()` here threw on the first keystroke, crashing the
  // render (React unmounts the tree → a blank screen). Every field is coerced
  // to '' before matching so a sparse row simply scores zero instead of
  // throwing.
  const title = String(object.title ?? '').toLowerCase();
  const category = String(object.category ?? '').toLowerCase();
  const summary = String(object.summary ?? '').toLowerCase();
  const location = String(object.locationName ?? '').toLowerCase();
  const creator = String(object.creatorName ?? '').toLowerCase();
  const status = String(object.metadata?.statusBadge ?? '').toLowerCase();
  const type = String(object.type ?? '').toLowerCase();

  let score = 0;
  if (title === query) score += 100;
  else if (title.startsWith(query)) score += 60;
  else if (title.includes(query)) score += 40;

  if (category === query) score += 30;
  else if (category.includes(query)) score += 18;

  if (type.includes(query)) score += 16;
  if (creator.includes(query)) score += 12;
  if (location.includes(query)) score += 10;
  if (status.includes(query)) score += 6;
  if (summary.includes(query)) score += 4;

  return score;
};

// Words that carry intent rather than subject matter. They tell us HOW to
// pursue, so they must not also be matched as if they were search terms --
// otherwise "find a plumber" scores every object containing "find".
const PURSUIT_INTENT_WORDS = new Set([
  'find',
  'show',
  'get',
  'look',
  'looking',
  'search',
  'watch',
  'monitor',
  'track',
  'want',
  'need',
  'me',
  'my',
  'a',
  'an',
  'the',
  'for',
  'near',
  'nearby',
  'around',
  'this',
  'that',
  'week',
  'today',
  'tomorrow',
  'good',
  'best',
  'cheapest',
  'cheap',
  'any',
  'some',
  'one',
  'ones',
  'thing',
  'things',
  'please',
  'where',
  'what',
  'is',
  'are',
  'in',
  'on',
  'at',
  'to',
  'of',
  'and'
]);

export const getPursuitTerms = (query: string): string[] =>
  Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !PURSUIT_INTENT_WORDS.has(w))
    )
  );

// A pursuit query is natural language, so we score the whole phrase AND its
// meaningful terms. Requiring a real term hit is what stops "find me anything"
// from matching the entire graph.
// Deliberately minimal stemming -- enough that "lights" finds "Lighting" and
// "auctions" finds "Auction", without pulling in a linguistics library that
// would start making decisions nobody can audit.
export const singularise = (word: string): string => {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
};

// A stem hit is real but weaker than the word the user actually typed.
const scoreTerm = (object: BriefObject, term: string): number => {
  const direct = scoreObjectForPhrase(object, term);
  if (direct > 0) return direct;

  const stem = singularise(term);
  if (stem !== term && stem.length > 2) {
    return scoreObjectForPhrase(object, stem) * 0.9;
  }
  return 0;
};

export interface PursuitMatch {
  item: BriefObject;
  score: number;
  matchedTerms: string[];
}

export const matchPursuit = (
  pursuit: Pursuit,
  pool: BriefObject[],
  limit = 8
): PursuitMatch[] => {
  const terms = getPursuitTerms(pursuit.query);
  if (terms.length === 0) return [];

  const allowed =
    pursuit.sourceTypes.length > 0
      ? pool.filter(
          (o) =>
            o.sourceType === undefined ||
            pursuit.sourceTypes.includes(o.sourceType)
        )
      : pool;

  return allowed
    .map((item) => {
      const matchedTerms = terms.filter((term) => scoreTerm(item, term) > 0);

      // Every term must contribute; a single incidental word is not a match.
      if (matchedTerms.length === 0) return { item, score: 0, matchedTerms };

      let score = matchedTerms.reduce(
        (sum, term) => sum + scoreTerm(item, term),
        0
      );

      // Reward breadth: an object hitting more of the query is a better answer
      // than one hitting a single term very strongly.
      score *= matchedTerms.length / terms.length;

      // Exact phrase presence is the strongest possible signal.
      score += scoreObjectForPhrase(item, pursuit.query.trim());

      const distance = item.metadata?.distanceKm;
      if (distance !== undefined) score += Math.max(0, 2 - distance / 2);

      return { item, score, matchedTerms };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

// "watch the green grant" is a standing instruction, not a one-off lookup.
const queryImpliesWatch = (query: string): boolean =>
  /\b(watch|monitor|track|keep an eye|notify|alert)\b/i.test(query);

export const createPursuit = (query: string, now: string): Pursuit => ({
  id: `pur_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  query: query.trim(),
  status: 'active',
  createdAt: now,
  lastUpdatedAt: now,
  sourceTypes: [],
  matchedObjectIds: [],
  watchChanges: queryImpliesWatch(query)
});

// ----------------------------------------------------------------------------
// Capture: the same parser, pointed at something the user pasted in. Forwarding
// is the easiest way into Brief, so it must go through exactly the same rules
// as an ingested message -- no privileged path, no extra trust.
// ----------------------------------------------------------------------------
const URL_RE = /https?:\/\/[^\s<>"]+/i;

export const buildCaptureMessage = (raw: string, now: string): InboundMessage => {
  const text = raw.trim();
  const url = text.match(URL_RE);

  return {
    id: `cap_${Date.now()}`,
    channel: 'manual',
    sourceId: 'src_manual_capture',
    sourceLabel: 'Captured by you',
    // A bare URL has no text to parse. We keep it verbatim rather than
    // inventing a description of a page Brief has never fetched.
    text,
    receivedAt: now,
    sourceUrl: url ? url[0] : undefined
  };
};

// ----------------------------------------------------------------------------
// Watch conditions: which changes actually matter to this user, for this thing.
// The matching logic is real; the background loop that would call it is not
// built, so nothing here claims to be monitoring anything.
// ----------------------------------------------------------------------------
export type WatchCondition =
  | 'new_match'
  | 'price'
  | 'deadline'
  | 'location'
  | 'availability'
  | 'time';

export const WATCH_CONDITION_LABELS: Record<WatchCondition, string> = {
  new_match: 'New matching information',
  price: 'Price changes',
  deadline: 'Deadline changes',
  location: 'Location changes',
  availability: 'Availability changes',
  time: 'Event time changes'
};

// Maps a detected field change onto the condition a user would have asked for.
const CHANGE_FIELD_TO_CONDITION: Record<string, WatchCondition> = {
  price: 'price',
  deadline: 'deadline',
  locationName: 'location',
  statusBadge: 'availability',
  operatingHours: 'time',
  capacity: 'availability',
  contactPhone: 'availability',
  title: 'new_match',
  summary: 'new_match'
};

// Given two versions of an object and the conditions a user cares about,
// return only the changes they asked to hear about.
const filterChangesByConditions = (
  changes: ObjectChange[],
  conditions: WatchCondition[]
): ObjectChange[] => {
  if (conditions.length === 0) return [];
  return changes.filter((change) => {
    const mapped = CHANGE_FIELD_TO_CONDITION[change.field];
    return mapped !== undefined && conditions.includes(mapped);
  });
};

// ----------------------------------------------------------------------------
// Why this appeared (prompt 7). Reasons are computed from actual state, so a
// reason can never be shown unless it is literally true.
// ----------------------------------------------------------------------------
export interface AppearanceReason {
  key: string;
  label: string;
}

export const getAppearanceReasons = (
  object: BriefObject,
  context: {
    pursuits: Pursuit[];
    pursuitResults: Record<string, PursuitMatch[]>;
    savedIds: Set<string>;
    watchedIds: Set<string>;
    relatedToSavedIds: Set<string>;
  }
): AppearanceReason[] => {
  const reasons: AppearanceReason[] = [];

  for (const pursuit of context.pursuits) {
    const hit = (context.pursuitResults[pursuit.id] ?? []).some(
      (m) => m.item.id === object.id
    );
    if (hit) {
      reasons.push({
        key: `pursuit_${pursuit.id}`,
        label: `Matches your pursuit: ${pursuit.query}`
      });
    }
  }

  if (context.savedIds.has(object.id)) {
    reasons.push({ key: 'saved', label: 'You saved this' });
  }

  if (context.watchedIds.has(object.id)) {
    reasons.push({ key: 'watched', label: 'You are watching this' });
  }

  if (context.relatedToSavedIds.has(object.id)) {
    reasons.push({ key: 'related', label: 'Related to something you saved' });
  }

  if (object.sourceType === 'manual') {
    reasons.push({ key: 'captured', label: 'You captured this yourself' });
  } else if (object.sourceType) {
    reasons.push({ key: 'source', label: 'Arrived from a connected source' });
  }

  if (object.metadata?.distanceKm !== undefined) {
    reasons.push({
      key: 'nearby',
      label: `Near you (${getDistanceLabel(object)})`
    });
  }

  return reasons;
};

// ----------------------------------------------------------------------------
// Daily Brief (prompt 6). Strictly derived from what the user already cares
// about. No generic news, no filler, no commentary. Empty sections are dropped
// entirely rather than padded.
// ----------------------------------------------------------------------------
export interface DailyBriefSection {
  key: 'new' | 'changed' | 'today' | 'open';
  title: string;
  objects: BriefObject[];
  pursuits: Pursuit[];
  note?: string;
}

// "Today" means the object itself says it is time-sensitive, using words the
// data actually contains. Nothing is inferred from the clock.
const TIME_SENSITIVE_RE = /\b(today|tonight|now|closing|last day|upcoming|deadline)\b/i;

const isTimeSensitive = (object: BriefObject): boolean => {
  const status = object.metadata?.statusBadge ?? '';
  const deadline = object.metadata?.deadline ?? '';
  return (
    TIME_SENSITIVE_RE.test(status) ||
    deadline !== '' ||
    TIME_SENSITIVE_RE.test(object.metadata?.operatingHours ?? '')
  );
};

export const buildDailyBrief = (input: {
  objects: BriefObject[];
  pursuits: Pursuit[];
  pursuitResults: Record<string, PursuitMatch[]>;
  savedIds: Set<string>;
  watchedIds: Set<string>;
  seenIds: Set<string>;
}): DailyBriefSection[] => {
  const activePursuits = input.pursuits.filter((p) => p.status === 'active');

  // NEW: pursuit matches the user has not opened yet.
  const newMatches: BriefObject[] = [];
  const newIds = new Set<string>();
  for (const pursuit of activePursuits) {
    for (const match of input.pursuitResults[pursuit.id] ?? []) {
      if (!input.seenIds.has(match.item.id) && !newIds.has(match.item.id)) {
        newIds.add(match.item.id);
        newMatches.push(match.item);
      }
    }
  }

  // CHANGED: watched or saved objects that have been re-ingested since the
  // user last looked. Requires a genuine ingestedAt stamp -- no guessing.
  const changed = input.objects.filter(
    (o) =>
      (input.watchedIds.has(o.id) || input.savedIds.has(o.id)) &&
      o.ingestedAt !== undefined
  );

  // TODAY: things the user cares about that say they are time-sensitive.
  const today = input.objects.filter(
    (o) =>
      (input.savedIds.has(o.id) || input.watchedIds.has(o.id) || newIds.has(o.id)) &&
      isTimeSensitive(o)
  );

  const stillOpen = activePursuits.filter(
    (p) => (input.pursuitResults[p.id] ?? []).length === 0
  );

  const sections: DailyBriefSection[] = [
    { key: 'new', title: 'New', objects: newMatches, pursuits: [] },
    { key: 'changed', title: 'Changed', objects: changed, pursuits: [] },
    { key: 'today', title: 'Today', objects: today, pursuits: [] },
    { key: 'open', title: 'Still open', objects: [], pursuits: stillOpen }
  ];

  return sections.filter(
    (section) => section.objects.length > 0 || section.pursuits.length > 0
  );
};

// ============================================================================
// DISCOVERY DAILY BRIEF — TODAY / NEAR YOU / NOW / COMING UP
// ----------------------------------------------------------------------------
// The compact "Today's Brief" layer of the discovery experience. Every row
// comes from a REAL persisted object's temporal projection (the server's
// lifecycle fields, never the wall clock guessing). Sections appear only when
// they have data — no hardcoded samples, no padding.
// ============================================================================

export interface DiscoveryBriefSection {
  key: 'today' | 'near' | 'now' | 'coming';
  title: string;
  objects: BriefObject[];
}

const startOfLocalDay = (d: Date) => {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
};

const isSameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const isEventType = (o: BriefObject) => o.type === 'experience' || String(o.type) === 'event';

export const buildDiscoveryBrief = (input: {
  objects: BriefObject[];
  area?: string | null;
  geo?: { lat: number; lng: number } | null;
}): DiscoveryBriefSection[] => {
  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);

  const parsed = (v: unknown): Date | null => {
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  };

  const today: BriefObject[] = [];
  const near: BriefObject[] = [];
  const nowSection: BriefObject[] = [];
  const coming: BriefObject[] = [];
  const placed = new Set<string>();

  for (const o of input.objects) {
    const t = o.temporal;
    const status = t?.status ?? '';
    const startsAt = parsed(t?.startsAt ?? o.metadata?.eventStart ?? o.metadata?.dateCanonical);
    const deadlineAt = parsed(t?.deadlineAt ?? o.metadata?.deadlineCanonical);

    // TODAY — events actually happening today, and things expiring today.
    if (isEventType(o) && startsAt && startsAt >= yesterdayStart && startsAt < tomorrowStart) {
      if (!placed.has(o.id)) { placed.add(o.id); today.push(o); }
      continue;
    }
    if ((o.type === 'offer' || o.type === 'opportunity') && deadlineAt && deadlineAt >= todayStart && deadlineAt < tomorrowStart) {
      if (!placed.has(o.id)) { placed.add(o.id); today.push(o); }
      continue;
    }
    if (status === 'happening') {
      if (!placed.has(o.id)) { placed.add(o.id); today.push(o); }
      continue;
    }

    // NOW — current alerts, fresh news, active offers. Places and businesses
    // are "current" too, but they are not breaking activity: they belong in
    // NEAR YOU, not NOW.
    const isNowType = o.type === 'alert' || o.type === 'news' || o.type === 'offer'
      || o.type === 'opportunity' || o.type === 'announcement';
    if (isNowType && (status === 'current' || status === 'active' || status === 'no_deadline')) {
      if (!placed.has(o.id)) { placed.add(o.id); nowSection.push(o); }
      continue;
    }

    // COMING UP — important upcoming events (ranked, so the most relevant
    // ones surface here).
    if (isEventType(o) && status === 'upcoming') {
      if (!placed.has(o.id)) { placed.add(o.id); coming.push(o); }
      continue;
    }

    // NEAR YOU — everything else with a real locality signal.
    const dist = o.metadata?.distanceKm;
    const area = String(o.metadata?.area ?? o.metadata?.county ?? '').trim();
    if (typeof dist === 'number' || area || o.locationName) {
      if (!placed.has(o.id)) { placed.add(o.id); near.push(o); }
    }
  }

  const sections: DiscoveryBriefSection[] = [];
  if (today.length > 0) sections.push({ key: 'today', title: 'TODAY', objects: today });
  if (near.length > 0) sections.push({ key: 'near', title: 'NEAR YOU', objects: near });
  if (nowSection.length > 0) sections.push({ key: 'now', title: 'NOW', objects: nowSection });
  if (coming.length > 0) sections.push({ key: 'coming', title: 'COMING UP', objects: coming });
  return sections;
};

// The report reasons the SERVER actually accepts. The client buttons send
// these exact ids; labels are for people. Aligned with trust.js REPORT_REASONS.
export const REPORT_REASONS: { id: string; label: string }[] = [
  { id: 'wrong', label: 'Incorrect information' },
  { id: 'spam', label: 'Spam' },
  { id: 'offensive', label: 'Offensive' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'expired', label: 'Expired' },
  { id: 'cancelled', label: 'Event cancelled' },
  { id: 'wrong_location', label: 'Wrong location' },
  { id: 'wrong_date', label: 'Wrong date/time' },
  { id: 'other', label: 'Other' }
];

// ============================================================================
// PERSONAL BRIEF — MY BRIEF / YOUR BRIEF / AROUND YOU / TODAY / COMING UP /
// FOR YOU. Built from the SAME persisted objects the global feed uses, in the
// server's personal order (the re-ranking, never a second object store).
// Sections appear only when real data backs them — no empty sections, no
// manufactured rows.
// ============================================================================

export interface PersonalBriefSection {
  key: 'your' | 'around' | 'today' | 'coming' | 'foryou';
  title: string;
  objects: BriefObject[];
}

const matchesFollowedTopics = (o: BriefObject, topics: { id: string; label: string; keywords: string[] }[], followed: string[]): string[] => {
  if (!followed.length) return [];
  const text = [
    o.title, o.summary, o.category,
    ...(Array.isArray(o.metadata?.categories) ? (o.metadata.categories as string[]) : [])
  ].filter((v): v is string => typeof v === 'string' && v.length > 0).join(' ').toLowerCase();
  if (!text) return [];
  const hits: string[] = [];
  for (const topic of topics) {
    if (!followed.includes(topic.id)) continue;
    if (topic.keywords.some((k) => text.includes(k))) hits.push(topic.id);
  }
  return hits;
};

export const buildPersonalSections = (input: {
  ordered: { object: BriefObject; boost: number; reasons: string[] }[];
  interests: { locations: string[]; types: string[]; topics: string[] };
  topics: { id: string; label: string; keywords: string[] }[];
  personalized: boolean;
}): PersonalBriefSection[] => {
  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);

  const parsed = (v: unknown): Date | null => {
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  };

  const your: BriefObject[] = [];
  const around: BriefObject[] = [];
  const today: BriefObject[] = [];
  const coming: BriefObject[] = [];
  const foryou: BriefObject[] = [];
  const placed = new Set<string>();

  for (const { object: o, boost, reasons } of input.ordered) {
    const t = o.temporal;
    const status = t?.status ?? '';
    const startsAt = parsed(t?.startsAt ?? o.metadata?.eventStart);
    const deadlineAt = parsed(t?.deadlineAt ?? o.metadata?.deadlineCanonical);

    // YOUR BRIEF — the user's own top of the feed: rows personalization
    // actually moved (explicit boost, never fabricated).
    if (input.personalized && boost > 0 && your.length < 4) {
      if (!placed.has(o.id)) { placed.add(o.id); your.push(o); }
      continue;
    }

    // TODAY — events actually happening today, and things expiring today
    // (the same real temporal rules as the global brief).
    if (isEventType(o) && startsAt && startsAt >= todayStart && startsAt < tomorrowStart) {
      if (!placed.has(o.id)) { placed.add(o.id); today.push(o); }
      continue;
    }
    if ((o.type === 'offer' || o.type === 'opportunity') && deadlineAt && deadlineAt >= todayStart && deadlineAt < tomorrowStart) {
      if (!placed.has(o.id)) { placed.add(o.id); today.push(o); }
      continue;
    }
    if (status === 'happening') {
      if (!placed.has(o.id)) { placed.add(o.id); today.push(o); }
      continue;
    }

    // COMING UP — upcoming events in the personal order.
    if (isEventType(o) && status === 'upcoming') {
      if (!placed.has(o.id)) { placed.add(o.id); coming.push(o); }
      continue;
    }

    // FOR YOU — followed types and matched topics, capped so it stays a
    // suggestion rail rather than a second feed.
    const typeMatch = input.interests.types.includes(o.type);
    const topicMatch = matchesFollowedTopics(o, input.topics, input.interests.topics).length > 0;
    if (input.personalized && (typeMatch || topicMatch) && foryou.length < 4) {
      if (!placed.has(o.id)) { placed.add(o.id); foryou.push(o); }
      continue;
    }

    // AROUND YOU — everything else with a real locality signal, in the
    // personal order. Never fabricated: only rows that say where they are.
    const area = String(o.metadata?.area ?? o.metadata?.county ?? '').trim();
    const dist = o.metadata?.distanceKm;
    if (typeof dist === 'number' || area || o.locationName) {
      if (!placed.has(o.id)) { placed.add(o.id); around.push(o); }
    }
  }

  const sections: PersonalBriefSection[] = [];
  if (your.length > 0) sections.push({ key: 'your', title: 'YOUR BRIEF', objects: your });
  if (around.length > 0) sections.push({ key: 'around', title: 'AROUND YOU', objects: around });
  if (today.length > 0) sections.push({ key: 'today', title: 'TODAY', objects: today });
  if (coming.length > 0) sections.push({ key: 'coming', title: 'COMING UP', objects: coming });
  if (foryou.length > 0) sections.push({ key: 'foryou', title: 'FOR YOU', objects: foryou });
  return sections;
};

/** A compact WHEN line for Today's Brief rows, from real temporal data. */
export const briefWhenLabel = (o: BriefObject): string | null => {
  const t = o.temporal;
  const fmt = (v: unknown) => {
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) return null;
    const now = new Date();
    if (isSameLocalDay(d, now)) {
      return `Today ${d.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' })}`;
    }
    return d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
  };
  if (t?.status === 'happening') return 'Happening now';
  if (t?.status === 'upcoming') return fmt(t.startsAt) ?? 'Upcoming';
  if (t?.status === 'active') {
    const dl = fmt(t.deadlineAt);
    return dl ? `Ends ${dl.replace('Today ', 'today ')}` : 'Ongoing';
  }
  if (t?.status === 'current' || t?.status === 'no_deadline') return 'Now';
  if (t?.status === 'past' && t.startsAt) return `Ended ${fmt(t.startsAt)}`;
  if (o.metadata?.eventStart) return fmt(o.metadata.eventStart);
  if (o.metadata?.deadlineCanonical) return `Ends ${fmt(o.metadata.deadlineCanonical)}`;
  return null;
};

// ============================================================================
// GROUP UTILITY LAYER
// ----------------------------------------------------------------------------
// Brief does not arrive in a group asking for its customers. It arrives making
// the group's own conversation more useful: findable, remembered, and honest
// about where every fact came from.
//
// A critical distinction from the ingestion boundary: parseInboundMessage asks
// "should this become an object?" and deliberately rejects questions as
// conversation. That is right for the object graph and WRONG here. In a group,
// an unanswered question is the single most valuable thing on the wall --
// groups are terrible at preserving them. So classification is a separate job
// with its own rules, and it keeps things the object parser throws away.
// ============================================================================

export type MessageClass =
  | 'job'
  | 'event'
  | 'business'
  | 'product'
  | 'service'
  | 'place'
  | 'opportunity'
  | 'question'
  | 'resource'
  | 'chatter';

export const MESSAGE_CLASS_LABELS: Record<MessageClass, string> = {
  job: 'Jobs',
  event: 'Events',
  business: 'Businesses',
  product: 'Products',
  service: 'Services',
  place: 'Places',
  opportunity: 'Opportunities',
  question: 'Questions',
  resource: 'Useful information',
  chatter: 'Conversation'
};

export interface GroupMessage {
  id: string;
  groupId: string;
  // Display name only, and only where the group permits it. Never a phone
  // number, never an internal account id.
  authorLabel?: string;
  text: string;
  sentAt: string;
  // Set when the platform tells us this is a reply. Used to decide whether a
  // question was ever answered -- inferred, never assumed.
  replyToId?: string;
  url?: string;
  // Multimodal: an image or document is just another way information arrived.
  // It produces the same entry shape as text.
  mediaKind?: 'message' | 'image' | 'document' | 'link';
  mediaReference?: string;
  // Text Brief can legitimately read: a caption, a filename, or text a
  // processor has already extracted. Brief performs NO image recognition, so
  // nothing is ever read out of pixels.
  mediaExtractedText?: string;
  mediaAnalysisStatus?: ImageAnalysisStatus;
}

// Access is the spine of this layer. A group EXISTING in Brief's data and a
// group being VISIBLE to this user are different facts, and conflating them is
// the one failure mode that would make Brief feel like surveillance.
//
//   member     -- the user is in this group
//   authorised -- not a member, but explicitly granted Brief access
//   pending    -- requested, not yet granted. Not readable.
//   revoked    -- access withdrawn. Not readable, and nothing new is taken.
export type GroupAccess = 'member' | 'authorised' | 'pending' | 'revoked';

// The ONLY states that may reach a user's Groups layer.
const READABLE_ACCESS: GroupAccess[] = ['member', 'authorised'];

export const canUserAccessGroup = (group: ConnectedSource): boolean =>
  READABLE_ACCESS.includes(group.access);

// Four separate permissions, because "Brief can see it" must never silently
// imply "Brief may keep it" or "Brief may show it elsewhere".
export interface GroupPermissions {
  canRead: boolean;
  canProcess: boolean;
  canRetain: boolean;
  canShareBeyondGroup: boolean;
  canReply: boolean;
  canPostDigest: boolean;
}

const DEFAULT_PERMISSIONS: GroupPermissions = {
  canRead: true,
  canProcess: true,
  canRetain: true,
  // Off by default: information from a private group stays in that group
  // unless someone deliberately opts in.
  canShareBeyondGroup: false,
  canReply: false,
  canPostDigest: false
};

/**
 * A messaging group Brief has been given access to read.
 *
 * This replaces the retired `BriefGroup`. The rename is the point: Brief used
 * to carry TWO community primitives -- client-only `BriefGroup` and the real,
 * server-backed `Circle` -- which is the duplicate the coverage map flagged.
 *
 * They are not the same thing and this one is not a community:
 *
 *   Circle          a community. People, purpose, place, blocks, signals,
 *                   targets, economic activity. Lives on the server.
 *   ConnectedSource a pipe Brief reads. A WhatsApp or Telegram group whose
 *                   messages are classified into knowledge entries.
 *
 * Collapsing this into Circle would have made Circle "Groups 2.0". Instead it
 * maps onto the primitive the server already has for exactly this: a Source.
 * `id` here IS a server source id.
 *
 * The invented fields are gone: memberCount/memberCountLabel/lastIndexedAt
 * were hardcoded ("312 members") and measured nothing.
 */
export interface ConnectedSource {
  id: string;
  name: string;
  platform: 'telegram' | 'whatsapp' | 'other';
  description?: string;
  access: GroupAccess;
  /** Whether the group has allowed author names to be retained. */
  retainAuthors: boolean;
  lastActivityAt?: string;
  permissions?: GroupPermissions;
}

// Where a single piece of information came from. Attached to every extracted
// record so nothing Brief shows is ever unattributable.
export interface SourceReference {
  groupId: string;
  platform: string;
  messageId?: string;
  authorLabel?: string;
  timestamp: string;
  sourceType: 'message' | 'image' | 'document' | 'link';
}

// An entry in the group's knowledge index. It is a POINTER to a message, not a
// replacement for it: the original text is always carried alongside Brief's
// interpretation so a member can check the machine's work.
export interface GroupKnowledgeEntry {
  id: string;
  groupId: string;
  messageId: string;
  // The literal message, shown verbatim so Brief's reading never stands in
  // for what was actually said.
  originalText: string;
  // Everything Brief may legitimately read, including a caption or text a
  // document processor already extracted. Used for search only.
  searchableText: string;
  mediaKind?: 'message' | 'image' | 'document' | 'link';
  mediaReference?: string;
  mediaAnalysisStatus?: ImageAnalysisStatus;
  // Text a processor genuinely extracted. Never read from pixels by Brief.
  mediaExtractedText?: string;
  authorLabel?: string;
  sentAt: string;
  url?: string;
  messageClass: MessageClass;
  // Why the classifier chose this class -- the literal words it matched.
  evidence: string;
  confidence: number;
  entities: ExtractedField[];
  // Full provenance. Brief must always be able to say where this came from.
  source: SourceReference;
  // Populated only when a member publishes the entry into the object graph.
  linkedObjectId?: string;
  // Questions only. The ids AND the resolved replies -- a question without its
  // answer is exactly the archaeology Brief exists to prevent.
  answeredByMessageIds: string[];
  answers: { messageId: string; text: string; authorLabel?: string }[];
}

// --- Classification ---------------------------------------------------------
// Question detection runs FIRST and wins. A message asking for something is a
// question even when it also mentions a product, because the useful record is
// "someone needs this", not "someone is selling this".
const QUESTION_RE =
  /\?\s*$|\?\s|^\s*(?:anyone|does anyone|any one|who|where|how|what|when|which|is there|are there|can (?:i|anyone|someone)|looking for|need|nataka|naomba|kuna)\b/i;

// Asking for a recommendation is still a question even without a question mark.
const REQUEST_RE =
  /\b(?:anyone (?:know|selling|got|have)|looking for|in need of|recommend|suggestions?|help me find|where can i)\b/i;

const CLASS_SIGNALS: { cls: MessageClass; words: RegExp }[] = [
  { cls: 'job', words: /\b(vacancy|vacancies|hiring|job|position|recruit|cv|applicants?|apply now|internship)\b/i },
  { cls: 'opportunity', words: /\b(grant|scholarship|funding|tender|bursary|call for|application(?:s)? open|deadline)\b/i },
  { cls: 'event', words: /\b(event|forum|summit|meetup|workshop|festival|market day|auction|training|webinar|kesho|this saturday|this sunday)\b/i },
  { cls: 'service', words: /\b(service|repair|installation|fundi|plumber|electrician|mechanic|cleaning|delivery|booking)\b/i },
  { cls: 'product', words: /\b(for sale|selling|on sale|in stock|brand new|second hand|pieces|units|kilo|bei)\b/i },
  { cls: 'place', words: /\b(shop|stall|market|centre|center|hub|premises|branch|located at|opposite)\b/i },
  { cls: 'business', words: /\b(supplier|vendor|company|enterprise|ltd|limited|dealer|distributor|wholesaler)\b/i },
  { cls: 'resource', words: /\b(guide|how to|steps|requirements|link|website|document|form|notice|announcement|price list|menu|catalogue|catalog|rate card)\b/i }
];

export interface Classification {
  messageClass: MessageClass;
  evidence: string;
  confidence: number;
}

const classifyGroupMessage = (
  text: string,
  media?: { kind?: GroupMessage['mediaKind']; status?: ImageAnalysisStatus }
): Classification => {
  const trimmed = text.trim();

  // Questions win. In a group this is the record worth keeping.
  const questionHit = trimmed.match(QUESTION_RE) ?? trimmed.match(REQUEST_RE);
  if (questionHit) {
    return {
      messageClass: 'question',
      evidence: questionHit[0].trim().slice(0, 40),
      // A question mark is unambiguous; a phrasing match is weaker.
      confidence: trimmed.endsWith('?') ? 0.9 : 0.7
    };
  }

  for (const signal of CLASS_SIGNALS) {
    const hit = trimmed.match(signal.words);
    if (hit) {
      return {
        messageClass: signal.cls,
        evidence: hit[0].trim(),
        confidence: 0.75
      };
    }
  }

  // Someone deliberately attaching a document or poster is not chatter, even
  // when the caption is only "Flyer". The attachment itself is the signal.
  // Confidence stays modest because the wording gave Brief nothing to go on.
  if (
    (media?.kind === 'document' || media?.kind === 'image') &&
    media.status === 'processed'
  ) {
    return {
      messageClass: 'resource',
      evidence: `shared ${media.kind}`,
      confidence: 0.5
    };
  }

  return { messageClass: 'chatter', evidence: '', confidence: 0.2 };
};

// --- Building the index ------------------------------------------------------
// Entity extraction reuses the ingestion parser's field extractors so a price
// means the same thing here as it does there. Chatter is classified but never
// indexed: Brief should not turn every message into a database record.
const extractEntities = (text: string): ExtractedField[] => {
  const out: ExtractedField[] = [];

  const money = text.match(MONEY_RE);
  if (money) {
    const value = cleanMoney(money[1] ?? money[2] ?? '');
    if (value !== null) {
      out.push({ field: 'price', value: String(value), evidence: money[0].trim() });
    }
  }

  const phone = text.match(PHONE_RE);
  if (phone) {
    out.push({ field: 'contact', value: phone[0].trim(), evidence: phone[0].trim() });
  }

  const hours = text.match(HOURS_RE);
  if (hours) {
    out.push({
      field: 'hours',
      value: `${hours[1]}:${hours[2]}-${hours[3]}:${hours[4]}`,
      evidence: hours[0].trim()
    });
  }

  const deadline = text.match(DEADLINE_RE);
  if (deadline) {
    out.push({
      field: 'deadline',
      value: deadline[1].trim().replace(/[,.]$/, ''),
      evidence: deadline[0].trim()
    });
  }

  const location = text.match(LOCATION_RE);
  if (location) {
    out.push({ field: 'location', value: location[1].trim(), evidence: location[0].trim() });
  }

  return out;
};

export const buildGroupIndex = (
  messages: GroupMessage[],
  group: ConnectedSource
): GroupKnowledgeEntry[] => {
  const entries: GroupKnowledgeEntry[] = [];

  // Access and permission are enforced HERE, at the point information is
  // created -- not later in the UI. A component cannot forget to filter
  // something that was never built. Revoked or pending access yields an empty
  // index, so nothing lingers from a group the user can no longer reach.
  if (!canUserAccessGroup(group)) return entries;
  if (group.permissions && (!group.permissions.canRead || !group.permissions.canProcess)) {
    return entries;
  }

  // Belt and braces: never index a message that claims a different group.
  const own = messages.filter((m) => m.groupId === group.id);

  for (const message of own) {
    // One pipeline for every input kind. An event poster contributes whatever
    // text is genuinely available (caption, filename, or text a processor has
    // already extracted) and nothing more -- Brief does not read pixels.
    const readable = [message.text, message.mediaExtractedText]
      .filter(Boolean)
      .join(' ')
      .trim();

    const classification = classifyGroupMessage(readable, {
      kind: message.mediaKind,
      status: message.mediaAnalysisStatus
    });

    // Conversation stays conversation. Indexing it would recreate the noise
    // Brief exists to cut through.
    if (classification.messageClass === 'chatter') continue;

    entries.push({
      id: `gke_${message.id}`,
      groupId: group.id,
      messageId: message.id,
      originalText: message.text,
      searchableText: readable,
      mediaKind: message.mediaKind,
      mediaReference: message.mediaReference,
      mediaAnalysisStatus: message.mediaAnalysisStatus,
      mediaExtractedText: message.mediaExtractedText,
      // Author retention is the group's decision, not Brief's.
      authorLabel: group.retainAuthors ? message.authorLabel : undefined,
      sentAt: message.sentAt,
      url: message.url,
      messageClass: classification.messageClass,
      evidence: classification.evidence,
      confidence: classification.confidence,
      entities: extractEntities(readable),
      source: {
        groupId: group.id,
        platform: group.platform,
        messageId: message.id,
        authorLabel: group.retainAuthors ? message.authorLabel : undefined,
        timestamp: message.sentAt,
        sourceType: message.mediaKind ?? 'message'
      },
      answeredByMessageIds: [],
      answers: []
    });
  }

  // A question counts as answered when a later message replies to it. We only
  // ever infer this from an explicit replyToId -- never from timing or
  // keyword similarity, which would produce confident nonsense.
  for (const entry of entries) {
    if (entry.messageClass !== 'question') continue;
    const replies = own.filter((m) => m.replyToId === entry.messageId);
    entry.answeredByMessageIds = replies.map((m) => m.id);
    entry.answers = replies.map((m) => ({
      messageId: m.id,
      text: m.text,
      authorLabel: group.retainAuthors ? m.authorLabel : undefined
    }));
  }

  return entries;
};

export const getUnansweredQuestions = (
  entries: GroupKnowledgeEntry[]
): GroupKnowledgeEntry[] =>
  entries
    .filter(
      (e) => e.messageClass === 'question' && e.answeredByMessageIds.length === 0
    )
    .sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));

// --- Weekly group brief ------------------------------------------------------
// Counts of useful things. Deliberately NOT engagement metrics: no message
// totals per member, no "most active" leaderboard, no streaks.
export interface GroupBriefLine {
  label: string;
  count: number;
  messageClass: MessageClass;
}

export interface WeeklyGroupBrief {
  from: string;
  to: string;
  lines: GroupBriefLine[];
  unanswered: GroupKnowledgeEntry[];
  totalIndexed: number;
}

const WEEK_MS = 7 * 86400000;

const buildWeeklyGroupBrief = (
  entries: GroupKnowledgeEntry[],
  now: Date = new Date()
): WeeklyGroupBrief => {
  const cutoff = now.getTime() - WEEK_MS;
  const recent = entries.filter((e) => new Date(e.sentAt).getTime() >= cutoff);

  const order: MessageClass[] = [
    'opportunity',
    'job',
    'event',
    'business',
    'product',
    'service',
    'place',
    'resource'
  ];

  const lines = order
    .map((cls) => ({
      label: MESSAGE_CLASS_LABELS[cls],
      count: recent.filter((e) => e.messageClass === cls).length,
      messageClass: cls
    }))
    // Empty categories are dropped rather than reported as zero.
    .filter((line) => line.count > 0);

  return {
    from: new Date(cutoff).toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
    lines,
    unanswered: getUnansweredQuestions(recent),
    totalIndexed: recent.length
  };
};

// --- Group commands ----------------------------------------------------------
// Deliberately tiny. The interface is the group everyone already uses.
export type GroupCommandName = 'find' | 'jobs' | 'events' | 'brief' | 'ask' | 'saved';

export interface GroupCommandResult {
  command: GroupCommandName;
  argument: string;
  // Results found inside this group's own messages.
  fromGroup: GroupKnowledgeEntry[];
  // Results from the wider Brief knowledge layer, used ONLY when the group
  // itself could not answer. Always presented separately.
  fromElsewhere: BriefObject[];
  brief?: WeeklyGroupBrief;
  // Plain text shown when nothing was found. Brief says so rather than
  // padding the answer.
  emptyNote?: string;
}

const searchGroupEntries = (
  entries: GroupKnowledgeEntry[],
  phrase: string
): GroupKnowledgeEntry[] => {
  const terms = getPursuitTerms(phrase);
  if (terms.length === 0) return [];

  return entries
    .map((entry) => {
      // Include the answers: someone asking "a 50W solar kit?" and someone
      // replying "Kikao Hardware has 50W systems" is one useful record.
      // searchableText, not originalText: a price list's contents must be
      // findable even though the message body only said "Price List".
      const haystack = `${entry.searchableText} ${entry.answers
        .map((a) => a.text)
        .join(' ')} ${entry.entities.map((e) => e.value).join(' ')}`.toLowerCase();
      const hits = terms.filter((t) => haystack.includes(t));
      return { entry, hits: hits.length };
    })
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => {
      if (b.hits !== a.hits) return b.hits - a.hits;
      return a.entry.sentAt < b.entry.sentAt ? 1 : -1;
    })
    .map(({ entry }) => entry);
};

// "Aug 12" - light provenance, no clutter.
export const formatSourceDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

export const runGroupCommand = (
  raw: string,
  context: {
    entries: GroupKnowledgeEntry[];
    objects: BriefObject[];
    savedObjects: BriefObject[];
    now?: Date;
  }
): GroupCommandResult | null => {
  const match = raw.trim().match(/^\/(find|jobs|events|brief|ask|saved)\b\s*(.*)$/i);
  if (!match) return null;

  const command = match[1].toLowerCase() as GroupCommandName;
  const argument = match[2].trim();
  const base: GroupCommandResult = {
    command,
    argument,
    fromGroup: [],
    fromElsewhere: []
  };

  if (command === 'brief') {
    return { ...base, brief: buildWeeklyGroupBrief(context.entries, context.now) };
  }

  if (command === 'jobs' || command === 'events') {
    const cls: MessageClass = command === 'jobs' ? 'job' : 'event';
    const found = context.entries
      .filter((e) => e.messageClass === cls)
      .sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
    return {
      ...base,
      fromGroup: found,
      emptyNote: found.length === 0 ? `No ${cls}s posted here yet.` : undefined
    };
  }

  if (command === 'saved') {
    return {
      ...base,
      fromElsewhere: context.savedObjects,
      emptyNote:
        context.savedObjects.length === 0 ? 'You have not saved anything yet.' : undefined
    };
  }

  // /find and /ask: search THIS group first. Only if the group cannot answer
  // do we reach into the wider knowledge layer, and the two are never mixed.
  if (argument === '') {
    return { ...base, emptyNote: `Try ${'/' + command} followed by what you need.` };
  }

  const fromGroup = searchGroupEntries(context.entries, argument);
  if (fromGroup.length > 0) {
    return { ...base, fromGroup };
  }

  const fromElsewhere = matchPursuit(
    {
      id: 'tmp',
      query: argument,
      status: 'active',
      createdAt: '',
      lastUpdatedAt: '',
      sourceTypes: [],
      matchedObjectIds: [],
      watchChanges: false
    },
    context.objects,
    4
  ).map((m) => m.item);

  return {
    ...base,
    fromElsewhere,
    emptyNote:
      fromElsewhere.length === 0
        ? 'Nothing in this group, and nothing elsewhere in Brief yet.'
        : undefined
  };
};

// --- Business utility mode ---------------------------------------------------
// A business connected to Brief maintains the answers it is already typing out
// by hand twenty times a week. This is an answering aid, not an advert: there
// is no promotional copy field, and nothing here is pushed at anyone.
export interface BusinessProfile {
  id: string;
  // Ties the profile to an identity object already in the graph when one
  // exists. Absent for a business Brief only knows from a group.
  objectId?: string;
  name: string;
  hours?: string;
  location?: string;
  contact?: string;
  services: string[];
  // Question-and-answer pairs the business has confirmed. Brief answers ONLY
  // with these words -- it never composes a reply on the business's behalf.
  faqs: { question: string; answer: string }[];
  lastConfirmedAt?: string;
}

/** No seeded business profiles. */
const INITIAL_BUSINESS_PROFILES: BusinessProfile[] = [];

// Brief's full group table. Crucially this includes groups the current user
// must NEVER see -- they exist here precisely so the access filter is tested
// against real data rather than against an empty list.
/**
 * No seeded groups. Connected sources come from the server
 * (`GET /api/sources`): a group Brief is not actually connected to must never
 * appear in the list of groups Brief reads.
 *
 * The retired seed invented six groups with invented member counts. Access
 * state (member/authorised/pending/revoked) is still modelled and still
 * enforced in buildGroupIndex -- it is the data that was fake, not the rule.
 */
export const ALL_GROUPS: ConnectedSource[] = [];

// A week of ordinary group traffic: useful posts, questions, and noise.
/**
 * No seeded group traffic.
 *
 * This was 171 lines of invented WhatsApp/Telegram messages -- fake vacancies,
 * fake grants, fake plumber requests -- which the group index then classified
 * and presented as real extracted local knowledge. It is the most misleading
 * kind of seed: the output looks like genuine analysis of a real community.
 *
 * Real messages arrive through the connectors as raw items. Until a source is
 * connected there is nothing to classify, and the UI says so.
 */
export const GROUP_MESSAGES: GroupMessage[] = [];

// ============================================================================
// SOURCES
// ----------------------------------------------------------------------------
// A source is where information arrives from -- a Telegram group, a WhatsApp
// community, a site. It is deliberately NOT a BriefObject: the channel is the
// river, and Brief extracts the useful fish. Conflating the two would make
// "the group" a thing users discover, which it is not.
// ============================================================================

export type SourceType = 'telegram' | 'whatsapp' | 'web' | 'rss' | 'api' | 'manual';

export type SourceHealth = 'healthy' | 'quiet' | 'error' | 'inactive';

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  url?: string;
  description?: string;
  active: boolean;
  lastSeenAt?: string;
  lastSuccessfulIngestionAt?: string;
  ingestionCount: number;
  errorCount: number;
  // Operator-facing only. Never rendered to ordinary users.
  lastErrorDetail?: string;
}

const QUIET_AFTER_HOURS = 48;

// Health is derived, never stored, so it cannot drift out of date.
export const getSourceHealth = (source: Source, now: Date = new Date()): SourceHealth => {
  if (!source.active) return 'inactive';

  // A source that has errored more recently than it has succeeded is broken,
  // regardless of how healthy its history looks.
  if (source.errorCount > 0) {
    const lastOk = source.lastSuccessfulIngestionAt
      ? new Date(source.lastSuccessfulIngestionAt).getTime()
      : 0;
    const lastSeen = source.lastSeenAt ? new Date(source.lastSeenAt).getTime() : 0;
    if (lastSeen > lastOk) return 'error';
  }

  if (!source.lastSuccessfulIngestionAt) return 'quiet';

  const hours =
    (now.getTime() - new Date(source.lastSuccessfulIngestionAt).getTime()) / 3600000;

  return hours > QUIET_AFTER_HOURS ? 'quiet' : 'healthy';
};

// Plain-language health, safe to show anyone. Technical detail stays in
// lastErrorDetail and is only surfaced in the operator view.
export const getSourceHealthLabel = (health: SourceHealth): string => {
  switch (health) {
    case 'healthy':
      return 'Receiving information normally';
    case 'quiet':
      return 'No recent information';
    case 'error':
      return 'Not receiving information';
    case 'inactive':
      return 'Paused';
  }
};

/**
 * Sources come from the server (`GET /api/sources`), which reports real
 * per-source counts. The seeded list is gone: a source Brief is not actually
 * connected to must never appear in the list of sources Brief reads.
 */
export const INITIAL_SOURCES: Source[] = [];

// ============================================================================
// INGESTION BOUNDARY
// ----------------------------------------------------------------------------
// The rule this layer exists to enforce: a message does NOT become a post.
//
// A raw inbound message is parsed into a *candidate* object, stamped with where
// it came from and when, checked against what Brief already knows, and then
// held for review. Nothing enters the object graph automatically. Everything
// below is pure -- no network, no timers, no side effects -- so the parsing
// rules can be tested without a pipeline attached.
//
// The parser's job is to extract what is literally present in the text. When a
// field is not stated, it stays undefined. A low-confidence candidate is a
// correct outcome, not a failure to be papered over with guesses.
// ============================================================================

export interface InboundMessage {
  id: string;
  channel: SourceType;
  // Which feed/group/page it arrived from. Becomes sourceId on the object.
  sourceId: string;
  sourceLabel: string;
  text: string;
  receivedAt: string;
  sourceUrl?: string;
  media?: InboundMedia[];
}

// An image is retained as evidence, never as a source of claims. Brief does no
// image recognition, so nothing is ever read out of a flyer or price list --
// the reference is kept so a later processor can attach real extractions.
export interface InboundMedia {
  kind: 'image' | 'document' | 'audio' | 'video';
  reference: string;
  caption?: string;
}

export type ImageAnalysisStatus = 'pending' | 'processed' | 'unavailable';

export interface CandidateMedia extends InboundMedia {
  sourceId: string;
  sourceMessageId: string;
  receivedAt: string;
  imageAnalysisStatus: ImageAnalysisStatus;
}

// Review lifecycle for anything Brief did not author. 'candidate' is the only
// state ingestion may produce; a human moves it from there.
export type ReviewState = 'candidate' | 'confirmed' | 'rejected';

export type CandidateStatus = 'pending' | 'accepted' | 'rejected';

export interface ExtractedField {
  field: string;
  value: string;
  // The exact substring the value came from, so a reviewer can audit the
  // parser instead of trusting it.
  evidence: string;
}

export interface IngestionCandidate {
  id: string;
  message: InboundMessage;
  draft: BriefObject;
  extracted: ExtractedField[];
  // 0..1, derived only from how much was actually extracted.
  confidence: number;
  typeConfident: boolean;
  duplicates: DuplicateCandidate[];
  suggestedLinks: { objectId: string; relation: string; why: string }[];
  status: CandidateStatus;
  reviewState: ReviewState;
  media: CandidateMedia[];
  // Some messages are just conversation. When this is false there is nothing
  // to review and nothing to publish -- Brief must not manufacture a record.
  isObjectWorthy: boolean;
  rejectionReason?: string;
  warnings: string[];
}

// --- Field extractors --------------------------------------------------------
// Each returns null when the field is not clearly present. None of them fall
// back to a default; a missing field must stay missing.

const MONEY_RE = /(?:ksh|kes|sh)\s*\.?\s*([0-9][0-9,\.]*)\s*(?:\/=|\/-)?|([0-9][0-9,]{2,})\s*(?:\/=|\/-)/i;
const PHONE_RE = /(?:\+254|0)7[0-9]{8}\b|\+254\s?7[0-9]{2}\s?[0-9]{3}\s?[0-9]{3}/;
const HOURS_RE = /\b([01]?[0-9]|2[0-3]):([0-5][0-9])\s*(?:-|to|until|till)\s*([01]?[0-9]|2[0-3]):([0-5][0-9])\b/i;
const DEADLINE_RE = /\b(?:deadline|closes|closing|apply by|last day|ends)\b[:\s]*([A-Za-z0-9 ,]{3,24})/i;
const LOCATION_RE = /\b(?:at|located at|location|venue|along|opposite|near)\b[:\s]+([A-Z][A-Za-z0-9'\-]*(?:\s+[A-Z][A-Za-z0-9'\-]*){0,4})/;

// Chatter markers: questions, greetings, replies. Presence alone is not
// disqualifying -- a real advert can contain a question -- so this is only
// decisive when the message also carries no concrete detail at all.
const CONVERSATION_RE = /^(?:\s*(?:hi|hey|hello|habari|sasa|niaje|thanks|asante|ok|okay|yes|no|lol|haha)\b|.*\?\s*$)/i;

const cleanMoney = (raw: string): number | null => {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Type inference from explicit vocabulary only. Each rule needs a word that
// genuinely signals the category; ambiguity returns null rather than 'place'.
const TYPE_SIGNALS: { type: ObjectType; words: RegExp; label: string }[] = [
  { type: 'opportunity', words: /\b(grant|scholarship|apply|application|funding|vacancy|hiring|job|tender|bursary)\b/i, label: 'application language' },
  { type: 'experience', words: /\b(event|forum|summit|meetup|workshop|festival|market day|auction|training|webinar|tournament|match|gathering|party|concert|show)\b/i, label: 'event language' },
  { type: 'service', words: /\b(service|repair|installation|booking|book a|consultation|inspection|delivery|plumber|fundi)\b/i, label: 'service language' },
  { type: 'product', words: /\b(for sale|selling|stock|in stock|price|buy|brand new|second hand|pieces|units)\b/i, label: 'sale language' },
  { type: 'knowledge', words: /\b(guide|how to|steps|requirements|explainer|notice|announcement|news|update|alert|advisory|report|post|brief|bulletin|traffic|outage|power|water|road|weather|community|statement|release|info)\b/i, label: 'informational language' },
  { type: 'place', words: /\b(shop|stall|market|centre|center|hub|office|premises|located at|branch|station|venue|avenue|street)\b/i, label: 'premises language' }
];

const inferType = (text: string): { type: ObjectType; why: string } | null => {
  for (const signal of TYPE_SIGNALS) {
    const hit = text.match(signal.words);
    if (hit) return { type: signal.type, why: `${signal.label} ("${hit[0]}")` };
  }
  return null;
};

// A title is the first meaningful line, trimmed. We never synthesise one from
// keywords -- if there is no usable line the candidate is flagged instead.
export const extractTitle = (text: string): string | null => {
  const line = text
    .split(/\n|(?<=[.!])\s+/)
    .map((l) => l.trim())
    .find((l) => l.length >= 8 && l.length <= 90 && /[a-z]/i.test(l));
  if (line) return line.replace(/^[^A-Za-z0-9]+/, '').slice(0, 80);
  const fallback = text
    .split(/\n|(?<=[.!])\s+/)
    .map((l) => l.trim())
    .find((l) => l.length >= 4 && /[a-z0-9]/i.test(l));
  if (!fallback) return null;
  return fallback.replace(/^[^A-Za-z0-9]+/, '').slice(0, 80);
};

export const parseInboundMessage = (
  message: InboundMessage,
  existing: BriefObject[]
): IngestionCandidate => {
  const text = message.text;
  const extracted: ExtractedField[] = [];
  const warnings: string[] = [];
  const metadata: BriefObject['metadata'] = {};

  const title = extractTitle(text);
  if (title) {
    extracted.push({ field: 'title', value: title, evidence: title });
  } else {
    warnings.push('No usable title line found.');
  }

  const typed = inferType(text);
  if (!typed) {
    warnings.push('Object type could not be determined from the text.');
  }

  const money = text.match(MONEY_RE);
  if (money) {
    const value = cleanMoney(money[1] ?? money[2] ?? '');
    if (value !== null) {
      metadata.price = value;
      metadata.currency = 'KES';
      extracted.push({ field: 'price', value: String(value), evidence: money[0].trim() });
    }
  }

  const phone = text.match(PHONE_RE);
  if (phone) {
    metadata.contactPhone = phone[0].trim();
    extracted.push({ field: 'contactPhone', value: phone[0].trim(), evidence: phone[0].trim() });
  }

  const hours = text.match(HOURS_RE);
  if (hours) {
    const value = `${hours[1]}:${hours[2]}-${hours[3]}:${hours[4]}`;
    metadata.operatingHours = value;
    extracted.push({ field: 'operatingHours', value, evidence: hours[0].trim() });
  }

  const deadline = text.match(DEADLINE_RE);
  if (deadline) {
    const value = deadline[1].trim().replace(/[,.]$/, '');
    metadata.deadline = value;
    extracted.push({ field: 'deadline', value, evidence: deadline[0].trim() });
  }

  const location = text.match(LOCATION_RE);
  const locationName = location ? location[1].trim() : undefined;
  if (locationName) {
    extracted.push({ field: 'locationName', value: locationName, evidence: location![0].trim() });
  }

  // Confidence is a description of the evidence, not a marketing number.
  // Type and title are the load-bearing fields; details add smaller increments.
  let confidence = 0;
  if (title) confidence += 0.35;
  if (typed) confidence += 0.35;
  if (locationName) confidence += 0.1;
  if (metadata.contactPhone) confidence += 0.08;
  if (metadata.price !== undefined) confidence += 0.06;
  if (metadata.operatingHours || metadata.deadline) confidence += 0.06;
  confidence = Math.min(1, Number(confidence.toFixed(2)));

  const draft: BriefObject = {
    id: `ing_${message.id}`,
    type: typed?.type ?? 'knowledge',
    title: title ?? '(untitled inbound message)',
    category: 'Unreviewed',
    summary: text.replace(/\s+/g, ' ').trim().slice(0, 160),
    locationName,
    // No creatorName: the sender of a message is not automatically the
    // business it describes. A reviewer supplies that, or nobody does.
    // No trustScore and isVerified:false -- nothing here has been verified.
    isVerified: false,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    sourceType: message.channel,
    sourceId: message.sourceId,
    sourceMessageId: message.id,
    sourceUrl: message.sourceUrl,
    ingestedAt: message.receivedAt,
    // lastVerifiedAt is deliberately absent: ingestion is not verification.
    createdAt: message.receivedAt
  };

  // Connect to what Brief already knows -- by explicit evidence only.
  const suggestedLinks: IngestionCandidate['suggestedLinks'] = [];
  const haystack = text.toLowerCase();

  for (const item of existing) {
    if (item.title && haystack.includes(item.title.toLowerCase())) {
      suggestedLinks.push({
        objectId: item.id,
        relation: item.type === 'place' ? 'locationObjectId' : 'relatedObjectIds',
        why: `Message names "${item.title}"`
      });
      continue;
    }
    if (
      locationName &&
      item.type === 'place' &&
      item.title.toLowerCase().includes(locationName.toLowerCase())
    ) {
      suggestedLinks.push({
        objectId: item.id,
        relation: 'locationObjectId',
        why: `Stated location matches "${item.title}"`
      });
    }
  }

  const duplicates = findPotentialDuplicates(draft, existing, 0.7);
  if (duplicates.length > 0) {
    warnings.push(`Possible duplicate of ${duplicates.length} existing record(s).`);
  }

  // --- Is this even an object? ---------------------------------------------
  // The single most important rule in the pipeline: most messages in a group
  // are conversation, and conversation must not become database records.
  // A message earns an object only by carrying a title, a determinable type,
  // and at least one concrete detail.
  const concreteDetails = extracted.filter((f) => f.field !== 'title').length;
  const conversational = CONVERSATION_RE.test(text.trim());
  const tooShort = text.trim().length < 18;

  let rejectionReason: string | undefined;
  if (!title) {
    rejectionReason = 'No usable title line.';
  } else if (!typed) {
    rejectionReason = 'No recognisable object type in the text.';
  } else if (tooShort) {
    rejectionReason = 'Too short to describe anything.';
  } else if (conversational && concreteDetails === 0) {
    rejectionReason = 'Reads as conversation, not an announcement.';
  }

  const isObjectWorthy = rejectionReason === undefined;

  const media: CandidateMedia[] = (message.media ?? []).map((m) => ({
    ...m,
    sourceId: message.sourceId,
    sourceMessageId: message.id,
    receivedAt: message.receivedAt,
    // Brief does not read images. The reference is preserved so a future
    // processor can attach real extractions; until then nothing is claimed.
    imageAnalysisStatus: 'pending' as ImageAnalysisStatus
  }));

  return {
    id: `cand_${message.id}`,
    message,
    draft,
    extracted,
    confidence,
    typeConfident: Boolean(typed),
    duplicates,
    suggestedLinks,
    status: 'pending',
    reviewState: 'candidate',
    media,
    isObjectWorthy,
    rejectionReason,
    warnings
  };
};

// ============================================================================
// PARTICIPATION -- quests, points, rank, rewards.
// The rule that keeps this from becoming engagement bait: points settle only
// when a contribution is ACCEPTED. Nothing pays for clicking, opening the app,
// posting volume, or logging in on consecutive days.
// ============================================================================

export type QuestKind =
  | 'verify_event'
  | 'photograph_notice'
  | 'answer_question'
  | 'help_find_vendor'
  | 'attend_and_checkin'
  | 'create_challenge'
  | 'refer_participant';

// A submission is reviewed before it is worth anything. 'rejected' work pays
// zero -- that is what stops volume-farming.
export type QuestStatus = 'open' | 'submitted' | 'accepted' | 'rejected' | 'expired';

export interface Quest {
  id: string;
  kind: QuestKind;
  title: string;
  // What acceptance actually requires. Shown to the user BEFORE they start, so
  // reward criteria are never retroactive.
  acceptanceCriteria: string;
  points: number;
  status: QuestStatus;
  // Ties a quest to a real place, group or game where one applies.
  locationName?: string;
  distanceKm?: number;
  groupId?: string;
  expiresAt?: string;
  // Set when a submission has been reviewed. Rejections carry a reason.
  reviewNote?: string;
  submittedAt?: string;
  reviewedAt?: string;
}

// Contribution quality, not point volume. Someone who submits 200 items and
// has 8 accepted is not a top contributor.
export interface ContributionRecord {
  accepted: number;
  rejected: number;
  // Points that have actually settled. Pending work is deliberately excluded.
  settledPoints: number;
}

export const getAcceptanceRate = (c: ContributionRecord): number | undefined => {
  const total = c.accepted + c.rejected;
  if (total <= 0) return undefined;
  return Math.round((c.accepted / total) * 1000) / 10;
};

// Rank is earned through accepted contribution, with an accuracy floor. Raw
// points alone cannot buy a rank -- that is the whole point of the ladder.
export type BriefRank =
  | 'Newcomer'
  | 'Explorer'
  | 'Contributor'
  | 'Seasoned'
  | 'Expert'
  | 'Steward';

const RANK_LADDER: {
  rank: BriefRank;
  minAccepted: number;
  minAcceptanceRate: number;
}[] = [
  { rank: 'Steward', minAccepted: 500, minAcceptanceRate: 90 },
  { rank: 'Expert', minAccepted: 200, minAcceptanceRate: 85 },
  { rank: 'Seasoned', minAccepted: 75, minAcceptanceRate: 80 },
  { rank: 'Contributor', minAccepted: 20, minAcceptanceRate: 70 },
  { rank: 'Explorer', minAccepted: 5, minAcceptanceRate: 0 },
  { rank: 'Newcomer', minAccepted: 0, minAcceptanceRate: 0 }
];

export const getBriefRank = (c: ContributionRecord): BriefRank => {
  const rate = getAcceptanceRate(c) ?? 0;
  for (const tier of RANK_LADDER) {
    if (c.accepted >= tier.minAccepted && rate >= tier.minAcceptanceRate) {
      return tier.rank;
    }
  }
  return 'Newcomer';
};

// What the user must still do to reach the next tier. Only ever states real
// remaining requirements; returns null at the top.
export const getNextRankRequirement = (
  c: ContributionRecord
): { rank: BriefRank; needAccepted: number; needRate: number } | null => {
  const current = getBriefRank(c);
  const index = RANK_LADDER.findIndex((t) => t.rank === current);
  if (index <= 0) return null;
  const next = RANK_LADDER[index - 1];
  const rate = getAcceptanceRate(c) ?? 0;
  return {
    rank: next.rank,
    needAccepted: Math.max(0, next.minAccepted - c.accepted),
    needRate: Math.max(0, Math.round((next.minAcceptanceRate - rate) * 10) / 10)
  };
};

export interface Participant {
  id: string;
  displayName: string;
  locationName: string;
  contribution: ContributionRecord;
}

// Rewards are local by construction. A Nairobi user should not be offered a
// foreign gift card as the default prize.
export type RewardKind =
  | 'supermarket_voucher'
  | 'airtime'
  | 'data_bundle'
  | 'merchant_voucher'
  | 'event_ticket'
  | 'gaming_credit';

export type TransferPolicy = 'officially_transferable' | 'restricted' | 'not_supported' | 'unknown';

export interface Reward {
  id: string;
  kind: RewardKind;
  title: string;
  // The merchant actually honouring it. No reward without a named provider.
  providerName: string;
  valueKes: number;
  pointsCost: number;
  region: string;
  // Finite stock. Brief does not advertise a reward it cannot fulfil.
  remaining: number;
  // Whether the reward may be passed on, decided per provider rather than
  // assumed.
  transferPolicy: TransferPolicy;
}

// A reward can only be claimed with SETTLED points, and only while stock and
// region genuinely permit it.
export const canRedeem = (
  reward: Reward,
  wallet: { settledPoints: number; region: string }
): { allowed: boolean; reason: string } => {
  if (reward.remaining <= 0) {
    return { allowed: false, reason: 'Out of stock.' };
  }
  if (reward.region !== wallet.region) {
    return { allowed: false, reason: `Only available in ${reward.region}.` };
  }
  if (wallet.settledPoints < reward.pointsCost) {
    const short = reward.pointsCost - wallet.settledPoints;
    return { allowed: false, reason: `${short.toLocaleString()} more points needed.` };
  }
  return { allowed: true, reason: '' };
};

// A transparent pool, not a reference to anybody's salary. Brief states what
// is committed and what remains, and never implies a payout it cannot cover.
export interface RewardPool {
  periodLabel: string;
  totalKes: number;
  committedKes: number;
  // Points-to-shilling is fixed and published, not discovered at redemption.
  kesPerPoint: number;
}

export const getPoolRemaining = (pool: RewardPool): number =>
  Math.max(0, pool.totalKes - pool.committedKes);

// Points settle ONLY on acceptance. Any other status is worth zero, and this
// is the single place that decides it.
const settleQuest = (quest: Quest): number =>
  quest.status === 'accepted' ? quest.points : 0;

export const summariseContribution = (quests: Quest[]): ContributionRecord => {
  let accepted = 0;
  let rejected = 0;
  let settledPoints = 0;
  for (const q of quests) {
    if (q.status === 'accepted') {
      accepted += 1;
      settledPoints += settleQuest(q);
    } else if (q.status === 'rejected') {
      rejected += 1;
    }
  }
  return { accepted, rejected, settledPoints };
};

// Two boards, deliberately. Ranking on points alone teaches people to farm
// points; ranking on accepted contribution teaches them to be useful.
export const getTopEarners = (people: Participant[], limit = 5): Participant[] =>
  [...people]
    .sort((a, b) => b.contribution.settledPoints - a.contribution.settledPoints)
    .slice(0, limit);

export const getTopContributors = (people: Participant[], limit = 5): Participant[] =>
  [...people]
    .sort((a, b) => {
      if (b.contribution.accepted !== a.contribution.accepted) {
        return b.contribution.accepted - a.contribution.accepted;
      }
      return (getAcceptanceRate(b.contribution) ?? 0) - (getAcceptanceRate(a.contribution) ?? 0);
    })
    .slice(0, limit);

// Percentile is only meaningful with a real cohort behind it.
export const getPercentile = (
  person: Participant,
  people: Participant[]
): number | undefined => {
  if (people.length < 10) return undefined;
  const better = people.filter(
    (p) => p.contribution.accepted > person.contribution.accepted
  ).length;
  return Math.max(0.1, Math.round((better / people.length) * 1000) / 10);
};

// --- Participation fixtures -------------------------------------------------

/**
 * No seeded quests. Participation is real activity or it is nothing.
 */
export const INITIAL_QUESTS: Quest[] = [];

// No fictional merchant inventory in production.
export const REWARD_CATALOGUE: Reward[] = [];

/**
 * No fabricated reward pool.
 *
 * This declared a KES 1,000,000 pool with KES 412,500 already committed --
 * money that does not exist, presented as a real community fund. Brief has no
 * payment provider and cannot disburse anything, so advertising a pot is the
 * most damaging kind of invented economics.
 *
 * Zeroed rather than deleted: the Quests board reads the shape, and a pool of
 * zero is the truthful figure. The UI reports it as unfunded.
 */
export const COMMUNITY_POOL: RewardPool = {
  periodLabel: 'Not funded',
  totalKes: 0,
  committedKes: 0,
  kesPerPoint: 0
};

// A cohort large enough for a percentile to mean something.
/**
 * No fabricated cohort.
 *
 * This was eleven invented people -- Nyabs, Achieng, Mwangi and others -- with
 * invented accepted/rejected counts and invented settled point totals, ranked
 * into a leaderboard and rendered as real community standing. Percentiles
 * computed against an invented cohort are meaningless.
 *
 * The ranking helpers (getTopContributors, getTopEarners, getPercentile) are
 * real and keep their logic; they now operate on an empty cohort until real
 * participants exist.
 */
export const PARTICIPANTS: Participant[] = [];

// ============================================================================
// 2. SEED DATA
// ============================================================================

/**
 * Brief starts empty.
 *
 * This was 338 lines of invented places, events and opportunities -- Maji
 * Mazuri Market, fabricated permits, fabricated vendors -- rendered as though
 * they were real local records. They are gone. Objects now come from the
 * server, which only holds what a connector actually ingested.
 *
 * An empty Brief is the correct state for a deployment that has ingested
 * nothing. The UI already handles it: every surface below has an empty state.
 */
export const INITIAL_OBJECTS: BriefObject[] = [];

/**
 * Maps a server object row onto the client's BriefObject.
 *
 * Written as an explicit field-by-field adapter rather than a cast because
 * the two shapes genuinely differ: the server carries `verificationStatus`
 * and a nullable `category`, the client carries `isVerified` and a required
 * one. A cast would paper over that and produce `undefined` in the UI.
 *
 * Nothing is invented here. A field the server did not send is left absent,
 * not defaulted to something plausible.
 */
/**
 * A real sparkline from object recency: how many visible things were created
 * per day over the last 8 days, normalised to the sparkline's 0–40 y-range.
 * Derived from `createdAt`, never a stored counter or a hardcoded curve — so a
 * flat or sparse shape is the truth, not a decoration.
 */
function sparkFromObjects(objects: BriefObject[]): string {
  const now = Date.now();
  const days = 8;
  const bins = new Array<number>(days).fill(0);
  for (const o of objects) {
    const t = Date.parse(o.createdAt);
    if (!Number.isFinite(t)) continue;
    const ageDays = (now - t) / 86400000;
    if (ageDays < 0 || ageDays >= days) continue;
    bins[days - 1 - Math.floor(ageDays)] += 1;
  }
  const max = Math.max(1, ...bins);
  return bins
    .map((n, i) => {
      const x = (i / (days - 1)) * 64;
      const y = 40 - (n / max) * 36;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export const objectFromServer = (row: any): BriefObject => {
  // Preserve the server's metadata (which now carries coarse lat/lng), and fold
  // in the geo-scoped distance the server computed when a location was given.
  // Without this, the ranked feed drops `distanceKm` on arrival and the map /
  // proximity rail can never populate from real data.
  const meta = row?.metadata && typeof row.metadata === 'object' ? { ...row.metadata } : {};
  if (typeof row?.distanceKm === 'number' && Number.isFinite(row.distanceKm)) {
    meta.distanceKm = row.distanceKm;
  }
  return {
  id: String(row?.id ?? ''),
  type: (row?.type ?? 'knowledge') as ObjectType,
  title: String(row?.title ?? 'Untitled'),
  // The server may hold no category. "Uncategorised" is a statement of
  // absence, not a guessed classification.
  category: row?.category ? String(row.category) : 'Uncategorised',
  summary: String(row?.summary ?? ''),
  locationName: row?.locationName ?? undefined,
  // The server's levels are unverified | source_confirmed |
  // cross_source_confirmed | community_confirmed. A "verified" claim in the
  // UI is only made at the corroborated/community tiers — a single source is
  // reported as such, never dressed up as verified.
  verificationStatus: typeof row?.verificationStatus === 'string' ? row.verificationStatus : undefined,
  isVerified: ['verified', 'cross_source_confirmed', 'community_confirmed'].includes(row?.verificationStatus),
  confirmationCount: Number.isInteger(row?.confirmationCount) ? row.confirmationCount : undefined,
  lastVerifiedAt: row?.lastVerifiedAt ?? undefined,
  validityWindowDays: row?.validityWindowDays ?? undefined,
  sourceType: row?.provenance?.[0]?.platform ?? undefined,
  sourceUrl: row?.sourceUrl ?? row?.provenance?.[0]?.sourceUrl ?? undefined,
  sourceId: row?.provenance?.[0]?.sourceId ?? undefined,
  sourcePlatforms: Array.isArray(row?.sourcePlatforms)
    ? row.sourcePlatforms.filter((s: unknown) => typeof s === 'string')
    : undefined,
  corrections: Array.isArray(row?.corrections) && row.corrections.length > 0
    ? row.corrections
        .map((c: any) => ({
          id: String(c?.id ?? ''),
          field: String(c?.field ?? ''),
          isMeta: c?.isMeta === true,
          originalValue: c?.originalValue === null || c?.originalValue === undefined ? null : String(c.originalValue),
          correctedValue: String(c?.correctedValue ?? ''),
          reason: String(c?.reason ?? ''),
          createdAt: String(c?.createdAt ?? '')
        }))
        .filter((c: any) => c.field)
    : undefined,
  openReportCount: Number.isInteger(row?.openReportCount) ? row.openReportCount : undefined,
  metadata: Object.keys(meta).length > 0 ? meta : undefined,
  createdAt: String(row?.createdAt ?? new Date().toISOString()),
  // Feed projections expose media/action as nested public fields; keep the
  // first-party detail view compatible without reintroducing private fields.
  imageUrl:
    row?.imageUrl ??
    row?.media?.url ??
    ((row?.imageReference || row?.media?.reference) && row?.id
      ? briefApi.mediaFileUrl(`/api/media/telegram/${String(row?.id)}`)
      : undefined),
  // Indexed gallery images resolve like the cover (server-side Telegram
  // resolution at /api/media/telegram/:id/:index, or direct web URLs).
  gallery: Array.isArray(row?.gallery) && row.gallery.length > 0
    ? row.gallery
        .map((g: any) => {
          const url = typeof g?.url === 'string' ? g.url : null;
          if (!url) return null;
          return {
            url,
            alt: typeof g?.alt === 'string' ? g.alt : undefined,
            attribution: g?.attribution ?? null
          };
        })
        .filter(Boolean)
    : undefined,
  publishedAt: typeof row?.publishedAt === 'string' ? row.publishedAt : undefined,
  temporal: row?.temporal && typeof row.temporal === 'object' ? row.temporal : undefined,
  sourceNames: Array.isArray(row?.sourceNames) ? row.sourceNames.filter((s: unknown) => typeof s === 'string') : undefined,
  sourceCount: Number.isInteger(row?.sourceCount) ? row.sourceCount : undefined,
  actionUrl: row?.actionUrl ?? row?.action?.url ?? undefined,
  actionType: row?.actionType ?? row?.action?.type ?? undefined,
  actionLabel: row?.actionLabel ?? row?.action?.label ?? undefined,
  testContent: row?.testContent && typeof row.testContent === 'object'
    ? {
        label: String(row.testContent.label ?? 'Test preview'),
        expiresAt: typeof row.testContent.expiresAt === 'string' ? row.testContent.expiresAt : null
      }
    : undefined,

  // Relationships the server actually recorded. `/api/objects` returns these
  // as {verb, targetId, target}; the client models the same edges as typed
  // id fields, so the known verbs are mapped across and anything else falls
  // into relatedObjectIds rather than being dropped.
  //
  // Without this the relationship rails could never populate from real data:
  // the edges existed server-side and were being discarded on arrival.
  ...relationshipsFromServer(row?.relationships)
  };
};

/** Server relationship verbs -> the client's typed relationship fields. */
const RELATIONSHIP_VERBS: Record<string, 'locationObjectId' | 'parentObjectId' | 'providerObjectId'> = {
  located_at: 'locationObjectId',
  appears_at: 'locationObjectId',
  part_of: 'parentObjectId',
  offered_by: 'providerObjectId',
  provided_by: 'providerObjectId'
};

const relationshipsFromServer = (
  rels: any
): Pick<BriefObject, 'locationObjectId' | 'parentObjectId' | 'providerObjectId' | 'relatedObjectIds'> => {
  if (!Array.isArray(rels) || rels.length === 0) return {};

  const out: ReturnType<typeof relationshipsFromServer> = {};
  const related: string[] = [];

  for (const rel of rels) {
    const targetId = typeof rel?.targetId === 'string' ? rel.targetId : null;
    if (!targetId) continue;

    const field = RELATIONSHIP_VERBS[String(rel?.verb ?? '')];
    if (field) {
      // First one wins: an object has one location, one parent, one provider.
      if (!out[field]) out[field] = targetId;
    } else if (!related.includes(targetId)) {
      related.push(targetId);
    }
  }

  if (related.length > 0) out.relatedObjectIds = related;
  return out;
};

/**
 * Pulse carries no seeded posts.
 *
 * This was 147 lines of invented neighbourhood chatter presented as real
 * local reporting. Brief has no post ingestion pipeline, so the honest state
 * is empty and the Pulse surfaces say so.
 */
export const INITIAL_POSTS: BriefPost[] = [];

/**
 * No seeded journeys. Workflows are user-created; there is no server journey
 * model yet, so Brief starts with none rather than pretending the user is
 * midway through a licence application they never began.
 */
export const INITIAL_JOURNEYS: Journey[] = [];


export const getObjectTypeMeta = (type: ObjectType) => {
  switch (type) {
    case 'place': return { label: 'Place', icon: <MapPin className="w-3.5 h-3.5" /> };
    case 'identity': return { label: 'Identity', icon: <Building2 className="w-3.5 h-3.5" /> };
    case 'experience': return { label: 'Experience', icon: <Users className="w-3.5 h-3.5" /> };
    case 'opportunity': return { label: 'Opportunity', icon: <Briefcase className="w-3.5 h-3.5" /> };
    case 'product': return { label: 'Product', icon: <Store className="w-3.5 h-3.5" /> };
    case 'service': return { label: 'Service', icon: <ShieldCheck className="w-3.5 h-3.5" /> };
    case 'knowledge': return { label: 'Knowledge', icon: <Newspaper className="w-3.5 h-3.5" /> };
    case 'community': return { label: 'Community', icon: <Users className="w-3.5 h-3.5" /> };
    case 'document': return { label: 'Document', icon: <Tag className="w-3.5 h-3.5" /> };
    case 'conversation': return { label: 'Conversation', icon: <MessageCircle className="w-3.5 h-3.5" /> };
    case 'business': return { label: 'Business', icon: <Building2 className="w-3.5 h-3.5" /> };
    case 'offer': return { label: 'Offer', icon: <BadgePercent className="w-3.5 h-3.5" /> };
    case 'alert': return { label: 'Alert', icon: <AlertTriangle className="w-3.5 h-3.5" /> };
    case 'announcement': return { label: 'Announcement', icon: <Megaphone className="w-3.5 h-3.5" /> };
    case 'news': return { label: 'News', icon: <Globe className="w-3.5 h-3.5" /> };
    default: return { label: 'Object', icon: <Sparkles className="w-3.5 h-3.5" /> };
  }
};

// ============================================================================
// 3. MAIN COMPONENT
// ============================================================================
/**
 * Reads the campaign slug out of the URL. Brief has no router, and adding one
 * for a single public route would be a larger change than the feature. A
 * pathname check is the smallest thing that works.
 */
export function campaignSlugFromPath(pathname: string): string | null {
  const m = /^\/c\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  return m ? m[1] : null;
}

/**
 * Renders a ticket code as a QR for display at the gate. The code IS the
 * scannable value; any QR reader recovers the same string.
 */
function PublicTicketQr({ code, size = 128 }: { code: string; size?: number }) {
  const [dataUrl, setDataUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    QRCode.toDataURL(code, { width: size, margin: 1, color: QR_COLORS })
      .then((u) => { if (live) setDataUrl(u); })
      .catch(() => { if (live) setDataUrl(null); });
    return () => { live = false; };
  }, [code, size]);
  if (!dataUrl) return <div className="w-28 h-28 bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg" />;
  return <img src={dataUrl} alt={`Ticket ${code}`} className="w-28 h-28 rounded-lg" />;
}

/** The public page's own share actions, built from the URL the viewer is on. */
function PublicShareRow({ title, description }: { title: string; description: string }) {
  const [copied, setCopied] = useState(false);
  // The viewer is ON the public page, so window.location.href is the canonical
  // link to share (no fabricated origin).
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const text = `${title} — ${description}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
  const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable: no-op */ }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      <a href={wa} target="_blank" rel="noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-[11px] font-extrabold border border-[var(--brief-line)]">
        <MessageCircle className="w-3 h-3" /> WhatsApp
      </a>
      <a href={tg} target="_blank" rel="noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-[11px] font-extrabold border border-[var(--brief-line)]">
        <ExternalLink className="w-3 h-3" /> Telegram
      </a>
      <button onClick={copy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-[11px] font-extrabold border border-[var(--brief-line)] cursor-pointer">
        <Share2 className="w-3 h-3" /> {copied ? 'Copied' : 'Copy link'}
      </button>
      <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[color:var(--color-paper)] text-[var(--ink-60)] text-[11px] border border-[var(--brief-line)]" title="Scan to open">
        <ExternalLink className="w-3 h-3" /> QR
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// T4 RICH DETAIL — helpers for the detail screen's DERIVED rails.
//
// Every rail below is fed by the /context endpoint, which derives related
// events, the host's other events, and series occurrences from real campaign
// rows on every read. Nothing is seeded; an empty rail simply does not render.
// ---------------------------------------------------------------------------

// A cover-less event is not a colour swatch keyed off its own title: a hue that
// comes from a hash of words is a fake fact, exactly like the number nobody
// counted. The plate is the room's plaster carrying the CATEGORY's light, the
// same wing colour the case uses everywhere else.

const railMoney = (n: number, c: string) => (n === 0 ? "Free" : `${c} ${n.toLocaleString()}`);

/** A maps link for a structured venue: coordinates when present, otherwise the
 *  venue address/name or the campaign's flat location string. */
export function venueMapsHref(
  venue: { name?: string | null; address?: string | null; lat?: number | null; lng?: number | null } | null | undefined,
  location: string | null
): string | null {
  if (venue?.lat != null && venue?.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.lat},${venue.lng}`)}`;
  }
  const q = venue?.address || venue?.name || location;
  return q ? buildMapsHref(q) : null;
}

/** Friendly "day, date · time" from an ISO string; honest when absent. */
export function formatStartsAt(startsAt: string | null): string | null {
  if (!startsAt) return null;
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return startsAt;
  const date = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** A compact card in a rail; links to the other event's own public page. */
function CompactEventCard({ listing }: { listing: EventListing }) {
  const wash = categoryWash(listing.category);
  return (
    <a
      href={`/c/${encodeURIComponent(listing.slug)}`}
      className="shrink-0 w-40 rounded-xl overflow-hidden border border-[var(--brief-line)] bg-[color:var(--color-paper)] no-underline"
    >
      <div className="relative h-20 w-full">
        {listing.coverImageUrl ? (
          <img src={listing.coverImageUrl} alt={listing.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover" style={{ background: PLASTER, filter: PHOTO_FILTER }} />
        ) : (
          // No cover, no giant letter: a plaster plate carrying the wing's light.
          <div className="absolute inset-0" style={{ background: PLASTER }}>
            <span className="absolute inset-0" style={{ background: wash }} />
          </div>
        )}
      </div>
      <div className="p-2 space-y-0.5">
        <p className="text-[11px] font-extrabold text-[var(--brief-ink)] leading-snug">{listing.title}</p>
        <p className="text-[11px] text-[var(--ink-60)]">{formatStartsAt(listing.startsAt) ?? listing.categoryLabel}</p>
        <p className="text-[11px] font-extrabold text-[var(--brief-ink)]">{railMoney(listing.price, listing.currency)}</p>
      </div>
    </a>
  );
}

/** A horizontal rail of derived events; renders nothing when there are none. */
function EventRail({ title, listings }: { title: string; listings: EventListing[] }) {
  if (!listings.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--ink-70)]">{title}</p>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        {listings.map((l) => <CompactEventCard key={l.slug} listing={l} />)}
      </div>
    </div>
  );
}

/**
 * PUBLIC CAMPAIGN PAGE
 *
 * The page a stranger lands on from a shared link. It talks ONLY to the
 * public endpoints, which return an allow-listed projection: no owner, no
 * internal ids, no roster, no analytics. Nothing is hidden client-side,
 * because nothing private is ever fetched.
 */
export function PublicCampaignPage({ slug }: { slug: string }) {
  const [load, setLoad] = useState<{
    status: 'loading' | 'ready' | 'error';
    data: ApiPublicCampaign | null;
    error: string | null;
  }>({ status: 'loading', data: null, error: null });

  const [name, setName] = useState<string>('');
  const [contact, setContact] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { status: string; ticketCode?: string | null }>(null);
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [waitlistMessage, setWaitlistMessage] = useState<string | null>(null);
  // Contribution pots (T3): the supporter states what they are putting in.
  const [amount, setAmount] = useState('');
  // Updates feed: the organiser's own words, read from the public route.
  const [updates, setUpdates] = useState<briefApi.CampaignUpdatePost[] | null>(null);
  // T4 context rails: related + more-from-this-host + series, all derived.
  const [ctx, setCtx] = useState<PublicCampaignContext | null>(null);

  React.useEffect(() => {
    let live = true;
    setUpdates(null);
    void briefApi.getCampaignUpdatesBySlug(slug).then((res) => {
      if (live) setUpdates(res.ok ? res.data : []);
    });
    return () => { live = false; };
    // The dependency used to be `load.data?.registered` — a social-proof count
    // Decision 6 removed. `slug` is the stable identity that actually means
    // "the campaign resolved", so the effect still re-runs exactly when it should.
  }, [slug, load.data?.slug]);

  React.useEffect(() => {
    let live = true;
    setCtx(null);
    void briefApi.getPublicCampaignContext(slug).then((res) => {
      if (live) setCtx(res.ok ? res.data : null);
    });
    return () => { live = false; };
  }, [slug]);

  const fetchCampaign = React.useCallback(async () => {
    setLoad({ status: 'loading', data: null, error: null });
    const res = await briefApi.getPublicCampaign(slug);
    if (res.ok) setLoad({ status: 'ready', data: res.data, error: null });
    else
      setLoad({
        status: 'error',
        data: null,
        error: res.status === 404 ? 'This campaign is not available.' : res.error
      });
  }, [slug]);

  React.useEffect(() => {
    fetchCampaign();
  }, [fetchCampaign]);

  const submit = async () => {
    setBusy(true);
    setRegError(null);
    const attendeeRef =
      contact.trim() !== '' ? contact.trim() : `guest-${Math.random().toString(36).slice(2, 10)}`;
    const trackingHash = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('trackingHash') ?? undefined
      : undefined;
    const res = await briefApi.registerForCampaign(slug, {
      attendeeRef,
      name: name.trim() === '' ? undefined : name.trim(),
      contact: contact.trim() === '' ? undefined : contact.trim(),
      trackingHash,
      // Pots only: a whole-shillings amount the supporter states themselves.
      // The server refuses it on fixed-price events.
      amount: amount.trim() ? Number(amount) : undefined
    });
    setBusy(false);
    if (!res.ok) {
      // The backend owns these outcomes: full, closed, already registered.
      // The page relays the reason rather than guessing at one.
      setRegError(res.error);
      // Capacity may have moved underneath us, so re-read the truth.
      fetchCampaign();
      return;
    }
    setDone({ status: res.data.registration.status, ticketCode: res.data.registration.ticketCode ?? null });
    setLoad({ status: 'ready', data: res.data.campaign, error: null });
  };

  const joinWaitlist = async () => {
    setWaitlistBusy(true);
    setWaitlistMessage(null);
    const attendeeRef = contact.trim() !== '' ? contact.trim() : `guest-${Math.random().toString(36).slice(2, 10)}`;
    const res = await briefApi.joinCampaignWaitlist(slug, {
      attendeeRef,
      name: name.trim() === '' ? undefined : name.trim(),
      contact: contact.trim() === '' ? undefined : contact.trim()
    });
    setWaitlistBusy(false);
    if (!res.ok) {
      setWaitlistMessage(res.error);
      return;
    }
    setWaitlistMessage(`Wait list position ${res.data.position ?? res.data.entry?.position ?? 'saved'}.`);
  };

  const c = load.data;

  return (
    <div className="min-h-screen bg-[color:var(--brief-bg)] text-[var(--accent-ink)] font-sans selection:bg-[#40916C] selection:text-[var(--brief-ink)] flex flex-col">
      {/* ── FULL-BLEED HERO — the Instagram event splash, edge to edge. ── */}
      {load.status === 'ready' && c && (
        <div className="relative">
          {c.image ? (
            <img
              src={c.image}
              alt={c.title}
              className="w-full h-72 sm:h-96 object-cover"
              style={{ background: PLASTER, filter: PHOTO_FILTER }}
            />
          ) : (
            // The cover-less hero used to be a blue-violet square with a giant
            // first letter of the title: a colour and a character that mapped to
            // nothing. It is the room's plaster, lit by the campaign's own type.
            <div className="w-full h-64 sm:h-80 relative" style={{ background: PLASTER }}>
              <span className="absolute inset-0" style={{ background: categoryWash(c.type) }} />
              <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--brief-muted)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: categoryAccent(c.type) }} />
                waiting on a cover
              </span>
            </div>
          )}
          <div className="absolute inset-0" style={{ background: PHOTO_SCRIM }} />

          {/* Floating back + share, over the image — the splash affordances. */}
          <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  if (window.history.length > 1) window.history.back();
                  else window.location.href = '/';
                }
              }}
              aria-label="Back"
              className="w-9 h-9 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/55 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined' && navigator.clipboard) {
                  navigator.clipboard.writeText(window.location.href).catch(() => {});
                }
              }}
              aria-label="Copy link"
              className="w-9 h-9 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/55 transition-colors cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>

          {/* Overlaid identity: chips + title + meta, like an IG post caption. */}
          <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 text-white space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-[11px] font-bold uppercase tracking-wider">
                {c.type}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-[11px] font-bold">
                {c.price === 0 ? 'Free' : `${c.currency} ${c.price.toLocaleString()}`}
              </span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black leading-tight drop-shadow-md">{c.title}</h1>
            <p className="text-[12px] sm:text-xs text-white/85">
              {[formatStartsAt(c.startsAt), c.location].filter(Boolean).join('  ·  ')}
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 w-full max-w-lg mx-auto px-4 py-6 space-y-5">
        {load.status === 'loading' && (
          <p className="text-xs text-[var(--ink-60)] py-12 text-center">Loading...</p>
        )}

        {load.status === 'error' && (
          <div className="border border-[var(--brief-line)] bg-[color:var(--color-paper)] rounded-2xl p-5 space-y-2">
            <p className="text-sm font-extrabold text-[var(--brief-ink)]">{load.error}</p>
            <button
              onClick={fetchCampaign}
              className="px-3 py-1.5 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer"
            >
              Try again
            </button>
          </div>
        )}

        {load.status === 'ready' && c && (
          <>
            <div className="space-y-2">
              {/* Host row (T4): a derived profile — the organiser's chosen name
                  plus a counted number of their public events. No internal id. */}
              {c.host && (c.host.name || c.host.eventsHosted > 0) && (
                <div className="flex items-center gap-2.5 pt-1">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "var(--color-primary-subtle)", color: "var(--color-primary)" }}
                  >
                    <User className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 leading-tight">
                    <p className="text-[12px] font-extrabold text-[var(--brief-ink)]">
                      {c.host.name ?? 'Organiser'}
                    </p>
                    <p className="text-[11px] text-[var(--ink-60)]">
                      {c.host.eventsHosted === 0
                        ? 'First event'
                        : `${c.host.eventsHosted} event${c.host.eventsHosted === 1 ? '' : 's'} hosted`}
                    </p>
                  </div>
                </div>
              )}
              {c.creator && (
                <p className="text-[12px] text-[var(--brief-ink)] font-extrabold">by {c.creator}</p>
              )}
              {c.description && (
                <p className="text-xs text-[var(--ink-60)] leading-relaxed">{c.description}</p>
              )}
            </div>

            {/* Contribution pot (T3): a goal, stated amounts, settled-only
                progress, and contributors as a COUNT. Nobody is listed. */}
            {c.goalAmount != null && (
              <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--ink-70)]">
                    Contribution pot
                  </p>
                  {c.endsAt && (
                    <p className="text-[11px] text-[var(--ink-60)]">
                      {Date.parse(c.endsAt) <= Date.now()
                        ? 'Deadline passed'
                        : `Open until ${c.endsAt.slice(0, 10)}`}
                    </p>
                  )}
                </div>
                <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--ground)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.round(((c.raised ?? 0) / c.goalAmount) * 100))}%`,
                      background: 'var(--signal-live)'
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-extrabold text-[var(--brief-ink)]">
                    {c.currency} {(c.raised ?? 0).toLocaleString()} of {c.goalAmount.toLocaleString()}
                  </span>
                  <span className="text-[var(--ink-60)]">
                    {(c.contributors ?? 0)} contribution{(c.contributors ?? 0) === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-[11px] leading-snug text-[var(--ink-70)]">
                  Progress counts SETTLED money only — a pledge that has not settled is not raised.
                  Contributors are counted, never listed.
                </p>
              </div>
            )}

            {/* Venue (T4): the structured venue — name, address, coordinates —
                rendered only when the organiser actually set one. */}
            {c.venue && (c.venue.name || c.venue.address) && (
              <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--ink-70)]">
                  Venue
                </p>
                {c.venue.name && (
                  <p className="text-xs font-extrabold text-[var(--brief-ink)]">{c.venue.name}</p>
                )}
                {c.venue.address && (
                  <p className="text-[12px] text-[var(--ink-60)] leading-snug">{c.venue.address}</p>
                )}
                <a
                  href={venueMapsHref(c.venue, c.location) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold"
                  style={{ background: "var(--color-primary-subtle)", color: "var(--color-primary)" }}
                >
                  <Navigation className="w-3 h-3" /> Open in maps
                </a>
              </div>
            )}

            {/* Agenda (T4): the organiser's ordered run of show, when set. */}
            {c.agenda && c.agenda.length > 0 && (
              <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-3">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--ink-70)]">
                  Agenda
                </p>
                {c.agenda.map((item, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className="w-2 h-2 rounded-full shrink-0 mt-1"
                        style={{ background: "var(--color-primary)" }}
                      />
                      {i < c.agenda!.length - 1 && (
                        <div className="w-px flex-1" style={{ background: "var(--ground)" }} />
                      )}
                    </div>
                    <div className="min-w-0 pb-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-xs font-extrabold text-[var(--brief-ink)]">{item.title}</p>
                        {item.at && <p className="shrink-0 text-[11px] text-[var(--ink-60)]">{item.at}</p>}
                      </div>
                      {item.description && (
                        <p className="text-[12px] leading-snug text-[var(--ink-60)]">{item.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Updates (T3): the organiser's posts, newest first. */}
            {updates !== null && updates.length > 0 && (
              <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-3">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--ink-70)]">
                  Updates
                </p>
                {updates.map((u) => (
                  <div key={u.id} className="space-y-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-extrabold text-[var(--brief-ink)]">{u.title}</p>
                      <p className="shrink-0 text-[11px] text-[var(--ink-60)]">{u.createdAt.slice(0, 10)}</p>
                    </div>
                    <p className="text-[12px] leading-snug text-[var(--ink-60)]">{u.body}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
              {c.startsAt && (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-[var(--brief-ink)] shrink-0" />
                    <span className="text-xs text-[var(--brief-ink)]">
                      {c.startsAt.slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>
                  <a
                    href={eventIcsUrl({ title: c.title, description: c.description, location: c.location, startsAt: c.startsAt, endsAt: c.endsAt }) ?? undefined}
                    download="event.ics"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold cursor-pointer"
                    style={{ background: "var(--color-primary-subtle)", color: "var(--color-primary)" }}
                  >
                    <CalendarPlus className="w-3 h-3" /> Add to calendar
                  </a>
                </div>
              )}
              {c.location && (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-[var(--brief-ink)] shrink-0" />
                    <span className="text-xs text-[var(--brief-ink)]">{c.location}</span>
                  </div>
                  <a
                    href={venueMapsHref(c.venue, c.location) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold cursor-pointer"
                    style={{ background: "var(--color-primary-subtle)", color: "var(--color-primary)" }}
                  >
                    <Navigation className="w-3 h-3" /> Get directions
                  </a>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-[var(--brief-ink)] shrink-0" />
                <span className="text-xs text-[var(--brief-ink)]">
                  {c.price === 0 ? 'Free' : `${c.currency} ${c.price.toLocaleString()}`}
                </span>
              </div>
              {c.remaining !== null && (
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-[var(--brief-ink)] shrink-0" />
                  <span className="text-xs text-[var(--brief-ink)]">
                    {c.soldOut ? 'Full' : `${c.remaining} spots left`}
                  </span>
                </div>
              )}
              {/* No "N people registered" — Decision 6: no social proof, no
                  "X going", no attendee names. The seats line below is the one
                  number this page is allowed to print. */}
              {/* No "N from your Circle going" — Decision 6's supersession note
                  ends the per-viewer overlap explicitly. */}
              {c.capacity !== null && c.remaining !== null && c.capacity > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--ink-60)]">Spots filled</span>
                    <span className="font-mono-live text-[var(--brief-ink)]">
                      {c.capacity - c.remaining} / {c.capacity}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--ground)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.round(((c.capacity - c.remaining) / c.capacity) * 100))}%`,
                        background: 'var(--signal-live)'
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* T4 derived rails — each renders nothing when there are genuinely
                no other events; none of this is seeded. */}
            {ctx && ctx.seriesOccurrences.length > 0 && (
              <EventRail title="More in this series" listings={ctx.seriesOccurrences} />
            )}
            {ctx && ctx.fromHost.length > 0 && (
              <EventRail
                title={`More from ${c.host?.name ?? 'this organiser'}`}
                listings={ctx.fromHost}
              />
            )}
            {ctx && ctx.related.length > 0 && (
              <EventRail title="You may also like" listings={ctx.related} />
            )}

            <PublicShareRow title={c.title} description={c.description} />

            {done && (
              <div className="border border-[var(--brief-line)] bg-[color:var(--color-paper)] rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[var(--brief-ink)] shrink-0" />
                  <p className="text-sm font-extrabold text-[var(--brief-ink)]">
                    {done.status === 'started' ? "You have a spot held" : "You're registered"}
                  </p>
                </div>
                <p className="text-[12px] text-[var(--ink-60)] leading-snug">
                  {done.status === 'started'
                    ? 'Your spot is held. It is confirmed once payment is arranged with the organiser.'
                    : 'The organiser can see you on their list.'}
                </p>
                {done.ticketCode && (
                  <div className="flex items-center gap-3 pt-1">
                    <PublicTicketQr code={done.ticketCode} />
                    <div className="min-w-0 space-y-1">
                      <p className="text-[11px] text-[var(--ink-60)]">Your ticket</p>
                      <p className="text-[12px] text-[var(--brief-ink)] break-all select-all">{done.ticketCode}</p>
                      <p className="text-[11px] text-[var(--ink-60)] leading-snug">Show this code at the gate.</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!done && c.hasEnded && (
              <div className="border border-[var(--brief-line)] rounded-2xl p-5">
                <p className="text-sm font-extrabold text-[var(--ink-60)]">
                  This event has ended.
                </p>
              </div>
            )}

            {!done && !c.hasEnded && (c.status === 'closed' || c.status === 'completed' || c.status === 'cancelled') && (
              <div className="border border-[var(--brief-line)] rounded-2xl p-5">
                <p className="text-sm font-extrabold text-[var(--ink-60)]">
                  Registration is closed.
                </p>
              </div>
            )}

            {!done && c.soldOut && !c.hasEnded && c.status !== 'closed' && c.status !== 'cancelled' && (
              <div id="waitlist-form" className="border border-[var(--brief-line)] rounded-2xl p-5 space-y-3">
                <p className="text-sm font-extrabold text-[var(--brief-ink)]">This one is full.</p>
                <div className="space-y-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name"
                    className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-sm rounded-xl px-3 py-3 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                  />
                  <input
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="Phone or email"
                    className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-sm rounded-xl px-3 py-3 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                  />
                  <button
                    disabled={waitlistBusy}
                    onClick={joinWaitlist}
                    className="w-full py-3 rounded-xl border border-[#0891B2] text-[var(--brief-ink)] font-extrabold text-xs cursor-pointer disabled:opacity-40"
                  >
                    {waitlistBusy ? 'Saving...' : 'Join wait list'}
                  </button>
                  {waitlistMessage && <p className="text-[11px] text-[var(--ink-60)]">{waitlistMessage}</p>}
                </div>
              </div>
            )}

            {!done &&
              !c.soldOut &&
              !c.hasEnded &&
              (c.status === 'published' || c.status === 'live') && (
                <div id="register-form" className="space-y-3">
                  {regError && (
                    <div className="border border-[var(--brief-line)] bg-[color:var(--color-paper)] rounded-xl p-3">
                      <p className="text-[12px] text-[var(--brief-ink)] break-words">{regError}</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] text-[var(--ink-60)] mb-1">
                      Your name
                    </label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Name"
                      className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-sm rounded-xl px-3 py-3 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--ink-60)] mb-1">
                      Phone or email
                    </label>
                    <input
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                      placeholder="So the organiser can reach you"
                      className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-sm rounded-xl px-3 py-3 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                    />
                  </div>
                  {/* Pots (T3): the supporter states a whole-shillings amount.
                      Fixed-price events never show this — the price is the price. */}
                  {c.goalAmount != null && (
                    <div>
                      <label className="block text-[11px] text-[var(--ink-60)] mb-1">
                        Your contribution ({c.currency})
                      </label>
                      <input
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        inputMode="numeric"
                        placeholder="Whole shillings you are putting in"
                        className="w-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-sm rounded-xl px-3 py-3 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                      />
                      <p className="mt-1 text-[11px] text-[var(--ink-60)] leading-snug">
                        State what you are putting in. It counts toward the pot once the money
                        settles; contributors are counted, never listed.
                      </p>
                    </div>
                  )}
                  <button
                    disabled={busy || (c.goalAmount != null && !Number(amount))}
                    onClick={submit}
                    className="w-full py-4 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-sm cursor-pointer disabled:opacity-40"
                  >
                    {busy
                      ? 'Registering...'
                      : c.goalAmount != null
                      ? `Contribute${amount.trim() ? ` ${c.currency} ${Number(amount).toLocaleString()}` : ''}`
                      : c.price === 0
                      ? 'Register'
                      : `Register - ${c.currency} ${c.price.toLocaleString()}`}
                  </button>
                  {(c.price > 0 || c.goalAmount != null) && (
                    <p className="text-[11px] text-[var(--ink-60)] leading-snug text-center">
                      No online payment is connected yet. Your spot is held and you
                      arrange payment with the organiser.
                    </p>
                  )}
                </div>
              )}

            {/* Decision 6: no resale market on an event page. The ticket still
                exists and can still be GIVEN (POST /api/ticket-market/tickets/
                :id/transfer stays live), but nothing here offers seats for sale
                — every listing and order route now answers 404. */}
          </>
        )}
      </div>

      {/* Sticky RSVP bar (T4): the single decision a stranger needs — the price
          and the action. It appears only while registration is actually open,
          and simply scrolls to the form (which owns the real submit + honesty
          notes). No duplicated money/state logic lives here. */}
      {load.status === 'ready' && c && !done && !c.hasEnded && (c.status === 'published' || c.status === 'live') && (
        <div className="sticky bottom-0 z-20 border-t border-[var(--brief-line)] bg-[color:var(--color-paper)] px-4 py-3">
          <div className="w-full max-w-lg mx-auto flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-60)]">This event</p>
              <p className="text-sm font-extrabold text-[var(--brief-ink)]">
                {c.price === 0 ? 'Free' : `${c.currency} ${c.price.toLocaleString()}`}
              </p>
            </div>
            <button
              onClick={() =>
                document
                  .getElementById(c.soldOut ? 'waitlist-form' : 'register-form')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
              className="px-5 py-3 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-xs cursor-pointer"
            >
              {c.soldOut ? 'Join wait list' : c.goalAmount != null ? 'Contribute' : 'Register'}
            </button>
          </div>
        </div>
      )}

      <footer className="border-t border-[var(--brief-line)] py-6 text-[11px] text-[var(--ink-60)] text-center">
        Brief
      </footer>
    </div>
  );
}

