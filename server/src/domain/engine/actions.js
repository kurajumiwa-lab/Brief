// ---------------------------------------------------------------------------
// THE ACTION REGISTRY (EVENT-ENGINE.md §7)
//
// WHAT WAS MISSING
//
// `workflow.js` could `notify`, `tag` and `blast`. Nothing could close a
// campaign, settle a work order, archive a listing or open a review — so the
// loop stopped one step short of *new event*: a rule could tell somebody that
// something needed doing, but it could never do it.
//
// WHY A REGISTRY AND NOT `eval`
//
// `when` predicates are data (a field/op/value triple, already validated).
// ACTIONS ARE NOT DATA: an action is a named function that a domain owns. The
// registry is a closed map, so a rule row cannot name code that does not exist,
// and every new capability is a deliberate export rather than a string the
// engine hopes exists.
//
// THE CONTRACT
//
//   (params, context) -> { ok, detail?, reason? }
//
// Never throw for an expected refusal: "the ledger will not release this" is a
// result, not an exception, and the run log must record it as one. A THROW is
// reserved for a genuine fault, and the runner turns it into a retry and then a
// dead letter.
//
// ACTIONS THAT MOVE MONEY ARE MARKED `money: true`. The runner records the
// frontier level on the run, so a report can answer "what did the machine do
// with money on its own?" without reading code.
// ---------------------------------------------------------------------------

import { store } from '../../store.js';
import * as notifications from '../notifications.js';
import * as person from '../person.js';
import * as outbound from '../../outbound.js';
import * as ledger from '../ledger.js';
import * as review from './review.js';
import * as schedules from './schedules.js';

/**
 * Close a campaign whose stated end has passed.
 *
 * The rule of the engine: an event that "ended" is a fact about the clock, not
 * an opinion someone holds. Before this, `hasEnded()` was only ever consulted
 * when building a feed — a campaign that finished last Tuesday still said
 * `published` in its own row, and the dashboard showed a live event that could
 * not sell a ticket.
 */
function closeExpiredCampaign(params, ctx) {
  const campaignId = params.campaignId ?? ctx.subject?.id ?? null;
  if (!campaignId) return { ok: false, reason: 'no_campaign' };
  const campaign = store.find('campaigns', (c) => c.id === campaignId);
  if (!campaign) return { ok: false, reason: 'campaign_not_found' };
  if (!['published', 'live'].includes(campaign.status)) return { ok: false, reason: `not_open (${campaign.status})` };

  // Imported lazily: campaign.js emits signals, and a static import here would
  // make the engine load the whole marketplace to run a reminder.
  return import('../campaign.js').then((campaigns) => {
    campaigns.transitionCampaign(campaignId, 'closed');
    return { ok: true, detail: { campaignId, from: campaign.status, to: 'closed' } };
  }).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));
}

/** Archive a listing that came out of its own state machine (sold out, stale). */
function archiveListing(params) {
  const listingId = params.listingId ?? null;
  if (!listingId) return { ok: false, reason: 'no_listing' };
  const listing = store.find('listings', (l) => l.id === listingId);
  if (!listing) return { ok: false, reason: 'listing_not_found' };
  if (listing.status === 'archived') return { ok: false, reason: 'already_archived' };
  return import('../listing.js').then((listingDomain) => {
    listingDomain.transitionListing(listingId, 'archived');
    return { ok: true, detail: { listingId, from: listing.status } };
  }).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));
}

/**
 * Request the release of money for a completed work order.
 *
 * This does NOT move money — it asks. The ledger's own transition does the
 * moving, and it is the ledger that refuses if the release is not allowed. That
 * separation is why an automation can be given this capability at all: the
 * worst a misconfigured rule can do here is create a request that the money
 * path then judges.
 */
function requestWorkRelease(params) {
  const workOrderId = params.workOrderId ?? null;
  if (!workOrderId) return { ok: false, reason: 'no_work_order' };
  return import('../workPayment.js').then(async (workPayment) => {
    if (typeof workPayment.requestRelease !== 'function') {
      return { ok: false, reason: 'release_request_unavailable' };
    }
    const out = await workPayment.requestRelease(workOrderId, { actorKind: 'rule', reason: params.reason ?? 'completed by rule' });
    return out?.ok === false ? { ok: false, reason: out.reason } : { ok: true, detail: out };
  }).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));
}

/**
 * Send a reminder.
 *
 * Fails closed when there is nobody to remind — it never claims a send that did
 * not happen, which is the same honesty rule the outbound seam already follows.
 */
async function remind(params, ctx) {
  const recipient = params.userId ?? ctx.signal?.actorId ?? ctx.recipient ?? null;
  const title = params.title ?? 'A reminder';
  if (!recipient) return { ok: false, reason: 'no_recipient' };
  const n = notifications.notify(recipient, {
    kind: 'reminder',
    title,
    body: params.body ?? null,
    metadata: { workflowId: ctx.workflow?.id ?? null, scheduleId: params.scheduleId ?? null, subject: ctx.subject ?? null }
  });
  return { ok: true, detail: { notificationId: n.id } };
}

const REGISTRY = {
  notify: {
    money: false,
    run: async (params, ctx) => {
      const recipient = params.userId ?? ctx.signal?.actorId ?? null;
      if (!recipient) return { ok: false, reason: 'no_recipient' };
      const n = notifications.notify(recipient, {
        kind: params.kind ?? 'workflow',
        title: params.title ?? ctx.workflow?.name ?? 'Brief',
        body: params.body ?? null,
        metadata: { workflowId: ctx.workflow?.id ?? null, signalId: ctx.signal?.id ?? null }
      });
      return { ok: true, detail: { notificationId: n.id } };
    }
  },
  tag: {
    money: false,
    run: async (params, ctx) => {
      const tag = params.tag;
      if (!tag) return { ok: false, reason: 'no_tag' };
      const actorId = ctx.signal?.actorId;
      if (!actorId) return { ok: false, reason: 'no_person' };
      const p = person.ensurePersonForUser(actorId);
      person.tagPerson(p.id, String(tag));
      return { ok: true, detail: { tag, personId: p.id } };
    }
  },
  blast: {
    money: false,
    run: async (params, ctx) => {
      if (!params.channel || !params.to) return { ok: false, reason: 'missing_channel_or_recipient' };
      const sent = await outbound.send({ channel: params.channel, to: params.to, text: params.text ?? ctx.workflow?.name ?? '' });
      return { ok: sent.ok, reason: sent.reason ?? null, detail: sent.sid ? { sid: sent.sid } : undefined };
    }
  },
  remind: { money: false, run: remind },

  close_campaign: { money: false, run: closeExpiredCampaign },
  archive_listing: { money: false, run: archiveListing },
  request_release: { money: true, run: requestWorkRelease },

  /**
   * Escalate to a person. This is the action that makes the frontier work: a
   * rule that cannot decide calls this instead of guessing, and the subject
   * lands in the one queue with a reason and a deadline.
   */
  escalate: {
    money: false,
    run: async (params, ctx) => {
      const subject = params.subject ?? ctx.subject ?? null;
      if (!subject?.kind || !subject?.id) return { ok: false, reason: 'no_subject' };
      const item = review.open({
        kind: params.kind ?? 'other',
        subject,
        reason: params.reason ?? ctx.workflow?.name ?? 'needs a person',
        openedByKind: 'rule',
        eventId: ctx.signal?.id ?? null,
        data: params.data ?? {}
      });
      return { ok: true, detail: { reviewId: item.id, deadlineAt: item.deadlineAt } };
    }
  },

  /**
   * Queue something for later without a timer that dies with the process.
   *
   * EVERYTHING except the scheduling instructions is carried through to the
   * scheduled action. The first cut dropped them, which made the engine's own
   * 24h reminder fire and find nobody to remind — a rule that looks like it
   * works and silently does nothing, which is the exact failure this engine is
   * supposed to make impossible.
   *
   * The recipient defaults to whoever caused the event: "remind the person who
   * created this" is what a reminder almost always means.
   */
  schedule: {
    money: false,
    run: async (params, ctx) => {
      const scheduled = params.action ?? 'remind';
      const { action: _a, key, inMs, dueAt, subject, note, params: nested, ...rest } = params;
      const row = schedules.schedule({
        key: key ?? `${ctx.workflow?.id ?? 'rule'}:${ctx.signal?.id ?? ctx.subject?.id ?? 'x'}:${scheduled}`,
        action: scheduled,
        params: {
          userId: ctx.signal?.actorId ?? null,
          subject: subject ?? ctx.subject ?? null,
          ...rest,
          ...(nested ?? {})
        },
        dueAt: dueAt ?? new Date(Date.now() + (Number(inMs) || 0)).toISOString(),
        workflowId: ctx.workflow?.id ?? null,
        subject: subject ?? ctx.subject ?? null,
        eventId: ctx.signal?.id ?? null,
        note: note ?? null
      });
      return { ok: true, detail: { scheduleId: row.id, dueAt: row.dueAt } };
    }
  },

  /**
   * Release money by transitioning the ledger row. Marked `money: true` so the
   * frontier report can count what moved without a human. The ledger decides
   * whether the transition is legal; this action cannot invent one.
   */
  release_payment: {
    money: true,
    run: async (params, ctx) => {
      const transactionId = params.transactionId ?? null;
      if (!transactionId) return { ok: false, reason: 'no_transaction' };
      try {
        const tx = ledger.transitionTransaction(transactionId, 'settled', params.note ?? 'released by rule', {
          actorKind: 'rule',
          causationId: ctx.signal?.id ?? null
        });
        return { ok: true, detail: { transactionId: tx.id, status: tx.status, amount: tx.amount } };
      } catch (e) {
        // The ledger's refusal is a RESULT: the money stayed put, and the run
        // log says why in the ledger's own words.
        return { ok: false, reason: String(e?.message ?? e) };
      }
    }
  }
};

export const ACTION_TYPES = Object.keys(REGISTRY);

/** Everything a rule row is allowed to name, with its frontier metadata. */
export function catalogue() {
  return Object.entries(REGISTRY).map(([type, def]) => ({ type, money: Boolean(def.money) }));
}

export function isMoneyAction(type) {
  return Boolean(REGISTRY[type]?.money);
}

export function hasAction(type) {
  return Object.prototype.hasOwnProperty.call(REGISTRY, type);
}

/**
 * Run one action. Unknown names are refused HERE rather than silently matching
 * nothing — a rule that names an action nobody implemented is a bug, and the
 * run log should say so the first time it fires instead of never.
 */
export async function run(type, params, ctx = {}) {
  const def = REGISTRY[type];
  if (!def) return { ok: false, reason: 'unknown_action', detail: { action: type } };
  return def.run(params ?? {}, ctx);
}
