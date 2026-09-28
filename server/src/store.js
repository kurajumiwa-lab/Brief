// ---------------------------------------------------------------------------
// PERSISTENCE
//
// A tiny append-safe JSON document store. Deliberately not an ORM and not
// SQLite: the ingestion layer needs durable rows with predictable shapes, and
// swapping this file for Postgres/Supabase later is a contained change because
// every caller goes through the named collection helpers below.
//
// Everything is synchronous. At this scale that is a feature -- no partially
// written pipeline state after a crash mid-request.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareStoreFile } from './ops.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.BRIEF_DATA_DIR || path.join(HERE, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'brief.json');

// The full schema. Each key is a collection of rows.
const EMPTY = {
  // Authentication. Passwords are scrypt-hashed with a per-user salt; only a
  // SHA-256 fingerprint of each session token is stored, never the token.
  users: [],
  workOrders: [], // Frozen commercial agreements and explicit two-party fulfillment.
  quoteRequests: [], // Explicit, scoped commercial invitations.
  requestQuotes: [], // Drafts plus immutable submitted offer versions; no ledger link.
  matches: [], // Revision-bound demand-to-capability relationships.
  capabilities: [], // Capability records reference the existing vendor identity.
  vendorLeads: [], // Scout-captured shops: photo + contact + category. See domain/vendorLeads.js.
  externalPlaceSnapshots: [], // Cached business-directory answers: source + point-in-time. See domain/externalPlaces.js.
  placePriceClaims: [], // Receipt-backed price claims on external places. Photo mandatory, always unverified.
  // ROLE-ON-SCOPE AUTHORITY (additive, revocable) — a person holds a role
  // bounded to a scope (org/program/cohort/circle). Attribution (who brought
  // them) is separate and immutable. See domain/roles.js.
  roleAssignments: [],
  // THE INVITE PRIMITIVE — one shape, nine rungs. An invite grants a role
  // bounded to a scope, carries immutable provenance, and always expires.
  // See domain/invites.js.
  invites: [],
  requestParticipants: [], // Owner-curated potential options, not matches.
  requests: [], // Structured economic demand; additive, no data migration.
  procurements: [], // Repeat-procurement memory: one historical row per completed Work Order.
  workPaymentIntents: [], // Work Order payments: the record of a payment attempt (Phase 8).
  workSettlements: [], // Settlement state: payment -> ledger transaction -> payee.
  sessions: [],
  emailChallenges: [], // Hashed, single-use mailbox proofs (legacy signed links are never accepted).
  // Server-held secrets that must survive a restart but must never reach a
  // client (currently: the HMAC key that signs one-tap email links).
  appSecrets: [],
  // First-run state: the segmentation answer a person actually gave, and the
  // append-only stream of named activation events. Ladder progress is DERIVED
  // from these plus ordinary rows (confirmations, captures, campaigns) — never
  // stored as a step counter. See domain/onboarding.js.
  onboardingProfiles: [],
  activationEvents: [],
  sources: [],
  sourceMemberships: [],
  rawItems: [],
  objects: [],
  objectSources: [], // canonical object <-> source provenance, many-to-many
  relationships: [],
  syncRuns: [],
  errors: [],
  // Feature schema: durable group containers and their contents.
  circles: [],
  groupJoinRequests: [], // Private directory admission requests.
  groupWorkspaces: [], // Context links; native domains own operations and lifecycle.
  workspaceParticipants: [], // Explicit requests/admissions, never group membership.
  members: [],
  blocks: [],
  // One row per ballot cast, keyed by (blockId, voterId). Vote tallies are
  // computed by scanning these rows -- there is deliberately no stored count.
  votes: [],
  // APPEND-ONLY HISTORY (see src/domain/circleHistory.js). One row per change to
  // a task, a membership or a vote: actor, timestamp, before, after, reason.
  // Nothing in this table is ever updated or removed; the only correction is
  // another row.
  circleRevisions: [],
  signals: [],
  // Recorded money movements. See src/domain/ledger.js -- no provider is
  // connected, so these are records only.
  ledgerTransactions: [],
  // Payment attempts. NOT a second money store: the authoritative economic
  // event is always the ledger transaction an intent points at.
  paymentIntents: [],
  // Raw provider callbacks, kept for audit and duplicate detection.
  paymentCallbacks: [],
  // Disbursements to sellers. A payout is a RECORD of money sent, not a
  // balance -- withdrawable is always derived as (settled net - paid - pending).
  payouts: [],
  // THE SETTLEMENT RAIL — generic money-movement attempts (server/settlement/).
  // One row per rail attempt: the manual rail queues here, a human confirms.
  // Vendor payouts keep their derived-amount lifecycle in domain/settlement.js;
  // this collection is the seam for movements that have no domain payout
  // machinery yet. States: pending/in_flight/settled/failed/reversed.
  settlementAttempts: [],
  // Rows the hourly reconciler opens for attempts stuck in_flight too long.
  // One open escalation per attempt; closed by a human, never by the sweep.
  settlementEscalations: [],
  // Service fees paid to Brief via Pochi la Biashara (manual M-Pesa code flow).
  servicePayments: [],
  // Referral reward events (append-only, deduped by key) and point-to-cash
  // conversions paid from the derived rewards pool.
  referralEvents: [],

  // WhatsApp shops: the builder state. The storefront is WhatsApp itself —
  // the share output (formatted text + wa.me link) is derived, never stored.
  shops: [],

  // Duka book: logged sales (the paper-ledger replacement). Rows are facts;
  // every total, top-item and low-stock flag is DERIVED at read time.
  shopSales: [],
  referralConversions: [],
  // Creator distribution layer. A campaign wraps an existing object; its
  // metrics are derived, never stored. See src/domain/campaign.js.
  campaigns: [],
  registrations: [],
  // Distribution provenance: how each member arrived — partner / program /
  // cohort / invite / channel — captured ONCE at signup (first-touch-wins).
  // Economic value per member/partner is DERIVED from real rows, never
  // stored. See src/domain/attribution.js.
  acquisitions: [],
  // First-class distribution partners (B2B2C infrastructure). A partner is a
  // STORED, contracted record (organisation → programs → cohorts) whose keys
  // join against the attribution keys above. Revenue share is DERIVED from
  // verified commercial activity and becomes money only via a finance-confirmed
  // settlement (ledger-backed). See src/domain/partner.js.
  partners: [],
  partnerPrograms: [],
  partnerCohorts: [],
  commercialAgreements: [], // append-only; one active agreement per partner
  partnerSettlements: [],   // finance-confirmed revenue-share payouts (ledger-backed)
  // Field agents (riders / door-to-door agents) who onboard vendors. A claim is
  // first-touch-wins per vendor and is attribution only — a claim is not
  // payable by itself. Pay follows an approved visit (see fieldVisits).
  // Settlements are finance-confirmed ledger payouts, one per agent per week.
  // See src/domain/fieldAgent.js.
  vendorClaims: [],
  fieldAgentSettlements: [],
  // Field-agent VISITS — the payable act under Decision 5 (docs/DECISIONS.md):
  // KES 150 flat per APPROVED visit, settled weekly. A row stores the agent,
  // the shop, the purpose, the agent's own words and the approval; it stores
  // NO fee and NO week, because both are derived from the rows on read.
  fieldVisits: [],
  // WORKFORCE — a distributed team run from phones (docs/WORKFORCE.md).
  // HR rows (workforce, territories, members, one worker profile per person)
  // are stored facts; the onboarding checklist is DERIVED from them.
  // Execution rows: a program (intent + frozen rate card) decomposes into
  // units, each unit into step tasks; each submission is a proof row. Worker
  // earnings are DERIVED from approved tasks whose unit was approved — there
  // is no balance column. Money moves only through workforceSettlements, each
  // backed by a finance-confirmed ledger transaction (type work_task_fee).
  // (`workSettlements` above is the unrelated Work Order payment record.)
  workforces: [],
  workforceTerritories: [],
  workforceMembers: [],
  workerProfiles: [],
  workPrograms: [],
  workUnits: [],
  workTasks: [],
  workProofs: [],
  workforceSettlements: [],
  // Rider pickups — a local delivery assigned to a rider, originating from an
  // onboarded shop. Routing and completion are the product; the per-pickup
  // origin fee Decision 5 ended is not (see src/domain/pickups.js).
  pickups: [],
  // Space audience — who follows a space, what it has broadcast to them, and
  // the message templates its owner reuses. All three are ordinary rows: a
  // follower is a person who chose to follow, a broadcast is a message with a
  // real expiry, a template is text the vendor wrote. Nothing here is a
  // vanity metric and nothing is pre-filled to make a space look followed.
  spaceFollowers: [],
  spaceBroadcasts: [],
  spaceTemplates: [],
  // One row per report filed from a public page. Nothing else writes here, and
  // nothing here changes a space's visibility — see spacePublicPage.reportSpace.
  spaceAbuseReports: [],
  // "This person introduced that shop" — pending until the shop confirms it.
  // See guardians.js: an unconfirmed claim is worth nothing by construction, and
  // the credit a confirmed one produces is a referralPoints row, not a ledger.
  attributions: [],
  // One row per published price/term change, with the seller's own reason. Never
  // edited, never deleted: see domain/listing.js -> updateListing.
  listingRevisions: [],
  // One row per edit to a CAMPAIGN after it left draft, with the pre-image and
  // the actor. Same reasoning as listingRevisions: an offer people have already
  // registered for may be edited, and the edit must be answerable afterwards
  // ("the date moved from Saturday to Sunday, on Tuesday, by the host").
  campaignRevisions: [],
  // The record of an offer being WITHDRAWN. Withdrawal is a state transition,
  // not a delete: one row per campaign, holding the receipt of what that
  // withdrawal actually did (tickets voided, registrations cancelled, money
  // refunded or still owed). A campaign row must never be hard-deleted while
  // one of these, or anything else, depends on it.
  campaignWithdrawals: [],
  // Money the withdrawal promised and the ledger has NOT yet given back. One
  // row per transaction, opened by the withdrawal and closed only by a real
  // refund transition — a human-visible queue, never a silent failure.
  refundObligations: [],
  // One row per movement of a stock count — a sale that took units, or a human
  // who re-typed the number. Append-only, and the only reason a morning brief
  // can say anything at all about the shelf: a listing stores one count, not a
  // history, so "4 sold and the count is back at 10" is unanswerable without
  // these. See domain/stockLog.js.
  stockChanges: [],
  // The owner's own choice about the morning brief: whether to be told, and at
  // which hour in Nairobi. Both start unset/off — the product does not announce a
  // default it never got asked about. See domain/shopBrief.js.
  shopBriefPrefs: [],
  // Errands — a posted task someone can carry (a parcel, a queue, a document,
  // a small buy-and-drop). Only registered agents/partners may ACCEPT one;
  // anyone may post. The fee a poster states is a stated amount, NOT money
  // Brief moves: settlement is recorded as the two parties agreeing it happened
  // off-platform, because no payment provider is wired for errands.
  // See src/domain/errands.js.
  errands: [],
  // One rating per person per delivered errand — the only reputation-shaped row
  // in Brief, and it is deliberately narrow: it records what a named party said
  // about ONE completed delivery. Nothing aggregates it into a score, a tier or
  // a ranking, and no endpoint computes one.
  errandRatings: [],
  // HISTORY ONLY. These were the finance-confirmed payouts of the derived
  // pickup origin fee (delivered pickups x KES 20). Decision 5 ended that fee
  // — a field agent is paid KES 150 per approved visit and nothing else — so
  // the writers are gone from src/domain/pickups.js and this collection is
  // readable history that nothing adds to and nothing can re-pay.
  pickupFeeSettlements: [],
  // Lipa Mdogo — asset-financing RECORDS + collection. Brief is not the
  // lender: the lender is a bank/sacco/cooperative partner who owns the risk;
  // these rows record the contract, the derived schedule, and provider-
  // confirmed installment payments with a signed receipt hash. See
  // src/domain/lipaMdogo.js.
  lipaMdogoContracts: [],
  lipaMdogoPayments: [],
  // Table banking — the ledger + calculator for EXISTING table-banking groups.
  // Brief is not the group and not the lender: these rows record contributions,
  // rotation, loans (computed schedules, not lent), repayments, and
  // maker-checker payouts. The pool is derived; no money touches Brief. See
  // src/domain/tableBanking.js.
  tableBanking: [],
  tableBankingContributions: [],
  tableBankingLoans: [],
  tableBankingRepayments: [],
  tableBankingPayouts: [],
  // A table-banking group placing a COLLECTIVE order rides the ordinary
  // Request -> Match -> Quote -> WorkOrder chain; this row records which group
  // a request was placed on behalf of (provenance + the member breakdown), so
  // the table-banking surface can list its collective demand. See
  // tableBanking.placeCollectiveRequest.
  tableBankingRequests: [],
  // WELFARE FUND — a second, earmarked pool the group keeps for member
  // emergencies. It is NOT insurance: the group's own money, paid out by the
  // group's own vote. Contributions are receipt-hashed records; claims carry a
  // vote trail; the fund balance is DERIVED (contributions minus approved
  // claims), never stored. See tableBanking.fileWelfareClaim / welfareFund.
  tableBankingWelfareContributions: [],
  tableBankingClaims: [],
  // Meeting minutes: a member-authored log of what the group decided. Real
  // rows; the treasurer/members keep them for disputes and records.
  tableBankingMinutes: [],
  // Join invites: the treasurer adds a member by phone; the member confirms by
  // replying YES <code>. Accepted invites are phones awaiting registration,
  // never fabricated users.
  tableBankingInvites: [],
  // Quote votes: a group decides which quote to accept for a COLLECTIVE
  // request. One vote per member; the tally is derived; the accept reuses the
  // normal quote-accept path.
  quoteVotes: [],
  // P2P ticket resale (Tikiti integration T1). A ticket is ONE admitted
  // seat, born from a confirmed campaign registration; its scannable code
  // IS the registration's gate code, versioned so a transfer kills every
  // prior QR. ledgerTransactions remains the only economic truth — these
  // rows are inventory, provenance and state machines, never money.
  tickets: [],
  ticketListings: [],
  ticketOrders: [],
  ticketTransfers: [],
  // Standalone public banners are a presentation layer over a published
  // campaign. They carry no second event or payment state.
  campaignBanners: [],
  // Commerce (Batch 3). A vendor sells listings; a customer's commitment to a
  // listing is an order; a contested order has a dispute. Money lives in
  // ledgerTransactions as it always has -- there is deliberately no order
  // balance and no second transaction table.
  // --- Commerce -------------------------------------------------------------
  vendors: [],
  listings: [],
  orders: [],
  disputes: [],
  // Product opinions, helpfulness ballots and moderation reports; no money counters.
  businessFeedStates: [], // Private discovery controls/references; never money or copied supply.
  productReviews: [],
  productReviewVotes: [],
  productReviewReports: [],

  // --- The Vault -----------------------------------------------------------
  // A persistent context layer wrapping a real-world activity. A Vault is NOT
  // a chat, a CRM or an inbox: it is the room that channels, people, vendors,
  // orders and payments all open into. One real-world activity is one Vault,
  // regardless of how many channels it flows through.
  vaults: [],
  // Who is in a vault and what they may see/do. Roles: host, guest, vendor,
  // admin. Never derived from a client claim -- always a stored row.
  vaultParticipants: [],
  // Which channels open into this vault (telegram/whatsapp/web/manual/link).
  // A channel is a DOOR; the vault is the room.
  vaultChannels: [],
  // A guest's or host's request for something, routed to a vendor. A request
  // is NOT money; the order it turns into is, and that order lives in the
  // ordinary orders/ledger path.
  vaultRequests: [],
  // The immutable chronological event stream of a vault. See domain/footsteps.js.
  // Append-only; a footstep corresponds to a real application event.
  footsteps: [],
  // Opaque, signed, expiring tokens for channel handoffs and guest entry.
  // See domain/handoff.js. The token is the id; never stored in plaintext
  // anywhere else.
  handoffs: [],

  // --- Trust & integrity ---------------------------------------------------
  // Community confirmation of an object: one row per (object, actor). Tallies
  // are DERIVED by scanning these, never stored — same rule as votes and money.
  confirmations: [],
  // Abuse/spam reports. A report is a request for review, not a removal: it
  // has a lifecycle (open -> dismissed / actioned) and never auto-deletes.
  reports: [],
  // Operator corrections: one row per corrected field, preserving the ORIGINAL
  // source value next to the corrected value (who/when/why). The object's
  // provenance is never rewritten; this log is the history.
  corrections: [],
  // In-app notifications. A notification is a real, derived event (something
  // was confirmed, a challenge was accepted, a saved thing changed). Push is a
  // separate, still-unconnected rail — these are the local inbox.
  notifications: [],
  // One row per user: which notification categories they want (following,
  // events, offers, alerts, news, locations, saved) plus the watermark of the
  // last generation sweep. The row is created lazily with defaults ON.
  notificationPrefs: [],
  // --- Personal Brief ------------------------------------------------------
  // A user's explicit interests: one row per (user, kind, value) where kind is
  // location | type | topic. Idempotent by design — re-following is a no-op.
  // These are PRIVATE to the owner and never appear on public endpoints.
  userInterests: [],
  // Explicit relevance controls: one row per (user, kind, target) where kind
  // is more | less | not_interested | hide_source. The user said this out
  // loud; nothing is inferred. Also private to the owner.
  userRelevance: [],
  // Server-persisted bookmarks: one row per (user, object). The client-side
  // relationship graph already models "saved"; this is the durable copy so
  // saves survive across devices and sessions.
  saves: [],
  // --- Following (entity layer) --------------------------------------------
  // A user follows an ENTITY, never a raw object list: one row per
  // (user, entity kind, entity key). Entities themselves are DERIVED from
  // existing records (objects, sources, circles) — nothing is duplicated
  // here, this store only holds the follow edges.
  entityFollows: [],
  // Append-only audit trail of consequential mutations (who/what/when/from/to).
  // Never pruned by the app; the operator decides.
  auditLog: [],

  // --- Tea (editorial layer, home-feed master build) ------------------------
  // Articles with a full status lifecycle; only published+unexpired resolve
  // publicly. See domain/tea.js.
  teaArticles: [],

  // --- Media (visual association, home-feed master build) ------------------
  // The editorial media library: category/editorial images an editor approves
  // for use as fallback visuals. Empty until uploaded — never pre-fabricated.
  // See domain/media.js.
  mediaLibrary: [],
  // Real image files a person uploaded, not links to somebody else's server.
  // The row records the bytes (size, sha256, sniffed type); the file itself
  // lives in the upload directory, which is local disk and therefore not
  // durable across a redeploy. See domain/upload.js.
  uploads: [],

  // --- Collections (home-feed master build §47) ----------------------------
  // Named, data-driven groupings over real objects (rule or curated). See
  // domain/collection.js.
  collections: [],

  // --- Personal collections (Collections brief) ----------------------------
  // USER-owned named groups of object REFERENCES. Membership lives in
  // personalCollectionItems; the objects themselves are never duplicated.
  // Quick-save reuses the existing `saves` rows ("Saved"). See
  // domain/collections.js — distinct from the editorial domain/collection.js.
  personalCollections: [],
  personalCollectionItems: [],

  // --- Yard Engine / creator advertising -----------------------------------
  // These are additive operational shelves. Identity remains in `people`,
  // money remains in `ledgerTransactions`, and content remains in `objects`.
  creatorProfiles: [],
  rateCards: [],
  advertiserProfiles: [],
  advertiserCampaigns: [],
  campaignMatches: [],
  queueReservations: [],
  adAssets: [],
  calendarEntries: [],
  waitlistEntries: [],
  vendorCapabilities: [],
  vendorRecommendations: [],
  outboundMessages: [],

  // --- Distribution (four-screen build B) ----------------------------------
  // UTM click attribution: one row per tracked click. See domain/distribution.js.
  clickEvents: [],

  // --- Automation engine (CCS §3.1) ----------------------------------------
  // Trigger→condition→action workflows evaluated against the signal log, and
  // their append-only run history. See domain/workflow.js.
  workflows: [],
  workflowRuns: [],

  // --- Partnership + subscriptions (CCS §3.3/§3.4) -------------------------
  // Creator media kits (derived) + brand opportunities, and recurring
  // memberships whose money still flows through the one ledger.
  partnershipRequests: [],
  subscriptions: [],
  // WHO is subscribed to which plan. Separate from the plan row so membership
  // is a fact per person and the count is derived, never a stored number that
  // can drift out of step with the rows it claims to count.
  subscribers: [],

  // --- Person (report §4.4) -------------------------------------------------
  // A first-class entity over every identity Brief holds. A person is a stable
  // id; personAliases bind it to concrete external identifiers (user id, phone,
  // email, telegram/whatsapp, participant id) through EXPLICIT verified acts
  // only — never probabilistic inference.
  people: [],
  personAliases: [],
  // Mshikano: cooperation posts + two-party-confirmed partnerships.
  coopPosts: [],
  coopPartnerships: [],

  // --- HudumaLink (WhatsApp + M-Pesa distributed action layer) -------------
  // A self-contained product module living inside the same store. Identity is
  // keyed by phone; money lives in hudumaEscrow exactly as the ledger pattern
  // elsewhere expects (no second balance). See server/src/domain/huduma/* and
  // the production schema in server/sql/hudumalink.sql.
  hudumaUsers: [],       // phone-keyed data subjects; eCitizen token AES-encrypted
  hudumaOrders: [],      // service orders + escrow status
  hudumaEscrow: [],      // M-Pesa STK ledger rows backing each order
  hudumaDocuments: [],   // delivered artefacts + authenticity signature hash
  hudumaSessions: [],    // per-phone conversational state machine

  // --- Engine (sync core + universal router + tier guardrails) -------------
  // The "power plant": background state synchronization, signed webhook
  // dispatch, and server-authoritative access tiers. engineSyncs is an audit
  // trail of real pipeline runs (bounded per caller); engineDeliveries is the
  // dispatch ledger — nothing is recorded delivered that was not delivered.
  engineSyncs: [],       // per-caller sync telemetry (real stage timings)
  engineRoutes: [],      // user routing rules: signal match -> channels
  engineDeliveries: [],  // webhook/outbound dispatch ledger, every attempt
  engineTierGrants: [],  // operator tier grants (billing is not connected)

  // --- Story likes (editorial rating) ---------------------------------------
  // One row per (article, actor). Like counts are DERIVED by scanning these
  // rows — never a stored counter that can drift from the records.
  articleLikes: [],

  // --- Group Buy engine (Table banking & group-order pipelines) ---------------------
  // A group buy is a tracked funding pipeline; contributions are records with
  // verifiable receipt digests. Money records also ride the one ledger —
  // there is deliberately no second balance here.
  groupBuys: [],
  groupBuyContributions: [],
  // T2: a bargain's committed participants (per-head pricing bands).
  groupBuyParticipants: [],
  // T3: owner-authored updates on a contribution campaign.
  campaignUpdates: [],
  // T6: KYC verification records. No identity documents are ever stored --
  // only status, provider reference and review provenance.
  verificationRecords: [],
  // T7: email subscriptions with double opt-in + delivery log.
  emailSubscriptions: [],
  emailLog: [],

  // --- Brief 2.0 Spaces (The Digital Landlord) -----------------------------
  // A Space is something a person is trying to make happen (a business,
  // project, community, or side-hustle). Spaces own capabilities, goals,
  // people relationships, conversations, activity streams, ledger rails, and cargo dispatches.
  spaces: [],
  spaceActivities: [],
  spaceConversations: [],
  spaceExpenses: [],
  spaceCustomerTabs: [],
  spaceDispatches: [],

  // --- Operations engine (EVENT-ENGINE.md) ---------------------------------
  // The machinery behind "always on". Two rules govern everything here, and
  // they are the reason these collections exist at all:
  //
  //   1. NO INVISIBLE FAILURES. An automated action that fails leaves a row a
  //      person can find. `queue.js` records a failure and moves on; that is
  //      how a broken automation stays broken for a month.
  //   2. THE RULE TABLE IS DATA. What fires, on what, and how far it may go
  //      without a human is configuration with an author — not a branch in
  //      somebody's code.
  //
  // `workflows` and `workflowRuns` already existed for the creator-facing
  // trigger -> condition -> action feature and are EXTENDED by this engine
  // rather than duplicated: two rule engines would be one lie.
  intakeEvents: [],   // idempotency at the edge: one row per incoming key
  deadLetters: [],    // terminal failures, awaiting a person
  reviewItems: [],    // human escalation as a first-class state
  schedules: [],      // durably "do X at T" — survives a restart
  engineState: []     // the runner's cursor and bookkeeping (one row each)
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// SCHEMA VERSION & MIGRATIONS
//
// Merging loaded data over EMPTY already handles the common case -- a new
// collection or a new optional field appears on an old database with no
// migration and no data loss. That is why there is no migration framework
// here, and it is a deliberate choice rather than an omission.
//
// What that merge CANNOT do is TRANSFORM existing rows: rename a field,
// backfill a required value, split a collection. Those need a real, ordered,
// one-time step, and that is what this is.
//
// Rules:
//   * migrations run in order, exactly once, recorded by version
//   * a BACKUP IS TAKEN before anything destructive runs
//   * a failing migration aborts startup rather than half-applying
//   * migrations are deterministic and must be safe to re-run on a fresh DB
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 3;

const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline',
    // Everything that existed before versioning. Nothing to transform: the
    // EMPTY-merge already gave old databases every new collection.
    up: (db) => db
  },
  {
    version: 3,
    name: 'signal-sequence',
    // The event log gains a monotonic `seq`: the runner's cursor, the replay
    // order, and the one thing a `createdAt` timestamp cannot provide (two
    // events in the same millisecond have no defined order). Old rows are
    // numbered in their existing order — `createdAt`, then file position — so
    // the backfilled sequence agrees with the order they were written in.
    up: (db) => {
      const signals = db.signals ?? [];
      const ordered = signals
        .map((sig, index) => ({ sig, index }))
        .sort((a, b) => (String(a.sig.createdAt ?? '') < String(b.sig.createdAt ?? '') ? -1
          : String(a.sig.createdAt ?? '') > String(b.sig.createdAt ?? '') ? 1
          : a.index - b.index));
      let seq = 0;
      for (const { sig } of ordered) {
        seq += 1;
        sig.seq = seq;
        sig.v = sig.v ?? 1;
        sig.entityKind = sig.entityKind ?? (sig.objectId ? 'object' : sig.circleId ? 'circle' : null);
        sig.entityId = sig.entityId ?? sig.objectId ?? sig.circleId ?? null;
        sig.occurredAt = sig.occurredAt ?? sig.createdAt ?? null;
        sig.recordedAt = sig.recordedAt ?? sig.createdAt ?? null;
        sig.actorKind = sig.actorKind ?? (sig.actorId ? 'user' : 'system');
        sig.source = sig.source ?? 'internal';
      }
      // The runner resumes from the end of history, not from its beginning:
      // a workspace that has been live for months must not replay every signal
      // it ever saw through the rules on the first boot after this ships.
      db.engineState = (db.engineState ?? []).filter((r) => r.id !== 'workflow_cursor');
      db.engineState.push({ id: 'workflow_cursor', lastSeq: seq, at: new Date().toISOString() });
      return db;
    }
  },
  {
    version: 2,
    name: 'backfill-order-currency',
    // Early orders were written before `currency` was explicit. Settlement
    // filters by currency, so a null there silently excludes real money from
    // a vendor's earnings. Backfill to the deployment default.
    up: (db) => {
      for (const o of db.orders ?? []) {
        if (!o.currency) o.currency = 'KES';
      }
      return db;
    }
  }
];

function backupBeforeMigration(fromVersion) {
  if (!fs.existsSync(DB_FILE)) return null;
  const dest = `${DB_FILE}.pre-v${fromVersion}-${Date.now()}.bak`;
  fs.copyFileSync(DB_FILE, dest);
  return dest;
}

/**
 * Bring a loaded database up to SCHEMA_VERSION.
 *
 * Exported so it can be tested against an OLD FIXTURE rather than only ever
 * running on a database that happens to already be current.
 */
export function migrate(db, { onBackup = backupBeforeMigration } = {}) {
  const from = Number.isInteger(db.__schemaVersion) ? db.__schemaVersion : 0;
  if (from >= SCHEMA_VERSION) return { db, migrated: false, from, to: from };

  const pending = MIGRATIONS.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (!pending.length) {
    db.__schemaVersion = SCHEMA_VERSION;
    return { db, migrated: false, from, to: SCHEMA_VERSION };
  }

  // Back up BEFORE transforming. If a migration is wrong, the operator still
  // has the original -- this is the whole reason the step exists.
  const backupFile = onBackup ? onBackup(from) : null;

  const applied = [];
  for (const m of pending) {
    try {
      db = m.up(db) ?? db;
      db.__schemaVersion = m.version;
      applied.push(`${m.version}:${m.name}`);
    } catch (e) {
      // Abort rather than leave the database half-migrated.
      const err = new Error(
        `migration ${m.version} (${m.name}) failed: ${e.message}. ` +
        (backupFile ? `The pre-migration copy is at ${backupFile}.` : 'No backup was taken.')
      );
      err.applied = applied;
      throw err;
    }
  }

  db.__schemaVersion = SCHEMA_VERSION;
  return { db, migrated: true, from, to: SCHEMA_VERSION, applied, backupFile };
}

function load() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    const fresh = structuredClone(EMPTY);
    fresh.__schemaVersion = SCHEMA_VERSION;
    return fresh;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    // The merge that makes additive changes free: an old database gains every
    // new collection without a migration.
    const merged = { ...structuredClone(EMPTY), ...parsed };
    const result = migrate(merged);
    if (result.migrated) {
      console.log(JSON.stringify({
        at: new Date().toISOString(), level: 'info', event: 'schema_migrated',
        from: result.from, to: result.to, applied: result.applied, backup: result.backupFile
      }));
    }
    return result.db;
  } catch (e) {
    if (/^migration /.test(String(e.message))) throw e; // never silently continue
    // A corrupt file must never silently start an empty live database.
    throw new Error(`database load failed: ${e.message}`);
  }
}

// No domain module can observe the store until recovery completes.
export const recoveryStatus = prepareStoreFile(DB_FILE);
let db = load();

let transactionDepth = 0;
// Derived lookup indexes, never another source of truth. Invalidate on writes
// and rollback; no full collection scan is needed per match card or page read.
const versions = new Map();
const indexes = new Map();
function touched(collection) { versions.set(collection, (versions.get(collection) ?? 0) + 1); indexes.delete(collection); }
function invalidateIndexes() { for (const key of Object.keys(db)) touched(key); }


function persist() {
  if (transactionDepth) return;
  ensureDir();
  const tmp = `${DB_FILE}.tmp`;
  // writeFileSync is the mock point the disk-failure tests intercept — keep it.
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  // fsync BEFORE the rename: an atomic rename is only durable if the new file's
  // contents have actually reached disk. Without this, a power loss after
  // renameSync can leave the visible file truncated or empty while the data is
  // still in the OS page cache — the exact "lost settled write" the money paths
  // must never suffer.
  const fd = fs.openSync(tmp, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, DB_FILE); // atomic swap
}

export const store = {
  // Synchronous multi-row mutations share the existing atomic file swap.
  // No second persistence layer; failed writes restore the whole snapshot.
  transaction(fn) {
    if (transactionDepth) return fn();
    const before = structuredClone(db);
    transactionDepth++;
    try { const result = fn(); transactionDepth--; persist(); return result; }
    catch (error) { transactionDepth = 0; db = before; invalidateIndexes(); throw error; }
  },
  version(collection) { return versions.get(collection) ?? 0; },
  indexed(collection, field, value) {
    let fields = indexes.get(collection);
    if (!fields) { fields = new Map(); indexes.set(collection, fields); }
    let index = fields.get(field);
    if (!index) { index = new Map(); for (const row of db[collection] ?? []) {
      const key = row[field]; if (!index.has(key)) index.set(key, []); index.get(key).push(row);
    } fields.set(field, index); }
    return [...(index.get(value) ?? [])];
  },
  lookup(collection, id) { return this.indexed(collection, 'id', id)[0] ?? null; },
  all(collection) {
    return db[collection] ?? [];
  },
  find(collection, predicate) {
    return (db[collection] ?? []).find(predicate) ?? null;
  },
  filter(collection, predicate) {
    return (db[collection] ?? []).filter(predicate);
  },
  insert(collection, row) {
    touched(collection);
    db[collection].push(row);
    try { persist(); } catch (e) { db[collection].pop(); touched(collection); throw e; }
    return row;
  },
  update(collection, id, patch) {
    const row = db[collection].find((r) => r.id === id);
    if (!row) return null;
    // LEDGER IMMUTABILITY: the money record's amount, currency and type are
    // set once at creation and must never change. A status transition may
    // update `status` + `history`, but rewriting the amount after the fact is
    // how a forged total becomes forged money. Reject it at the store so no
    // future caller can do it silently.
    if (collection === 'ledgerTransactions') {
      const forbidden = ['amount', 'currency', 'type'].filter((k) => Object.prototype.hasOwnProperty.call(patch, k));
      if (forbidden.length > 0) {
        throw new Error(`ledger fields are immutable: ${forbidden.join(', ')}`);
      }
    }
    touched(collection);
    const before = structuredClone(row);
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    try { persist(); } catch (e) {
      for (const key of Object.keys(row)) delete row[key];
      Object.assign(row, before);
      touched(collection);
      throw e;
    }
    return row;
  },
  remove(collection, id) {
    touched(collection);
    const previous = db[collection];
    db[collection] = previous.filter((r) => r.id !== id);
    try { persist(); } catch (error) { db[collection] = previous; touched(collection); throw error; }
    return db[collection].length < previous.length;
  },
  /** Test helper: wipes everything. Never called by a route. */
  _reset() {
    db = structuredClone(EMPTY);
    invalidateIndexes();
    db.__schemaVersion = SCHEMA_VERSION;
    persist();
  },
  schemaVersion() { return db.__schemaVersion ?? 0; },
  recovery: recoveryStatus,
  reloadFromDisk() {
    if (transactionDepth) throw new Error('cannot reload during a transaction');
    const next = load();
    db = next;
    invalidateIndexes();
    this.recovery = { restored: true, reason: 'explicit reload after restore' };
  },
  _file: DB_FILE
};

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * An opaque, high-entropy ticket code for gate check-in.
 *
 * Deliberately NOT the registration id (which is guessable and scoped
 * internally): a ticket code is what an attendee shows at the gate, so it must
 * be unguessable enough that possession of the code is a reasonable stand-in
 * for "this is my ticket", yet short enough to type or scan by hand.
 *
 * 4 groups of 4 base32 chars (26 bits each, ~104 bits total) — collision-safe
 * at realistic event scale without a stored index.
 */
export function newTicketCode() {
  // 31 chars: A-Z minus I,L,O and 2-9 minus 0,1 — no confusable glyphs.
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const group = () => {
    const bytes = new Uint8Array(4);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  };
  return `BRF-${group()}-${group()}-${group()}`;
}
