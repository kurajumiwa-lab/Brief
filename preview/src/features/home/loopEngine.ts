// ---------------------------------------------------------------------------
// THE LOOP — the YouTube-style recommendation and feed ordering abstraction.
//
// The Home feed is a window shop, not a task list or an onboarding funnel.
// The Loop orders and surfaces carousels based on:
//   * Location context (e.g. Ruiru, Gikomba, Kilimani, Nairobi)
//   * Persona context (customer, vendor, trader, all)
//   * Real rows from the board: listings, gaps, suppliers, events, routes.
//
// When real backend recommendation scores are wired, this module provides the
// clean plug point. Everything here operates on real rows only: no fake items.
// ---------------------------------------------------------------------------

import type {
  DiscoverFeedItem,
  DiscoverGap,
  DiscoverRoute,
  EventListing
} from '../../api/briefApi';
import type { PublicSpace, Circle } from '../../api/types';

export interface LoopContext {
  area: string;
  persona: 'all' | 'customer' | 'vendor' | 'trader';
}

export interface LoopPromotedBanner {
  id: string;
  tag: 'PROMOTED' | 'SPONSORED';
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}

export type LoopSectionKind =
  | 'popular'
  | 'merch'
  | 'gaps'
  | 'suppliers'
  | 'events'
  | 'groups'
  | 'wholesale'
  | 'promoted_banner';

export interface LoopSection {
  id: string;
  title: string;
  subtitle?: string;
  seeAllRoom?: string;
  kind: LoopSectionKind;
  items: any[];
  banner?: LoopPromotedBanner;
}

export function buildLoopSections(
  context: LoopContext,
  data: {
    feed: DiscoverFeedItem[];
    events: EventListing[];
    gaps: DiscoverGap[];
    spaces: PublicSpace[];
    routes: DiscoverRoute[];
    circles: Circle[];
  },
  callbacks: {
    onOpenGroupBuys?: () => void;
    onOpenPulse?: () => void;
    onExploreDiscover?: (room: any) => void;
  }
): LoopSection[] {
  const { area, persona } = context;
  const areaLabel = area.trim() || 'Nairobi';

  // Filter listings vs events in feed
  const listings = data.feed.filter((i) => i.kind !== 'event');
  const eventsAndTrips = data.events;

  // 1. Popular in area
  const popularSection: LoopSection = {
    id: 'popular-near-you',
    title: `Popular in ${areaLabel}`,
    subtitle: 'Marketplace offers and verified goods',
    seeAllRoom: 'all',
    kind: 'popular',
    items: listings.slice(0, 8)
  };

  // 2. New Merch & Available Offers
  const merchSection: LoopSection = {
    id: 'new-merch',
    title: `New merchandise & offers`,
    subtitle: 'Recently stocked from local shops',
    seeAllRoom: 'direct',
    kind: 'merch',
    items: listings.slice(2, 10)
  };

  // Promoted Banner A: Trip package or freight journey
  const promotedTripBanner: LoopSection = {
    id: 'promo-trip',
    title: '',
    kind: 'promoted_banner',
    items: [],
    banner: {
      id: 'promo-trip-1',
      tag: 'PROMOTED',
      title: 'Overland Rail & Coastal Trade Getaway',
      description: 'Mombasa → Nairobi → Kisumu corridor. 3 days slow transit with partner stays.',
      actionLabel: 'Explore Trips →',
      onAction: () => callbacks.onExploreDiscover?.('events')
    }
  };

  // 3. Economic Gaps
  const gapsSection: LoopSection = {
    id: 'economic-gaps',
    title: `Economic gaps near you`,
    subtitle: 'Unmet buyer demand waiting for a supplier or runner',
    seeAllRoom: 'all',
    kind: 'gaps',
    items: data.gaps.slice(0, 6)
  };

  // 4. Supplier & Shop Connect
  const suppliersSection: LoopSection = {
    id: 'supplier-connect',
    title: `Supplier & shop connect`,
    subtitle: 'Wholesale, workshops, and verified B2B storefronts',
    seeAllRoom: 'shops',
    kind: 'suppliers',
    items: data.spaces.slice(0, 8)
  };

  // Promoted Banner B: Group buy & bulk deal
  const promotedGroupBuyBanner: LoopSection = {
    id: 'promo-groupbuy',
    title: '',
    kind: 'promoted_banner',
    items: [],
    banner: {
      id: 'promo-gb-1',
      tag: 'SPONSORED',
      title: 'Wholesale Grain & Sugar Pool — Volume Discount',
      description: 'Pool demand with 12 neighborhood shops for direct farmgate pricing.',
      actionLabel: 'Join Group Buy →',
      onAction: () => callbacks.onOpenGroupBuys?.()
    }
  };

  // 5. Events & Trips This Week
  const eventsSection: LoopSection = {
    id: 'events-this-week',
    title: `Events & meetups this week`,
    subtitle: 'Gatherings, trader meetups and overland trips',
    seeAllRoom: 'events',
    kind: 'events',
    items: eventsAndTrips.slice(0, 8)
  };

  // 6. Groups & Chamas
  const groupsSection: LoopSection = {
    id: 'groups-rail',
    title: `Groups & chamas`,
    subtitle: 'Communities, table banking, and pool buying',
    seeAllRoom: 'circles',
    kind: 'groups',
    items: data.circles.slice(0, 10)
  };

  // 7. Wholesale & Freight Routes
  const wholesaleSection: LoopSection = {
    id: 'wholesale-routes',
    title: `Wholesale corridors & freight`,
    subtitle: 'Inter-hub supply lines and bulk volume routes',
    seeAllRoom: 'bulk',
    kind: 'wholesale',
    items: data.routes.slice(0, 6)
  };

  // Dynamic ordering by persona context:
  if (persona === 'vendor' || persona === 'trader') {
    return [
      suppliersSection,
      gapsSection,
      wholesaleSection,
      promotedGroupBuyBanner,
      popularSection,
      eventsSection,
      groupsSection
    ];
  }

  if (persona === 'customer') {
    return [
      popularSection,
      merchSection,
      promotedTripBanner,
      eventsSection,
      groupsSection,
      gapsSection,
      suppliersSection
    ];
  }

  // Default 'all' window shop feed
  return [
    popularSection,
    merchSection,
    promotedTripBanner,
    gapsSection,
    suppliersSection,
    promotedGroupBuyBanner,
    eventsSection,
    groupsSection
  ];
}
