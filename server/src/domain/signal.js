// ---------------------------------------------------------------------------
// SIGNAL SERVICE
//
// A Signal is an append-only record that something happened. Signals are
// emitted by real state changes elsewhere in the server -- never generated to
// make a feed look busy. An empty feed means nothing has happened yet, and
// that is the correct thing to show.
// ---------------------------------------------------------------------------

import { store, newId } from '../store.js';
// The Universal Data Router is a downstream consumer of every signal: if the
// owner has routing rules matching this signal, a signed payload is dispatched
// (webhook/Discord/Slack/WhatsApp). Imported lazily inside emitSignal to avoid
// a load-time cycle, and dispatched WITHOUT await so a dead webhook endpoint
// can never break signal emission — failures land in the delivery ledger.
import * as engineRouter from './engine/router.js';

export const SIGNAL_TYPES = [
  'source_connected',
  'item_received',
  'object_created',
  'object_viewed',
  'object_saved',
  'object_shared',
  'object_confirmed',
  'object_reported',
  'object_updated',
  'duplicate_merged',
  'circle_created',
  'block_added',
  'target_progressed',
  'campaign_created',
  'campaign_published',
  'campaign_live',
  'campaign_closed',
  'campaign_cancelled',
  'campaign_completed',
  // A withdrawal promised money back and the ledger did not give it yet. This
  // is the one signal an operator is expected to watch: it names the campaign,
  // the transaction and the amount still owed, so an unpaid refund is a row on
  // a queue rather than a silence. See domain/campaign.js -> withdrawCampaign.
  'campaign_refund_owed',
  'campaign_viewed',
  // A space's public page was opened. Its own type, so a space's view count
  // never mixes with object/campaign analytics that compute other things.
  'space_viewed',
  'guardian_claimed',
  'guardian_confirmed',
  'guardian_disputed',
  'guardian_revoked',
  'guardian_reviewed',
  'campaign_shared',
  'campaign_banner_created',
  // Ticket resale market (Tikiti T1): a seat is a real-world thing whose
  // ownership and availability change — every change is a signal Pulse can
  // surface, never a silent state flip.
  'ticket_listed',
  'ticket_order_opened',
  'ticket_transferred',
  'ticket_order_refunded',
  'ticket_voided',
  // Bargain tiers (Tikiti T2): a room crossing a price band is news.
  'bargain_tier_reached',
  // Contribution campaigns (Tikiti T3): updates + goal reached.
  'campaign_update_posted',
  'campaign_goal_reached',
  // Verification (Tikiti T6): a review decision changed someone's standing.
  'verification_decision',
  // Fraud (Tikiti T10): a listing was auto-flagged for review.
  'ticket_flagged',
  'campaign_registration_started',
  'campaign_registered',
  'campaign_registration_updated',
  'campaign_checkin',
  'campaign_no_show',
  'member_joined',
  // Leaving is a real state change too, and it belongs in the same evidence
  // history as joining -- otherwise a member's trail shows arrivals only.
  'member_left',
  'member_removed',
  // --- Circle operations (Batch 2) -----------------------------------------
  // Each of these is emitted by a real state change on a Block, never by a
  // UI render. They are what the Circle activity feed and a member's evidence
  // history are derived from.
  'task_assigned',
  'task_released',
  'task_completed',
  // The full lifecycle, so the activity feed cannot show "done" for work that
  // was later cancelled, and cannot hide a cancellation or a reopening at all.
  'task_cancelled',
  'task_reopened',
  'task_verified',
  'vote_cancelled',
  'coordinator_transferred',
  // --- Group Buy engine (orchestration packages) ----------------------------
  // Emitted by real contribution records and stage transitions; the Universal
  // Data Router fans these to a group's WhatsApp/Telegram/webhook endpoints.
  'group_buy_created',
  'group_buy_contribution',
  'group_buy_stage',
  'vote_cast',
  'vote_closed',
  // --- Commerce (Batch 3) --------------------------------------------------
  // Emitted by real state changes on vendors, listings and orders. An order
  // being placed is an event; a marketplace page being rendered is not.
  'vendor_created',
  'listing_published',
  'listing_paused',
  'listing_archived',
  'order_placed',
  'coop_confirmed',
  'order_stage_changed',
  // Money genuinely confirmed by a payment provider. Emitted only from the
  // webhook path after a real ledger transaction exists.
  'order_paid',
  // table. Every one of these is a real state change on a challenge, match, or
  // beta cohort signup.
  'order_fulfilled',
  'order_settled',
  'order_disputed',
  'order_cancelled',
  'sync_completed',
  'sync_failed',
  // --- Yard Engine / advertising ------------------------------------------
  'advertiser_campaign_created',
  'advertiser_campaign_submitted',
  'advertiser_campaign_funded',
  'creator_match_proposed',
  'creator_match_accepted',
  'creator_match_declined',
  'queue_reservation_released',
  'ad_asset_approved',
  'ad_asset_issued',
  'tracked_asset_clicked',
  'campaign_fulfilment_verified',
  'advertising_payout_settled',
  'payout_ready',
  'advertiser_campaign_expired',
  'waitlist_joined',
  'waitlist_offered',
  'waitlist_expired',
  'waitlist_registered',
  // --- Entity layer (Following + Circles) -----------------------------------
  // Emitted by real user acts on followable entities, never by renders.
  // entity_object_opened and source_opened carry objectId/sourceId so the
  // analytics dashboard can derive entity engagement without a second table.
  'entity_viewed',
  'entity_followed',
  'entity_unfollowed',
  'entity_object_opened',
  'source_opened',
  // --- Collections (personal collections brief) ----------------------------
  // Emitted by real user acts on their own collections. The analytics
  // dashboard derives collection engagement from these; nothing else reads
  // them.
  'collection_created',
  'collection_opened',
  'collection_shared',
  'collection_item_removed',
  // --- Notifications (in-app return loop) -----------------------------------
  // The four tracked acts from the notifications brief: a notification was
  // generated, opened, marked read, or a preference changed. Emitted by the
  // domain/notifications.js service when those actions really happen.
  'notification_generated',
  'notification_opened',
  'notification_marked_read',
  'notification_pref_changed'
];

export function emitSignal({ type, circleId = null, blockId = null, sourceId = null, objectId = null, actorId = null, value = null, metadata = {} }) {
  if (!SIGNAL_TYPES.includes(type)) {
    throw new Error(`unknown signal type: ${type}`);
  }
  const signal = {
    id: newId('sig'),
    type,
    circleId,
    blockId,
    sourceId,
    objectId,
    // WHO did it. Null for system events (a sync completing has no actor).
    // This is what makes a member's evidence history derivable without a
    // second activity table -- the signal already records the event, it just
    // needs to say whose act it was.
    actorId,
    value,
    metadata,
    createdAt: new Date().toISOString()
  };
  store.insert('signals', signal);

  // Fan out to the Universal Data Router. Fire-and-forget by design: the
  // ledger records every outcome, and emitSignal's caller never waits on (or
  // learns about) a webhook endpoint being down.
  try {
    void engineRouter.dispatchForSignal(signal);
  } catch {
    // Dispatch itself failed before any delivery attempt — never let that
    // surface through signal emission.
  }
  return signal;
}

// Newest first. Resolves the human-readable source name where one exists so
// the client never has to invent a label.
export function listSignals({ circleId = null, limit = 50 } = {}) {
  let rows = store.all('signals');
  if (circleId) rows = rows.filter((s) => s.circleId === circleId);
  return rows
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit)
    .map((s) => {
      const src = s.sourceId ? store.find('sources', (x) => x.id === s.sourceId) : null;
      const circ = s.circleId ? store.find('circles', (x) => x.id === s.circleId) : null;
      return {
        ...s,
        sourceName: src?.name ?? null,
        circleName: circ?.name ?? null
      };
    });
}

// ---------------------------------------------------------------------------
// MEMBER EVIDENCE
//
// A member's history, derived from signals they actually caused. There is no
// evidence table: a signal already records that something happened and who
// did it, so a second store would be a duplicate source of truth.
//
// TRUST IS EVIDENCE, NEVER A SCORE. This function deliberately returns a list
// of things that happened -- not a percentage, rating, reliability index or
// hidden ranking. A member who has done nothing has an empty list, and that
// is the honest answer.
// ---------------------------------------------------------------------------

// Signal type -> how it reads as a line of evidence. Only acts a member
// performs themselves appear here.
const EVIDENCE_LABELS = {
  member_joined: 'Joined circle',
  task_completed: 'Completed task',
  task_assigned: 'Took on task',
  vote_cast: 'Voted',
  block_added: 'Contributed',
  campaign_checkin: 'Arrived',
  // Commerce evidence is what a seller ACTUALLY did -- orders fulfilled and
  // settled. Deliberately not a rating: "6 fulfilled orders" is a countable
  // claim the vendor could contest, "4.8 stars" is not.
  order_fulfilled: 'Fulfilled an order',
  order_settled: 'Completed a settled sale'
};

export function memberEvidence(userId, { circleId = null } = {}) {
  if (!userId) return [];
  let rows = store.filter('signals', (s) => s.actorId === userId);
  if (circleId) rows = rows.filter((s) => s.circleId === circleId);

  return rows
    .filter((s) => EVIDENCE_LABELS[s.type])
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((s) => {
      const circ = s.circleId ? store.find('circles', (c) => c.id === s.circleId) : null;
      return {
        kind: s.type,
        label: EVIDENCE_LABELS[s.type],
        circleId: s.circleId,
        circleName: circ?.name ?? null,
        blockId: s.blockId,
        // The underlying signal, so a caller can always inspect what the
        // evidence is actually made of rather than trusting the summary.
        signalId: s.id,
        at: s.createdAt
      };
    });
}

/**
 * The same evidence grouped into counts -- still facts, still no score.
 * "3 completed tasks" is a countable claim a member could contest; "trust:
 * 87%" is not.
 */
export function memberEvidenceSummary(userId, { circleId = null } = {}) {
  const items = memberEvidence(userId, { circleId });
  const counts = {};
  for (const it of items) counts[it.kind] = (counts[it.kind] ?? 0) + 1;

  const PLURAL = {
    task_completed: (n) => `${n} completed task${n === 1 ? '' : 's'}`,
    task_assigned: (n) => `${n} task${n === 1 ? '' : 's'} taken on`,
    vote_cast: (n) => `${n} vote${n === 1 ? '' : 's'} cast`,
    block_added: (n) => `${n} contribution${n === 1 ? '' : 's'}`,
    member_joined: (n) => `Joined ${n} circle${n === 1 ? '' : 's'}`,
    campaign_checkin: (n) => `Arrived ${n} time${n === 1 ? '' : 's'}`,
    order_fulfilled: (n) => `${n} fulfilled order${n === 1 ? '' : 's'}`,
    order_settled: (n) => `${n} settled sale${n === 1 ? '' : 's'}`
  };

  return Object.entries(counts).map(([kind, n]) => ({
    kind,
    count: n,
    label: PLURAL[kind] ? PLURAL[kind](n) : `${n} x ${kind}`
  }));
}
