// ---------------------------------------------------------------------------
// EVENT WITHDRAWAL — an offer can always be withdrawn; a row with a history
// cannot be deleted.
//
// This suite exists because the two acts used to be one. Deleting a published
// event removed the campaign row and its object while leaving registrations,
// tickets and ledger rows pointing at a campaign that no longer existed. What
// has to hold now:
//
//   * withdrawing is a STATE: the row stays, the people and the money it
//     touched keep their records, and the receipt says what actually happened;
//   * money moves only through the ledger's own transition, and a refund the
//     ledger refuses becomes an OWED row on an operator queue — never silence;
//   * a second withdrawal (a retried request, a double tap) changes nothing:
//     one row per campaign, no second refund;
//   * a hard delete is refused, with the reasons, while anything depends on it;
//   * editing a published offer leaves a revision, and a change to the terms
//     somebody registered for tells them.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.BRIEF_DEV_AUTH = "0";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brief-withdraw-"));
process.env.BRIEF_DATA_DIR = dir;

const { store } = await import("../src/store.js");
const auth = await import("../src/domain/auth.js");
const campaigns = await import("../src/domain/campaign.js");
const ledger = await import("../src/domain/ledger.js");
const notifications = await import("../src/domain/notifications.js");
const events = await import("../src/domain/events.js");

let count = 0;
const pass = (name) => { count++; console.log("PASS " + name); };

const host = auth.createUser({ handle: "wd_host", password: "host-pw-123" });
const buyer = auth.createUser({ handle: "wd_buyer", password: "buyer-pw-123" });
const buyer2 = auth.createUser({ handle: "wd_buyer2", password: "buyer2-pw-123" });

/** A published, paid event, ready to hold other people's decisions. */
function publishedEvent(over = {}) {
  const c = campaigns.createCampaign(host.id, {
    title: "Saturday Rooftop Session",
    type: "event",
    description: "An evening of sets and conversation",
    location: "Kilimani, Nairobi",
    startsAt: new Date(Date.now() + 5 * 86400000).toISOString(),
    price: 500,
    ...over
  });
  campaigns.transitionCampaign(c.id, "published");
  return store.find("campaigns", (x) => x.id === c.id);
}

/** A registration paid for in full, exactly as the settlement path does it. */
function payAndRegister(campaign, userId, attendeeRef) {
  const reg = campaigns.register(campaign, { attendeeRef, userId, name: attendeeRef, amount: null });
  const tx = ledger.createTransaction({
    amount: campaign.price, type: "campaign_registration", counterparty: userId,
    campaignId: campaign.id, registrationId: reg.id
  });
  ledger.transitionTransaction(tx.id, "pending", "collecting");
  ledger.transitionTransaction(tx.id, "confirmed", "provider confirmed");
  ledger.transitionTransaction(tx.id, "settled", "settled");
  campaigns.promoteRegistrationForSettledTransaction(store.find("ledgerTransactions", (t) => t.id === tx.id));
  return { registration: store.find("registrations", (r) => r.id === reg.id), transaction: tx };
}

// ---------------------------------------------------------------------------
// 1. The preview states the consequences before anything happens.
// ---------------------------------------------------------------------------
{
  const campaign = publishedEvent();
  const empty = campaigns.withdrawalPreview(campaign);
  assert.equal(empty.canWithdraw, true, "a published offer can be withdrawn");
  assert.equal(empty.canDelete, true, "and, with nothing attached yet, it can also simply be deleted");
  assert.deepEqual(empty.blockers, []);

  const paid = payAndRegister(campaign, buyer.id, "buyer@example.test");
  // A paid event HOLDS the second person's spot (status `started`) until money
  // settles, so they hold no ticket yet — the preview has to count rows, not
  // intentions, and this is the row it counts.
  const held = campaigns.register(campaign, {
    attendeeRef: "plus-one@example.test", userId: buyer2.id, name: "Plus one"
  });
  assert.equal(held.status, "started", "an unpaid spot is held, not registered");
  const preview = campaigns.withdrawalPreview(campaign);
  assert.equal(preview.registrations.total, 2, "both registrations are counted");
  assert.equal(preview.registrations.toCancel, 2, "both are seats that would be released");
  assert.equal(preview.money.refundable, 1, "one payment was actually taken");
  assert.equal(preview.money.refundableKes, 500, "and the amount owed back is the amount charged");
  assert.equal(preview.tickets.issued, 1, "only the settled seat was ever issued a ticket");
  assert.equal(preview.tickets.live, 1, "and that is the one live ticket");
  assert.equal(preview.holders.count, 2, "two people would be told");
  assert.deepEqual(preview.blockers,
    ["2 registrations", "1 issued ticket", "1 ledger row"],
    "and the blockers are named, so a refusal can say what is in the way");
  assert.equal(preview.canDelete, false, "a row holding real decisions may not be deleted");
  pass("the preview counts real rows: seats, tickets, money and the people to tell");
}

// ---------------------------------------------------------------------------
// 2. Withdrawing: the state moves, tickets die, seats release, money returns
//    through the ledger, and the holders are told.
// ---------------------------------------------------------------------------
{
  const campaign = publishedEvent({ title: "Withdrawn Session" });
  const { registration, transaction } = payAndRegister(campaign, buyer.id, "holder@example.test");
  campaigns.transitionCampaign(campaign.id, "live");
  const ticket = store.find("tickets", (t) => t.registrationId === registration.id);
  assert.equal(ticket.status, "valid");

  const result = campaigns.withdrawCampaign(campaign.id, { actorId: host.id, reason: "the venue fell through" });
  assert.equal(result.alreadyWithdrawn, false);
  assert.equal(result.campaign.status, "cancelled", "the offer is withdrawn, as a state");

  const row = store.find("campaigns", (c) => c.id === campaign.id);
  assert.ok(row, "and the campaign row is still there — withdrawn is not deleted");
  assert.equal(store.find("objects", (o) => o.id === campaign.objectId).publication, "private",
    "the wrapped object stops being public");

  assert.equal(store.find("tickets", (t) => t.id === ticket.id).status, "void",
    "the ticket stops admitting anyone to an event that is over");
  assert.equal(store.find("registrations", (r) => r.id === registration.id).status, "cancelled",
    "the seat is released");

  const refunded = store.find("ledgerTransactions", (t) => t.id === transaction.id);
  assert.equal(refunded.status, "refunded", "the money goes back through the ledger's own transition");
  assert.ok(refunded.history.some((h) => h.status === "refunded" && /withdrawn/.test(h.note)),
    "and the ledger history says why");

  const receipt = result.withdrawal.receipt;
  assert.equal(receipt.ticketsVoided, 1);
  assert.equal(receipt.registrationsCancelled, 1);
  assert.equal(receipt.refunded.length, 1);
  assert.equal(receipt.refunded[0].amount, 500);
  assert.deepEqual(receipt.owed, [], "nothing is owed when the refund completed");

  const notices = notifications.listNotifications(buyer.id, { limit: 20 }).filter((n) => n.type === "event_withdrawn");
  assert.equal(notices.length, 1, "the holder is told, once");
  assert.match(notices[0].title, /Withdrawn Session/);
  assert.match(notices[0].body, /500/, "and the notice names the amount refunded");
  assert.equal(
    notifications.listNotifications(host.id, { limit: 20 }).filter((n) => n.type === "event_withdrawn").length, 0,
    "the host is not notified about their own act");

  const obligations = campaigns.listRefundObligations({ status: "refunded" });
  assert.equal(obligations.filter((o) => o.campaignId === campaign.id).length, 1,
    "the refund is a row, so it can be audited later");
  pass("withdrawing releases seats, voids tickets, refunds through the ledger, and tells the holders");
}

// ---------------------------------------------------------------------------
// 3. Idempotent: the same request twice is one withdrawal, and one refund.
// ---------------------------------------------------------------------------
{
  const campaign = publishedEvent({ title: "Twice Tapped" });
  const { transaction } = payAndRegister(campaign, buyer.id, "twice@example.test");

  const first = campaigns.withdrawCampaign(campaign.id, { actorId: host.id, reason: "changed my mind" });
  const refundedAfterFirst = store.find("ledgerTransactions", (t) => t.id === transaction.id).history.length;

  const second = campaigns.withdrawCampaign(campaign.id, { actorId: host.id, reason: "changed my mind" });
  assert.equal(second.alreadyWithdrawn, true, "the second call reports that it was already withdrawn");
  assert.equal(second.withdrawal.id, first.withdrawal.id, "and returns the SAME receipt, not a new one");
  assert.equal(store.filter("campaignWithdrawals", (w) => w.campaignId === campaign.id).length, 1,
    "there is exactly one withdrawal row per campaign");
  assert.equal(store.find("ledgerTransactions", (t) => t.id === transaction.id).history.length, refundedAfterFirst,
    "and no money moved a second time");
  pass("withdrawal is idempotent: a repeated request cannot refund twice");
}

// ---------------------------------------------------------------------------
// 4. A refund the ledger refuses is OWED, recorded, and signalled.
// ---------------------------------------------------------------------------
{
  // A ledger row that cannot be refunded — a transaction that has gone missing
  // from the store underneath a campaign that still points at it. The refusal
  // is the branch that a silent `catch {}` would turn into a lost refund, so it
  // is exercised directly: the obligation is still written, it still carries
  // the ledger's own words, and it is still signalled.
  const campaign = publishedEvent({ title: "Refused Refund" });
  const signalCountBefore = store.filter("signals", (s) => s.type === "campaign_refund_owed").length;
  const gone = { id: "tx_that_is_not_in_the_ledger", amount: 500, currency: "KES", registrationId: null, counterparty: buyer.id };

  const outcome = campaigns.refundOrOwe(gone, { campaignId: campaign.id, actorId: host.id, why: "called off" });
  assert.equal(outcome.refunded, undefined, "nothing was refunded");
  assert.ok(outcome.owed, "the refusal is returned, not dropped");
  assert.equal(outcome.owed.amount, 500, "for the amount the campaign said was taken");

  const owedRow = store.find("refundObligations", (o) => o.campaignId === campaign.id && o.status === "owed");
  assert.ok(owedRow, "and stored as an obligation rather than swallowed");
  assert.equal(owedRow.transactionId, gone.id, "against the transaction that cannot be refunded");
  assert.match(owedRow.refusal, /not found/, "with the ledger's own words as the reason");
  assert.equal(
    store.filter("signals", (s) => s.type === "campaign_refund_owed").length, signalCountBefore + 1,
    "and one signal, so an operator queue can watch for it");

  // The same branch reached the other way round: a whole withdrawal where a
  // refundable transaction vanishes between the preview and the refund.
  const campaign2 = publishedEvent({ title: "Vanished Payment" });
  const paid2 = payAndRegister(campaign2, buyer.id, "vanished@example.test");
  const preview = campaigns.withdrawalPreview(campaign2);
  assert.equal(preview.money.refundable, 1, "the preview saw the money");
  store.remove("ledgerTransactions", paid2.transaction.id); // the row goes between look and act
  const result = campaigns.withdrawCampaign(campaign2.id, { actorId: host.id, reason: "called off" });
  assert.equal(result.withdrawal.receipt.refunded.length, 0);
  assert.equal(result.withdrawal.receipt.owed.length, 0,
    "a row that is no longer in the ledger is not refunded, and not invented either");
  assert.ok(store.find("refundObligations", (o) => o.campaignId === campaign2.id) === null,
    "nothing is owed for money the ledger has no record of taking");

  const queue = campaigns.listRefundObligations({ status: "owed" });
  assert.ok(queue.some((o) => o.id === owedRow.id), "the owed refund is on the queue");
  pass("a refund the ledger refuses is an owed row, with the refusal recorded and signalled");
}

{
  // Money the buyer already had refunded BEFORE the withdrawal is neither
  // refunded again nor turned into a new obligation: the ledger's own history
  // is the record that it was returned.
  const campaign = publishedEvent({ title: "Already Refunded" });
  const { transaction } = payAndRegister(campaign, buyer.id, "already@example.test");
  ledger.transitionTransaction(transaction.id, "refunded", "the buyer asked for their money back first");
  const before = store.find("ledgerTransactions", (t) => t.id === transaction.id).history.length;

  const result = campaigns.withdrawCampaign(campaign.id, { actorId: host.id, reason: "called off" });
  assert.equal(result.withdrawal.receipt.refunded.length, 0, "a return that already happened is not repeated");
  assert.equal(result.withdrawal.receipt.owed.length, 0, "and it is not owed again");
  assert.equal(store.find("ledgerTransactions", (t) => t.id === transaction.id).history.length, before,
    "the ledger is untouched, because nothing was left to do");
  assert.equal(store.filter("refundObligations", (o) => o.campaignId === campaign.id).length, 0,
    "and no obligation is invented for money already returned");
  pass("money refunded before the withdrawal is left alone");
}

// ---------------------------------------------------------------------------
// 5. Money that never settled is CLOSED, not "refunded".
// ---------------------------------------------------------------------------
{
  const campaign = publishedEvent({ title: "Never Paid" });
  const reg = campaigns.register(campaign, { attendeeRef: "unpaid@example.test", userId: buyer.id });
  const tx = ledger.createTransaction({
    amount: 500, type: "campaign_registration", counterparty: buyer.id,
    campaignId: campaign.id, registrationId: reg.id
  });

  const result = campaigns.withdrawCampaign(campaign.id, { actorId: host.id, reason: "call it off" });
  assert.equal(result.withdrawal.receipt.refunded.length, 0, "an unsettled attempt is not a refund");
  assert.equal(result.withdrawal.receipt.owed.length, 0, "and it is not an obligation either");
  assert.equal(result.withdrawal.receipt.attemptsClosed, 1, "it is closed, so it can never settle later");
  assert.equal(store.find("ledgerTransactions", (t) => t.id === tx.id).status, "failed");
  pass("a payment attempt that never settled is closed, not described as money returned");
}

// ---------------------------------------------------------------------------
// 6. Delete is refused while anything depends on the row; allowed when nothing does.
// ---------------------------------------------------------------------------
{
  const campaign = publishedEvent({ title: "Has History" });
  campaigns.register(campaign, { attendeeRef: "someone@example.test", userId: buyer.id });

  let refusal = null;
  try { campaigns.deleteCampaign(campaign.id); } catch (e) { refusal = e; }
  assert.ok(refusal, "deleting an offer with a registration is refused");
  assert.equal(refusal.code, "withdrawal_required", "with a code a caller can act on");
  assert.deepEqual(refusal.blockers, ["1 registration"],
    "and the reasons named — one held seat is enough; no ticket was issued for it, so none is claimed");
  assert.ok(store.find("campaigns", (c) => c.id === campaign.id), "nothing was removed");

  // Nothing depends on this one, so it can go.
  const untouched = publishedEvent({ title: "Nothing Happened" });
  const removed = campaigns.deleteCampaign(untouched.id);
  assert.equal(removed.removed, true);
  assert.equal(store.find("campaigns", (c) => c.id === untouched.id), null, "an offer with no history is simply removed");
  assert.equal(store.find("objects", (o) => o.id === untouched.objectId), null, "and takes its object with it");
  pass("delete refuses a row with a history, and allows a row without one");
}

// ---------------------------------------------------------------------------
// 7. A withdrawn offer stops appearing on the board.
// ---------------------------------------------------------------------------
{
  const campaign = publishedEvent({ title: "Was On The Board" });
  const slug = campaign.publicSlug;
  const onBoard = () => events.browseEvents({ limit: 50 }).events.some((e) => e.slug === slug);
  assert.equal(onBoard(), true, "the published event is on the board");
  campaigns.withdrawCampaign(campaign.id, { actorId: host.id, reason: "withdrawn" });
  assert.equal(onBoard(), false, "and a withdrawn event is not offered to anybody");
  assert.equal(campaigns.getPublicBySlug(slug), null, "its page stops resolving too");
  pass("withdrawal removes the offer from the board without deleting its record");
}

// ---------------------------------------------------------------------------
// 8. Editing a published offer leaves a revision; material edits tell holders.
// ---------------------------------------------------------------------------
{
  const campaign = publishedEvent({ title: "Original Title" });
  campaigns.register(campaign, { attendeeRef: "attendee@example.test", userId: buyer.id });

  campaigns.updateCampaign(campaign.id, { description: "A better blurb" }, host.id);
  let revisions = campaigns.listCampaignRevisions(campaign.id);
  assert.equal(revisions.length, 1, "an edit after publication is recorded");
  assert.deepEqual(revisions[0].fields, ["description"]);
  assert.equal(revisions[0].before.description, "An evening of sets and conversation");
  assert.equal(revisions[0].after.description, "A better blurb");
  assert.equal(revisions[0].actorId, host.id, "with who did it");
  assert.equal(
    notifications.listNotifications(buyer.id, { limit: 20 }).filter((n) => n.type === "event_changed").length, 0,
    "a description edit is not a change to the deal, so nobody is alarmed");

  const movedTo = new Date(Date.now() + 9 * 86400000).toISOString();
  campaigns.updateCampaign(campaign.id, { startsAt: movedTo, location: "Westlands, Nairobi" }, host.id);
  revisions = campaigns.listCampaignRevisions(campaign.id);
  assert.equal(revisions.length, 2);
  assert.deepEqual(revisions[0].fields.sort(), ["location", "startsAt"], "the terms that changed are named");

  const told = notifications.listNotifications(buyer.id, { limit: 20 }).filter((n) => n.type === "event_changed");
  assert.equal(told.length, 1, "moving the date and the place notifies the people holding a place");
  assert.match(told[0].body, /startsAt/);

  // Editing a DRAFT is not a published change: no revision, nobody told.
  const draft = campaigns.createCampaign(host.id, { title: "Draft", type: "event" });
  campaigns.updateCampaign(draft.id, { title: "Draft, renamed" }, host.id);
  assert.equal(campaigns.listCampaignRevisions(draft.id).length, 0,
    "a draft is nobody's business but the author's, so no revision is written");
  pass("post-publication edits are recorded, and a change to the terms notifies the people it affects");
}

// ---------------------------------------------------------------------------
// 9. The wire: a host can withdraw over HTTP, the delete is refused with a
//    code, and the preview is readable before committing.
// ---------------------------------------------------------------------------
{
  const { default: app } = await import("../src/index.js");
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (p, m = "GET", body, token) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const viewer = (await call("/api/auth/register", "POST",
      { handle: "wd_http_" + Date.now().toString(36), password: "a good passphrase" })).body;

    const created = await call("/api/campaigns", "POST", {
      title: "HTTP Withdrawal", type: "event", location: "Nairobi", price: 0,
      startsAt: new Date(Date.now() + 4 * 86400000).toISOString()
    }, viewer.token);
    assert.equal(created.status, 201, "a campaign can be created");
    const id = created.body.campaign.id;
    await call(`/api/campaigns/${id}/publish`, "POST", {}, viewer.token);

    // Somebody registers, so the offer now has a history.
    const reg = await call("/api/public/campaigns/" + created.body.campaign.publicSlug + "/register", "POST",
      { attendeeRef: "http-attendee@example.test", name: "HTTP attendee" });
    assert.ok(reg.status === 200 || reg.status === 201, `the public registration route accepts a free seat (${reg.status})`);

    const preview = await call(`/api/campaigns/${id}/withdrawal`, "GET", undefined, viewer.token);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.preview.canDelete, false, "the preview already says delete is not allowed");
    assert.equal(preview.body.withdrawal, null, "and no withdrawal has happened yet");

    const refused = await call(`/api/campaigns/${id}`, "DELETE", undefined, viewer.token);
    assert.equal(refused.status, 409, "deleting an offer with a registration is a conflict, not a success");
    assert.equal(refused.body.code, "withdrawal_required", "and the code says what to do instead");
    assert.ok(refused.body.blockers.length >= 1, "with the blockers attached");
    assert.ok(store.find("campaigns", (c) => c.id === id), "and the campaign is still there");

    const withdrawn = await call(`/api/campaigns/${id}/withdraw`, "POST", { reason: "rain" }, viewer.token);
    assert.equal(withdrawn.status, 200, "the withdrawal is accepted");
    assert.equal(withdrawn.body.campaign.status, "cancelled");
    assert.equal(withdrawn.body.withdrawal.receipt.registrationsCancelled, 1, "the seat was released");

    const again = await call(`/api/campaigns/${id}/withdraw`, "POST", { reason: "rain" }, viewer.token);
    assert.equal(again.body.alreadyWithdrawn, true, "and calling it twice is safe over HTTP too");
    assert.equal(again.body.withdrawal.id, withdrawn.body.withdrawal.id, "returning the same receipt");

    const shown = await call(`/api/campaigns/${id}/withdrawal`, "GET", undefined, viewer.token);
    assert.ok(shown.body.withdrawal, "the receipt is readable afterwards");
    assert.equal(shown.body.preview.canWithdraw, false, "and a cancelled offer cannot be withdrawn again");

    const revisions = await call(`/api/campaigns/${id}/revisions`, "GET", undefined, viewer.token);
    assert.equal(revisions.status, 200);
    assert.ok(Array.isArray(revisions.body.revisions));

    // Somebody else's campaign is not theirs to withdraw — 404, not 403: the
    // existence of another host's draft is not disclosed.
    const other = (await call("/api/auth/register", "POST",
      { handle: "wd_http2_" + Date.now().toString(36), password: "a good passphrase" })).body;
    const stranger = await call(`/api/campaigns/${id}/withdraw`, "POST", {}, other.token);
    assert.equal(stranger.status, 404, "a stranger cannot withdraw it, and is not told it exists");
    pass("the withdrawal, the refusal and the receipt are all reachable over HTTP");
  } finally {
    srv.close();
  }
}

console.log(`\nPASS ${count}`);
process.exit(0);
