import { useEffect, useState, lazy, Fragment } from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import Shell from "@/components/layout/Shell";
import { PageSpinner } from "@/components/ui/Spinner";
import BootSplash from "@/components/system/BootSplash";
import Button from "@/components/ui/Button";
import AuthPage from "@/pages/auth/AuthPage";
import PreviewPage from "@/pages/preview/PreviewPage";
import NearbyPage from "@/pages/nearby/NearbyPage";
import PlaceProfile from "@/pages/nearby/PlaceProfile";
import TaskTrack from "@/pages/tasks/TaskTrack";
import BusinessDeskPage from "@/pages/storefront/BusinessDeskPage";
import CreatePage from "@/pages/create/CreatePage";
import LegalPage from "@/pages/legal/LegalPage";
import SubscriptionPage from "@/pages/billing/SubscriptionPage";
import MembershipPage from "@/pages/membership/MembershipPage";
import DirectoryPage from "@/pages/membership/DirectoryPage";
import LogisticsPage from "@/pages/logistics/LogisticsPage";
import LogisticsOrderPage from "@/pages/logistics/LogisticsOrderPage";
import CalendarPage from "@/pages/calendar/CalendarPage";
import BookPage from "@/pages/calendar/BookPage";
import OffersBrowsePage from "@/pages/offers/OffersBrowsePage";
import PublicPage from "@/pages/page/PublicPage";
import PageEditor from "@/pages/page/PageEditor";
import InviteShopPage from "@/pages/trades/InviteShopPage";
import TrustBrowsePage from "@/pages/trust/TrustBrowsePage";
import TrustBranchPage from "@/pages/trust/TrustBranchPage";
import TrustMePage from "@/pages/trust/TrustMePage";
import TrustStaffPage from "@/pages/trust/TrustStaffPage";
import TrustMyReviewsPage from "@/pages/trust/TrustMyReviewsPage";
import OfficeJoinPage from "@/pages/office/OfficeJoinPage";
import OfficePage from "@/pages/office/OfficePage";
import LearnPage from "@/pages/learn/LearnPage";
import LearnDetailPage from "@/pages/learn/LearnDetailPage";
import LearnNewPage from "@/pages/learn/LearnNewPage";
import DayPage from "@/pages/today/TodayPage";
import DeskPage from "@/pages/desk/DeskPage";
import { DESK_ENABLED, INTEGRATIONS_ENABLED, NEARBY_DOORS_ENABLED } from "@/config/flags";
import BlueprintsPage from "@/pages/templates/BlueprintsPage";
import BlueprintDetailPage from "@/pages/templates/BlueprintDetailPage";
import TemplatePacksPage, { TemplatePackDetailPage } from "@/pages/templates/TemplatePacksPage";
import SavingsPage from "@/pages/market/SavingsPage";
import MeritPage from "@/pages/merit/MeritPage";
import PriceWorkPage from "@/pages/work/PriceWorkPage";
import {
  JobDetailPage, JobsBoardPage, MyJobsPage, PostJobPage,
} from "@/pages/jobs/JobsPages";
import ReceiptsPage from "@/pages/payments/ReceiptsPage";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";
import { canSellGoods } from "@/config/identity";

// The five destinations. Today is the landing page; the rest are lazy like
// everything else. The old home, Me and Activity screens stay in the tree as
// deep links, but no navigation points at them.
/**
 * `/mail` is the old conversations-only screen. It is not a page any more; it
 * is the Inbox with its conversation filter already applied. Keeping the URL
 * alive costs one line and keeps yesterday's links working.
 */
function InboxPageMail() {
  return <InboxPage initialFilter="messages" />;
}

const TodayPage = lazy(() => import("@/pages/home/TodayPage"));
const RegionsPage = lazy(() => import("@/pages/regions/RegionsPage"));
const DiscoverSectionPage = lazy(() => import("@/pages/discover/DiscoverSectionPage"));
const DiscoverFavoritesPage = lazy(() => import("@/pages/discover/DiscoverFavoritesPage"));
const ReceiptLedgerPage = lazy(() => import("@/pages/receipts/ReceiptLedgerPage"));
const ReferralsPage = lazy(() => import("@/pages/referrals/ReferralsPage"));
const ReferralLandingPage = lazy(() => import("@/pages/referrals/ReferralLandingPage"));
const ReceiptRewardsPage = lazy(() => import("@/pages/town/ReceiptRewardsPage"));
const ReferralIndexPage = lazy(() => import("@/pages/town/ReferralIndexPage"));
const ReferralShareLandingPage = lazy(() => import("@/pages/town/ReferralShareLandingPage"));
const ScoutMarketplacePage = lazy(() => import("@/pages/town/ScoutMarketplacePage"));
const MerchantCommercePage = lazy(() => import("@/pages/town/MerchantCommercePage"));
const CommerceOpsPage = lazy(() => import("@/pages/town/CommerceOpsPage"));
const TradeProofsPage = lazy(() => import("@/pages/trades/TradeProofsPage"));
const RegionsIndexPage = lazy(() => import("@/pages/regions/RegionsIndexPage"));
const RegionPage = lazy(() => import("@/pages/regions/RegionPage"));
const PortfolioPage = lazy(() => import("@/pages/you/PortfolioPage"));
const YouPage = lazy(() => import("@/pages/you/YouPage"));
const IdentityPage = lazy(() => import("@/pages/you/IdentityPage"));
const RankPage = lazy(() => import("@/pages/you/RankPage"));
const StartPage = lazy(() => import("@/pages/start/StartPage"));
const InboxPage = lazy(() => import("@/pages/inbox/InboxPage"));
const RoutinesPage = lazy(() => import("@/pages/routines/RoutinesPage"));
const StreetPage = lazy(() => import("@/pages/street/StreetPage"));
const MorePage = lazy(() => import("@/pages/more/MorePage"));
// Flag-gated pages are lazy on purpose: the flag decides whether the route
// exists, but a page nobody can open should not be downloaded by anybody.
const IntegrationsPage = lazy(() => import("@/pages/integrations/IntegrationsPage"));
const FrontDoorsPage = lazy(() => import("@/pages/nearby/FrontDoorsPage"));
const NoticeBoardPage = lazy(() => import("@/pages/noticeboard/NoticeBoardPage"));

// Every page is lazy. The home screen downloads only what it renders —
// Leaflet (map), chat, analytics, ops and the rest split into chunks fetched
// on first navigation.
const BrowsePage = lazy(() => import("@/pages/browse/BrowsePage"));
// Outside (v4) destinations. Explore and Activity are lazy like everything
// else. Create is the one exception and it is deliberate: it is the middle tab
// on every screen, and the app's primary action should not show a spinner.
// Measured cost of keeping it in the main chunk: 14.3 kB raw / 3.9 kB gzip
// (`npm run build`, index 327.90 kB vs 313.56 kB lazy). If first paint ever
// needs those kilobytes back, making it lazy is a one-line change and the
// Suspense fallback in Shell already handles it.
const CommunityPage = lazy(() => import("@/pages/community/CommunityPage"));
const ParksPage = lazy(() =>
  import("@/pages/parks/ParksPage").then((m) => ({ default: m.ParksPage }))
);
const ParkDetailPage = lazy(() =>
  import("@/pages/parks/ParksPage").then((m) => ({ default: m.ParkDetailPage }))
);
const ActivityDetailPage = lazy(() => import("@/pages/activities/ActivityDetailPage"));
const ListingPage = lazy(() => import("@/pages/listing/ListingPage"));
const OrdersPage = lazy(() => import("@/pages/orders/OrdersPage"));
const RepeatOrderPage = lazy(() => import("@/pages/orders/RepeatOrderPage"));
const TradeRecordsPage = lazy(() => import("@/pages/orders/TradeRecordsPage"));
const OrderDetailPage = lazy(() => import("@/pages/orders/OrderDetailPage"));
const WorkPage = lazy(() => import("@/pages/work/WorkPage"));
const SurfaceFeed = lazy(() => import("@/pages/surface/SurfaceFeed"));
const SearchHub = lazy(() => import("@/pages/search/SearchHub"));
const MapPage = lazy(() => import("@/pages/map/MapPage"));
const News = lazy(() => import("@/pages/news/News"));
const TasksPortal = lazy(() => import("@/pages/tasks/TasksPortal"));
const PassportPage = lazy(() => import("@/pages/standing/PassportPage"));
const GrowthPlannerPage = lazy(() => import("@/pages/growth/GrowthPlannerPage"));
const EnterprisePage = lazy(() => import("@/pages/enterprise/EnterprisePage"));
const StockRoom = lazy(() => import("@/pages/stock/StockRoom"));
const Network = lazy(() => import("@/pages/network/Network"));
const VendorLists = lazy(() => import("@/pages/lists/VendorLists"));
const Groups = lazy(() => import("@/pages/groups/Groups"));
const ChatPage = lazy(() => import("@/pages/chat/ChatPage"));
const MarketLocks = lazy(() => import("@/pages/locks/MarketLocks"));
const OurNetwork = lazy(() => import("@/pages/governance/OurNetwork"));
const ToolsPage = lazy(() => import("@/pages/tools/ToolsPage"));
const EventShareRedirect = lazy(() => import("@/pages/events/EventShareRedirect"));
const EventsPage = lazy(() => import("@/pages/events/EventsPage"));
const EventHubPage = lazy(() => import("@/pages/events/EventHubPage"));
const EventDeskPage = lazy(() => import("@/pages/events/EventDeskPage"));
const RateCardPage = lazy(() => import("@/pages/events/RateCardPage"));
const PublicRateCardPage = lazy(() => import("@/pages/events/PublicRateCardPage"));
const POSBridge = lazy(() => import("@/pages/pos/POSBridge"));
const Analytics = lazy(() => import("@/pages/analytics/Analytics"));
const Ops = lazy(() => import("@/pages/ops/Ops"));
// Operator-only: kept out of the bundle a customer downloads.
const EnquiryInboxPage = lazy(() => import("@/pages/storefront/EnquiryInboxPage"));
// Operator-only intake desk: photographs of public advertising become market
// data. The API answers 403 without a market-ops role, so the route is public.
const MarketIntakePage = lazy(() => import("@/pages/intake/MarketIntakePage"));
// The product sold to signed-in vendors: prices from public advertising, with
// seller contacts behind the partner tier.
const MarketDataPage = lazy(() => import("@/pages/market/MarketDataPage"));

/** Signed in, but the profile call failed. Saying so — with the server's own
    words — beats the old silent bounce to /auth, which was indistinguishable
    from a wrong password and sent people round the login loop. */
function SessionProblem() {
  const authError = useAuthStore((s) => s.authError);
  const fetchVendor = useAuthStore((s) => s.fetchVendor);
  const logout = useAuthStore((s) => s.logout);
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-surface-0">
      <div className="w-full max-w-md rounded-2xl border border-edge-1 bg-surface-0 shadow-sm p-6 space-y-4 animate-fade-in">
        <h1 className="text-lg font-extrabold tracking-tight text-ink-1">Almost in</h1>
        <p className="text-sm text-ink-3 leading-relaxed">{authError}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => fetchVendor()}>Try again</Button>
          <Button variant="ghost" onClick={logout}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}

/** Gate: no token → /auth (remembering where to return); token but vendor not
    loaded yet → spinner; token but the profile call failed → the reason. */
function RequireVendor({ children }) {
  const { token, vendor, ready, authError } = useAuthStore();
  const location = useLocation();
  if (!token) {
    // A `/p/<handle>` link arrives from WhatsApp, and a stranger must see the
    // page, not a login wall. It used to be redirected to the older
    // `/page/<handle>`, which renders a different, card-shaped layout without
    // the gallery or the listings — so the link we hand out showed the weaker
    // page. It now renders exactly the page the owner sees, read-only: the
    // components are public, only the editing controls are gated on `isOwner`.
    const shared = location.pathname.match(/^\/p\/([^/]+)\/?$/);
    if (shared) return children;
    return <Navigate to="/auth" replace state={{ from: location.pathname + location.search }} />;
  }
  if (!ready) return <PageSpinner label="Entering the network…" />;
  if (!vendor) return authError ? <SessionProblem /> : <Navigate to="/auth" replace />;
  return children;
}

/**
 * Stock is not a universal screen any more. It appears when the person has said
 * they sell goods — or when the account already holds stock, so nobody with a
 * live shelf is locked out by a preference they never set.
 */
function StockRoute() {
  const vendor = useAuthStore((s) => s.vendor);
  const identity = useIdentityStore();
  const loaded = identity.loaded;
  const declared = identity.intent !== null || identity.capabilities.length > 0;
  const allowed =
    !loaded ||
    !declared ||
    canSellGoods(identity) ||
    Boolean(vendor?.has_stock) ||
    Number(vendor?.total_stock_moved || 0) > 0;

  if (!allowed) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-edge-1 bg-surface-1 p-6 text-center">
        <h1 className="text-lg font-extrabold text-ink-1">Stock is off</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-3">
          You have not said you sell goods, so there is no shelf to manage. If
          that changes, turn it on and the shelf appears — nothing was deleted.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button as={Link} to="/you" size="sm">Open You</Button>
          <Button as={Link} to="/create" size="sm" variant="secondary">Publish instead</Button>
        </div>
      </div>
    );
  }
  return <StockRoom />;
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  const ready = useAuthStore((s) => s.ready);
  const fetchVendor = useAuthStore((s) => s.fetchVendor);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    if (!ready) fetchVendor();
  }, [ready, token, fetchVendor]);

  return (
    <>
      {/* The five-second cold-start screen. It runs alongside the session check
          rather than before it, so the time is spent, not added. */}
      {!splashDone && <BootSplash onDone={() => setSplashDone(true)} />}
      <AppRoutes />
    </>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      {/* A referral link is shared in WhatsApp and must open before sign-up.
          The page stores the code, then sends the visitor through auth with
          `state.from` pointing back at the claim. */}
      <Route path="/r/:code" element={<ReferralLandingPage />} />
      <Route path="/referral-index/go/:code" element={<ReferralShareLandingPage />} />
      {/* Dev-only living spec for the redesign. See pages/preview/PreviewPage. */}
      <Route path="/preview" element={<PreviewPage />} />
      {/* Public storefront (v2.14): catalogue, tiers, trial — readable without
          an account; enquiring attaches to a vendor @handle. */}
      <Route path="/storefront" element={<BusinessDeskPage />} />
      {/* Open to everyone, no account: browse offers, the knowledge directory and free templates. */}
      <Route path="/offers" element={<OffersBrowsePage />} />
      {/* The public Page: a mini site per business. No account needed to read it. */}
      <Route path="/page/:handle" element={<PublicPage />} />
      {/* The event vendor rate card is public, like a Page. No account needed to read it. */}
      <Route path="/rate-card/:handle" element={<PublicRateCardPage />} />
      {/* A customer scanned a receipt from a shop with no page. Public, so the
          link in a WhatsApp group works before anyone installs anything. */}
      <Route path="/invite/:slug" element={<InviteShopPage />} />
      {/* MarketTrust: checked shops in Kenya, Ethiopia and Uganda. Open to everyone; rating needs sign-in. */}
      <Route path="/trust" element={<TrustBrowsePage />} />
      <Route path="/trust/branches/:id" element={<TrustBranchPage />} />
      {/* A customer's own review history on this device. No account needed. */}
      <Route path="/trust/my-reviews" element={<TrustMyReviewsPage />} />
      {/* Home office: a single-use invite link works without an account. */}
      <Route path="/office/join/:token" element={<OfficeJoinPage />} />
      <Route path="/learn" element={<LearnPage />} />
      <Route path="/learn/:id" element={<LearnDetailPage />} />
      <Route path="/templates" element={<BlueprintsPage />} />
      {/* 0082: template packs. A shelf offers a choice of business type; the
          detail route is declared first so /packs is not read as a pack key. */}
      <Route path="/templates/packs" element={<TemplatePacksPage />} />
      <Route path="/templates/packs/:key" element={<TemplatePackDetailPage />} />
      <Route path="/templates/:key" element={<BlueprintDetailPage />} />
      {/* 0082: what the next shop charges. Public — a saving is information
          the whole town should be able to check before joining anything. */}
      <Route path="/savings" element={<SavingsPage />} />
      {/* 0083: a business's trust record. Public — the point of publishing a
          score is that a stranger can read it without an account. */}
      <Route path="/merit/:handle" element={<MeritPage />} />
      {/* Jobs are readable before sign-in; applying needs an account and is
          free. Nothing on either page takes money from the applicant. */}
      <Route path="/jobs" element={<JobsBoardPage />} />
      <Route path="/jobs/post" element={<PostJobPage />} />
      <Route path="/jobs/mine" element={<MyJobsPage />} />
      <Route path="/jobs/:id" element={<JobDetailPage />} />
      {/* Operator side of the same desk: where a request lands. The API answers
          403 for anyone without a market-ops role, so the page can be public. */}
      <Route path="/storefront/inbox" element={<EnquiryInboxPage />} />
      {/* Operator side of the market dataset: read photographs, confirm prices. */}
      <Route path="/intake" element={<MarketIntakePage />} />
      <Route path="/market-data" element={<MarketDataPage />} />
      {/* The post-join question. Outside the shell on purpose: no tabs, no
          drawer, no shelves — one answer and then the app. */}
      <Route
        path="/start"
        element={
          <RequireVendor>
            <StartPage />
          </RequireVendor>
        }
      />
      <Route
        element={
          <RequireVendor>
            <Shell />
          </RequireVendor>
        }
      >
        <Fragment>
          {/* ── Primary destinations ───────────────────────────────────
              Home · Browse · Work · Inbox · Business — organised around what
              an owner is doing, not around our databases. Discovery routes
              remain deep-linkable beneath Browse (/network, /nearby, /map,
              /markets, /news are views of the same results); work routes
              (/orders, /tasks, /locks, /tools) under Work; business routes
              under /me. Nothing was deleted — only duplicated navigation. */}
          {/* Phase 10: the Morning Brief is the landing page when flagged; Home stays at /home. */}
          {/* ── The five destinations ─────────────────────────────────── */}
          <Route path="/" element={<TodayPage />} />
          <Route path="/home" element={<TodayPage />} />
          <Route path="/regions" element={<RegionsPage />} />
          {/* Shareable smart-category doors. The section sets a default query;
              /discover/favorites is local-only and has no server feed. */}
          <Route path="/discover" element={<RegionsPage />} />
          <Route path="/discover/favorites" element={<DiscoverFavoritesPage />} />
          <Route path="/discover/:section" element={<DiscoverSectionPage />} />
          <Route path="/receipts" element={<ReceiptLedgerPage />} />
          <Route path="/receipt-rewards" element={<ReceiptRewardsPage />} />
          <Route path="/referrals" element={<ReferralsPage />} />
          <Route path="/referral-index" element={<ReferralIndexPage />} />
          <Route path="/scout" element={<ScoutMarketplacePage />} />
          <Route path="/merchant" element={<MerchantCommercePage />} />
          <Route path="/ops/commerce" element={<CommerceOpsPage />} />
          <Route path="/trades/proofs" element={<TradeProofsPage />} />
          <Route path="/regions/all" element={<RegionsIndexPage />} />
          <Route path="/regions/:slug" element={<RegionPage />} />
          {/* THE ONE INBOX. /activity and /mail are kept because links in
              WhatsApp threads and old notification payloads point at them, but
              they no longer render a second and third inbox — they render this
              one. `/mail` opens it already filtered to conversations, which is
              the only thing the old Mail page did. */}
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/activity" element={<InboxPage />} />
          <Route path="/mail" element={<InboxPageMail />} />
          <Route path="/routines" element={<RoutinesPage />} />
          <Route path="/street" element={<StreetPage />} />
          {/* 0082: the receipt game as a paid task. Signed in, so a day can be
              assessed against a real person and a monthly cap. */}
          <Route path="/price-work" element={<PriceWorkPage />} />
          <Route path="/live" element={<Navigate to="/street" replace />} />
          <Route path="/e/:slug" element={<EventShareRedirect />} />
          <Route path="/you" element={<YouPage />} />
          <Route path="/you/page" element={<PageEditor />} />
          <Route path="/you/identity" element={<IdentityPage />} />
          <Route path="/you/rank" element={<RankPage />} />
          <Route path="/more" element={<MorePage />} />
          {/* Linked from the notice-board shelf. The page already existed and
              was never registered, so the link was a 404 in an empty room. */}
          <Route path="/notices" element={<NoticeBoardPage />} />
          <Route path="/p/:handle" element={<PortfolioPage />} />
          {/* Old address for the same page. A handle is a URL, not a product. */}
          <Route path="/you/settings" element={<Navigate to="/more" replace />} />
          {/* The Morning Brief is the first block of Today, so `/brief` is an
              old address, not a page. It used to resolve to both a page and a
              redirect in this same block — the redirect won, which meant the
              page was unreachable while still being imported into the bundle. */}
          <Route path="/legal" element={<LegalPage />} />
          <Route path="/billing" element={<SubscriptionPage />} />
          {/* Free for now: membership, member directory and group orders */}
          <Route path="/membership" element={<MembershipPage />} />
          <Route path="/membership/directory" element={<DirectoryPage />} />
          <Route path="/logistics" element={<LogisticsPage />} />
          <Route path="/logistics/:id" element={<LogisticsOrderPage />} />
          {/* Calendar: my week, appointments and a booking page for clients */}
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/office" element={<OfficePage />} />
          <Route path="/my-page" element={<PageEditor />} />
          {INTEGRATIONS_ENABLED && <Route path="/integrations" element={<IntegrationsPage />} />}
          <Route path="/learn/new" element={<LearnNewPage />} />
          <Route path="/today" element={<DayPage />} />
          {/* Flagged: off unless VITE_DESK_ENABLED=true. A false child is skipped by Routes. */}
          {DESK_ENABLED && <Route path="/desk" element={<DeskPage />} />}
          {/* Flagged: off unless VITE_MAIL_ENABLED=true. */}
          {/* Flagged: off unless VITE_NEARBY_DOORS_ENABLED=true. */}
          {NEARBY_DOORS_ENABLED && <Route path="/doors" element={<FrontDoorsPage />} />}
          <Route path="/book/:vendorId" element={<BookPage />} />
          <Route path="/payments" element={<ReceiptsPage />} />
          {/* ── Outside destinations (v4) ──────────────────────────────────
              Explore absorbs Browse's discovery surfaces; Activity absorbs
              Work and Inbox. Every older URL below still resolves and still
              highlights the right tab (see config/navigation.js areas). */}
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/parks" element={<ParksPage />} />
          <Route path="/parks/:slug" element={<ParkDetailPage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/activities/:id" element={<ActivityDetailPage />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/listing/:id" element={<ListingPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/repeat" element={<RepeatOrderPage />} />
          <Route path="/orders/records" element={<TradeRecordsPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/work" element={<WorkPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/stock" element={<StockRoute />} />

          {/* ── Browse and supporting discovery surfaces ──────────────── */}
          <Route path="/nearby" element={<NearbyPage />} />
          <Route path="/nearby/:group" element={<NearbyPage />} />
          <Route path="/place/:id" element={<PlaceProfile />} />
          <Route path="/feed" element={<SurfaceFeed />} />
          <Route path="/search" element={<SearchHub />} />
          <Route path="/search/:tab" element={<SearchHub />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/news" element={<News />} />
          <Route path="/news/:kind" element={<News />} />
          {/* Markets were retired in place of regions. The old addresses still
              resolve so a WhatsApp link from last month lands somewhere useful. */}
          <Route path="/markets" element={<Navigate to="/regions" replace />} />
          <Route path="/markets/:id" element={<Navigate to="/regions" replace />} />
          <Route path="/mall" element={<Navigate to="/regions" replace />} />
          <Route path="/explore" element={<Navigate to="/regions" replace />} />
          <Route path="/identity/ops" element={<Navigate to="/ops" replace />} />
          <Route path="/inbox/:tab" element={<InboxPage />} />
          <Route path="/network" element={<Network />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/event/:eventId" element={<EventHubPage />} />
          <Route path="/events/desk" element={<EventDeskPage />} />
          <Route path="/rate-card" element={<RateCardPage />} />
          <Route path="/lists" element={<VendorLists />} />
          <Route path="/locks" element={<MarketLocks />} />

          {/* ── Tasks (Squad league + Workspace) ──────────────────────── */}
          <Route path="/squad" element={<Navigate to="/tasks/squad" replace />} />
          <Route path="/tasks" element={<TasksPortal />} />
          <Route path="/tasks/:track" element={<TaskTrack />} />

          {/* ── Your business ─────────────────────────────────────────── */}
          <Route path="/me" element={<Navigate to="/you" replace />} />
          {/* MarketTrust, signed in: my shops, till codes and points. Linked from /trust. */}
          <Route path="/trust/me" element={<TrustMePage />} />
          {/* MarketTrust check desk: Wasta staff approve or reject shops. The API refuses everyone else. */}
          <Route path="/trust/staff" element={<TrustStaffPage />} />
          {/* Brief is the legacy name for the Me workspace; /brief still redirects. */}
          <Route path="/brief" element={<Navigate to="/me" replace />} />
          <Route path="/profile" element={<Navigate to="/me" replace />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/pos" element={<POSBridge />} />
          <Route path="/governance" element={<OurNetwork />} />
          <Route path="/ops" element={<Ops />} />
          <Route path="/passport" element={<PassportPage />} />
          <Route path="/growth" element={<GrowthPlannerPage />} />
          {/* v2.13 enterprise workspaces — the paid, private side of the dual
              model. Lazy-imported above and named in ME_ROOTS, so the surface is
              reachable at the URL the README and the API both use. */}
          <Route path="/enterprise" element={<EnterprisePage />} />
          {/* The creative-portfolio page was retired in v2.16. Its capability —
              showing work — now lives on the shop front (selected work), its
              price list lives on the Business Desk, and its inquiry pipeline is
              the enquiry inbox. LinkedIn-old links still land somewhere useful. */}
          <Route path="/portfolio" element={<Navigate to="/me" replace />} />
          <Route path="/studio" element={<Navigate to="/me" replace />} />
          <Route path="/:handle" element={<VendorHandleRoute />} />

          {/* ── v2 URLs that moved ────────────────────────────────────── */}
          <Route path="/movements" element={<Navigate to="/orders" replace />} />
          <Route path="/stock/:id" element={<ListingRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Fragment>
      </Route>
    </Routes>
  );
}

function VendorHandleRoute() {
  const { pathname } = useLocation();
  // /@handle is the old address for a page. It still resolves to the page,
  // because a link in a WhatsApp thread must not break — but the page itself
  // uses /p/handle and never presents the handle as the identity.
  if (pathname.startsWith("/@") && pathname.length > 2) {
    return <PortfolioPage />;
  }
  return <Navigate to="/" replace />;
}

function ListingRedirect() {
  const { pathname } = useLocation();
  return <Navigate to={pathname.replace(/^\/stock\//, "/listing/")} replace />;
}

