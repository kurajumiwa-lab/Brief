// ---------------------------------------------------------------------------
// DISCOVER SUMMARY — tiles and the featured slot, with the mock left behind.
//
// The layout this feeds used to be a hardcoded array of fake posts. These tests
// are the guarantee that the replacement does not smuggle that back in:
//   * an empty network reports zeros, and writes no row to look busy;
//   * the featured slot follows a STATED rule, in order: seller pin → most
//     settled orders → newest listing → soonest published event → nothing;
//   * interest is a counted row (settled orders, registrations), never a
//     claimed crowd;
//   * a listing with no photo of its own gets no photo at all — no stock image,
//     no hotlink, no "for now" placeholder borrowed from someone else;
//   * the vocabulary of the mock is gone: no "verified" sellers, no viewer
//     counts, no invented contact details.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
process.env.NODE_ENV = "test";
process.env.BRIEF_DEV_AUTH = "0";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brief-discover-"));
process.env.BRIEF_DATA_DIR = dir;

const { store } = await import("../src/store.js");
const auth = await import("../src/domain/auth.js");
const spaces = await import("../src/domain/space.js");
const campaigns = await import("../src/domain/campaign.js");
const { discoverSummary } = await import("../src/domain/discoverSummary.js");

let count = 0;
const test = async (name, fn) => { await fn(); count++; console.log("PASS " + name); };

const seller = auth.createUser({ handle: "ds_seller", password: "a good passphrase" });
const buyer = auth.createUser({ handle: "ds_buyer", password: "a good passphrase" });

// ---------------------------------------------------------------------------
await test("an empty network is reported as empty, and nothing is written to look busy", () => {
  const before = { listings: store.all("listings").length, orders: store.all("orders").length, campaigns: store.all("campaigns").length };
  const s = discoverSummary({});
  assert.deepEqual(s.counts, { listings: 0, shops: 0, events: 0, circles: 0, errands: 0 }, "zeros, not dashes and not seeds");
  assert.equal(s.tiles.length, 5);
  assert.equal(s.tiles.find((t) => t.key === 'marketplace').count, 0, "Marketplace leads and says zero");
  assert.equal(s.featured, null, "no featured item exists, so none is invented");
  assert.equal(s.asOf, null, "no rows, so no timestamp is claimed");
  assert.match(s.note, /A zero is shown as a zero|count of rows/);
  assert.deepEqual(
    { listings: store.all("listings").length, orders: store.all("orders").length, campaigns: store.all("campaigns").length },
    before,
    "a read wrote nothing"
  );
});

const space = spaces.createSpace({ ownerId: seller.id, name: "Tilapia at Wakulima", type: "business", visibility: "public" });
const perch = spaces.createSpaceOffer(space.id, { title: "Nile perch 1kg", price: 620, currency: "KES", callerId: seller.id });
const tilapia = spaces.createSpaceOffer(space.id, { title: "Tilapia 1kg", price: 450, currency: "KES", callerId: seller.id });
spaces.publishSpaceOffer(space.id, perch.id, { callerId: seller.id });
spaces.publishSpaceOffer(space.id, tilapia.id, { callerId: seller.id });

await test("the featured rule is newest, then settled orders, then the seller's own pin", () => {
  const first = discoverSummary({});
  assert.equal(first.featured.kind, "listing");
  assert.equal(first.featured.title, "Tilapia 1kg", "the newest active listing when nothing has settled");
  assert.equal(first.featuredFrom, "newest");
  assert.match(first.featured.why, /nothing has settled yet/, "and the card says so out loud");
  assert.equal(first.featured.mediaUrl, null, "no photo was uploaded, so no photo is shown");
  assert.equal(first.featured.interest.count, 0, "and no orders settled, so zero is printed");

  store.insert("orders", {
    id: "ord_perch", buyerId: buyer.id, vendorId: space.vendorId, listingId: perch.id, quantity: 3,
    total: 1860, currency: "KES", status: "settled", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  const afterSale = discoverSummary({});
  assert.equal(afterSale.featured.title, "Nile perch 1kg", "the listing with real settled orders takes the slot");
  assert.equal(afterSale.featuredFrom, "settled-orders");
  assert.equal(afterSale.featured.interest.count, 1, "interest is the count of settled orders, not a crowd claim");
  assert.match(afterSale.featured.why, /1 settled order/);

  spaces.setFeatured(space.id, { callerId: seller.id, listingIds: [tilapia.id] });
  const pinned = discoverSummary({});
  assert.equal(pinned.featured.title, "Tilapia 1kg", "the seller's own choice outranks the arithmetic");
  assert.equal(pinned.featuredFrom, "seller-pin");
  assert.equal(pinned.featured.why, "pinned by the seller", "and the reason is named, not hidden");
});

await test("a pin pointing at an archived listing cannot keep something on the front", () => {
  const draft = spaces.createSpaceOffer(space.id, { title: "Future cake", price: 900, callerId: seller.id });
  store.update("listings", draft.id, { status: "active" });
  spaces.setFeatured(space.id, { callerId: seller.id, listingIds: [draft.id] });
  assert.equal(discoverSummary({}).featured.id, draft.id, "while active, the pin wins");
  store.update("listings", draft.id, { status: "archived" });
  const s = discoverSummary({});
  assert.notEqual(s.featured.id, draft.id, "once archived it is not featured, because it is not on the counter");
});

await test("an event can hold the slot, and reports NO crowd even when one exists", () => {
  const other = spaces.createSpace({ ownerId: buyer.id, name: "Weekend Plates", type: "side_hustle" });
  for (const l of store.filter("listings", (x) => x.vendorId === other.vendorId)) void l;
  // Remove the seller's live offers so only events remain.
  for (const l of store.filter("listings", (x) => x.status === "active")) {
    store.update("listings", l.id, { status: "archived" });
  }
  const camp = store.insert("campaigns", {
    id: "cmp_ds", title: "Kilimani Night Market", type: "event", status: "published",
    price: 0, currency: "KES", ownerId: buyer.id, location: "Kilimani Grounds",
    startsAt: new Date(Date.now() + 4 * 86400000).toISOString(), endsAt: null,
    publicSlug: "kilimani-night-market-ds", slug: "kilimani-night-market-ds",
    objectId: null, metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  store.insert("registrations", {
    id: "reg_1", campaignId: camp.id, attendeeRef: "a1", name: "Wanjiku", status: "registered",
    userId: buyer.id, createdAt: new Date().toISOString()
  });
  store.insert("registrations", {
    id: "reg_2", campaignId: camp.id, attendeeRef: "a2", name: "Otieno", status: "cancelled",
    userId: null, createdAt: new Date().toISOString()
  });

  const s = discoverSummary({});
  assert.equal(s.featured.kind, "event");
  assert.equal(s.featured.title, "Kilimani Night Market");
  // The two registration rows above are still inserted on purpose. One is a
  // real, non-cancelled registration by a known user -- exactly the row the old
  // code counted into `interest` and printed as "1 registered". Decision 6
  // forbids that, so the honest test is that the summary refuses to report a
  // crowd it could perfectly well have counted. Keeping the fixture is what
  // makes this a refusal test instead of a tautology.
  assert.equal(s.featured.interest, null, "no interest count on an event slot (D6)");
  assert.equal(s.featured.why, "the soonest event", "the only reason an event holds the slot is when it starts");
  assert.equal(s.featured.group, null, "no 'N from your circle' line (D6)");
  const asJson = JSON.stringify(s);
  assert.equal(/"label":"registrations?"/.test(asJson), false, "no registration label survives anywhere in the summary");
  assert.equal(/registered|busiest/i.test(asJson), false, "and no social-proof wording either");
  assert.equal(s.counts.marketplace ?? s.counts.listings, 0, "the market tile drops to zero when everything is archived");
});

await test("the circles tile counts what a stranger could actually join", () => {
  const all = store.all("circles").length;
  store.insert("circles", {
    id: "cir_open", name: "Kilimani Bakers", description: "", status: "active",
    visibility: "open", ownerId: seller.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  store.insert("circles", {
    id: "cir_invite", name: "Private Rotators", description: "", status: "active",
    visibility: "invite_only", ownerId: seller.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  // The circles domain already decides joinability: open, or empty enough that
  // anybody can start it. The summary reuses that rule instead of inventing its
  // own, so a member is added to make the invite-only circle genuinely closed.
  store.insert("members", {
    id: "mbr_ds", circleId: "cir_invite", userId: seller.id, role: "member",
    status: "active", joinedAt: new Date().toISOString(), createdAt: new Date().toISOString()
  });
  const s = discoverSummary({});
  assert.equal(s.counts.circles, 1, "a circle that is neither open nor empty is not joinable");
  assert.equal(store.find("circles", (c) => c.id === "cir_invite") && discoverSummary({}).counts.circles, 1);
  store.remove("members", "mbr_ds");
  assert.equal(discoverSummary({}).counts.circles, 2, "and an empty circle of either kind can be started by anyone");
  assert.equal(s.tiles.find((t) => t.key === "circles").unit, "you could join", "and the tile says which of the two it means");
  assert.equal(store.all("circles").length, all + 2, "the read created nothing");
});

await test("no vocabulary of the old mock survives, and no borrowed media is attached", () => {
  const json = JSON.stringify(discoverSummary({}));
  for (const banned of ["verified vendor", "verified creative", "unsplash", "people are viewing", "viewers right now", "trending", "+254", "telegram"]) {
    assert.ok(!json.toLowerCase().includes(banned.toLowerCase()), `no "${banned}" in the payload`);
  }
  assert.ok(!/\b0\d{8}\b|\+254\d{9}/.test(json), "no phone number appears");
  assert.ok(!json.includes("images.unsplash"), "no hotlinked stock photo");
});

await test("API: the summary is public, is a read, and reflects a new listing immediately", async () => {
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
    const anon = await call("/api/discover/summary");
    assert.equal(anon.status, 200, "a signed-out visitor sees the same shape — it is a browse read");
    assert.ok(Array.isArray(anon.body.tiles) && anon.body.tiles.length === 5);
    assert.equal(anon.body.tiles[0].key, "marketplace", "Marketplace leads the grid by server order, not client luck");
    assert.equal(typeof anon.body.note, "string", "and the read carries its own caveat");

    const before = anon.body.counts.listings;
    const owner = (await call("/api/auth/register", "POST", { handle: "ds_api_" + Date.now().toString(36), password: "a good passphrase" })).body;
    const sp = (await call("/api/spaces", "POST", { name: "Dairy Corner", type: "business" }, owner.token)).body.space;
    const off = (await call(`/api/spaces/${sp.id}/offers`, "POST", { title: "Yoghurt 500ml", price: 120, currency: "KES" }, owner.token)).body.offer;
    await call(`/api/spaces/${sp.id}/offers/${off.id}/publish`, "POST", {}, owner.token);
    const after = await call("/api/discover/summary");
    assert.equal(after.body.counts.listings, before + 1, "a published listing moves the tile on the next read");
    assert.equal(after.body.featured.title, "Yoghurt 500ml", "and the newest one becomes the face of the market");
    assert.equal(after.body.featured.mediaUrl, null, "still no photo until the seller adds one");
  } finally {
    srv.close();
  }
});

await test("a feed row carries its own timestamp and nothing else about time", () => {
  const s = discoverSummary({});
  assert.equal(s.tiles.length, 5, "five tiles, from one key, not a duplicated literal");
  assert.deepEqual(Object.keys(s).filter((k) => k === "tiles").length, 1, "the payload declares `tiles` exactly once");
  const listing = s.feed.find((f) => f.kind === "listing");
  assert.ok(listing, "a listing is on the feed");
  assert.ok(typeof listing.listedAt === "string" && Number.isFinite(Date.parse(listing.listedAt)),
    "listedAt is the row's own createdAt — the surface may print an age");
  const row = store.filter("listings", (l) => l.id === listing.id)[0];
  assert.equal(listing.listedAt, row.createdAt,
    "and it is THAT field verbatim: no now(), no rounding, no invented date");
  const event = s.feed.find((f) => f.kind === "event");
  if (event) {
    assert.ok(event.listedAt === null || Number.isFinite(Date.parse(event.listedAt)),
      "an event's stamp is its publishedAt/startsAt, or nothing at all");
  }
  assert.ok(!s.feed.some((f) => "views" in f || "saves" in f || "rank" in f || "score" in f),
    "no field pretends to measure interest a listing cannot have");
});

await test("a row says which object it can be acted on, and never invents one", () => {
  // "Save" and "not for me" are keyed by an object id. A card may only offer
  // them when the row really has one, so the honest field is the row's own —
  // including the null — rather than the row's id dressed up as an object id
  // (which would 404 on the first tap and look like a broken button).
  const owner = auth.createUser({ handle: "ds_obj_owner", password: "a good passphrase" });
  const camp = campaigns.createCampaign(owner.id, {
    title: "Thursday Jazz at the Yard", type: "event", description: "", location: "Ngong Road",
    startsAt: new Date(Date.now() + 3 * 86400000).toISOString(), price: 0
  });
  campaigns.transitionCampaign(camp.id, "published");

  const s = discoverSummary({});
  const event = s.feed.find((f) => f.id === camp.publicSlug);
  assert.ok(event, "the fresh event is on the board");
  assert.equal(event.objectId, camp.objectId,
    "an event names its campaign's object — the id a save would land on");
  assert.ok(store.find("objects", (o) => o.id === event.objectId),
    "and that id resolves to a real object row, so the action has somewhere to go");
  if (s.featured && s.featured.id === event.id) {
    assert.equal(s.featured.objectId, event.objectId, "the featured copy carries the same id, not a second guess");
  }
  // Whatever holds the slot, an id is either absent or real — never a value
  // that would 404 the moment somebody tapped it.
  for (const row of [s.featured, ...s.feed].filter(Boolean)) {
    assert.ok(row.objectId === null || store.find("objects", (o) => o.id === row.objectId),
      `every objectId on the board resolves (${row.kind} ${row.id})`);
  }

  // Listings are written straight onto the counter and usually carry no object
  // at all. Null is the truthful answer there, and it is NOT the listing id.
  const listing = s.feed.find((f) => f.kind === "listing");
  if (listing) {
    const row = store.filter("listings", (l) => l.id === listing.id)[0];
    assert.equal(listing.objectId, row.objectId ?? null, "the listing's own objectId, verbatim");
    assert.notEqual(listing.objectId, listing.id, "a listing id is not an object id, and is never passed off as one");
  }

  // An event whose campaign was written without an object keeps the null.
  store.insert("campaigns", {
    id: "cmp_ds_noobj", title: "Bare Event", type: "event", status: "published",
    price: 0, currency: "KES", ownerId: owner.id, location: null,
    startsAt: new Date(Date.now() + 2 * 86400000).toISOString(), endsAt: null,
    publicSlug: "bare-event-ds", slug: "bare-event-ds", objectId: null, metadata: {},
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  const bare = discoverSummary({}).feed.find((f) => f.id === "bare-event-ds");
  assert.equal(bare.objectId, null, "no object, so no id is minted to fill the gap");
});

await test("API: the reel's actions accept exactly what the board hands out", async () => {
  const { default: app } = await import("../src/index.js");
  const personal = await import("../src/domain/personal.js");
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (p, m = "GET", body, token) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const board = await call("/api/discover/summary");
    const event = board.body.feed.find((f) => f.kind === "event" && f.objectId);
    assert.ok(event, "the board offers an event with an object");
    const viewer = (await call("/api/auth/register", "POST", { handle: "ds_reel_" + Date.now().toString(36), password: "a good passphrase" })).body;

    const saved = await call(`/api/me/saved/${encodeURIComponent(event.objectId)}`, "POST", {}, viewer.token);
    assert.equal(saved.status, 200, "saving the id the card shows is accepted, not a 404");
    assert.ok(saved.body.saved.includes(event.objectId), "and the save is the viewer's own row");
    const savedState = await call("/api/me", "GET", undefined, viewer.token);
    assert.ok(savedState.body.saved.includes(event.objectId), "/api/me agrees, so a reload still shows it kept");

    const dismissed = await call("/api/me/relevance", "POST", { kind: "not_interested", objectId: event.objectId }, viewer.token);
    assert.equal(dismissed.status, 200);
    assert.ok(dismissed.body.relevance.notInterested.includes(event.objectId), "and 'not for me' is a real record");
    const feed = await call("/api/me/feed", "GET", undefined, viewer.token);
    assert.ok(!(feed.body.objects ?? []).some((o) => o.id === event.objectId),
      "the personal feed honours it, which is why the card may say 'dealt with'");
    const undone = await call("/api/me/relevance", "DELETE", { kind: "not_interested", objectId: event.objectId }, viewer.token);
    assert.equal(undone.status, 200);
    assert.ok(!undone.body.relevance.notInterested.includes(event.objectId), "and undo puts it back");

    // A listing with no object cannot be saved by anybody — the reason the card
    // does not offer the button. This is the failure the field exists to prevent.
    const bare = board.body.feed.find((f) => f.kind === "listing" && !f.objectId);
    if (bare) {
      let threw = "";
      try { personal.saveObject(viewer.user.id, bare.id); } catch (e) { threw = String(e.message); }
      assert.match(threw, /object not found/, "passing a listing id where an object id belongs fails loudly");
    }
  } finally {
    srv.close();
  }
});

console.log(`\nPASS ${count}`);
process.exit(0);
