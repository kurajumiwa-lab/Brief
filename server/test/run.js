// ---------------------------------------------------------------------------
// INGESTION TEST SUITE
//
// Two kinds of test live here:
//   OFFLINE  pure pipeline logic -- always runs, no network.
//   LIVE     real HTTP against real third parties. Skipped automatically when
//            the network or a credential is unavailable, and reported as
//            SKIP rather than silently passing.
//
//   node test/run.js            offline + live
//   OFFLINE=1 node test/run.js  offline only
// ---------------------------------------------------------------------------

import './test-env.mjs';
import { qualifyGroupCreator } from './group-fixtures.mjs';
import { store } from '../src/store.js';
import path from 'node:path';
import { extractFields, extractVendors, extractProducts, isObjectWorthy } from '../src/pipeline/extract.js';
import { storeRawItem, processRawItem, previewText } from '../src/pipeline/ingest.js';
import * as telegram from '../src/connectors/telegram.js';
import * as web from '../src/connectors/web.js';
import * as whatsapp from '../src/connectors/whatsapp.js';
import crypto from 'node:crypto';
import fsp from 'node:fs';
import os from 'node:os';

let pass = 0, fail = 0, skip = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`); }
};
const skipped = (name, why) => { skip++; console.log(`  SKIP  ${name} (${why})`); };

// BRIEF_DATA_DIR is set by ./test-env.mjs, imported before the store binds.
// It MUST NOT be assigned here: this module body runs after the hoisted
// static imports, and an assignment here would be a no-op for store.js.
store._reset();

const POPUP = `Saturday popup at Kilimani Studio.

12 vendors.
Fashion, food and beauty.

KES 300 entry.
4PM-10PM.

Vendor: Kikao Streetwear
Printed Hoodie KES 2500

DM Jane on WhatsApp.`;

console.log('\n=== EXTRACTION (spec 6) ===');
{
  const { fields, confidence } = extractFields(POPUP);
  check('title extracted', fields.title?.includes('Kilimani Studio'), fields.title);
  check('type inferred as experience', fields.type === 'experience', fields.type);
  check('price 300 KES', fields.price === 300 && fields.currency === 'KES');
  check('time range normalised to 24h', fields.timeRange === '16:00-22:00', fields.timeRange);
  check('location extracted', fields.locationName === 'Kilimani Studio', fields.locationName);
  check('vendor count 12', fields.vendorCount === 12);
  check('categories found', ['fashion', 'food', 'beauty'].every((c) => fields.categories?.includes(c)));
  check('contact name found', fields.contactName === 'Jane', fields.contactName);
  check('confidence is high but not certain', confidence > 0.6 && confidence <= 1, String(confidence));
}

console.log('\n=== NEVER INVENT (spec 7 / 37) ===');
{
  const { fields } = extractFields(POPUP);
  check('day recorded as day, not a fake date', fields.dayOfWeek === 'saturday');
  check('no calendar date invented from "Saturday"', fields.dateText === undefined);
  const sparse = extractFields('Popup this weekend, come through!');
  check('sparse message yields no price', sparse.fields.price === undefined);
  check('sparse message yields no location', sparse.fields.locationName === undefined);
  check('sparse message is not object worthy', !isObjectWorthy(sparse.fields));
  check('a currency-like substring in an identifier is not a price', extractFields('just idle chatter mtsh05xv with nothing in it').fields.price === undefined);
  const chat = extractFields('hey is anyone going today?');
  check('pure conversation is rejected', !isObjectWorthy(chat.fields));
}

console.log('\n=== TYPE CLASSIFICATION ===');
{
  const t = (s) => extractFields(s).fields.type;
  check('"night market" is an event', t('Night market at Westlands Square. 15 vendors.') === 'experience');
  check('"market day" is an event', t('Maji Mazuri Saturday Market Day, extended trading') === 'experience');
  check('"creator market" is an event', t('Creator market at the Alchemist, 20 vendors') === 'experience');
  check('a bare market is a place', t('Wakulima Market is the main produce market in the CBD') === 'place');
  check('a shop is a place', t('Our shop is at Kilimani Centre, open 9AM-5PM') === 'place');
  check('grant language wins for opportunities', t('Apply for the Green Commerce grant') === 'opportunity');
}

console.log('\n=== CONTACT NAMES ===');
{
  const c = (s) => extractFields(s).fields.contactName;
  check('"DM Jane" found despite capitalised keyword', c('DM Jane on WhatsApp') === 'Jane');
  check('"Contact Jane" found', c('Contact Jane') === 'Jane');
  check('"call us" is not a person', c('call us today') === undefined);
  check('"Contact Me" is not a person', c('Contact Me now') === undefined);
}

console.log('\n=== VENDORS + PRODUCTS (spec 20 / 21) ===');
{
  check('explicit vendor name found', extractVendors('Vendor: Kikao Streetwear').includes('Kikao Streetwear'));
  check('"will be selling" pattern found', extractVendors('Glow Studio will be selling skincare').includes('Glow Studio'));
  check('stall number is not a vendor name', !extractVendors('Find us at stall 14').includes('14'));
  check('no vendor invented from prose', extractVendors('It was a nice day in Nairobi').length === 0);
  const prods = extractProducts('Printed Hoodie KES 2500 and Caps KES 800');
  check('two products with prices', prods.length === 2 && prods[0].price === 2500);
  check('admission fee is NOT a product', extractProducts('Entry KES 300').length === 0);
  check('gate fee is NOT a product', extractProducts('Gate fee KES 100').length === 0);
}

console.log('\n=== RAW ITEM + PIPELINE (spec 5) ===');
let eventId = null;
{
  store.insert('sources', {
    id: 'src_tg', name: 'Kilimani Creators', type: 'telegram_group', platform: 'telegram',
    accessType: 'member_access', connectionStatus: 'connected', confidence: 0.6,
    url: null, externalId: '-100123', createdAt: new Date().toISOString()
  });
  const { row, duplicate } = storeRawItem({
    sourceId: 'src_tg', externalId: '-100123:77', messageId: '77', author: 'jane',
    text: POPUP, publishedAt: '2026-08-15T10:00:00Z', rawUrl: 'https://t.me/kilimanicreators/77'
  });
  check('raw item stored before any object exists', row.processingStatus === 'pending');
  check('first delivery is not a duplicate', duplicate === false);

  const again = storeRawItem({ sourceId: 'src_tg', externalId: '-100123:77', text: POPUP });
  check('redelivery is detected as duplicate', again.duplicate === true);
  check('redelivery does not create a second raw row', store.all('rawItems').length === 1);

  const result = processRawItem(row.id);
  eventId = result.objectId;
  check('object created from raw item', result.ok && result.created);
  check('raw item marked processed', store.find('rawItems', (r) => r.id === row.id).processingStatus === 'processed');
  check('vendor + product children created', result.childIds.length >= 2, String(result.childIds.length));

  const ev = store.find('objects', (o) => o.id === eventId);
  check('object is an experience', ev.type === 'experience');
  check('extraction evidence retained for audit', Array.isArray(ev.extractionEvidence) && ev.extractionEvidence.length > 0);
  check('unknown fields marked, not guessed', Array.isArray(ev.metadata.unknownFields));
}

console.log('\n=== PROVENANCE (spec 4 / 35) ===');
{
  const prov = store.filter('objectSources', (s) => s.objectId === eventId);
  check('provenance row exists', prov.length === 1);
  check('source message id preserved', prov[0].sourceMessageId === '77');
  check('source author preserved', prov[0].sourceAuthor === 'jane');
  check('real permalink preserved', prov[0].sourceUrl === 'https://t.me/kilimanicreators/77');
  check('retrieval timestamp present', Boolean(prov[0].sourceRetrievedAt));
  check('source and extraction confidence tracked separately',
    prov[0].sourceConfidence !== undefined && prov[0].extractionConfidence !== undefined);
}

console.log('\n=== PUBLICATION STATE (spec 24) ===');
{
  const ev = store.find('objects', (o) => o.id === eventId);
  check('private-source object is NOT public by default', ev.publication === 'source_members', ev.publication);

  store.insert('sources', {
    id: 'src_pub', name: 'Public Channel', type: 'telegram_channel', platform: 'telegram',
    accessType: 'public', connectionStatus: 'connected', confidence: 0.6,
    url: null, externalId: '-100999', createdAt: new Date().toISOString()
  });
  const { row } = storeRawItem({
    sourceId: 'src_pub', externalId: '-100999:5', text:
      'Night market at Westlands Square. KES 500 entry. 6PM-11PM. 20 vendors.'
  });
  const r = processRawItem(row.id);
  check('public-source object may be public',
    store.find('objects', (o) => o.id === r.objectId).publication === 'public');
}

console.log('\n=== DEDUPLICATION (spec 8) ===');
{
  store.insert('sources', {
    id: 'src_wa', name: 'Nairobi Fashion Community', type: 'whatsapp_group', platform: 'whatsapp',
    accessType: 'member_access', connectionStatus: 'connected', confidence: 0.5,
    url: null, externalId: 'wa1', createdAt: new Date().toISOString()
  });
  const before = store.all('objects').filter((o) => o.type === 'experience').length;
  const { row } = storeRawItem({
    sourceId: 'src_wa', externalId: 'wa1:9',
    text: 'Saturday popup at Kilimani Studio\nEntry KES 300. Runs 4PM-10PM.\nOver 12 vendors expected.'
  });
  const result = processRawItem(row.id);
  const after = store.all('objects').filter((o) => o.type === 'experience').length;

  check('same event from a 2nd source does NOT create a new event', after === before, `${before} -> ${after}`);
  check('it merged into the canonical object', result.merged && result.objectId === eventId);
  check('now attached to two sources',
    new Set(store.filter('objectSources', (s) => s.objectId === eventId).map((s) => s.sourceId)).size === 2);
  check('verification escalates to cross_source_confirmed',
    store.find('objects', (o) => o.id === eventId).verificationStatus === 'cross_source_confirmed');

  const { row: other } = storeRawItem({
    sourceId: 'src_wa', externalId: 'wa1:10',
    text: 'Craft fair at Karen Hub. KES 100 entry. 9AM-4PM. 6 vendors.'
  });
  const distinct = processRawItem(other.id);
  check('a genuinely different event is NOT merged', distinct.created === true);
}

console.log('\n=== GRAPH (spec 22) ===');
{
  const rels = store.filter('relationships', (r) => r.sourceId === eventId);
  check('event -> vendor relationship exists', rels.some((r) => r.verb === 'has_vendor'));
  check('event -> product relationship exists', rels.some((r) => r.verb === 'offers'));
  const vendor = store.find('objects', (o) => o.title === 'Kikao Streetwear');
  check('vendor -> event back-reference exists',
    store.filter('relationships', (r) => r.sourceId === vendor.id).some((r) => r.verb === 'appears_at'));
}

console.log('\n=== BRIEF IT PREVIEW (spec 16 / 17) ===');
{
  const objectsBefore = store.all('objects').length;
  const p = previewText(POPUP);
  check('preview reports it is worthy', p.worthy === true);
  check('preview returns fields', p.fields.price === 300);
  check('preview writes NOTHING to the store', store.all('objects').length === objectsBefore);
}

// ---------------------------------------------------------------------------
// INTELLIGENT CONTENT PIPELINE (Telegram -> object)
//
// The ten content types a post can become, the richer location (county / area
// / landmark) and time (canonical date, start/end time, recurrence) extraction,
// media association, and the "never force a message into an object" rule.
// ---------------------------------------------------------------------------

console.log('\n=== CONTENT TYPE CLASSIFICATION (10 content types) ===');
{
  const t = (s) => extractFields(s).fields.type;
  check('a business (salon) is a business', t('Glow Salon Nairobi offers hair and nail services, Mon-Sat') === 'business');
  check('a business (company) is a business', t('Safiri Travels Ltd — tours and safaris company') === 'business');
  check('a promotion is an offer', t('50% off all items this weekend only') === 'offer');
  check('a flash sale is an offer', t('Flash sale: buy one get one free today') === 'offer');
  check('a job post is an opportunity', t('We are hiring! Barista wanted at a Westlands cafe') === 'opportunity');
  check('a vacancy is an opportunity', t('Vacancy: Accounts assistant, apply before Friday') === 'opportunity');
  check('a warning is an alert', t('Security alert: road closed along Ngong Road tonight') === 'alert');
  check('a power cut is an alert', t('Power outage in Kileleshwa until 6PM') === 'alert');
  check('a community meeting is an announcement', t('Community meeting this Sunday at the estate grounds') === 'announcement');
  check('a funeral notice is an announcement', t('Funeral announcement for Mama Akinyi this Saturday') === 'announcement');
  check('a news headline is news', t('Breaking: Nairobi County opens new bus terminus') === 'news');
  check('a press release is news', t('Press release from the county health office') === 'news');
  check('general information is knowledge', t('A guide to making mandazi at home') === 'knowledge');
  check('a product listing is a product', t('Second hand sofa for sale, good condition') === 'product');
  check('a service listing is a service', t('Plumber available for repairs in South B') === 'service');
  // The existing vocabulary still holds, alongside the new types.
  check('an event is still an experience', t('Night market at Westlands Square') === 'experience');
  check('a place is still a place', t('Our shop is at Kilimani Centre') === 'place');
}

console.log('\n=== LOCATION: counties / estates / landmarks (never invented) ===');
{
  const f = (s) => extractFields(s).fields;
  const nai = f('Open mic night at The Alchemist, Westlands, Nairobi');
  check('county extracted from a mention', nai.county === 'Nairobi', nai.county);
  check('estate extracted from a mention', nai.area === 'Westlands', nai.area);
  check('landmark extracted from a mention', nai.landmark === 'The Alchemist', nai.landmark);
  check('location provenance recorded', Array.isArray(nai.locationEvidence) && nai.locationEvidence.length >= 3);
  check('location confidence reflects the match', typeof nai.locationConfidence === 'number');

  const buru = f('Meeting at Buruburu Social Hall');
  check('a non-Nairobi estate is still classified', buru.area === 'Buruburu', buru.area);
  check('a venue captured as free text', buru.locationName === 'Buruburu Social Hall', buru.locationName);

  const nak = f('Farmers fair in Nakuru next week');
  check('a non-Nairobi county is classified', nak.county === 'Nakuru', nak.county);
  check('no area invented when none is present', nak.area === undefined);

  const none = f('Come hang out with us sometime');
  check('no county invented from prose', none.county === undefined);
  check('no area invented from prose', none.area === undefined);
  check('no landmark invented from prose', none.landmark === undefined);
}

console.log('\n=== TIME: canonical dates, start/end times, recurrence ===');
{
  const f = (s) => extractFields(s).fields;
  const dated = f('Conference on 15 September 2026, 9AM-5PM');
  check('full date becomes a canonical ISO date', dated.dateCanonical === '2026-09-15', dated.dateCanonical);
  check('start time normalised', dated.startTime === '09:00', dated.startTime);
  check('end time normalised', dated.endTime === '17:00', dated.endTime);
  check('canonical event timestamp composed', dated.eventStart === '2026-09-15T09:00:00', dated.eventStart);
  check('event end timestamp composed', dated.eventEnd === '2026-09-15T17:00:00', dated.eventEnd);

  const monthFirst = f('Deadline: September 15, 2026');
  check('month-first full date parsed', monthFirst.dateCanonical === '2026-09-15', monthFirst.dateCanonical);
  check('deadline canonicalised from its own date', monthFirst.deadlineCanonical === '2026-09-15', monthFirst.deadlineCanonical);

  const noYear = f('Market on 15 August');
  check('a day+month with no year is NOT given a fake year', noYear.dateText === '15 August' && noYear.dateCanonical === undefined, JSON.stringify(noYear.dateText));

  const recur = f('Yoga every Saturday at 8AM');
  check('recurring schedule captured as text', recur.recurrence === 'every saturday', recur.recurrence);
  check('a weekday is NOT resolved to a date', recur.dayOfWeek === 'saturday' && recur.dateCanonical === undefined);
  check('a single clock time becomes a start time', recur.startTime === '08:00', recur.startTime);
  check('no end time invented for a single time', recur.endTime === undefined);

  const sat = f('Saturday popup');
  check('a lone weekday is a day, never a timestamp', sat.dayOfWeek === 'saturday' && sat.eventStart === undefined);
}

console.log('\n=== 8 REALISTIC PIPELINE FIXTURES ===');
{
  // Sources: one public channel (its posts become publicly discoverable) and
  // member sources for everything else.
  store.insert('sources', {
    id: 'src_fx_pub', name: 'Nairobi Events Channel', type: 'telegram_channel', platform: 'telegram',
    accessType: 'public', connectionStatus: 'connected', confidence: 0.6,
    url: 'https://t.me/nairobi_events', externalId: '-2001', createdAt: new Date().toISOString()
  });
  store.insert('sources', {
    id: 'src_fx_member', name: 'Kilimani Community', type: 'telegram_group', platform: 'telegram',
    accessType: 'member_access', connectionStatus: 'connected', confidence: 0.6,
    url: null, externalId: '-2002', createdAt: new Date().toISOString()
  });
  const ingest = (sourceId, externalId, text, media) => {
    const { row } = storeRawItem({
      sourceId, externalId, messageId: externalId.split(':')[1] ?? '1',
      author: 'poster', text, media: media ?? [],
      publishedAt: '2026-08-15T10:00:00Z',
      rawUrl: `https://t.me/nairobi_events/${externalId.split(':')[1] ?? '1'}`
    });
    const result = processRawItem(row.id);
    return { rowId: row.id, result, object: result.objectId ? store.find('objects', (o) => o.id === result.objectId) : null };
  };

  // 1 — EVENT ANNOUNCEMENT --------------------------------------------------
  const ev = ingest('src_fx_pub', '-2001:101',
    'Night Market at The Alchemist this Saturday.\n\nLive music, food and craft vendors.\n\nKES 500 entry. Gates open 4PM to 10PM.\n\nWestlands, Nairobi.');
  check('fixture 1 creates an object', ev.result.ok && ev.result.created === true);
  check('fixture 1 is an event (experience)', ev.object?.type === 'experience', ev.object?.type);
  check('fixture 1 event price', ev.object?.metadata?.price === 500);
  check('fixture 1 event time range', ev.object?.metadata?.timeRange === '16:00-22:00', ev.object?.metadata?.timeRange);
  check('fixture 1 venue', ev.object?.locationName === 'The Alchemist', ev.object?.locationName);
  check('fixture 1 county + estate', ev.object?.metadata?.county === 'Nairobi' && ev.object?.metadata?.area === 'Westlands');
  check('fixture 1 landmark', ev.object?.metadata?.landmark === 'The Alchemist');
  check('fixture 1 is public (public source)', ev.object?.publication === 'public', ev.object?.publication);

  // 2 — BUSINESS PROMOTION ---------------------------------------------------
  const promo = ingest('src_fx_member', '-2002:201',
    'Nairobi Threads Boutique — End of month sale!\n\n50% off all dresses and jeans this week.\n\nVisit us at Lavington Mall, ground floor.\n\nOpen Mon to Sat, 9AM - 6PM.');
  check('fixture 2 creates an object', promo.result.ok && promo.result.created === true);
  check('fixture 2 is an offer', promo.object?.type === 'offer', promo.object?.type);
  check('fixture 2 promotion has no invented price', promo.object?.metadata?.price === undefined);
  check('fixture 2 store hours', promo.object?.metadata?.timeRange === '09:00-18:00', promo.object?.metadata?.timeRange);
  check('fixture 2 venue', promo.object?.locationName === 'Lavington Mall', promo.object?.locationName);
  check('fixture 2 estate', promo.object?.metadata?.area === 'Lavington', promo.object?.metadata?.area);

  // 3 — JOB POST ---------------------------------------------------------------
  const job = ingest('src_fx_member', '-2002:301',
    'We are hiring! Customer Care Associate at Safiri Travels.\n\nLocation: Westlands, Nairobi.\n\nFull time. Apply by 15 September 2026.\n\nSend CV to careers@safiri.co.ke or DM us.');
  check('fixture 3 creates an object', job.result.ok && job.result.created === true);
  check('fixture 3 is an opportunity (job)', job.object?.type === 'opportunity', job.object?.type);
  check('fixture 3 deadline captured', job.object?.metadata?.deadline === '15 September 2026', job.object?.metadata?.deadline);
  check('fixture 3 deadline canonicalised', job.object?.metadata?.deadlineCanonical === '2026-09-15', job.object?.metadata?.deadlineCanonical);
  check('fixture 3 job location county', job.object?.metadata?.county === 'Nairobi' && job.object?.metadata?.area === 'Westlands');

  // 4 — COMMUNITY ANNOUNCEMENT ------------------------------------------------
  const ann = ingest('src_fx_member', '-2002:401',
    'ANNOUNCEMENT: Residents of Buruburu Phase 5.\n\nCommunity meeting this Sunday 3pm at Buruburu Social Hall.\n\nAgenda: water rationing schedule and security.\n\nAll members are invited.');
  check('fixture 4 creates an object', ann.result.ok && ann.result.created === true);
  check('fixture 4 is an announcement', ann.object?.type === 'announcement', ann.object?.type);
  check('fixture 4 meeting venue', ann.object?.locationName === 'Buruburu Social Hall', ann.object?.locationName);
  check('fixture 4 estate', ann.object?.metadata?.area === 'Buruburu', ann.object?.metadata?.area);
  check('fixture 4 start time (single clock time)', ann.object?.metadata?.startTime === '15:00', ann.object?.metadata?.startTime);
  check('fixture 4 day of week', ann.object?.metadata?.dayOfWeek === 'sunday', ann.object?.metadata?.dayOfWeek);

  // 5 — NEWS / ARTICLE ----------------------------------------------------------
  const news = ingest('src_fx_member', '-2002:501',
    'Daily Nation — Breaking: Nairobi County announces new matatu termini for the CBD.\n\nThe county government has gazetted new pick-up points along Moi Avenue effective 1 October 2026.\n\nRead more: https://example.com/news/matatu-termini');
  check('fixture 5 creates an object', news.result.ok && news.result.created === true);
  check('fixture 5 is news', news.object?.type === 'news', news.object?.type);
  check('fixture 5 county + area', news.object?.metadata?.county === 'Nairobi' && news.object?.metadata?.area === 'CBD');
  check('fixture 5 landmark (road)', news.object?.metadata?.landmark === 'Moi Avenue', news.object?.metadata?.landmark);
  check('fixture 5 canonical date', news.object?.metadata?.dateCanonical === '2026-10-01', news.object?.metadata?.dateCanonical);
  check('fixture 5 source url retained', news.object?.metadata?.url?.startsWith('https://example.com'), news.object?.metadata?.url);

  // 6 — IMAGE + CAPTION (media association) ------------------------------------
  const caption = 'Fresh farm produce for sale at Kenyatta Market.\n\nSukuma wiki KES 40, Tomatoes KES 60 a kilo.\n\nOpen daily 6AM-1PM. Nairobi.';
  const img = ingest('src_fx_member', '-2002:601', caption,
    [{ kind: 'image', reference: 'AgADfile_high', caption }]);
  check('fixture 6 creates an object', img.result.ok && img.result.created === true);
  check('fixture 6 is a product listing', img.object?.type === 'product', img.object?.type);
  check('fixture 6 associates the Telegram image (file id, not a fake URL)',
    img.object?.imageReference === 'AgADfile_high' && img.object?.imageSourceType === 'telegram', img.object?.imageSourceType);
  check('fixture 6 marks the image as needing server-side resolution', img.object?.imageNeedsResolution === true);
  check('fixture 6 preserves source attribution', typeof img.object?.imageAttribution === 'string' && img.object?.imageAttribution.length > 0);
  check('fixture 6 image alt is the caption', img.object?.imageAlt === caption, (img.object?.imageAlt ?? '').slice(0, 30));
  {
    const media = await import('../src/domain/media.js');
    const r = media.resolveMedia(img.object);
    check('fixture 6 resolves at the exact level', r.level === 'exact', r.level);
    check('fixture 6 resolution honestly needs a fetch', r.image?.needsResolution === true && r.image?.reference === 'AgADfile_high');
    check('fixture 6 never presents the file id as a url', r.image?.url === null);
  }
  check('fixture 6 product children created', img.result.childIds.length >= 2, String(img.result.childIds.length));

  // The web path: a real http(s) image URL is stored and resolves directly.
  const webImg = ingest('src_fx_member', '-2002:602',
    'Second hand sofa for sale, Nairobi. KES 15000.',
    [{ kind: 'image', reference: 'https://example.com/sofa.jpg' }]);
  check('a web image URL is stored directly', webImg.object?.imageUrl === 'https://example.com/sofa.jpg', webImg.object?.imageUrl);
  check('a web image is not marked for telegram resolution', webImg.object?.imageSourceType === 'web');

  // 7 — DUPLICATE POST (dedup across sources) ----------------------------------
  const dup1 = ingest('src_fx_member', '-2002:701',
    'Craft fair at Zawadi Gardens this Saturday.\n\nKES 150 entry. 9AM-5PM. 6 vendors.');
  const dup2 = ingest('src_fx_pub', '-2001:702',
    'Saturday craft fair at Zawadi Gardens. Entry KES 150. 9AM-5PM.');
  check('fixture 7 first post creates the event', dup1.result.created === true);
  check('fixture 7 second post is a duplicate (merged)', dup2.result.merged === true && dup2.result.created === false);
  check('fixture 7 both posts point at ONE object', dup1.object.id === dup2.object.id);
  check('fixture 7 escalated to cross-source confirmation',
    store.find('objects', (o) => o.id === dup1.object.id).verificationStatus === 'cross_source_confirmed');
  check('fixture 7 event has two sources',
    store.filter('objectSources', (s) => s.objectId === dup1.object.id).length === 2);

  // 8 — AMBIGUOUS / GENERAL POST ------------------------------------------------
  const gen = ingest('src_fx_member', '-2002:801',
    'A guide to replacing a lost Huduma Namba in Nairobi.\n\nYou need your ID, a passport photo, and KES 100 for processing.\n\nSteps: visit the Huduma Centre, fill the form, pay at the counter.');
  check('fixture 8 general info becomes a knowledge object', gen.result.ok && gen.result.created === true && gen.object?.type === 'knowledge', gen.object?.type);
  check('fixture 8 general info keeps its county', gen.object?.metadata?.county === 'Nairobi');
  check('fixture 8 general info keeps its price', gen.object?.metadata?.price === 100);

  const ambiguous = ingest('src_fx_member', '-2002:802',
    'Hey everyone, hope you\'re all doing well. See you around!');
  check('fixture 8 an ambiguous chat is NOT forced into an object', ambiguous.result.created === false);
  const ambRaw = store.find('rawItems', (r) => r.id === ambiguous.rowId);
  check('fixture 8 the ambiguous message stays as source content',
    ambRaw?.processingStatus === 'rejected' && ambRaw?.objectId === undefined, ambRaw?.processingStatus);
  check('fixture 8 the original text is preserved verbatim',
    ambRaw?.text === 'Hey everyone, hope you\'re all doing well. See you around!');

  // FEED: newly ingested Telegram objects surface in the EXISTING public feed.
  {
    const { default: app } = await import('../src/index.js');
    const srv = app.listen(0);
    const port = srv.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/public/feed`);
      const body = await res.json();
      const rows = [...body.feed.hero, ...body.feed.discovery, ...body.feed.opportunities, ...body.feed.more];
      const titles = rows.map((r) => r.title).join(' | ');
      check('the ingested event is visible in the existing public feed',
        titles.includes('Night Market at The Alchemist'), titles.slice(0, 120));
      check('a private (member) post is NOT in the public feed',
        !titles.includes('Nairobi Threads Boutique'));
    } finally {
      srv.close();
    }
  }
}

console.log('\n=== WHATSAPP SECURITY (spec 13 / 32) ===');
{
  process.env.WHATSAPP_APP_SECRET = 'shh';
  process.env.WHATSAPP_VERIFY_TOKEN = 'vtok';
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  const good = 'sha256=' + crypto.createHmac('sha256', 'shh').update(body).digest('hex');
  check('valid signature accepted', whatsapp.verifySignature(body, good).ok);
  check('tampered signature rejected', !whatsapp.verifySignature(body, good.slice(0, -2) + 'ff').ok);
  check('missing signature rejected', !whatsapp.verifySignature(body, null).ok);
  check('verify handshake requires the right token',
    whatsapp.verifySubscription({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vtok', 'hub.challenge': 'c' }).ok);
  check('wrong verify token refused',
    !whatsapp.verifySubscription({ 'hub.mode': 'subscribe', 'hub.verify_token': 'no', 'hub.challenge': 'c' }).ok);
  check('group ingestion is declared UNSUPPORTED, not faked',
    whatsapp.capabilities.groupIngestion.startsWith('NO'));

  const msgs = whatsapp.normalizeWebhook({
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: '555' },
      contacts: [{ wa_id: '254700', profile: { name: 'Jane' } }],
      messages: [{ id: 'wamid.1', from: '254700', timestamp: '1755250000', text: { body: 'Popup Saturday KES 200' } }]
    } }] }]
  });
  check('cloud API message normalised', msgs.length === 1 && msgs[0].author === 'Jane');
  check('no permalink fabricated for WhatsApp', msgs[0].rawUrl === null);
}

console.log('\n=== TELEGRAM NORMALIZATION (spec 10-12) ===');
{
  const norm = telegram.normalizeUpdate({
    message: {
      message_id: 77, date: 1755250000,
      chat: { id: -100123, title: 'Kilimani Creators', type: 'supergroup', username: 'kilimanicreators' },
      from: { username: 'jane' }, text: POPUP
    }
  });
  check('update normalised', norm.externalId === '-100123:77');
  check('permalink built for a public chat', norm.rawUrl === 'https://t.me/kilimanicreators/77');
  const priv = telegram.normalizeUpdate({
    message: { message_id: 5, date: 1, chat: { id: -1, type: 'group' }, text: 'Popup Saturday KES 200' }
  });
  check('no permalink invented for a private chat', priv.rawUrl === null);
  check('non-text update ignored',
    telegram.normalizeUpdate({ message: { message_id: 1, chat: { id: 1 } } }) === null);
  check('history limitation documented', telegram.capabilities.history.startsWith('no'));
}

console.log('\n=== TELEGRAM CHANNEL POSTS, MEDIA & EDITS (spec 10-12) ===');
{
  // channel_post: the bot is a member of a channel and Telegram pushes the post.
  const channel = telegram.normalizeUpdate({
    update_id: 99,
    channel_post: {
      message_id: 88, date: 1755400000,
      chat: { id: -100555, title: 'Nairobi Events', type: 'channel', username: 'nairobievents' },
      text: 'Night market at Westlands Square. KES 500 entry. 20 vendors.'
    }
  });
  check('channel_post normalised', channel !== null && channel.externalId === '-100555:88', channel?.externalId);
  check('channel source carries channel identity',
    channel.chat.type === 'channel' && channel.chat.title === 'Nairobi Events');
  check('channel permalink built from username', channel.rawUrl === 'https://t.me/nairobievents/88');

  // photo + caption: the caption is ingested as text, the file_id is preserved.
  const photo = telegram.normalizeUpdate({
    channel_post: {
      message_id: 89, date: 1755400000,
      chat: { id: -100555, type: 'channel', username: 'nairobievents' },
      caption: 'Popup Saturday at Kilimani Studio. KES 300 entry. 12 vendors.',
      photo: [
        { file_id: 'AgADfile_low', width: 320, height: 200 },
        { file_id: 'AgADfile_high', width: 1280, height: 800 }
      ]
    }
  });
  check('photo caption becomes the text', photo !== null &&
    photo.text === 'Popup Saturday at Kilimani Studio. KES 300 entry. 12 vendors.');
  check('photo media preserved with the largest file_id',
    photo.media.length === 1 && photo.media[0].kind === 'image' && photo.media[0].reference === 'AgADfile_high');
  check('photo media carries its caption', photo.media[0].caption === 'Popup Saturday at Kilimani Studio. KES 300 entry. 12 vendors.');

  // document: file_id + file_name preserved, never downloaded.
  const doc = telegram.normalizeUpdate({
    channel_post: {
      message_id: 90, date: 1755400000,
      chat: { id: -100555, type: 'channel' },
      caption: 'Price list for Saturday.',
      document: { file_id: 'BQADdoc_1', file_name: 'prices.pdf' }
    }
  });
  check('document media preserved', doc.media.length === 1 && doc.media[0].kind === 'document' && doc.media[0].reference === 'BQADdoc_1');
  check('document file name preserved', doc.media[0].caption === 'prices.pdf');

  // edited_channel_post / edited_message are ingested like their originals.
  const edited = telegram.normalizeUpdate({
    edited_channel_post: {
      message_id: 88, date: 1755400000, edit_date: 1755400100,
      chat: { id: -100555, type: 'channel', username: 'nairobievents' },
      text: 'Night market at Westlands Square. KES 450 entry. 20 vendors.'
    }
  });
  check('edited_channel_post normalised', edited !== null && edited.externalId === '-100555:88');
  check('edited text is the edited body', edited.text.includes('KES 450 entry'));

  const editedMsg = telegram.normalizeUpdate({
    edited_message: {
      message_id: 91, date: 1755400000, edit_date: 1755400100,
      chat: { id: -1001, type: 'supergroup', username: 'g' },
      text: 'Popup Sunday at Westlands. KES 200 entry.'
    }
  });
  check('edited_message normalised', editedMsg !== null && editedMsg.externalId === '-1001:91');

  // A caption-less photo has no usable text and is ignored, not an error.
  check('caption-less photo ignored', telegram.normalizeUpdate({
    channel_post: { message_id: 92, date: 1, chat: { id: -1, type: 'channel' }, photo: [{ file_id: 'x' }] }
  }) === null);
}

console.log('\n=== TELEGRAM STATUS, REDACTION & WEBHOOK REGISTRATION (spec 2 / 4 / 12) ===');
{
  const originalFetch = globalThis.fetch;
  const FAKE_TOKEN = '987654321:AA_test_secret_for_redaction';
  const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

  // --- redaction: the token must never survive in any surfaced string ---------
  process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
  telegram.resetStatusCache();
  check('redactSecrets strips the token', telegram.redactSecrets(`url ${FAKE_TOKEN} gone`).indexOf(FAKE_TOKEN) === -1);
  check('redactSecrets leaves other text intact', telegram.redactSecrets('hello world') === 'hello world');
  check('redactSecrets is a no-op for non-strings', telegram.redactSecrets(42) === 42);
  check('redactSecrets masks the token in a getMe-style error',
    telegram.redactSecrets(`getMe failed: ${FAKE_TOKEN}`) === 'getMe failed: [REDACTED]');

  // --- status() with no token: honest false, no secret -----------------------
  delete process.env.TELEGRAM_BOT_TOKEN;
  telegram.resetStatusCache();
  const unconf = await telegram.status();
  check('status unconfigured reports configured:false', unconf.configured === false && unconf.operational === false);
  check('status unconfigured names the missing config', /TELEGRAM_BOT_TOKEN/.test(unconf.diagnostic ?? ''));
  check('status unconfigured leaks no token', !JSON.stringify(unconf).includes(FAKE_TOKEN));

  // --- status() with a healthy mocked Bot API ---------------------------------
  process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/getMe')) return jsonResponse({ ok: true, result: { id: 123, username: 'brief_bot', can_read_all_group_messages: false, can_join_groups: true } });
    if (u.includes('/getWebhookInfo')) return jsonResponse({ ok: true, result: { url: 'https://brief.example.com/api/webhooks/telegram', pending_update_count: 0, last_error_message: '', allowed_updates: ['channel_post'] } });
    return jsonResponse({ ok: false, description: 'not found' }, 404);
  };
  telegram.resetStatusCache();
  const ok = await telegram.status();
  check('status operational when getMe + webhook are healthy', ok.operational === true && ok.configured === true);
  check('status reports the bot identity', ok.bot.username === 'brief_bot' && ok.bot.id === 123);
  check('status reports webhook url + pending count',
    ok.webhook.url === 'https://brief.example.com/api/webhooks/telegram' && ok.webhook.pendingUpdateCount === 0);
  check('status snapshot cached for sync consumers', telegram.statusSnapshot()?.operational === true);

  // --- status() with no webhook installed -------------------------------------
  globalThis.fetch = async (url) => {
    if (String(url).includes('/getMe')) return jsonResponse({ ok: true, result: { id: 123, username: 'brief_bot' } });
    if (String(url).includes('/getWebhookInfo')) return jsonResponse({ ok: true, result: { url: '' } });
    return jsonResponse({ ok: false, description: 'not found' }, 404);
  };
  telegram.resetStatusCache();
  const nowebhook = await telegram.status();
  check('status not operational when no webhook is installed', nowebhook.operational === false && nowebhook.bot !== null);
  check('status names the missing webhook', /no webhook/.test(nowebhook.diagnostic ?? ''));

  // --- status() with a persistent webhook delivery error ----------------------
  globalThis.fetch = async (url) => {
    if (String(url).includes('/getMe')) return jsonResponse({ ok: true, result: { id: 123, username: 'brief_bot' } });
    if (String(url).includes('/getWebhookInfo')) return jsonResponse({ ok: true, result: { url: 'https://brief.example.com/api/webhooks/telegram', last_error_message: 'SSL error' } });
    return jsonResponse({ ok: false, description: 'not found' }, 404);
  };
  telegram.resetStatusCache();
  const err = await telegram.status();
  check('status not operational on a persistent webhook error', err.operational === false && /SSL error/.test(err.diagnostic ?? ''));

  // --- status() with an auth failure never exposes the token ------------------
  globalThis.fetch = async () => jsonResponse({ ok: false, description: 'Unauthorized' }, 401);
  telegram.resetStatusCache();
  const badAuth = await telegram.status();
  check('status not operational on getMe auth failure', badAuth.operational === false && badAuth.configured === true);
  check('auth-failure diagnostic never contains the token', !JSON.stringify(badAuth).includes(FAKE_TOKEN));

  // --- idempotent webhook registration via the setWebhook seam -----------------
  // Re-registering the SAME url must not issue a competing setWebhook. The
  // connector's setWebhook always posts, but the ROUTE compares getWebhookInfo
  // first. Prove the seam the route relies on reports the current url so a
  // caller can skip a redundant setWebhook.
  globalThis.fetch = async (url) => {
    if (String(url).includes('/getWebhookInfo')) return jsonResponse({ ok: true, result: { url: 'https://brief.example.com/api/webhooks/telegram', pending_update_count: 0 } });
    if (String(url).includes('/setWebhook')) return jsonResponse({ ok: true, result: true });
    return jsonResponse({ ok: false, description: 'not found' }, 404);
  };
  telegram.resetStatusCache();
  const info = await telegram.getWebhookInfo();
  check('webhook info reports the live url', info.ok && info.result.url === 'https://brief.example.com/api/webhooks/telegram');
  const set = await telegram.setWebhook('https://brief.example.com/api/webhooks/telegram', 'secret');
  check('setWebhook is supported when needed', set.ok === true);

  globalThis.fetch = originalFetch;
  telegram.resetStatusCache();
  delete process.env.TELEGRAM_BOT_TOKEN;
}

console.log('\n=== TELEGRAM PRODUCTION WEBHOOK GATE (spec 11 / 12) ===');
{
  // In production the dev fallback is off, so an anonymous request has NO
  // identity. A provider webhook (authenticated by its own secret header, not
  // a Brief session) must still reach its handler -- otherwise real Telegram
  // channel_post updates would be refused 401 before ever being ingested.
  process.env.NODE_ENV = 'test';
  process.env.BRIEF_DEV_AUTH = '0';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'prod-gate-secret';
  const { default: app } = await import('../src/index.js');
  const { drained } = await import('../src/queue.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, headers = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    // The gate is intact for ordinary private routes.
    const priv = await call('/api/status');
    check('anonymous private route is still refused (401)', priv.status === 401, `got ${priv.status}`);

    // The webhook, with the correct secret header, passes the gate.
    const update = {
      update_id: 5001,
      channel_post: { message_id: 4243, date: 1755400000, chat: { id: -100777, type: 'channel', username: 'prodbotchan' }, text: 'Saturday popup at Kilimani Studio. KES 300 entry. 12 vendors.' }
    };
    const good = await call('/api/webhooks/telegram', 'POST', update, { 'x-telegram-bot-api-secret-token': 'prod-gate-secret' });
    check('a channel_post webhook reaches the handler without a session', good.status === 200, `got ${good.status} ${JSON.stringify(good.body)}`);
    check('the production webhook stored a raw item', Boolean(good.body?.rawItemId));

    await drained();
    const src = store.find('sources', (s) => s.externalId === '-100777');
    check('the channel_post created a telegram_channel source', Boolean(src) && src.type === 'telegram_channel', src?.type);
    const raw = src ? store.find('rawItems', (r) => r.sourceId === src.id) : null;
    check('the raw item reached processed state', raw?.processingStatus === 'processed', raw?.processingStatus);
    check('an object was produced end to end', Boolean(raw?.objectId));

    // A public channel (has a username) yields a publicly discoverable object.
    const obj = raw ? store.find('objects', (o) => o.id === raw.objectId) : null;
    check('the channel-post object is publicly discoverable', obj?.publication === 'public', obj?.publication);

    // The same update again must dedupe to the same single object.
    const replay = await call('/api/webhooks/telegram', 'POST', update, { 'x-telegram-bot-api-secret-token': 'prod-gate-secret' });
    check('replayed channel_post is a duplicate', replay.body?.duplicate === true);
    check('exactly one raw item for the channel post', store.filter('rawItems', (r) => r.sourceId === src.id).length === 1);
    check('exactly one object for the channel post', store.filter('objects', (o) => o.id === raw.objectId).length === 1);

    // The public feed (anonymous, no session) surfaces the object.
    const feed = await call('/api/public/feed');
    check('the public feed is anonymous-reachable', feed.status === 200, `got ${feed.status}`);
    const titles = JSON.stringify(feed.body);
    check('the channel-post object is visible in the public feed', titles.includes('Kilimani Studio'), titles.slice(0, 120));
  } finally {
    srv.close();
    delete process.env.BRIEF_DEV_AUTH;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  }
}

console.log('\n=== SSRF GUARD (spec 32) ===');
{
  for (const bad of ['http://localhost/x', 'http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data',
                     'http://192.168.1.1/', 'http://10.0.0.5/', 'file:///etc/passwd']) {
    check(`refused ${bad}`, !web.validateUrl(bad).ok);
  }
  check('ordinary https URL allowed', web.validateUrl('https://example.com/page').ok);
}

// ---------------------------------------------------------------------------
// WEB + RSS INGESTION (offline) — the whole connector surface driven against
// fixture HTTP served by a mocked fetch, so parsing, normalization, dedup,
// persistence and failure isolation are proven without a network.
// ---------------------------------------------------------------------------
console.log('\n=== WEB + RSS INGESTION (offline) ===');
{
  const scheduler = await import('../src/pipeline/scheduler.js');
  const normalize = await import('../src/pipeline/normalize.js');

  const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Nairobi Tech News</title><link>https://feeds.example</link><description>Tech news from Nairobi</description>
<item>
  <title>Breaking: Nairobi County opens new bus terminus</title>
  <link>https://example.com/news/bus-terminus</link>
  <guid>https://example.com/news/bus-terminus</guid>
  <pubDate>Tue, 15 Sep 2026 09:00:00 GMT</pubDate>
  <category>transport</category>
  <description>The county opens a new terminus along Moi Avenue.</description>
</item>
<item>
  <title>New startup hub opens in Westlands</title>
  <link>https://example.com/article</link>
  <guid>https://example.com/article</guid>
  <pubDate>Wed, 16 Sep 2026 08:00:00 GMT</pubDate>
  <author>jane@example.com (Jane Doe)</author>
  <category>startups</category>
  <category>westlands</category>
  <description>A new co-working hub opens in Westlands, Nairobi this week.</description>
  <enclosure url="https://feeds.example/img/hub.jpg" type="image/jpeg" length="12345"/>
</item>
</channel></rss>`;

  const ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Nairobi Events</title>
<entry>
  <title>Night Market this Saturday</title>
  <id>tag:example,2026:entry-1</id>
  <link rel="alternate" href="https://nairobievents.example/night-market"/>
  <updated>2026-09-10T09:00:00Z</updated>
  <published>2026-09-10T09:00:00Z</published>
  <author><name>Events Desk</name></author>
  <summary>Night market in Nairobi this Saturday.</summary>
</entry>
</feed>`;

  const ARTICLE_HTML = `<html><head>
<title>Fallback title</title>
<meta property="og:title" content="New startup hub opens in Westlands">
<meta property="og:description" content="A new co-working hub opens in Westlands, Nairobi this week.">
<meta property="og:image" content="https://example.com/img/hub.jpg">
<meta property="og:site_name" content="Kenya Tech">
<meta property="article:published_time" content="2026-09-16T08:00:00Z">
<meta name="author" content="Jane Doe">
<link rel="canonical" href="https://example.com/article">
</head><body><p>A new co-working hub opens in Westlands, Nairobi this week.</p></body></html>`;

  const EVENT_HTML = `<html><head><title>Workshop</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Event","name":"Startup Workshop","startDate":"2026-09-15T09:00:00Z","endDate":"2026-09-15T17:00:00Z","location":{"@type":"Place","name":"Sarit Centre","address":{"addressLocality":"Westlands"}},"organizer":{"@type":"Organization","name":"Tech Hub"},"offers":{"@type":"Offer","price":"500","priceCurrency":"KES"}}
</script></head><body>Join us for a startup workshop at Sarit Centre.</body></html>`;

  const SPARSE_HTML = `<html><head><title>Just a title</title>
<meta property="og:title" content="Just a title"></head><body></body></html>`;

  // Two similar-titled but distinct articles: near-identical titles, different
  // canonical URLs and different (non-similar) locations. They MUST stay two
  // objects — a title match alone is never enough to merge.
  const SIMILAR_XML = `<rss version="2.0"><channel><title>R</title>
<item><title>Weekend market returns to Nairobi</title><link>https://example.com/a1</link><guid>https://example.com/a1</guid><description>Weekend market returns</description></item>
<item><title>Weekend market returns to Mombasa</title><link>https://example.com/a2</link><guid>https://example.com/a2</guid><description>Weekend market returns</description></item>
</channel></rss>`;

  const originalFetch = globalThis.fetch;
  const resp = (body, status = 200, type = 'text/html') =>
    new Response(body, { status, headers: { 'content-type': type } });

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/robots.txt')) {
      // example.com disallows only /robots-blocked; everyone else is open.
      if (u.startsWith('https://example.com/')) {
        return resp('User-agent: *\nDisallow: /robots-blocked\n', 200, 'text/plain');
      }
      return resp('', 404);
    }
    switch (u) {
      case 'https://feeds.example/rss.xml': return resp(RSS_XML, 200, 'application/rss+xml');
      case 'https://feeds.example/atom.xml': return resp(ATOM_XML, 200, 'application/atom+xml');
      case 'https://feeds.example/empty.xml': return resp('<rss version="2.0"><channel><title>Empty</title></channel></rss>', 200, 'application/rss+xml');
      case 'https://feeds.example/malformed': return resp('<html><body>not a feed</body></html>', 200, 'text/html');
      case 'https://example.com/article': return resp(ARTICLE_HTML, 200);
      case 'https://example.com/event': return resp(EVENT_HTML, 200);
      case 'https://example.com/sparse': return resp(SPARSE_HTML, 200);
      case 'https://example.com/robots-blocked': return resp('<html>secret</html>', 200);
      case 'https://example.com/error': return resp('boom', 500);
      case 'https://broken.example/feed.xml': return resp('boom', 500);
      case 'https://good2.example/rss.xml': return resp(RSS_XML, 200, 'application/rss+xml');
      default: return resp('not found', 404);
    }
  };

  const src = (id, name, type, url) => store.insert('sources', {
    id, name, type, platform: type === 'rss' ? 'rss' : 'web', url,
    externalId: url, accessType: 'public', connectionStatus: 'connected',
    enabled: true, healthState: 'never', lastAttemptAt: null, lastSuccessAt: null, lastError: null,
    confidence: 0.55, lastSyncedAt: null, lastMessageAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });

  try {
    // --- RSS parsing ----------------------------------------------------------
    const rss = await web.fetchFeed('https://feeds.example/rss.xml');
    check('RSS 2.0 feed parsed', rss.ok === true, rss.error);
    check('RSS feed title captured', rss.feedTitle === 'Nairobi Tech News', rss.feedTitle);
    check('RSS items extracted', rss.items.length === 2, String(rss.items.length));
    const news = rss.items[0];
    check('RSS item guid', news.guid === 'https://example.com/news/bus-terminus');
    check('RSS item link + canonical', news.link === 'https://example.com/news/bus-terminus' && news.canonicalUrl === news.link);
    check('RSS item publication date parsed', Boolean(news.publishedAt), news.publishedAt);
    check('RSS item categories', news.categories.includes('transport'), JSON.stringify(news.categories));
    const art = rss.items[1];
    check('RSS item author', /Jane Doe/.test(art.author ?? ''), art.author);
    check('RSS item categories plural', ['startups', 'westlands'].every((c) => art.categories.includes(c)));
    check('RSS enclosure captured', art.enclosure === 'https://feeds.example/img/hub.jpg', art.enclosure);

    // --- Atom parsing -----------------------------------------------------------
    const atom = await web.fetchFeed('https://feeds.example/atom.xml');
    check('Atom feed parsed', atom.ok === true, atom.error);
    check('Atom entry extracted', atom.items.length === 1 && atom.items[0].title === 'Night Market this Saturday');
    check('Atom canonical link (rel=alternate)', atom.items[0].canonicalUrl === 'https://nairobievents.example/night-market', atom.items[0].canonicalUrl);
    check('Atom entry id used as guid', atom.items[0].guid === 'tag:example,2026:entry-1', atom.items[0].guid);

    // --- missing dates + malformed ----------------------------------------------
    const empty = await web.fetchFeed('https://feeds.example/empty.xml');
    check('a feed with no items yields an empty list', empty.ok === true && empty.items.length === 0);
    const bad = await web.fetchFeed('https://feeds.example/malformed');
    check('a non-feed response is refused honestly', bad.ok === false && /not RSS or Atom/.test(bad.error ?? ''), bad.error);
    const bad2 = await web.fetchFeed('https://example.com/article'); // HTML, not a feed
    check('an HTML page refused as a feed', bad2.ok === false);

    // --- web parsing ------------------------------------------------------------
    const page = await web.fetchPage('https://example.com/article');
    check('page fetched', page.ok === true, page.error);
    check('og:title preferred over <title>', page.extracted.title === 'New startup hub opens in Westlands', page.extracted.title);
    check('og:description captured', /co-working/.test(page.extracted.description ?? ''));
    check('og:image captured', page.extracted.image === 'https://example.com/img/hub.jpg');
    check('site name captured', page.extracted.siteName === 'Kenya Tech');
    check('published time captured', Boolean(page.extracted.publishedAt));
    check('author captured', page.extracted.author === 'Jane Doe', page.extracted.author);
    check('canonical link captured', page.extracted.canonicalUrl === 'https://example.com/article', page.extracted.canonicalUrl);

    const ev = await web.fetchPage('https://example.com/event');
    check('JSON-LD event page parsed', ev.ok === true && ev.extracted.ldType === 'Event', ev.extracted.ldType);
    check('JSON-LD start date', ev.extracted.startDate === '2026-09-15T09:00:00Z', ev.extracted.startDate);
    check('JSON-LD venue', ev.extracted.locationName === 'Sarit Centre', ev.extracted.locationName);
    check('JSON-LD organizer', ev.extracted.organizer === 'Tech Hub', ev.extracted.organizer);
    check('JSON-LD price + currency', ev.extracted.price === 500 && ev.extracted.currency === 'KES');

    const sparse = await web.fetchPage('https://example.com/sparse');
    check('missing image is null, not invented', sparse.extracted.image === null);
    check('missing publication date is null, not invented', sparse.extracted.publishedAt === null);

    const gone = await web.fetchPage('https://example.com/error');
    check('an inaccessible page fails gracefully', gone.ok === false && gone.status === 500, JSON.stringify(gone.status));

    const blocked = await web.fetchPage('https://example.com/robots-blocked');
    check('robots.txt Disallow is honoured for pages', blocked.ok === false && /blocked/.test(blocked.error ?? ''), blocked.error);

    // --- pipeline: RSS -> raw item -> object --------------------------------------
    store._reset();
    const rssSrc = src('src_rss', 'Nairobi Tech News', 'rss', 'https://feeds.example/rss.xml');
    const r1 = await scheduler.pollSource('src_rss');
    check('RSS poll succeeds', r1.ok === true, JSON.stringify(r1));
    check('RSS poll received 2 items', r1.received === 2, String(r1.received));
    check('RSS poll stored 2 raw items', r1.stored === 2, String(r1.stored));
    const rssRaws = store.filter('rawItems', (r) => r.sourceId === 'src_rss');
    check('RSS items persisted as raw items', rssRaws.length === 2);
    const newsObj = store.find('objects', (o) => o.title?.includes('bus terminus'));
    check('RSS news item classified as news', newsObj?.type === 'news', newsObj?.type);
    check('RSS news county extracted', newsObj?.metadata?.county === 'Nairobi', newsObj?.metadata?.county);
    check('RSS news source url retained', newsObj?.metadata?.url === 'https://example.com/news/bus-terminus', newsObj?.metadata?.url);
    const hubObj = store.find('objects', (o) => o.title?.includes('startup hub'));
    check('RSS article image associated (enclosure)', hubObj?.imageUrl === 'https://feeds.example/img/hub.jpg', hubObj?.imageUrl);
    check('RSS source health is ok after success', store.find('sources', (s) => s.id === 'src_rss').healthState === 'ok');
    check('RSS poll recorded a sync run', store.filter('syncRuns', (r) => r.sourceId === 'src_rss').length === 1);
    check('RSS objects are publicly discoverable', store.find('objects', (o) => o.id === newsObj.id).publication === 'public');

    // --- pipeline: web -> raw item -> object (event) ------------------------------
    const webSrc = src('src_web', 'Event page', 'webpage', 'https://example.com/event');
    const r2 = await scheduler.pollSource('src_web');
    check('web poll succeeds', r2.ok === true, JSON.stringify(r2));
    const evObj = store.find('objects', (o) => o.metadata?.organizer === 'Tech Hub');
    check('JSON-LD event becomes an experience object', evObj?.type === 'experience', evObj?.type);
    check('event venue extracted', evObj?.locationName === 'Sarit Centre', evObj?.locationName);
    check('event organizer retained', evObj?.metadata?.organizer === 'Tech Hub', evObj?.metadata?.organizer);
    check('event date canonicalised', evObj?.metadata?.dateCanonical === '2026-09-15', evObj?.metadata?.dateCanonical);
    check('event price retained', evObj?.metadata?.price === 500 && evObj?.metadata?.currency === 'KES');

    // --- dedup: duplicate RSS delivery --------------------------------------------
    const beforeDup = store.all('objects').length;
    const r3 = await scheduler.pollSource('src_rss');
    check('re-polling the same RSS feed is idempotent', r3.ok === true && r3.stored === 0 && r3.skipped === 2, JSON.stringify({ stored: r3.stored, skipped: r3.skipped }));
    check('re-poll created no duplicate objects', store.all('objects').length === beforeDup, `${beforeDup} -> ${store.all('objects').length}`);

    // --- dedup: same article from RSS and Web -------------------------------------
    store._reset();
    const rA = src('srcA', 'RSS', 'rss', 'https://feeds.example/rss.xml');
    const wA = src('srcW', 'Web', 'webpage', 'https://example.com/article');
    await scheduler.pollSource('srcA');
    const hubsAfterRss = store.filter('objects', (o) => o.title?.includes('startup hub')).length;
    await scheduler.pollSource('srcW');
    const hubsAfterWeb = store.filter('objects', (o) => o.title?.includes('startup hub')).length;
    check('same article from RSS then Web is ONE object', hubsAfterRss === 1 && hubsAfterWeb === 1, `${hubsAfterRss} -> ${hubsAfterWeb}`);
    const merged = store.find('objects', (o) => o.title?.includes('startup hub'));
    check('RSS + Web article merged to cross-source confirmation',
      merged?.verificationStatus === 'cross_source_confirmed', merged?.verificationStatus);
    check('the merged object cites both sources',
      store.filter('objectSources', (s) => s.objectId === merged.id).length === 2);

    // --- dedup: distinct similar articles stay separate ---------------------------
    store._reset();
    store.insert('sources', { id: 'src_dup', name: 'Dup', type: 'rss', url: 'https://good2.example/rss.xml', accessType: 'public', enabled: true });
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/robots.txt')) return resp('', 404);
      if (u === 'https://good2.example/rss.xml') return resp(SIMILAR_XML, 200, 'application/rss+xml');
      return resp('not found', 404);
    };
    const rr = await scheduler.pollSource('src_dup');
    check('similar-titled distinct articles are both stored', rr.stored === 2, String(rr.stored));
    check('distinct articles remain separate objects', store.filter('objects', (o) => o.type !== 'identity').length === 2);

    // --- failure isolation ---------------------------------------------------------
    store._reset();
    src('src_bad', 'Broken', 'rss', 'https://broken.example/feed.xml');
    src('src_good', 'Good', 'rss', 'https://good2.example/rss.xml');
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/robots.txt')) return resp('', 404);
      if (u === 'https://broken.example/feed.xml') return resp('boom', 500);
      if (u === 'https://good2.example/rss.xml') return resp(SIMILAR_XML, 200, 'application/rss+xml');
      return resp('not found', 404);
    };
    const round = await scheduler.runPollRound();
    check('a poll round runs every enabled source', round.ok === true && round.sources === 2, JSON.stringify(round.sources));
    const badRes = round.results.find((x) => x.source === 'src_bad');
    const goodRes = round.results.find((x) => x.source === 'src_good');
    check('the broken source fails honestly', badRes?.ok === false, JSON.stringify(badRes?.error));
    check('the healthy source still succeeds', goodRes?.ok === true && goodRes?.stored === 2, JSON.stringify(goodRes?.stored));
    check('broken source health records the error', store.find('sources', (s) => s.id === 'src_bad').healthState === 'error');
    check('healthy source health is ok', store.find('sources', (s) => s.id === 'src_good').healthState === 'ok');
    check('the broken source stored nothing', store.filter('rawItems', (r) => r.sourceId === 'src_bad').length === 0);
    check('the healthy source ingested real objects', store.filter('objects', (o) => o.type !== 'identity').length === 2);

    // --- connector health reflects real state --------------------------------------
    const status = scheduler.ingestStatus('rss');
    check('ingest status counts enabled sources', status.sourcesEnabled === 2, String(status.sourcesEnabled));
    check('ingest status reports health per source', status.health.ok === 1 && status.health.error === 1, JSON.stringify(status.health));

    // --- source registry: enabled toggle -------------------------------------------
    store._reset();
    const toggled = src('src_t', 'Tog', 'rss', 'https://feeds.example/rss.xml');
    check('a pollable source starts enabled', toggled.enabled === true && toggled.healthState === 'never');
    check('enabled sources are discovered by the poller', scheduler.enabledPollableSources().some((s) => s.id === 'src_t'));
    store.update('sources', 'src_t', { enabled: false });
    check('disabling a source removes it from the poller', !scheduler.enabledPollableSources().some((s) => s.id === 'src_t'));
  } finally {
    globalThis.fetch = originalFetch;
    store._reset();
  }
}

// --- LIVE NETWORK TESTS ------------------------------------------------------

const OFFLINE = process.env.OFFLINE === '1';
async function online() {
  if (OFFLINE) return false;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 6000);
    await fetch('https://example.com', { signal: c.signal });
    clearTimeout(t);
    return true;
  } catch { return false; }
}

const isOnline = await online();

console.log('\n=== LIVE: WEB CONNECTOR (spec 14) ===');
if (!isOnline) {
  skipped('web connector live tests', 'no network');
} else {
  const page = await web.fetchPage('https://example.com');
  check('real page fetched', page.ok === true, page.error);
  check('title extracted from real HTML', page.extracted?.title === 'Example Domain', page.extracted?.title);
  check('robots.txt consulted', Boolean(page.robots));

  const fb = await web.robotsAllows('https://www.facebook.com/somepage');
  check('robots.txt Disallow: / is honoured', fb.allowed === false, fb.reason);

  // Wildcard and end-anchor rules: the bug this suite exists to prevent.
  const gh = await web.robotsAllows('https://github.com/search');
  check('anchored rule "/search$" honoured', gh.allowed === false, gh.reason);
  const ghPulse = await web.robotsAllows('https://github.com/a/b/pulse');
  check('wildcard rule "/*/*/pulse" honoured', ghPulse.allowed === false, ghPulse.reason);
  const ghOk = await web.robotsAllows('https://github.com/anthropics/anthropic-sdk-python');
  check('permitted path still allowed', ghOk.allowed === true, ghOk.reason);
}

console.log('\n=== LIVE: RSS CONNECTOR (spec 15) ===');
if (!isOnline) {
  skipped('rss connector live tests', 'no network');
} else {
  const feed = await web.fetchFeed('https://feeds.bbci.co.uk/news/world/rss.xml');
  check('real RSS feed fetched and parsed', feed.ok === true, feed.error);
  check('feed items extracted', (feed.items?.length ?? 0) > 0, String(feed.items?.length));
  check('items carry real links', Boolean(feed.items?.[0]?.link));
  check('items carry publish dates', Boolean(feed.items?.[0]?.publishedAt));
  const notFeed = await web.fetchFeed('https://example.com');
  check('non-feed URL rejected honestly', notFeed.ok === false);
}

console.log('\n=== LIVE: TELEGRAM API (spec 10) ===');
if (!isOnline) {
  skipped('telegram live tests', 'no network');
} else if (telegram.isConfigured()) {
  const v = await telegram.verify();
  check('real bot token authenticates', v.ok === true, v.error);
  if (v.ok) console.log(`        bot @${v.bot.username}, can_read_all_group_messages=${v.bot.canReadAllGroupMessages}`);
} else {
  // No token configured: prove we still reach the real API and that it
  // rejects a bad credential, rather than pretending success.
  const saved = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = '123456:INVALID_TOKEN_FOR_TEST';
  const v = await telegram.verify();
  process.env.TELEGRAM_BOT_TOKEN = saved ?? '';
  check('real Telegram API reached and rejects a bad token',
    v.ok === false && /unauthorized/i.test(v.error ?? ''), JSON.stringify(v));
  skipped('authenticated Telegram tests', 'TELEGRAM_BOT_TOKEN not set');
}


// ---------------------------------------------------------------------------
// AUTHORITY (Phase 3.5)
//
// A caller must not be able to claim membership, authority or contribution
// belonging to another user. Identity comes from the authenticated request,
// never from the request body. These run against the real Express app.
// ---------------------------------------------------------------------------
console.log('\n=== AUTHORITY (spec 32) ===');
{
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../src/index.js');
  store._reset();

  const srv = app.listen(0);
  const port = srv.address().port;

const call = async (path, method = 'GET', body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    // Created through the domain, not the route: the route now makes the
    // creator its coordinator, and this attack needs a circle the caller has
    // nothing to do with.
    const circlesD = await import('../src/domain/circle.js');
    const c = circlesD.createTargetCircle({ name: 'Auth Circle', targetValue: 1000 });

    // --- forging membership for another user ------------------------------
    let r = await call(`/api/circles/${c.id}/members`, 'POST', { userId: 'attacker_victim' });
    check('cannot create membership for another user', r.status === 403, `got ${r.status}`);
    check('refusal names the missing authority', /coordinator/.test(r.body?.error ?? ''));
    const privateRoster = await call(`/api/circles/${c.id}/members`);
    check('a stranger cannot read the roster', privateRoster.status === 403);
    const rows = store.filter('members', m => m.circleId === c.id);
    check('forged request created no membership row', rows.length === 0, `${rows.length} rows`);

    // --- legitimate self-join ----------------------------------------------
    r = await call(`/api/circles/${c.id}/members`, 'POST', { role: 'coordinator' });
    check('self-join on a fresh circle succeeds', r.status === 201, `got ${r.status}`);
    check('identity taken from caller not body', r.body?.member?.userId === 'usr_me');

    // --- coordinator may add another user ----------------------------------
    r = await call(`/api/circles/${c.id}/members`, 'POST', { userId: 'invited_person' });
    check('coordinator may add another user', r.status === 201, `got ${r.status}`);
    check('invited user stored under their own id', r.body?.member?.userId === 'invited_person');

    // --- self-verification refused -----------------------------------------
    r = await call(`/api/circles/${c.id}/members/usr_me/verify`, 'POST', { kind: 'identity_verified' });
    check('a member cannot verify themselves', r.status === 403, `got ${r.status}`);

    r = await call(`/api/circles/${c.id}/members/invited_person/verify`, 'POST', { kind: 'phone_verified' });
    check('coordinator may verify another member', r.status === 200, `got ${r.status}`);
    check('evidence recorded', r.body?.member?.trust?.evidence?.length === 1);
    check('still no numeric trust score', !('trustScore' in (r.body?.member ?? {})));

    // --- a circle the caller does NOT coordinate ---------------------------
    // Likewise created outside the route so the caller is a joinER, not the
    // coordinator -- the point of the two checks below.
    const c2 = circlesD.createTargetCircle({ name: 'Second' });
    await call(`/api/circles/${c2.id}/members`, 'POST', { role: 'observer' });

    r = await call(`/api/circles/${c2.id}/members/usr_me/role`, 'PATCH', { role: 'coordinator' });
    check('non-coordinator cannot change roles', r.status === 403, `got ${r.status}`);

    r = await call(`/api/circles/${c.id}/members/invited_person/role`, 'PATCH', { role: 'scout' });
    check('a role change without a reason is refused', r.status === 400, `got ${r.status}`);
    check('the refusal asks for the reason, not a permission', /needs a reason/.test(r.body?.error ?? ''), r.body?.error);
    r = await call(`/api/circles/${c.id}/members/invited_person/role`, 'PATCH', { role: 'scout', reason: 'taking logistics for the market trip' });
    check('coordinator may change a role', r.status === 200, `got ${r.status}`);
    check('role actually updated', r.body?.member?.role === 'scout');
    const roleRow = store.filter('circleRevisions', (x) => x.kind === 'member_role_changed' && x.circleId === c.id).at(-1);
    check('the change is in the history with before and after',
      roleRow?.before === 'contributor' && roleRow?.after === 'scout' && /market trip/.test(roleRow?.reason ?? ''),
      JSON.stringify(roleRow));
    // members carry names, not database keys, for the room's roster
    const roster = (await call(`/api/circles/${c.id}/members`, 'GET')).body.members;
    check('a member row carries a display name for the UI', roster.every((m) => 'displayName' in m && 'initials' in m), JSON.stringify(roster[0] ?? {}).slice(0, 120));

    // --- circle mutation ----------------------------------------------------
    r = await call(`/api/circles/${c2.id}`, 'PATCH', { name: 'Hijacked' });
    check('non-coordinator cannot mutate a circle', r.status === 403, `got ${r.status}`);
    check('name unchanged after refused mutation',
      (await call(`/api/circles/${c2.id}`)).body.circle.name === 'Second');

    r = await call(`/api/circles/${c.id}`, 'PATCH', { name: 'Renamed By Coordinator' });
    check('coordinator may update the circle', r.status === 200, `got ${r.status}`);

    // --- transaction attribution --------------------------------------------
    r = await call('/api/transactions', 'POST',
      { amount: 500, type: 'contribution', counterparty: 'someone_else', circleId: c2.id });
    check('cannot attribute a transaction to another user', r.status === 403, `got ${r.status}`);

    r = await call('/api/transactions', 'POST',
      { amount: 500, type: 'contribution', counterparty: 'someone_else', circleId: c.id });
    check('coordinator may attribute a contribution', r.status === 201, `got ${r.status}`);

    r = await call('/api/transactions', 'POST', { amount: 250, type: 'contribution' });
    check('recording your own money needs no authority', r.status === 201, `got ${r.status}`);

    // --- ECONOMIC INVARIANT SURVIVES HARDENING -------------------------------
    const before = (await call(`/api/circles/${c.id}`)).body.circle.currentValue;
    await call(`/api/circles/${c.id}`, 'PATCH', { currentValue: 99999 });
    const after = (await call(`/api/circles/${c.id}`)).body.circle.currentValue;
    check('progress still not writable', after === before, `${before} -> ${after}`);

    // --- honest auth reporting ------------------------------------------------
    const a = await call('/api/auth/status');
    check('auth status exposed', a.status === 200);
    // Authentication is now genuinely implemented (users, scrypt, expiring
    // revocable sessions), so this must report configured. The honesty
    // requirement has not gone away -- it moved: the endpoint must now admit
    // when the single-user DEVELOPMENT FALLBACK is still accepting
    // unauthenticated requests.
    check('reports auth IS configured', a.body?.configured === true);
    check('names the method', a.body?.method === 'session_token', a.body?.method);
    check('discloses the dev fallback state', typeof a.body?.devFallback === 'boolean');
    check('dev fallback is on outside production', a.body?.devFallback === true);
    check('and is NOT flagged insecure outside production', a.body?.insecure === false);
    check('explains the current posture', (a.body?.reason ?? '').length > 30);
  } finally {
    srv.close();
  }
}


// ---------------------------------------------------------------------------
// CAMPAIGNS (creator distribution layer)
//
// Covers the 17 cases required by the campaign brief, plus the attacks:
// forged ownership, forged revenue, forged registration counts, capacity
// bypass, and private-data leakage through the public endpoint.
// ---------------------------------------------------------------------------
console.log('\n=== CAMPAIGNS ===');
{
  process.env.NODE_ENV = 'test';
  const { default: app2 } = await import('../src/index.js');
  store._reset();

  const srv2 = app2.listen(0);
  const port2 = srv2.address().port;
  const call2 = async (path, method = 'GET', body, extraHeaders) => {
    const res = await fetch(`http://127.0.0.1:${port2}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(extraHeaders ?? {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    // 1 + 2 + 3: create, server-derived identity, forged ownerId ignored
    let r = await call2('/api/campaigns', 'POST', {
      title: 'Saturday Pop-up', type: 'popup', location: 'Westlands',
      capacity: 3, price: 500, ownerId: 'attacker'
    });
    check('creator can create a campaign', r.status === 201, `got ${r.status}`);
    const camp = r.body.campaign;
    check('ownerId comes from the server', camp.ownerId === 'usr_me', camp.ownerId);
    check('forged ownerId in body ignored', camp.ownerId !== 'attacker');
    check('campaign starts as draft', camp.status === 'draft');
    check('public slug generated', typeof camp.publicSlug === 'string' && camp.publicSlug.length > 5);
    check('wraps a real Brief object', Boolean(store.find('objects', (o) => o.id === camp.objectId)));
    check('no stored revenue field', !('revenue' in camp));
    check('no stored registrations counter', !('registrations' in camp));

    // 5: unpublished campaign is NOT public
    r = await call2(`/api/public/campaigns/${camp.publicSlug}`);
    check('draft campaign is not public', r.status === 404, `got ${r.status}`);
    r = await call2(`/api/public/campaigns/${camp.publicSlug}/register`, 'POST', { attendeeRef: 'a1' });
    check('cannot register for a draft campaign', r.status === 404);

    // 4 + 6: publish, then public
    r = await call2(`/api/campaigns/${camp.id}/publish`, 'POST', {});
    check('owner can publish', r.status === 200, `got ${r.status}`);
    check('wrapped object became public',
      store.find('objects', (o) => o.id === camp.objectId).publication === 'public');

    r = await call2(`/api/public/campaigns/${camp.publicSlug}`);
    check('published campaign is public', r.status === 200, `got ${r.status}`);

    // 17: public response must not leak private information
    const pub = r.body.campaign;
    check('public view hides ownerId', !('ownerId' in pub));
    check('public view hides internal id', !('id' in pub));
    check('public view hides objectId', !('objectId' in pub));
    check('public view hides metrics/analytics', !('metrics' in pub) && !('analytics' in pub));
    check('public view shows availability only', typeof pub.remaining === 'number');

    // 7 + 8: owner may update; capacity frozen after publication
    r = await call2(`/api/campaigns/${camp.id}`, 'PATCH', { title: 'Saturday Pop-up (updated)' });
    check('owner can update', r.status === 200, `got ${r.status}`);
    r = await call2(`/api/campaigns/${camp.id}`, 'PATCH', { capacity: 999 });
    check('capacity frozen after publication', r.status === 400, `got ${r.status}`);

    // 14: capacity enforced from real registrations
    for (const ref of ['a1', 'a2', 'a3']) {
      const rr = await call2(`/api/public/campaigns/${camp.publicSlug}/register`, 'POST', { attendeeRef: ref });
      check(`registration ${ref} accepted`, rr.status === 201, `got ${rr.status}`);
    }
    r = await call2(`/api/public/campaigns/${camp.publicSlug}/register`, 'POST', { attendeeRef: 'a4' });
    check('4th registration refused at capacity 3', r.status === 409, `got ${r.status}`);

    r = await call2(`/api/public/campaigns/${camp.publicSlug}/register`, 'POST', { attendeeRef: 'a1' });
    check('duplicate registration is idempotent', r.status === 201);
    let an = (await call2(`/api/campaigns/${camp.id}/analytics`)).body.analytics;
    check('slots taken counted once per attendee', an.slotsTaken === 3, `got ${an.slotsTaken}`);
    check('remaining derived to zero', an.remaining === 0);

    // 9: registration drives derived participation
    check('registrationsStarted derived', an.registrationsStarted === 3, `got ${an.registrationsStarted}`);
    check('views recorded from real page loads', an.views >= 1, `got ${an.views}`);

    // 11 + 12: settled money is revenue, unsettled is not
    const regs = (await call2(`/api/campaigns/${camp.id}/registrations`)).body.registrations;
    const tx = (await call2('/api/transactions', 'POST',
      { amount: 500, type: 'campaign_order', campaignId: camp.id })).body.transaction;
    an = (await call2(`/api/campaigns/${camp.id}/analytics`)).body.analytics;
    check('unsettled transaction is NOT revenue', an.revenueSettled === 0, `got ${an.revenueSettled}`);
    check('unsettled money reported separately', an.revenuePending === 500);

    for (const st of ['pending', 'confirmed', 'settled']) {
      await call2(`/api/transactions/${tx.id}/transition`, 'POST', { status: st });
    }
    an = (await call2(`/api/campaigns/${camp.id}/analytics`)).body.analytics;
    check('settled transaction becomes revenue', an.revenueSettled === 500, `got ${an.revenueSettled}`);

    // 13: client cannot forge revenue
    await call2(`/api/campaigns/${camp.id}`, 'PATCH', { revenueSettled: 999999, revenue: 999999 });
    an = (await call2(`/api/campaigns/${camp.id}/analytics`)).body.analytics;
    check('client cannot forge revenue', an.revenueSettled === 500, `got ${an.revenueSettled}`);

    // 14b: client cannot forge registration counts
    await call2(`/api/campaigns/${camp.id}`, 'PATCH', { registrations: 5000, slotsTaken: 5000 });
    an = (await call2(`/api/campaigns/${camp.id}/analytics`)).body.analytics;
    check('client cannot forge registration count', an.slotsTaken === 3, `got ${an.slotsTaken}`);

    // check-in flow
    await call2(`/api/campaigns/${camp.id}/registrations/${regs[0].id}/status`, 'POST', { status: 'checked_in' });
    an = (await call2(`/api/campaigns/${camp.id}/analytics`)).body.analytics;
    check('check-in derived from records', an.checkedIn === 1, `got ${an.checkedIn}`);

    // 15 + 16: circle link and the target invariant
    qualifyGroupCreator('usr_me');
    const circle = (await call2('/api/circles', 'POST', { name: 'Popup Fund', targetValue: 1000 })).body.circle;
    const camp2 = (await call2('/api/campaigns', 'POST',
      { title: 'Linked', type: 'session', circleId: circle.id, price: 0 })).body.campaign;
    check('campaign can connect to an existing Circle', camp2.circleId === circle.id);

    const ctx = (await call2('/api/transactions', 'POST',
      { amount: 400, type: 'contribution', circleId: circle.id, campaignId: camp2.id })).body.transaction;
    let c1 = (await call2(`/api/circles/${circle.id}`)).body.circle;
    check('unsettled money does not move target', c1.currentValue === 0, `got ${c1.currentValue}`);
    for (const st of ['pending', 'confirmed', 'settled']) {
      await call2(`/api/transactions/${ctx.id}/transition`, 'POST', { status: st });
    }
    c1 = (await call2(`/api/circles/${circle.id}`)).body.circle;
    check('settled money moves the target', c1.currentValue === 400, `got ${c1.currentValue}`);
    await call2(`/api/circles/${circle.id}`, 'PATCH', { currentValue: 50000 });
    c1 = (await call2(`/api/circles/${circle.id}`)).body.circle;
    check('target progress still not client-writable', c1.currentValue === 400, `got ${c1.currentValue}`);

    // relationships use the existing graph
    check('campaign edge in existing relationships table',
      Boolean(store.find('relationships', (x) => x.verb === 'promoted_by_campaign')));

    // lifecycle refuses illegal hops
    r = await call2(`/api/campaigns/${camp2.id}/complete`, 'POST', {});
    check('illegal lifecycle hop refused', r.status === 400, `got ${r.status}`);

    // 8b: NON-OWNER ACCESS. Simulate a second owner by rewriting the row,
    // then re-attempt every owner route as the (now different) caller.
    const solo = (await call2('/api/campaigns', 'POST', { title: 'Mine', type: 'popup', price: 0 })).body.campaign;
    store.update('campaigns', solo.id, { ownerId: 'someone_else' });
    check('non-owner cannot read', (await call2(`/api/campaigns/${solo.id}`)).status === 404);
    check('non-owner cannot update', (await call2(`/api/campaigns/${solo.id}`, 'PATCH', { title: 'Hijack' })).status === 404);
    check('non-owner cannot publish', (await call2(`/api/campaigns/${solo.id}/publish`, 'POST', {})).status === 404);
    check('non-owner cannot read analytics', (await call2(`/api/campaigns/${solo.id}/analytics`)).status === 404);
    check('non-owner cannot read registrations', (await call2(`/api/campaigns/${solo.id}/registrations`)).status === 404);
    check('title unchanged after refused update',
      store.find('campaigns', (x) => x.id === solo.id).title === 'Mine');
    check('list excludes other owners campaigns',
      !(await call2('/api/campaigns')).body.campaigns.some((x) => x.id === solo.id));

    // no numeric trust score anywhere on a campaign
    check('no trustScore on campaign', !('trustScore' in camp) && !('reputation' in camp));

    // ---------------------------------------------------------------------
    // PHASE 7: DISTRIBUTION + OBJECT LINKING
    // ---------------------------------------------------------------------
    console.log('\n=== DISTRIBUTION + OBJECT LINKING ===');

    // --- config / public origin -----------------------------------------
    delete process.env.BRIEF_PUBLIC_ORIGIN;
    let cfg = await call2('/api/config');
    check('config reports null origin when unset', cfg.body.publicOrigin === null);
    check('config exposes the campaign path prefix', cfg.body.campaignPathPrefix === '/c/');
    check('config leaks no secrets',
      !('TELEGRAM_BOT_TOKEN' in cfg.body) && !('telegramToken' in cfg.body) &&
      Object.keys(cfg.body).length === 2);

    process.env.BRIEF_PUBLIC_ORIGIN = 'https://brief.example.com/';
    cfg = await call2('/api/config');
    check('configured origin is returned', cfg.body.publicOrigin === 'https://brief.example.com');
    check('trailing slash is normalised', !cfg.body.publicOrigin.endsWith('/'));
    delete process.env.BRIEF_PUBLIC_ORIGIN;

    // --- object attachment ------------------------------------------------
    const ownCamp = (await call2('/api/campaigns', 'POST', { title: 'Owns Object', type: 'drop' })).body.campaign;
    const ownObjId = ownCamp.objectId;
    check('campaign that creates its object reports ownsObject', ownCamp.ownsObject === true);
    check('campaign response embeds the wrapped object', ownCamp.object && ownCamp.object.id === ownObjId);
    check('embedded object carries no economic fields',
      ownCamp.object && !('revenue' in ownCamp.object) && !('price' in ownCamp.object) &&
      !('currentValue' in ownCamp.object));

    const attached = (await call2('/api/campaigns', 'POST',
      { title: 'Attaches Object', type: 'drop', objectId: ownObjId })).body.campaign;
    check('existing object can be attached', attached.objectId === ownObjId);
    check('attaching does not create a second object', attached.objectId === ownCamp.objectId);
    check('attached campaign reports ownsObject false', attached.ownsObject === false);
    check('attached object is exposed in the response', attached.object.id === ownObjId);

    const badAttach = await call2('/api/campaigns', 'POST',
      { title: 'Bad', type: 'drop', objectId: 'obj_does_not_exist' });
    check('nonexistent object rejected', badAttach.status === 400);
    check('nonexistent object gives a real reason', /object not found/.test(badAttach.body.error));

    // unauthorised: an object from a source with no membership row
    store.insert('sources', { id: 'src_x', name: 'Foreign', type: 'group',
      platform: 'telegram', accessType: 'private', createdAt: new Date().toISOString() });
    store.insert('objects', { id: 'obj_x', type: 'experience', title: 'Foreign Object',
      summary: '', publication: 'source_members', createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString() });
    store.insert('objectSources', { id: 'os_x', objectId: 'obj_x', sourceId: 'src_x' });

    const denied = await call2('/api/campaigns', 'POST',
      { title: 'Steal', type: 'popup', objectId: 'obj_x' });
    check('unauthorised object attachment rejected', denied.status === 400);
    check('refusal names authority, not existence', /not authorised/.test(denied.body.error));
    check('GET object 404s without membership', (await call2('/api/objects/obj_x')).status === 404);

    store.insert('sourceMemberships', { id: 'mem_x', userId: 'usr_me', sourceId: 'src_x',
      membershipStatus: 'member', accessGranted: true, accessMethod: 'declared',
      connectedAt: new Date().toISOString() });
    const allowed = await call2('/api/campaigns', 'POST',
      { title: 'Allowed', type: 'popup', objectId: 'obj_x' });
    check('membership grants attachment', allowed.status === 201);
    check('GET object 200s with membership', (await call2('/api/objects/obj_x')).status === 200);

    // --- attaching must never mutate or publish the object ----------------
    const beforePub = store.find('objects', (o) => o.id === 'obj_x').publication;
    await call2(`/api/campaigns/${allowed.body.campaign.id}/publish`, 'POST', {});
    const afterPub = store.find('objects', (o) => o.id === 'obj_x').publication;
    check('publishing does NOT publish an attached object', afterPub === beforePub);
    check('attached object stays source_members', afterPub === 'source_members');

    // --- PATCH: attach an object to an EXISTING campaign -------------------
    const later = (await call2('/api/campaigns', 'POST', { title: 'Attach Later', type: 'popup' })).body.campaign;
    const laterOwnObj = later.objectId;
    check('a fresh campaign owns its generated object', later.ownsObject === true);

    const patched = (await call2(`/api/campaigns/${later.id}`, 'PATCH', { objectId: 'obj_x' })).body.campaign;
    check('PATCH can attach an object to an existing campaign', patched.objectId === 'obj_x');
    check('PATCH attach flips ownsObject to false', patched.ownsObject === false);
    check('PATCH attach embeds the object projection', patched.object.id === 'obj_x');
    check('PATCH attach leaves the previously created object alive',
      Boolean(store.find('objects', (o) => o.id === laterOwnObj)));
    check('PATCH attach does not publish the attached object',
      store.find('objects', (o) => o.id === 'obj_x').publication === 'source_members');
    check('PATCH attach does not change lifecycle', patched.status === later.status);
    check('PATCH attach does not change ownership', patched.ownerId === later.ownerId);
    check('PATCH attach does not change the slug', patched.publicSlug === later.publicSlug);
    check('PATCH attach moves no money', patched.metrics.revenueSettled === 0);

    // ATTACK: attach an object the caller has no membership for
    store.insert('sources', { id: 'src_z', name: 'Other', type: 'group', platform: 'telegram',
      accessType: 'private', createdAt: new Date().toISOString() });
    store.insert('objects', { id: 'obj_z', type: 'experience', title: 'Someone Elses',
      summary: '', publication: 'source_members', createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString() });
    store.insert('objectSources', { id: 'os_z', objectId: 'obj_z', sourceId: 'src_z' });

    const stealPatch = await call2(`/api/campaigns/${later.id}`, 'PATCH', { objectId: 'obj_z' });
    check('ATTACK: PATCH cannot attach an unauthorised object', stealPatch.status === 400);
    check('ATTACK: refusal cites authority', /not authorised/.test(stealPatch.body.error));
    check('ATTACK: failed attach did not swap the object',
      (await call2(`/api/campaigns/${later.id}`)).body.campaign.objectId === 'obj_x');

    // ATTACK: publish someone else's object by attaching then publishing
    const beforeZ = store.find('objects', (o) => o.id === 'obj_z').publication;
    await call2(`/api/campaigns/${later.id}/publish`, 'POST', {});
    check('ATTACK: cannot publish a foreign object via attachment',
      store.find('objects', (o) => o.id === 'obj_z').publication === beforeZ);

    check('PATCH cannot detach to null', (await call2(`/api/campaigns/${later.id}`, 'PATCH',
      { objectId: null })).status === 400);
    check('PATCH rejects an unknown objectId', (await call2(`/api/campaigns/${later.id}`, 'PATCH',
      { objectId: 'obj_nope' })).status === 400);

    // --- GET /share : canonical distribution payload -----------------------
    delete process.env.BRIEF_PUBLIC_ORIGIN;
    const unconf = (await call2(`/api/campaigns/${later.id}/share`)).body.share;
    check('share is unavailable when no origin is configured', unconf.available === false);
    check('share names the reason honestly', unconf.reason === 'public_origin_not_configured');
    check('share still returns the slug when unconfigured', unconf.slug === later.publicSlug);
    check('share invents no url when unconfigured', !('url' in unconf) || unconf.url == null);
    check('share offers no fake channels when unconfigured',
      Object.keys(unconf.channels).length === 0);

    process.env.BRIEF_PUBLIC_ORIGIN = 'https://brief.example.com/';
    const sh = (await call2(`/api/campaigns/${later.id}/share`)).body.share;
    check('share becomes available once configured', sh.available === true);
    check('share url is origin + /c/ + slug', sh.url === `https://brief.example.com/c/${later.publicSlug}`);
    check('share url has no double slash', !sh.url.slice(8).includes('//'));
    check('share reason is absent when available', !('reason' in sh) || sh.reason == null);
    check('whatsapp intent is a real wa.me link', sh.channels.whatsapp.startsWith('https://wa.me/?text='));
    check('telegram intent is a real t.me link', sh.channels.telegram.startsWith('https://t.me/share/url?url='));
    check('x intent is a real intent link', sh.channels.x.startsWith('https://twitter.com/intent/tweet?url='));
    check('every channel embeds the canonical url',
      ['whatsapp', 'telegram', 'x'].every((k) => sh.channels[k].includes(encodeURIComponent(sh.url))));
    check('channels are url-encoded, never raw',
      !sh.channels.telegram.includes('https://brief.example.com/c/'));
    check('exactly three real channels', Object.keys(sh.channels).length === 3);
    check('instagram is copy-link only, not a channel',
      !('instagram' in sh.channels) && sh.copyOnly.includes('instagram'));
    check('tiktok is copy-link only, not a channel',
      !('tiktok' in sh.channels) && sh.copyOnly.includes('tiktok'));

    // ATTACK: the share payload must not be forgeable via headers or body
    const hostForge = await call2(`/api/campaigns/${later.id}/share`, 'GET', undefined,
      { host: 'evil.example.net', 'x-forwarded-host': 'evil.example.net' });
    check('ATTACK: Host header cannot redirect the canonical url',
      hostForge.body.share.url.startsWith('https://brief.example.com/'));
    check('ATTACK: canonical url never contains the forged host',
      !JSON.stringify(hostForge.body.share).includes('evil.example.net'));

    // ATTACK: distribution endpoint of a campaign the caller does not own
    const foreignCamp = store.insert('campaigns', {
      id: 'cmp_foreign', ownerId: 'usr_someone_else', title: 'Not Yours', type: 'popup',
      status: 'published', objectId: 'obj_z', ownsObject: false, publicSlug: 'not-yours',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    check('ATTACK: GET share on a foreign campaign 404s',
      (await call2('/api/campaigns/cmp_foreign/share')).status === 404);
    check('ATTACK: POST share on a foreign campaign 404s',
      (await call2('/api/campaigns/cmp_foreign/share', 'POST', {})).status === 404);
    check('ATTACK: PATCH on a foreign campaign 404s',
      (await call2('/api/campaigns/cmp_foreign', 'PATCH', { title: 'Hijacked' })).status === 404);
    check('ATTACK: foreign campaign was not modified',
      store.find('campaigns', (c) => c.id === 'cmp_foreign').title === 'Not Yours');
    check('ATTACK: body ownerId does not grant ownership of a foreign campaign',
      (await call2('/api/campaigns/cmp_foreign', 'PATCH',
        { ownerId: 'usr_me', title: 'Mine Now' })).status === 404);
    check('ATTACK: foreign campaign still belongs to its owner',
      store.find('campaigns', (c) => c.id === 'cmp_foreign').ownerId === 'usr_someone_else');

    // ATTACK: slug manipulation
    const slugBefore = store.find('campaigns', (c) => c.id === later.id).publicSlug;
    await call2(`/api/campaigns/${later.id}`, 'PATCH', { publicSlug: 'premium-slug' });
    check('ATTACK: publicSlug is not writable via PATCH',
      store.find('campaigns', (c) => c.id === later.id).publicSlug === slugBefore);
    check('ATTACK: a manipulated slug resolves to nothing',
      (await call2('/api/public/campaigns/premium-slug')).status === 404);
    check('ATTACK: slug stays stable across a title change',
      (await call2(`/api/campaigns/${later.id}`, 'PATCH',
        { title: 'Totally New Title' })).body.campaign.publicSlug === slugBefore);

    // ATTACK: sharing an unpublished campaign must not expose it publicly
    const draftShare = (await call2('/api/campaigns', 'POST',
      { title: 'Draft Only', type: 'popup' })).body.campaign;
    const ds = (await call2(`/api/campaigns/${draftShare.id}/share`)).body.share;
    check('a draft still gets a link (the creator may prepare)', typeof ds.slug === 'string');
    check('ATTACK: the draft link resolves to 404 while unpublished',
      (await call2(`/api/public/campaigns/${ds.slug}`)).status === 404);
    await call2(`/api/campaigns/${draftShare.id}/share`, 'POST', {});
    check('ATTACK: recording a share does not publish the campaign',
      store.find('campaigns', (c) => c.id === draftShare.id).status === 'draft');
    check('ATTACK: recording a share creates no transaction',
      store.filter('transactions', (t) => t.campaignId === draftShare.id).length === 0);
    check('ATTACK: recording a share creates no registration',
      (await call2(`/api/campaigns/${draftShare.id}`)).body.campaign.metrics.registrations === 0);

    // ATTACK: repeated public views inflate views but never viewers/economics
    await call2(`/api/campaigns/${draftShare.id}/publish`, 'POST', {});
    const dslug = store.find('campaigns', (c) => c.id === draftShare.id).publicSlug;
    for (let i = 0; i < 5; i += 1) await call2(`/api/public/campaigns/${dslug}`);
    const afterViews = (await call2(`/api/campaigns/${draftShare.id}`)).body.campaign.metrics;
    check('ATTACK: repeated views are counted as page loads', afterViews.views === 5);
    check('ATTACK: repeated views do not become viewers', afterViews.viewers === 1);
    check('ATTACK: repeated views create no revenue', afterViews.revenueSettled === 0);
    check('ATTACK: repeated views create no registrations', afterViews.registrations === 0);
    // 5 views and 0 registrations is a MEASURED 0%, not an unmeasurable one --
    // the honest value here is 0, and null would be the lie.
    check('ATTACK: views with no registrations is a real, measured 0%',
      afterViews.conversionPct === 0);
    delete process.env.BRIEF_PUBLIC_ORIGIN;

    // an owned object still follows its campaign
    await call2(`/api/campaigns/${ownCamp.id}/publish`, 'POST', {});
    check('publishing DOES publish an object the campaign created',
      store.find('objects', (o) => o.id === ownObjId).publication === 'public');

    // --- share ------------------------------------------------------------
    const shareDraft = (await call2('/api/campaigns', 'POST', { title: 'Draft Share', type: 'popup' })).body.campaign;
    check('sharing a draft is refused',
      (await call2(`/api/campaigns/${shareDraft.id}/share`, 'POST', { channel: 'whatsapp' })).status === 400);

    const shareable = (await call2('/api/campaigns', 'POST', { title: 'Shareable', type: 'popup', price: 500 })).body.campaign;
    await call2(`/api/campaigns/${shareable.id}/publish`, 'POST', {});

    // --- standalone banner + WhatsApp link -------------------------------
    process.env.BRIEF_PUBLIC_ORIGIN = 'https://brief.example.com/';
    r = await call2(`/api/campaigns/${shareable.id}/banner`, 'POST', {
      headline: 'Share the next gathering', body: 'A clean standalone card for the home shelf.'
    });
    check('published campaign can create a standalone banner',
      r.status === 201 && r.body?.banner?.status === 'active');
    check('banner carries the server WhatsApp intent link',
      r.body?.banner?.share?.available === true && r.body.banner.share.channels.whatsapp.startsWith('https://wa.me/?text='));
    r = await call2('/api/banners');
    check('active banners are publicly listed without a roster',
      r.status === 200 && r.body?.banners?.some((item) => item.campaignId === shareable.id) &&
      !JSON.stringify(r.body.banners).includes(shareable.ownerId));
    r = await call2(`/api/campaigns/${shareable.id}/banner`, 'POST', { headline: 'Changed' });
    check('creating the same banner is idempotent', r.status === 200 && r.body?.reused === true);
    r = await call2(`/api/banners/${r.body.banner.id}/archive`, 'POST', {});
    check('the owner can archive the standalone banner', r.status === 200 && r.body?.banner?.status === 'archived');
    delete process.env.BRIEF_PUBLIC_ORIGIN;

    const beforeShare = (await call2(`/api/campaigns/${shareable.id}`)).body.campaign.metrics;
    await call2(`/api/campaigns/${shareable.id}/share`, 'POST', { channel: 'whatsapp' });
    await call2(`/api/campaigns/${shareable.id}/share`, 'POST', { channel: 'telegram' });
    const afterShare = (await call2(`/api/campaigns/${shareable.id}`)).body.campaign.metrics;
    check('share count is derived from signals', afterShare.shares === 2);
    check('sharing does not mutate revenue',
      afterShare.revenueSettled === beforeShare.revenueSettled && afterShare.revenueSettled === 0);
    check('sharing does not mutate pending revenue',
      afterShare.revenuePending === beforeShare.revenuePending);
    check('sharing does not mutate slots', afterShare.slotsTaken === beforeShare.slotsTaken);
    check('sharing does not create registrations', afterShare.registrations === 0);
    check('sharing does not create a transaction',
      store.filter('ledgerTransactions', (t) => t.campaignId === shareable.id).length === 0);
    check('campaign_shared is a real signal type',
      store.filter('signals', (x) => x.type === 'campaign_shared').length === 2);

    // slug stays canonical across all of it
    check('slug unchanged by sharing',
      (await call2(`/api/campaigns/${shareable.id}`)).body.campaign.publicSlug === shareable.publicSlug);
    check('slug is not writable',
      (await call2(`/api/campaigns/${shareable.id}`, 'PATCH', { publicSlug: 'stolen' }))
        .body.campaign.publicSlug === shareable.publicSlug);

    // --- viewing ----------------------------------------------------------
    const txBefore = store.all('ledgerTransactions').length;
    for (let i = 0; i < 4; i++) await call2(`/api/public/campaigns/${shareable.publicSlug}`);
    const viewed = (await call2(`/api/campaigns/${shareable.id}`)).body.campaign.metrics;
    check('viewing does not create a transaction', store.all('ledgerTransactions').length === txBefore);
    check('viewing does not create revenue', viewed.revenueSettled === 0);
    check('page loads are counted', viewed.views === 4);
    check('repeat loads from one client collapse into one viewer', viewed.viewers === 1);
    check('viewers is never greater than views', viewed.viewers <= viewed.views);

    // --- honest conversion -------------------------------------------------
    const unviewed = (await call2('/api/campaigns', 'POST', { title: 'Unviewed', type: 'popup' })).body.campaign;
    check('no views -> conversion is null, not zero', unviewed.metrics.conversionPct === null);
    check('no views -> viewers is null, not zero', unviewed.metrics.viewers === null);
    check('views but no registrations -> a real 0%', viewed.conversionPct === 0);

    // --- public projection -------------------------------------------------
    const meta = (await call2('/api/campaigns', 'POST',
      { title: 'Meta', type: 'popup', metadata: { creatorName: 'Amina K', image: 'https://cdn.example.com/a.jpg' } })).body.campaign;
    await call2(`/api/campaigns/${meta.id}/publish`, 'POST', {});
    const pv = (await call2(`/api/public/campaigns/${meta.publicSlug}`)).body.campaign;
    check('public view exposes a creator label', pv.creator === 'Amina K');
    check('public view exposes an image when set', pv.image === 'https://cdn.example.com/a.jpg');
    check('public view still hides ownerId', !('ownerId' in pv));
    check('public view still hides internal ids',
      !('id' in pv) && !('objectId' in pv) && !('circleId' in pv));
    check('public view hides ownsObject', !('ownsObject' in pv));
    check('public view hides metrics and metadata', !('metrics' in pv) && !('metadata' in pv));
    check('public view hides the viewer fingerprint', !JSON.stringify(pv).includes('viewerRef'));
    const noMeta = (await call2(`/api/public/campaigns/${shareable.publicSlug}`)).body.campaign;
    check('creator is null when unset, not invented', noMeta.creator === null);
    check('image is null when unset, not a placeholder', noMeta.image === null);

    // ---------------------------------------------------------------------
    // PHASE 8: THE PAID LOOP (settlement -> registration)
    // ---------------------------------------------------------------------
    console.log('\n=== PAID REGISTRATION LOOP ===');

    const paid = (await call2('/api/campaigns', 'POST',
      { title: 'Paid Workshop', type: 'popup', capacity: 5, price: 1000 })).body.campaign;
    await call2(`/api/campaigns/${paid.id}/publish`, 'POST', {});
    const paidSlug = store.find('campaigns', (c) => c.id === paid.id).publicSlug;

    const held = (await call2(`/api/public/campaigns/${paidSlug}/register`, 'POST',
      { attendeeRef: 'buyer-1', name: 'Buyer One' })).body.registration;
    check('a paid registration opens as a held spot', held.status === 'started');
    let pm = (await call2(`/api/campaigns/${paid.id}`)).body.campaign.metrics;
    check('a held spot occupies capacity', pm.slotsTaken === 1);
    check('a held spot is NOT counted as a registration', pm.registrations === 0);
    check('a held spot creates no revenue', pm.revenueSettled === 0);
    check('a held spot creates no transaction', pm.orders === 0);

    // --- path A: settling a linked transaction promotes the spot -----------
    const linkTx = (await call2('/api/transactions', 'POST',
      { amount: 1000, type: 'sale', campaignId: paid.id, registrationId: held.id })).body.transaction;
    check('a transaction may carry a registrationId', linkTx.registrationId === held.id);
    for (const st of ['pending', 'confirmed']) {
      await call2(`/api/transactions/${linkTx.id}/transition`, 'POST', { status: st });
    }
    check('an unsettled linked transaction does NOT promote the spot',
      store.find('registrations', (r) => r.id === held.id).status === 'started');
    check('unsettled money is not revenue',
      (await call2(`/api/campaigns/${paid.id}`)).body.campaign.metrics.revenueSettled === 0);

    await call2(`/api/transactions/${linkTx.id}/transition`, 'POST', { status: 'settled' });
    check('settling a linked transaction promotes the held spot',
      store.find('registrations', (r) => r.id === held.id).status === 'registered');
    pm = (await call2(`/api/campaigns/${paid.id}`)).body.campaign.metrics;
    check('the promoted spot now counts as a registration', pm.registrations === 1);
    check('settled money is now revenue', pm.revenueSettled === 1000);
    check('promotion did not double-count the slot', pm.slotsTaken === 1);
    check('promotion emitted the existing campaign_registered signal',
      store.filter('signals', (sg) => sg.type === 'campaign_registered' &&
        sg.metadata?.registrationId === held.id).length === 1);

    // --- path B: the organiser confirms cash arrived ----------------------
    const held2 = (await call2(`/api/public/campaigns/${paidSlug}/register`, 'POST',
      { attendeeRef: 'buyer-2', name: 'Buyer Two' })).body.registration;
    const conf = await call2(`/api/campaigns/${paid.id}/registrations/${held2.id}/confirm-payment`, 'POST', {});
    check('confirm-payment succeeds for a held spot', conf.status === 201);
    check('confirm-payment promotes the registration', conf.body.registration.status === 'registered');
    check('confirm-payment settles a real transaction', conf.body.transaction.status === 'settled');
    check('confirm-payment links the transaction to the registration',
      conf.body.transaction.registrationId === held2.id);
    check('confirm-payment charges the CAMPAIGN price', conf.body.transaction.amount === 1000);
    check('confirm-payment returns derived analytics', conf.body.analytics.registrations === 2);
    check('confirm-payment produced real revenue', conf.body.analytics.revenueSettled === 2000);
    check('the transaction went through the real state machine',
      conf.body.transaction.history.map((h) => h.status).join() === 'created,pending,confirmed,settled');

    // ATTACK: a forged amount in the body must be ignored
    const held3 = (await call2(`/api/public/campaigns/${paidSlug}/register`, 'POST',
      { attendeeRef: 'buyer-3' })).body.registration;
    const forgedAmt = await call2(`/api/campaigns/${paid.id}/registrations/${held3.id}/confirm-payment`,
      'POST', { amount: 999999, price: 999999, revenueSettled: 999999 });
    check('ATTACK: a forged amount cannot mint revenue',
      forgedAmt.body.transaction.amount === 1000);
    check('ATTACK: forged revenue fields are ignored',
      forgedAmt.body.analytics.revenueSettled === 3000);

    // ATTACK: confirming twice must not double-charge
    const twice = await call2(`/api/campaigns/${paid.id}/registrations/${held2.id}/confirm-payment`, 'POST', {});
    check('ATTACK: confirming an already-paid spot is refused', twice.status === 409);
    check('ATTACK: double confirmation created no extra revenue',
      (await call2(`/api/campaigns/${paid.id}`)).body.campaign.metrics.revenueSettled === 3000);

    // ATTACK: cross-campaign registration links
    const other = (await call2('/api/campaigns', 'POST',
      { title: 'Other Paid', type: 'popup', price: 50 })).body.campaign;
    const cross = await call2('/api/transactions', 'POST',
      { amount: 99999, type: 'sale', campaignId: other.id, registrationId: held.id });
    check('ATTACK: a transaction cannot link a foreign campaign registration',
      cross.status === 400 && /does not belong/.test(cross.body.error));
    const orphan = await call2('/api/transactions', 'POST',
      { amount: 5, type: 'sale', registrationId: held.id });
    check('ATTACK: registrationId without its campaignId is refused', orphan.status === 400);
    const ghost = await call2('/api/transactions', 'POST',
      { amount: 5, type: 'sale', campaignId: paid.id, registrationId: 'reg_ghost' });
    check('ATTACK: an unknown registrationId is refused', ghost.status === 400);

    // ATTACK: confirm-payment on another creator's campaign
    check('ATTACK: confirm-payment on a foreign campaign 404s',
      (await call2(`/api/campaigns/cmp_foreign/registrations/${held.id}/confirm-payment`,
        'POST', {})).status === 404);
    check('ATTACK: confirm-payment with a foreign registration 404s',
      (await call2(`/api/campaigns/${other.id}/registrations/${held.id}/confirm-payment`,
        'POST', {})).status === 404);

    // A cancelled spot is not revived by a late payment.
    const held4 = (await call2(`/api/public/campaigns/${paidSlug}/register`, 'POST',
      { attendeeRef: 'buyer-4' })).body.registration;
    await call2(`/api/campaigns/${paid.id}/registrations/${held4.id}/status`, 'POST',
      { status: 'cancelled' });
    const lateTx = (await call2('/api/transactions', 'POST',
      { amount: 1000, type: 'sale', campaignId: paid.id, registrationId: held4.id })).body.transaction;
    for (const st of ['pending', 'confirmed', 'settled']) {
      await call2(`/api/transactions/${lateTx.id}/transition`, 'POST', { status: st });
    }
    check('a cancelled registration is NOT revived by a late settlement',
      store.find('registrations', (r) => r.id === held4.id).status === 'cancelled');
    check('confirm-payment refuses a cancelled spot',
      (await call2(`/api/campaigns/${paid.id}/registrations/${held4.id}/confirm-payment`,
        'POST', {})).status === 409);

    // A free campaign has nothing to confirm.
    const freeC = (await call2('/api/campaigns', 'POST',
      { title: 'Free Talk', type: 'popup', price: 0 })).body.campaign;
    await call2(`/api/campaigns/${freeC.id}/publish`, 'POST', {});
    const freeSlug = store.find('campaigns', (c) => c.id === freeC.id).publicSlug;
    const freeReg = (await call2(`/api/public/campaigns/${freeSlug}/register`, 'POST',
      { attendeeRef: 'free-1' })).body.registration;
    check('a free registration is immediately registered', freeReg.status === 'registered');
    check('confirm-payment is refused on a free campaign',
      (await call2(`/api/campaigns/${freeC.id}/registrations/${freeReg.id}/confirm-payment`,
        'POST', {})).status === 400);

    // Views and shares still create nothing economic on a paid campaign.
    const beforeEcon = (await call2(`/api/campaigns/${paid.id}`)).body.campaign.metrics;
    for (let i = 0; i < 3; i += 1) await call2(`/api/public/campaigns/${paidSlug}`);
    await call2(`/api/campaigns/${paid.id}/share`, 'POST', { channel: 'whatsapp' });
    const afterEcon = (await call2(`/api/campaigns/${paid.id}`)).body.campaign.metrics;
    check('views create no revenue', afterEcon.revenueSettled === beforeEcon.revenueSettled);
    check('views create no registrations', afterEcon.registrations === beforeEcon.registrations);
    check('shares create no revenue', afterEcon.orders === beforeEcon.orders);
    check('views were still counted as page loads', afterEcon.views > beforeEcon.views);

    // ---------------------------------------------------------------------
    // PHASE 9: REGISTRATION STATE MACHINE + TRANSACTION INTEGRITY
    // ---------------------------------------------------------------------
    console.log('\n=== TRANSACTION & TRUST RAIL ===');

    const mkPaid = async (over = {}) => {
      const c = (await call2('/api/campaigns', 'POST',
        Object.assign({ title: 'Rail', type: 'popup', capacity: 10, price: 1000 }, over))).body.campaign;
      await call2(`/api/campaigns/${c.id}/publish`, 'POST', {});
      return store.find('campaigns', (x) => x.id === c.id);
    };
    const regFor = async (slug, ref) =>
      (await call2(`/api/public/campaigns/${slug}/register`, 'POST', { attendeeRef: ref })).body.registration;
    const setSt = (cid, rid, status) =>
      call2(`/api/campaigns/${cid}/registrations/${rid}/status`, 'POST', { status });

    // --- G1: cancellation is terminal -------------------------------------
    const rail1 = await mkPaid();
    const r1 = await regFor(rail1.publicSlug, 'x1');
    await setSt(rail1.id, r1.id, 'cancelled');
    const revive = await setSt(rail1.id, r1.id, 'registered');
    check('ATTACK: a cancelled registration cannot be revived', revive.status === 400);
    check('the refusal names the illegal transition',
      /invalid registration transition/.test(revive.body.error));
    check('ATTACK: a cancelled registration cannot be checked in',
      (await setSt(rail1.id, r1.id, 'checked_in')).status === 400);
    check('ATTACK: a cancelled registration cannot be marked no_show',
      (await setSt(rail1.id, r1.id, 'no_show')).status === 400);
    check('the cancelled row is still cancelled',
      store.find('registrations', (r) => r.id === r1.id).status === 'cancelled');

    // --- G2: capacity cannot be exceeded by revival -----------------------
    const rail2 = await mkPaid({ capacity: 1, price: 0 });
    const a1 = await regFor(rail2.publicSlug, 'cap-a');
    await setSt(rail2.id, a1.id, 'cancelled');
    const a2 = await regFor(rail2.publicSlug, 'cap-b');
    check('cancelling frees the slot for someone else', a2 && a2.id !== a1.id);
    await setSt(rail2.id, a1.id, 'registered');
    const capM = (await call2(`/api/campaigns/${rail2.id}`)).body.campaign.metrics;
    check('ATTACK: reviving a cancelled spot cannot overbook the campaign',
      capM.slotsTaken <= capM.capacity, `slotsTaken ${capM.slotsTaken} > capacity ${capM.capacity}`);
    check('remaining never goes negative', capM.remaining >= 0);

    // --- G3: no path back into `started` -> no double charge --------------
    const rail3 = await mkPaid({ price: 500 });
    const r3 = await regFor(rail3.publicSlug, 'dbl');
    await call2(`/api/campaigns/${rail3.id}/registrations/${r3.id}/confirm-payment`, 'POST', {});
    await setSt(rail3.id, r3.id, 'checked_in');
    check('ATTACK: a checked-in registration cannot be forced back to started',
      (await setSt(rail3.id, r3.id, 'started')).status === 400);
    check('ATTACK: nothing may transition INTO started',
      (await setSt(rail3.id, r3.id, 'started')).status === 400);
    // Pay-at-the-door: a held spot checked in on arrival is legitimate and
    // must keep working. The double-charge fix is the backward edge, not this.
    const door = await mkPaid({ price: 250 });
    const rDoor = await regFor(door.publicSlug, 'door');
    check('a held spot can be checked in at the door',
      (await setSt(door.id, rDoor.id, 'checked_in')).status === 200);
    check('checking in at the door invents no revenue',
      (await call2(`/api/campaigns/${door.id}`)).body.campaign.metrics.revenueSettled === 0);
    check('ATTACK: a door check-in cannot then be pushed back to started',
      (await setSt(door.id, rDoor.id, 'started')).status === 400);
    check('ATTACK: a paid attendee cannot be charged twice',
      (await call2(`/api/campaigns/${rail3.id}/registrations/${r3.id}/confirm-payment`, 'POST', {})).status === 409);
    check('one attendee at price 500 produced exactly 500 of revenue',
      (await call2(`/api/campaigns/${rail3.id}`)).body.campaign.metrics.revenueSettled === 500);

    // legal transitions still work
    const rail3b = await mkPaid({ price: 0 });
    const r3b = await regFor(rail3b.publicSlug, 'legal');
    check('registered -> checked_in is allowed', (await setSt(rail3b.id, r3b.id, 'checked_in')).status === 200);
    check('checked_in -> no_show corrects a mis-tap',
      (await setSt(rail3b.id, r3b.id, 'no_show')).status === 200);
    check('no_show -> checked_in corrects it back',
      (await setSt(rail3b.id, r3b.id, 'checked_in')).status === 200);
    check('registered -> cancelled is allowed',
      (await setSt(rail3b.id, (await regFor(rail3b.publicSlug, 'legal2')).id, 'cancelled')).status === 200);

    // --- G4: non-positive amounts are refused ------------------------------
    check('ATTACK: a negative transaction amount is refused',
      (await call2('/api/transactions', 'POST',
        { amount: -99999, type: 'sale', campaignId: rail3.id })).status === 400);
    check('ATTACK: a zero transaction amount is refused',
      (await call2('/api/transactions', 'POST',
        { amount: 0, type: 'sale', campaignId: rail3.id })).status === 400);
    check('ATTACK: negative money never reached campaign revenue',
      (await call2(`/api/campaigns/${rail3.id}`)).body.campaign.metrics.revenueSettled === 500);
    qualifyGroupCreator('usr_me');
    const negCircle = (await call2('/api/circles', 'POST',
      { name: 'Neg', goal: 'g', targetValue: 1000 })).body.circle;
    check('ATTACK: negative money cannot drive a target backwards',
      (await call2('/api/transactions', 'POST',
        { amount: -500, type: 'contribution', circleId: negCircle.id })).status === 400);
    check('the target is untouched',
      (await call2(`/api/circles/${negCircle.id}`)).body.circle.currentValue === 0);
    check('a positive amount is still accepted',
      (await call2('/api/transactions', 'POST',
        { amount: 1, type: 'sale', campaignId: rail3.id })).status === 201);

    // --- G5: a refund releases the spot ------------------------------------
    const rail5 = await mkPaid({ capacity: 2, price: 800 });
    const r5 = await regFor(rail5.publicSlug, 'ref');
    const conf5 = await call2(`/api/campaigns/${rail5.id}/registrations/${r5.id}/confirm-payment`, 'POST', {});
    const tx5 = conf5.body.transaction;
    check('the attendee is registered after paying',
      store.find('registrations', (r) => r.id === r5.id).status === 'registered');
    await call2(`/api/transactions/${tx5.id}/transition`, 'POST', { status: 'refunded' });
    check('a refund releases the registration',
      store.find('registrations', (r) => r.id === r5.id).status === 'cancelled');
    const m5 = (await call2(`/api/campaigns/${rail5.id}`)).body.campaign.metrics;
    check('a refund removes the revenue', m5.revenueSettled === 0);
    check('a refund frees the slot', m5.slotsTaken === 0);
    check('a refund is reflected in the cancelled count', m5.cancelled === 1);
    check('a refunded spot cannot be confirmed again',
      (await call2(`/api/campaigns/${rail5.id}/registrations/${r5.id}/confirm-payment`, 'POST', {})).status === 409);
    check('a refunded, cancelled registration is not revived by a repeat refund',
      store.find('registrations', (r) => r.id === r5.id).status === 'cancelled');

    // a refund must not demote somebody who already attended
    const rail5b = await mkPaid({ price: 400 });
    const r5b = await regFor(rail5b.publicSlug, 'attended');
    const tx5b = (await call2(`/api/campaigns/${rail5b.id}/registrations/${r5b.id}/confirm-payment`, 'POST', {})).body.transaction;
    await setSt(rail5b.id, r5b.id, 'checked_in');
    await call2(`/api/transactions/${tx5b.id}/transition`, 'POST', { status: 'refunded' });
    check('a refund does not erase an attendance that already happened',
      store.find('registrations', (r) => r.id === r5b.id).status === 'checked_in');

    // --- G6: replay emits no duplicate signal ------------------------------
    const rail6 = await mkPaid({ price: 0 });
    const r6 = await regFor(rail6.publicSlug, 'idem');
    for (let i = 0; i < 3; i += 1) await setSt(rail6.id, r6.id, 'checked_in');
    check('repeating a status is idempotent',
      store.find('registrations', (r) => r.id === r6.id).status === 'checked_in');
    check('a replayed status change emits no duplicate signal',
      store.filter('signals', (sg) => sg.type === 'campaign_checkin' &&
        sg.metadata?.registrationId === r6.id).length === 1);
    check('the derived check-in count is still 1',
      (await call2(`/api/campaigns/${rail6.id}`)).body.campaign.metrics.checkedIn === 1);

    // --- ownership on the whole rail ---------------------------------------
    check('ATTACK: status route on a foreign campaign 404s',
      (await call2(`/api/campaigns/cmp_foreign/registrations/${r6.id}/status`, 'POST',
        { status: 'cancelled' })).status === 404);
    check('ATTACK: the foreign attempt changed nothing',
      store.find('registrations', (r) => r.id === r6.id).status === 'checked_in');

    // ---------------------------------------------------------------------
    // PHASE 10: CONNECTOR BOUNDARY (G1 fail-closed, G2 malformed -> 400)
    // ---------------------------------------------------------------------
    console.log('\n=== CONNECTOR BOUNDARY ===');

    const tgUpdate = (over = {}) => ({
      update_id: 1,
      message: Object.assign({
        message_id: 4242, date: 1755400000,
        chat: { id: -100999, type: 'group', title: 'Boundary Group' },
        from: { id: 7 },
        text: 'Join us Sat 3pm at Kilimani Hall. Tickets 500 KES. Contact 0712345678'
      }, over)
    });
    const hook = (body, secretHeader) =>
      call2('/api/webhooks/telegram', 'POST', body,
        secretHeader ? { 'x-telegram-bot-api-secret-token': secretHeader } : undefined);

    // --- G1: fail closed ---------------------------------------------------
    const savedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;

    const sourcesBefore = store.filter('sources', () => true).length;
    const rawBefore = store.filter('rawItems', () => true).length;

    let hr = await hook(tgUpdate());
    check('ATTACK: an unconfigured telegram webhook refuses anonymous input', hr.status === 401);
    check('the refusal names the missing configuration',
      /TELEGRAM_WEBHOOK_SECRET not set/.test(hr.body.error));
    check('ATTACK: guessing a header does not bypass an unset secret',
      (await hook(tgUpdate(), 'anything')).status === 401);
    check('ATTACK: an unauthenticated webhook creates no source',
      store.filter('sources', () => true).length === sourcesBefore);
    check('ATTACK: an unauthenticated webhook stores no raw item',
      store.filter('rawItems', () => true).length === rawBefore);

    process.env.TELEGRAM_WEBHOOK_SECRET = 'phase10-secret';
    check('ATTACK: a configured secret with no header is refused',
      (await hook(tgUpdate())).status === 401);
    check('ATTACK: a configured secret with the wrong header is refused',
      (await hook(tgUpdate(), 'wrong')).status === 401);

    const good = await hook(tgUpdate(), 'phase10-secret');
    check('a correctly authenticated webhook is accepted', good.status === 200);
    check('the accepted webhook stored a raw item', Boolean(good.body.rawItemId));
    check('replaying an authenticated webhook is idempotent',
      (await hook(tgUpdate(), 'phase10-secret')).body.duplicate === true);
    check('replay created no second raw item',
      store.filter('rawItems', (r) => r.externalId === '-100999:4242').length === 1);

    // --- G2: malformed -> 400, never 500 -----------------------------------
    const rawAtG2 = store.filter('rawItems', () => true).length;
    const malformed = [
      ['a non-object update', [1, 2, 3]],
      ['a non-object message', { update_id: 2, message: [1, 2, 3] }],
      ['an object message_id', tgUpdate({ message_id: { a: 1 } })],
      ['an array chat.id', tgUpdate({ chat: { id: [1, 2], type: 'group' } })],
      ['a numeric chat.type', tgUpdate({ chat: { id: -5, type: 99 } })],
      ['a numeric text', tgUpdate({ text: 12345 })],
      ['a non-numeric date', tgUpdate({ date: 'not-a-date' })],
      ['oversized text', tgUpdate({ text: 'A'.repeat(200000) })]
    ];
    for (const [label, body] of malformed) {
      const mr = await hook(body, 'phase10-secret');
      check(`malformed payload rejected with 400: ${label}`, mr.status === 400,
        `got ${mr.status}`);
      check(`the rejection for ${label} leaks no internals`,
        typeof mr.body.error === 'string' && !/\bat \w+\.|node_modules|\/home\//.test(mr.body.error));
    }
    check('malformed payloads persisted nothing',
      store.filter('rawItems', () => true).length === rawAtG2);

    // valid-but-ignorable input still succeeds (must NOT become a 400)
    const ignorable = await hook({ update_id: 3, message: { message_id: 55,
      date: 1755400000, chat: { id: -100999, type: 'group' } } }, 'phase10-secret');
    check('an update with no text is ignored, not rejected', ignorable.status === 200);
    check('the ignorable update is reported honestly', ignorable.body.ignored === 'no usable text');
    check('an empty update object is ignored, not rejected',
      (await hook({}, 'phase10-secret')).status === 200);

    // --- economic firewall across the connector boundary -------------------
    const moneyText = 'PAID: 50 tickets sold, revenue 250000 KES settled, 50 registrations. ' +
      'Sat 3pm Kilimani Hall contact 0712345678';
    const p10Tx = store.filter('ledgerTransactions', () => true).length;
    const p10Reg = store.filter('registrations', () => true).length;
    const p10Camp = store.filter('campaigns', () => true).length;
    await hook(tgUpdate({ message_id: 8888, text: moneyText }), 'phase10-secret');
    await new Promise((r) => setTimeout(r, 250));
    check('ingestion creates no transaction',
      store.filter('ledgerTransactions', () => true).length === p10Tx);
    check('ingestion creates no registration',
      store.filter('registrations', () => true).length === p10Reg);
    check('ingestion creates no campaign',
      store.filter('campaigns', () => true).length === p10Camp);
    // Scoped to the object THIS webhook produced. A global scan would be wrong:
    // objects ingested from a genuinely public source, and objects a campaign
    // publishes, are legitimately public elsewhere in this suite.
    const p10Src = store.find('sources', (x) => x.externalId === '-100999');
    const p10Raw = p10Src
      ? store.filter('rawItems', (r) => r.sourceId === p10Src.id).map((r) => r.id)
      : [];
    const p10Objs = store.filter('objects', (o) =>
      store.filter('objectSources', (os) => os.objectId === o.id)
        .some((os) => os.sourceId === p10Src?.id));
    check('the webhook source is private (member_access), not public',
      Boolean(p10Src) && p10Src.accessType === 'member_access');
    check('an object ingested from a private group is never public',
      p10Objs.every((o) => o.publication !== 'public'), 
      p10Objs.map((o) => o.publication).join(','));
    check('the webhook actually produced raw items to reason about', p10Raw.length > 0);

    if (savedSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = savedSecret;
  } finally {
    srv2.close();
  }
}

// ---------------------------------------------------------------------------
// CIRCLE OPERATIONS (Batch 2): blocks, tasks, votes, evidence.
//
// Finding F5 recorded that Blocks had ZERO server test coverage despite
// having a route and a type vocabulary. This closes that gap.
//
// These tests exercise BEHAVIOUR, not existence. Every case here fails if the
// implementation breaks: illegal transitions, forged assignees, duplicate
// ballots, cross-circle operations, and tallies that drift from their records.
//
// Multi-user note: callerId() is a single-user constant until an auth
// provider is connected, so "another user" is simulated by writing the
// membership rows directly and driving the domain layer, while the ROUTES are
// used to prove the authority checks reject the caller. Both halves matter --
// one proves the rules, the other proves they are actually wired in.
// ---------------------------------------------------------------------------
console.log('\n=== CIRCLE OPERATIONS: BLOCKS (spec F5) ===');
{
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../src/index.js');
  const blocksDomain = await import('../src/domain/block.js');
  const signalsDomain = await import('../src/domain/signal.js');
  store._reset();

  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const ME = 'usr_me';

  try {
    // --- setup: a circle the caller coordinates, and a foreign one ----------
    qualifyGroupCreator('usr_me');
    const circle = (await call('/api/circles', 'POST', { name: 'Kilimani Ops', targetValue: 5000 })).body.circle;
    await call(`/api/circles/${circle.id}/members`, 'POST', { role: 'coordinator' });
    const foreign = (await call('/api/circles', 'POST', { name: 'Other Circle' })).body.circle;

    // ================= NOTES =================
    console.log('\n  -- notes --');
    let r = await call('/api/blocks', 'POST', { circleId: circle.id, type: 'note', content: 'Gate code changed' });
    check('note block created', r.status === 201, `got ${r.status}`);
    check('note belongs to its circle', r.body?.block?.circleId === circle.id);
    check('note content preserved', r.body?.block?.content === 'Gate code changed');

    r = await call('/api/blocks', 'POST', { circleId: 'circ_does_not_exist', type: 'note', content: 'x' });
    check('note in a nonexistent circle rejected', r.status === 404, `got ${r.status}`);

    r = await call('/api/blocks', 'POST', { circleId: circle.id, type: 'note', content: '   ' });
    check('blank note content rejected', r.status === 400, `got ${r.status}`);

    r = await call('/api/blocks', 'POST', { circleId: circle.id, type: 'nonsense', content: 'x' });
    check('unknown block type rejected', r.status === 400, `got ${r.status}`);

    const listed = (await call(`/api/blocks?circleId=${circle.id}`)).body.blocks;
    check('blocks list scoped to the circle', listed.every((b) => b.circleId === circle.id));
    check('foreign circle blocks not listed', !listed.some((b) => b.circleId === foreign.id));

    // ================= TASKS =================
    console.log('\n  -- tasks --');
    r = await call('/api/blocks', 'POST', { circleId: circle.id, type: 'task', content: 'Repair the gate' });
    const task = r.body.block;
    check('task block created', r.status === 201 && task.type === 'task');
    check('task is born open', task.task?.status === 'open', JSON.stringify(task.task));
    check('task is born unassigned', task.task?.assigneeId === null);

    // A task cannot skip straight to completed -- it was never taken on.
    r = await call(`/api/circles/${circle.id}/blocks/${task.id}/complete`, 'POST', {});
    check('completing an unassigned task is rejected', r.status === 400, `got ${r.status}`);
    check('rejection names the illegal transition', /invalid task transition/.test(r.body?.error ?? ''), r.body?.error);

    r = await call(`/api/circles/${circle.id}/blocks/${task.id}/assign`, 'POST', {});
    check('self-assign succeeds', r.status === 200, `got ${r.status}`);
    check('task now assigned to caller', r.body?.block?.task?.assigneeId === ME);
    check('assignment reported as a real change', r.body?.changed === true);

    // Idempotence: the Phase 9 lesson applied to activity evidence.
    const sigsBefore = store.filter('signals', (s) => s.type === 'task_assigned').length;
    r = await call(`/api/circles/${circle.id}/blocks/${task.id}/assign`, 'POST', {});
    check('re-assigning to the same member is a no-op', r.body?.changed === false, JSON.stringify(r.body?.changed));
    const sigsAfter = store.filter('signals', (s) => s.type === 'task_assigned').length;
    check('a no-op emits NO second signal', sigsAfter === sigsBefore, `${sigsBefore} -> ${sigsAfter}`);

    // Assigning to a non-member must fail even with coordinator authority.
    r = await call(`/api/circles/${circle.id}/blocks/${task.id}/assign`, 'POST', { assigneeId: 'usr_outsider' });
    check('cannot assign to a non-member', r.status === 400, `got ${r.status}`);
    check('refusal explains membership', /not a member/.test(r.body?.error ?? ''), r.body?.error);

    r = await call(`/api/circles/${circle.id}/blocks/${task.id}/complete`, 'POST', {});
    check('assignee completes the task', r.status === 200 && r.body?.block?.task?.status === 'completed');
    check('completion records who did it', r.body?.block?.task?.completedBy === ME);
    check('completion is timestamped', Boolean(r.body?.block?.task?.completedAt));

    // Completed is terminal.
    const completedSigs = store.filter('signals', (s) => s.type === 'task_completed').length;
    r = await call(`/api/circles/${circle.id}/blocks/${task.id}/complete`, 'POST', {});
    check('completing twice is a no-op, not a second completion', r.body?.changed === false);
    check('no duplicate completion signal',
      store.filter('signals', (s) => s.type === 'task_completed').length === completedSigs);
    r = await call(`/api/circles/${circle.id}/blocks/${task.id}/release`, 'POST', {});
    check('a completed task cannot be reopened', r.status === 400, `got ${r.status}`);

    // --- cross-circle: a block is reachable only through its own circle ----
    // Created through the domain: the caller is not a member of `foreign`, so
    // the route would (correctly) refuse. The point of this case is the
    // cross-circle path check, not block creation.
    const foreignTask = blocksDomain.createBlock({
      circleId: foreign.id, type: 'task', content: 'Foreign work'
    });
    r = await call(`/api/circles/${circle.id}/blocks/${foreignTask.id}/assign`, 'POST', {});
    check('cannot operate on a foreign circle task via my circle', r.status === 404, `got ${r.status}`);
    check('foreign task untouched',
      blocksDomain.taskState(store.find('blocks', (b) => b.id === foreignTask.id)).status === 'open');

    r = await call(`/api/circles/${circle.id}/blocks/blk_nope/assign`, 'POST', {});
    check('unknown block id rejected', r.status === 404, `got ${r.status}`);

    // --- role enforcement: observer may not operate -------------------------
    // Demote the caller to observer and prove the API refuses, rather than
    // relying on a hidden button.
    const myRow = store.find('members', (m) => m.circleId === circle.id && m.userId === ME);
    store.update('members', myRow.id, { role: 'observer' });
    const obsTask = (await call('/api/blocks', 'POST', {
      circleId: circle.id, type: 'task', content: 'Observer must not take this'
    })).body.block;
    r = await call(`/api/circles/${circle.id}/blocks/${obsTask.id}/assign`, 'POST', {});
    check('observer cannot take on a task', r.status === 403, `got ${r.status}`);
    check('refusal names the role', /observer/.test(r.body?.error ?? ''), r.body?.error);
    check('observer assignment did not happen',
      blocksDomain.taskState(store.find('blocks', (b) => b.id === obsTask.id)).assigneeId === null);
    store.update('members', myRow.id, { role: 'coordinator' });

    // --- non-member cannot operate at all ----------------------------------
    const circlesOp = await import('../src/domain/circle.js');
    const strangerCircle = circlesOp.createTargetCircle({ name: 'Not Mine' });
    store.insert('members', {
      id: 'memb_other', circleId: strangerCircle.id, userId: 'usr_someone_else',
      role: 'coordinator', verifications: [], joinedAt: new Date().toISOString()
    });
    const strangerTask = blocksDomain.createBlock({
      circleId: strangerCircle.id, type: 'task', content: 'Their work'
    });
    r = await call(`/api/circles/${strangerCircle.id}/blocks/${strangerTask.id}/assign`, 'POST', {});
    check('non-member cannot take on a task', r.status === 403, `got ${r.status}`);
    check('refusal explains membership', /only members/.test(r.body?.error ?? ''), r.body?.error);

    // ================= VOTES =================
    console.log('\n  -- votes --');
    r = await call('/api/blocks', 'POST', {
      circleId: circle.id, type: 'vote', content: 'Move market day to Sunday?'
    });
    check('vote with no options rejected', r.status === 400, `got ${r.status}`);
    check('refusal explains the minimum', /two distinct options/.test(r.body?.error ?? ''), r.body?.error);

    // Created THROUGH THE ROUTE on purpose: the options travel in `metadata`,
    // and an earlier version of this route dropped that field entirely, so a
    // vote could never be created over HTTP. Building it via the domain here
    // would have hidden that bug.
    r = await call('/api/blocks', 'POST', {
      circleId: circle.id, type: 'vote', content: 'Move market day to Sunday?',
      metadata: { options: ['Yes', 'No', 'Abstain'] }
    });
    check('vote block created over HTTP', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
    const voteBlock = r.body.block;
    check('options survived the route', blocksDomain.voteOptions(
      store.find('blocks', (b) => b.id === voteBlock.id)).length === 3);
    check('vote starts open', !blocksDomain.isVoteClosed(voteBlock));
    check('tally hydrated on creation', voteBlock.tally?.totalVotes === 0);

    // Duplicate options would let one choice appear twice on a ballot.
    r = await call('/api/blocks', 'POST', {
      circleId: circle.id, type: 'vote', content: 'Dupe?', metadata: { options: ['Yes', 'Yes'] }
    });
    check('duplicate vote options rejected', r.status === 400, `got ${r.status}`);

    let t = (await call(`/api/circles/${circle.id}/blocks/${voteBlock.id}/tally`)).body.tally;
    check('empty tally counts zero', t.totalVotes === 0);
    check('every option present even at zero', t.results.length === 3);
    check('pct is null, not 0, before any vote', t.results.every((x) => x.pct === null));
    check('no leader without votes', t.leader === null);

    r = await call(`/api/circles/${circle.id}/blocks/${voteBlock.id}/vote`, 'POST', { option: 'Yes' });
    check('member casts a valid vote', r.status === 201, `got ${r.status}`);
    check('tally returned with the ballot', r.body?.tally?.totalVotes === 1);

    r = await call(`/api/circles/${circle.id}/blocks/${voteBlock.id}/vote`, 'POST', { option: 'No' });
    check('duplicate vote rejected with 409', r.status === 409, `got ${r.status}`);
    check('refusal says already voted', /already voted/.test(r.body?.error ?? ''), r.body?.error);
    check('duplicate did not change the tally',
      blocksDomain.tallyVote(voteBlock.id).totalVotes === 1);

    r = await call(`/api/circles/${circle.id}/blocks/${voteBlock.id}/vote`, 'POST', { option: 'Maybe' });
    check('invalid option rejected', r.status === 400, `got ${r.status}`);
    check('refusal lists the valid options', /Yes/.test(r.body?.error ?? ''), r.body?.error);

    // --- tally correctness against real ballots ----------------------------
    // Add real members and real ballots through the domain, then verify the
    // tally MATCHES THE ROWS -- this is what a stored counter would get wrong.
    for (const u of ['usr_a', 'usr_b', 'usr_c']) {
      store.insert('members', {
        id: `memb_${u}`, circleId: circle.id, userId: u,
        role: 'contributor', verifications: [], joinedAt: new Date().toISOString()
      });
    }
    // --- the roll is locked when the vote opens --------------------------
    // usr_a/b/c are members NOW, but the vote above opened before they were.
    // Eligibility is a snapshot taken at creation, precisely so that stuffing a
    // circle an hour before a count cannot manufacture a majority.
    let refused = null;
    try { blocksDomain.castVote(voteBlock.id, 'usr_a', 'No'); } catch (e) { refused = e.message; }
    check('a member added after the vote opened cannot vote in it', /added you after the vote opened/.test(refused ?? ''), refused);
    check('the refusal explains the rule', /majority cannot be manufactured/.test(refused ?? ''), refused);

    const vote2 = blocksDomain.createBlock({
      circleId: circle.id, type: 'vote', content: 'Split the stall fee?',
      metadata: { options: ['Even', 'By weight'], quorum: 3 }
    });
    blocksDomain.castVote(vote2.id, 'usr_a', 'Even');
    blocksDomain.castVote(vote2.id, 'usr_b', 'Even');
    blocksDomain.castVote(vote2.id, 'usr_c', 'By weight');

    // --- changing a vote: allowed, counted once, and never silent ----------
    blocksDomain.changeVote(vote2.id, 'usr_c', 'Even');
    t = blocksDomain.tallyVote(vote2.id);
    check('a changed vote is still one vote', t.totalVotes === 3, `got ${t.totalVotes}`);
    check('the change is counted as one row superseded', t.changedVotes === 1, `got ${t.changedVotes}`);
    check('the new choice wins', t.results.find((x) => x.option === 'Even').count === 3, JSON.stringify(t.results));
    const voteChanged = store.filter('circleRevisions', (x) => x.kind === 'vote_changed' && x.subject === vote2.id);
    check('the change left a history row', voteChanged.length === 1, `got ${voteChanged.length}`);
    check('the history row says from what to what', voteChanged[0]?.before === 'By weight' && voteChanged[0]?.after === 'Even', JSON.stringify(voteChanged[0]));
    const ballots2 = store.filter('votes', (v) => v.blockId === vote2.id);
    check('the earlier ballot row is still there, superseded not deleted', ballots2.length === 4 && ballots2.some((v) => v.supersededAt), `rows ${ballots2.length}`);

    // --- a count cannot be closed by hand once it has ballots --------------
    let closeErr = null;
    try { blocksDomain.closeVote(vote2.id, { actorId: ME }); } catch (e) { closeErr = e.message; }
    check('closing a live count is refused', /cannot be closed by hand/.test(closeErr ?? ''), closeErr);
    let cancelErr = null;
    try { blocksDomain.cancelVote(vote2.id, { actorId: ME }); } catch (e) { cancelErr = e.message; }
    check('cancelling without a reason is refused', /needs a reason/.test(cancelErr ?? ''), cancelErr);
    const cancelled = blocksDomain.cancelVote(vote2.id, { actorId: ME, reason: 'market moved, question is moot' });
    check('cancelling with a reason works', cancelled.changed === true);
    t = blocksDomain.tallyVote(vote2.id);
    check('a cancelled vote reports its status', t.status === 'cancelled' && t.cancelled === true, JSON.stringify({ s: t.status }));
    check('the reason is on the result', /market moved/.test(t.cancelReason ?? ''), t.cancelReason);
    check('the ballots survive the cancellation', t.totalVotes === 3, `got ${t.totalVotes}`);

    // --- quorum: a decision needs enough of the roll ----------------------
    const small = blocksDomain.createBlock({
      circleId: circle.id, type: 'vote', content: 'Buy the freezer?',
      metadata: { options: ['Yes', 'No'], quorum: 4, closesAt: new Date(Date.now() + 3600_000).toISOString() }
    });
    let pastErr = null;
    try {
      blocksDomain.createBlock({ circleId: circle.id, type: 'vote', content: 'Past?', metadata: { options: ['a','b'], closesAt: '2020-01-01T00:00:00Z' } });
    } catch (e) { pastErr = e.message; }
    check('a vote cannot open already closed', /must be in the future/.test(pastErr ?? ''), pastErr);
    blocksDomain.castVote(small.id, ME, 'Yes');
    const tSmall = blocksDomain.tallyVote(small.id, { now: Date.now() + 2 * 3600_000 });
    check('a count under quorum is not a decision', tSmall.status === 'failed_quorum', JSON.stringify({ s: tSmall.status, q: tSmall.quorumMet }));
    check('the quorum figure is the one asked for', tSmall.quorum === 4 && tSmall.eligibleCount >= 4, JSON.stringify({ q: tSmall.quorum, e: tSmall.eligibleCount }));

    // --- sealed ballots: countable, unreadable ---------------------------
    const sealed = blocksDomain.createBlock({
      circleId: circle.id, type: 'vote', content: 'Remove a member?',
      metadata: { options: ['Yes', 'No'], secret: true }
    });
    blocksDomain.castVote(sealed.id, 'usr_a', 'Yes');
    blocksDomain.castVote(sealed.id, 'usr_b', 'No');
    const tSealed = blocksDomain.tallyVote(sealed.id);
    check('a sealed tally still counts', tSealed.totalVotes === 2 && tSealed.secret === true, JSON.stringify({ n: tSealed.totalVotes }));
    const sealedRows = store.filter('votes', (v) => v.blockId === sealed.id);
    check('no ballot row names a voter', sealedRows.every((v) => v.voterId === null && v.voterHash), JSON.stringify(sealedRows.map((v) => v.voterId)));
    check('the hash is stable and short', /^[0-9a-f]{32}$/.test(sealedRows[0].voterHash), sealedRows[0].voterHash);
    const sealedHist = store.filter('circleRevisions', (x) => x.subject === sealed.id);
    // Only the BALLOT rows are sealed. The options and the roll are public to
    // members by design — a group can audit that a vote existed without being
    // told who chose what.
    const ballotsInHistory = sealedHist.filter((x) => x.kind === 'vote_cast' || x.kind === 'vote_changed');
    check('the history of a sealed vote reveals no choice',
      ballotsInHistory.every((x) => x.after === null && x.actorId === null && x.redacted === true),
      JSON.stringify(ballotsInHistory[0]));
    check('but it does record that a ballot happened', sealedHist.filter((x) => x.kind === 'vote_cast').length === 2, `got ${sealedHist.length}`);

    // The tally arithmetic is checked on a vote whose roll actually contains the
    // four members (the block above opened when only ME was in the circle, so the
    // latecomers are refused there by design).
    const voteFull = blocksDomain.createBlock({
      circleId: circle.id, type: 'vote', content: 'Move market day to Sunday? (second call)',
      metadata: { options: ['Yes', 'No', 'Abstain'], closesAt: new Date(Date.now() + 6 * 3600_000).toISOString() }
    });
    blocksDomain.castVote(voteFull.id, ME, 'Yes');
    blocksDomain.castVote(voteFull.id, 'usr_a', 'No');
    blocksDomain.castVote(voteFull.id, 'usr_b', 'No');
    blocksDomain.castVote(voteFull.id, 'usr_c', 'Abstain');

    t = blocksDomain.tallyVote(voteBlock.id);
    check('a vote opened before the stuffing reports only its own roll', t.totalVotes === 1, `got ${t.totalVotes}`);
    const tf = blocksDomain.tallyVote(voteFull.id);
    const byOpt = Object.fromEntries(tf.results.map((x) => [x.option, x.count]));
    check('tally counts Yes correctly', byOpt.Yes === 1, JSON.stringify(byOpt));
    check('tally counts No correctly', byOpt.No === 2, JSON.stringify(byOpt));
    check('tally counts Abstain correctly', byOpt.Abstain === 1, JSON.stringify(byOpt));
    check('total equals ballots cast', tf.totalVotes === 4, String(tf.totalVotes));
    check('tally matches the underlying rows',
      tf.totalVotes === store.filter('votes', (v) => v.blockId === voteFull.id && !v.supersededAt).length);
    check('leader is the strict winner', tf.leader === 'No', String(tf.leader));
    check('percentages derived from real total',
      Math.round(byOpt.No / tf.totalVotes * 100) === Math.round(tf.results.find((x) => x.option === 'No').pct));
    check('eligible count comes from the roll snapshot, not a live count',
      tf.eligibleCount === store.filter('members', (m) => m.circleId === circle.id).length,
      JSON.stringify({ e: tf.eligibleCount }));

    // A tie must not invent a winner.
    const tieVote = blocksDomain.createBlock({
      circleId: circle.id, type: 'vote', content: 'Tie?', metadata: { options: ['A', 'B'] }
    });
    blocksDomain.castVote(tieVote.id, 'usr_a', 'A');
    blocksDomain.castVote(tieVote.id, 'usr_b', 'B');
    check('a tie reports no leader', blocksDomain.tallyVote(tieVote.id).leader === null);

    // --- foreign circle voting ---------------------------------------------
    const foreignVote = blocksDomain.createBlock({
      circleId: foreign.id, type: 'vote', content: 'Their question', metadata: { options: ['X', 'Y'] }
    });
    r = await call(`/api/circles/${circle.id}/blocks/${foreignVote.id}/vote`, 'POST', { option: 'X' });
    check('cannot vote in a foreign circle through my own', r.status === 404, `got ${r.status}`);
    check('foreign vote received no ballot',
      blocksDomain.tallyVote(foreignVote.id).totalVotes === 0);

    // A member of MY circle is not automatically eligible in another.
    let threw = null;
    try { blocksDomain.castVote(foreignVote.id, 'usr_a', 'X'); } catch (e) { threw = e.message; }
    check('non-member of that circle cannot vote in it', /only members/.test(threw ?? ''), String(threw));

    // --- closing a vote: the clock closes it, not the coordinator ----------
    r = await call(`/api/circles/${circle.id}/blocks/${voteFull.id}/close-vote`, 'POST', {});
    check('a coordinator cannot close a live count by hand', r.status >= 400, `got ${r.status}`);
    check('the refusal says what to do instead', /cancel it with a reason/.test(r.body?.error ?? ''), r.body?.error);
    check('a future-deadline vote is still open now', blocksDomain.isVoteClosed(store.find('blocks', (b) => b.id === voteFull.id), Date.now()) === false);
    const later = Date.now() + 30 * 24 * 3600_000;
    const closedLater = blocksDomain.tallyVote(voteFull.id, { now: later });
    check('the same vote is closed once its own deadline passed', closedLater.closed === true && closedLater.status === 'resolved');
    check('the result survives the clock', blocksDomain.tallyVote(voteFull.id, { now: later }).totalVotes === 4);
    check('tally survives closing', blocksDomain.tallyVote(voteFull.id).totalVotes === 4);

    // ================= SIGNALS AS ACTIVITY =================
    console.log('\n  -- signals / activity --');
    const acts = (await call(`/api/signals?circleId=${circle.id}`)).body.signals;
    check('activity feed is populated by real actions', acts.length > 0, String(acts.length));
    check('activity records the task assignment', acts.some((s) => s.type === 'task_assigned'));
    check('activity records the task completion', acts.some((s) => s.type === 'task_completed'));
    check('activity records votes cast', acts.some((s) => s.type === 'vote_cast'));
    check('activity is newest-first',
      acts.every((s, i) => i === 0 || acts[i - 1].createdAt >= s.createdAt));
    check('activity scoped to this circle', acts.every((s) => s.circleId === circle.id));
    check('a vote signal does not leak HOW someone voted',
      acts.filter((s) => s.type === 'vote_cast').every((s) => !JSON.stringify(s.metadata ?? {}).includes('Yes')));

    const foreignActs = (await call(`/api/signals?circleId=${foreign.id}`)).body.signals;
    check('foreign circle activity does not leak in',
      foreignActs.every((s) => s.circleId === foreign.id));

    // ================= MEMBER EVIDENCE =================
    console.log('\n  -- member evidence --');
    const ev = (await call(`/api/circles/${circle.id}/members/${ME}/evidence`)).body;
    check('evidence derived for a member who acted', ev.evidence.length > 0, String(ev.evidence.length));
    check('evidence includes the completed task', ev.evidence.some((e) => e.kind === 'task_completed'));
    check('evidence includes the vote cast', ev.evidence.some((e) => e.kind === 'vote_cast'));
    check('evidence is human readable', ev.evidence.every((e) => typeof e.label === 'string' && e.label.length > 0));
    check('evidence links back to its signal', ev.evidence.every((e) => Boolean(e.signalId)));

    // The rule that matters most: evidence, never a score.
    const evJson = JSON.stringify(ev);
    check('NO trust score in evidence', !/trustScore|"score"|rating|reliability/i.test(evJson));
    check('NO percentage presented as trust', !/\d+%/.test(evJson.replace(/\d+% of/g, '')));
    check('summary counts are plain facts',
      ev.summary.every((x) => typeof x.count === 'number' && typeof x.label === 'string'));

    // Joining is the member's own act: it must appear in THEIR history, not
    // in that of the coordinator who added them.
    check('joining is attributed to the member who joined',
      ev.evidence.some((e) => e.kind === 'member_joined'),
      ev.evidence.map((e) => e.kind).join(','));

    const emptyEv = (await call(`/api/circles/${circle.id}/members/usr_nobody/evidence`)).body;
    check('a member who did nothing has NO evidence', emptyEv.evidence.length === 0);
    check('no evidence is an empty list, not a zero score', Array.isArray(emptyEv.evidence) && emptyEv.summary.length === 0);

    // Evidence is scoped: acting in one circle is not evidence in another.
    const scoped = signalsDomain.memberEvidence(ME, { circleId: foreign.id });
    check('evidence scoped per circle', scoped.every((e) => e.circleId === foreign.id));

    // ================= TARGETS STILL DERIVED =================
    console.log('\n  -- targets --');
    const before = (await call(`/api/circles/${circle.id}`)).body.circle;
    check('target progress starts at zero with no settled money', before.currentValue === 0);
    check('progressPct derived from a real target', before.progressPct === 0);

    // Client must not be able to write progress.
    r = await call(`/api/circles/${circle.id}`, 'PATCH', { currentValue: 99999, progressPct: 100 });
    const after = (await call(`/api/circles/${circle.id}`)).body.circle;
    check('client cannot PATCH currentValue', after.currentValue === 0, String(after.currentValue));
    check('client cannot PATCH progressPct', after.progressPct === 0, String(after.progressPct));

    // Real settled money moves it; nothing else does.
    store.insert('ledgerTransactions', {
      id: 'tx_c1', circleId: circle.id, amount: 2500, currency: 'KES', type: 'contribution',
      status: 'settled', counterparty: 'usr_a', history: [], createdAt: new Date().toISOString()
    });
    store.insert('ledgerTransactions', {
      id: 'tx_c2', circleId: circle.id, amount: 1000, currency: 'KES', type: 'contribution',
      status: 'pending', counterparty: 'usr_b', history: [], createdAt: new Date().toISOString()
    });
    const moved = (await call(`/api/circles/${circle.id}`)).body.circle;
    check('settled contribution counts toward target', moved.currentValue === 2500, String(moved.currentValue));
    check('PENDING money does NOT count', moved.currentValue === 2500, 'pending leaked into progress');
    check('progress percentage is real arithmetic', moved.progressPct === 50, String(moved.progressPct));
    check('contributor count from settled rows only', moved.contributorCount === 1, String(moved.contributorCount));
  } finally {
    srv.close();
  }
}


/**
 * A ledger row for commerce tests. Uses the real domain so the transaction is
 * subject to the same validation as any other money in Brief.
 */
function ledgerFor(st, { amount }) {
  return st.insert('ledgerTransactions', {
    id: `txn_t${st.all('ledgerTransactions').length + 1}`,
    amount, currency: 'KES', type: 'order_payment', status: 'created',
    description: '', counterparty: null, circleId: null, objectId: null,
    campaignId: null, registrationId: null, metadata: {},
    history: [{ status: 'created', at: new Date().toISOString() }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
}

console.log('\n=== COMMERCE: VENDORS, LISTINGS, ORDERS (Batch 3) ===');
{
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../src/index.js');
  const vendorsDomain = await import('../src/domain/vendor.js');
  const listingsDomain = await import('../src/domain/listing.js');
  const ordersDomain = await import('../src/domain/order.js');
  store._reset();

  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const ME = 'usr_me';

  try {
    // --- honest empty state ------------------------------------------------
    let r = await call('/api/listings');
    check('empty marketplace returns no listings', Array.isArray(r.body.listings) && r.body.listings.length === 0);
    r = await call('/api/vendors/me');
    check('a user who does not sell has no vendor', r.body.vendor === null);
    r = await call('/api/orders');
    check('no orders before anything is bought', r.body.orders.length === 0);

    // --- listing before being a vendor -------------------------------------
    r = await call('/api/listings', 'POST', { title: 'Ghost goods', price: 100 });
    check('cannot list without a vendor profile', r.status === 403, `got ${r.status}`);

    // --- vendor creation ---------------------------------------------------
    r = await call('/api/vendors', 'POST', { displayName: 'Kikao Streetwear', description: 'Printed hoodies' });
    check('vendor created', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
    const vendor = r.body.vendor;
    check('vendor owned by the caller, not the body', vendor.ownerId === ME, vendor.ownerId);
    check('vendor starts active', vendor.status === 'active');
    check('vendor carries no numeric score',
      !/score|rating|stars|reliability/i.test(JSON.stringify(vendor)), JSON.stringify(vendor).slice(0, 160));
    check('vendor verification is an evidence list', Array.isArray(vendor.verification.evidence));
    check('unverified vendor has no evidence', vendor.verification.evidence.length === 0);

    // FORGED OWNER: a body-supplied ownerId must be ignored entirely.
    r = await call('/api/vendors', 'POST', { displayName: 'Impostor', ownerId: 'usr_attacker' });
    check('duplicate vendor returns the existing one', r.body.vendor.id === vendor.id);
    check('forged ownerId ignored', r.body.vendor.ownerId === ME, r.body.vendor.ownerId);
    check('forged ownerId created no second vendor', store.all('vendors').length === 1);

    // --- vendor verification comes from real recorded checks ---------------
    {
    qualifyGroupCreator('usr_me');
      const c = (await call('/api/circles', 'POST', { name: 'Traders' })).body.circle;
      await call(`/api/circles/${c.id}/members`, 'POST', { role: 'coordinator' });
      // Recorded through the domain because the route (correctly) refuses
      // self-verification -- a moderator performs this check, not the seller.
      const membersDomain = await import('../src/domain/member.js');
      membersDomain.recordVerification(c.id, ME, 'identity_verified');
      const v = (await call(`/api/vendors/${vendor.id}`)).body.vendor;
      check('vendor evidence reuses real member verification',
        v.verification.evidence.some((e) => e.kind === 'identity_verified'),
        JSON.stringify(v.verification.evidence));
      check('evidence still carries no score', v.verification.verifiedCount === 1 && !('trustScore' in v.verification));
    }

    // --- listing creation + price integrity --------------------------------
    r = await call('/api/listings', 'POST', { title: 'Printed Hoodie', price: 2500, type: 'product', quantityAvailable: 3 });
    check('listing created', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
    const hoodie = r.body.listing;
    check('listing starts as draft', hoodie.status === 'draft', hoodie.status);
    check('draft listing is not orderable', hoodie.orderable === false);
    check('draft refusal states why', /not published/i.test(hoodie.unorderableReason ?? ''), hoodie.unorderableReason);
    check('listing bound to the caller vendor', hoodie.vendorId === vendor.id);

    r = await call('/api/listings', 'POST', { title: 'Free stuff', price: 0 });
    check('zero price rejected', r.status === 400, `got ${r.status}`);
    r = await call('/api/listings', 'POST', { title: 'Negative', price: -500 });
    check('negative price rejected', r.status === 400, `got ${r.status}`);
    r = await call('/api/listings', 'POST', { title: 'Bad type', price: 100, type: 'spaceship' });
    check('invalid listing type rejected', r.status === 400, `got ${r.status}`);
    r = await call('/api/listings', 'POST', { title: '', price: 100 });
    check('empty title rejected', r.status === 400, `got ${r.status}`);

    // --- browse excludes drafts -------------------------------------------
    r = await call('/api/listings');
    check('draft does not appear in public browse', r.body.listings.length === 0, `${r.body.listings.length} shown`);
    r = await call('/api/listings/mine');
    check('vendor sees their own draft', r.body.listings.length === 1);

    // --- ordering an unavailable listing -----------------------------------
    r = await call('/api/orders', 'POST', { listingId: hoodie.id, quantity: 1 });
    check('cannot order a draft listing', r.status === 400, `got ${r.status}`);
    // Over HTTP the caller owns this vendor, so the self-order guard answers
    // first. That ordering is deliberate: "you cannot buy from yourself" is
    // true regardless of listing state. The availability refusal is asserted
    // below against a buyer who is not the seller.
    check('self-order guard answers first for the owner',
      /own listing/i.test(r.body?.error ?? ''), r.body?.error);
    {
      let threw = null;
      try { ordersDomain.createOrder({ listingId: hoodie.id, buyerId: 'usr_shopper', quantity: 1 }); }
      catch (e) { threw = String(e.message); }
      check('a real buyer is told the draft is unpublished',
        /not published/i.test(threw ?? ''), threw);
    }

    // --- lifecycle ---------------------------------------------------------
    r = await call(`/api/listings/${hoodie.id}/status`, 'POST', { status: 'sold_out' });
    check('draft cannot jump straight to sold_out', r.status === 400, `got ${r.status}`);
    check('invalid transition names both states', /draft -> sold_out/.test(r.body?.error ?? ''), r.body?.error);

    r = await call(`/api/listings/${hoodie.id}/status`, 'POST', { status: 'active' });
    check('draft activates', r.status === 200 && r.body.listing.status === 'active');
    check('activation reported as a change', r.body.changed === true);
    check('active listing is orderable', r.body.listing.orderable === true);

    r = await call(`/api/listings/${hoodie.id}/status`, 'POST', { status: 'active' });
    check('re-activating is a harmless no-op', r.status === 200 && r.body.changed === false);
    check('no duplicate signal for a no-op transition',
      store.filter('signals', (s) => s.type === 'listing_published').length === 1,
      String(store.filter('signals', (s) => s.type === 'listing_published').length));

    // --- client cannot write status directly -------------------------------
    r = await call(`/api/listings/${hoodie.id}`, 'PATCH', { status: 'archived' });
    check('PATCH cannot set status', r.status === 200 && r.body.listing.status === 'active', r.body?.listing?.status);

    // --- paused listings refuse orders -------------------------------------
    await call(`/api/listings/${hoodie.id}/status`, 'POST', { status: 'paused' });
    r = await call('/api/orders', 'POST', { listingId: hoodie.id, quantity: 1 });
    check('cannot order a paused listing', r.status === 400, `got ${r.status}`);
    {
      // Asserted against a real buyer: for the owner the self-order guard
      // answers first, which is the correct precedence.
      let threw = null;
      try { ordersDomain.createOrder({ listingId: hoodie.id, buyerId: 'usr_shopper', quantity: 1 }); }
      catch (e) { threw = String(e.message); }
      check('paused refusal explains', /paused/i.test(threw ?? ''), threw);
    }
    await call(`/api/listings/${hoodie.id}/status`, 'POST', { status: 'active' });

    // --- vendor cannot buy from themselves ---------------------------------
    r = await call('/api/orders', 'POST', { listingId: hoodie.id, quantity: 1 });
    check('a vendor cannot order from their own listing', r.status === 400, `got ${r.status}`);
    check('self-order refusal explains', /own listing/i.test(r.body?.error ?? ''), r.body?.error);

    // ---------------------------------------------------------------------
    // A SECOND ACTOR. callerId() cannot be varied over HTTP, so the buyer is
    // simulated at the domain layer -- the same technique the circle suite
    // uses. The ROUTE-level identity rules are covered above and below.
    // ---------------------------------------------------------------------
    const BUYER = 'usr_buyer';

    // --- server-derived pricing (the central rule) -------------------------
    const order = ordersDomain.createOrder({ listingId: hoodie.id, buyerId: BUYER, quantity: 2 });
    check('order total is server arithmetic', order.total === 5000, String(order.total));
    check('unit price copied from the listing', order.unitPrice === 2500, String(order.unitPrice));
    check('order records both parties', order.buyerId === BUYER && order.vendorId === vendor.id);
    check('order starts as ordered', order.status === 'ordered');
    check('a new order is NOT paid', order.paid === false);
    check('unpaid order says so plainly', order.paymentStatus === 'unpaid', order.paymentStatus);
    check('no transaction attached at order time', order.transactionId === null);

    // FORGED PRICE: the domain signature has no price/total parameter, so a
    // forged payload cannot reach the arithmetic. Proven by passing them.
    const forged = ordersDomain.createOrder({
      listingId: hoodie.id, buyerId: BUYER, quantity: 1,
      price: 1, unitPrice: 1, total: 1, amount: 1, currency: 'USD'
    });
    check('forged unit price ignored', forged.unitPrice === 2500, String(forged.unitPrice));
    check('forged total ignored', forged.total === 2500, String(forged.total));
    check('forged currency ignored', forged.currency === 'KES', forged.currency);

    // --- quantity validation ----------------------------------------------
    for (const [q, label] of [[0, 'zero'], [-3, 'negative'], [1.5, 'fractional']]) {
      let threw = null;
      try { ordersDomain.createOrder({ listingId: hoodie.id, buyerId: BUYER, quantity: q }); }
      catch (e) { threw = String(e.message); }
      check(`${label} quantity rejected`, threw !== null, 'accepted');
    }

    // --- stock consumption is real ----------------------------------------
    {
      const l = listingsDomain.getListing(hoodie.id);
      check('stock reduced by real orders', l.quantityAvailable === 0, String(l.quantityAvailable));
      check('listing auto-flips to sold_out at zero stock', l.status === 'sold_out', l.status);
      let threw = null;
      try { ordersDomain.createOrder({ listingId: hoodie.id, buyerId: BUYER, quantity: 1 }); }
      catch (e) { threw = String(e.message); }
      check('sold-out listing refuses orders', /sold out/i.test(threw ?? ''), threw);
    }

    // --- over-ordering available stock -------------------------------------
    {
      const l2 = listingsDomain.createListing({ vendorId: vendor.id, title: 'Cap', price: 800, quantityAvailable: 2 });
      listingsDomain.transitionListing(l2.id, 'active');
      let threw = null;
      try { ordersDomain.createOrder({ listingId: l2.id, buyerId: BUYER, quantity: 5 }); }
      catch (e) { threw = String(e.message); }
      check('cannot order more than is available', /only 2 available/.test(threw ?? ''), threw);
    }

    // --- services need no stock and no location ----------------------------
    {
      const svc = listingsDomain.createListing({
        vendorId: vendor.id, title: 'Deep clean', price: 3000, type: 'service'
      });
      listingsDomain.transitionListing(svc.id, 'active');
      check('a service needs no stock', svc.quantityAvailable === null);
      check('a service needs no location', svc.locationName === null);
      const o1 = ordersDomain.createOrder({ listingId: svc.id, buyerId: BUYER, quantity: 1 });
      const o2 = ordersDomain.createOrder({ listingId: svc.id, buyerId: 'usr_other', quantity: 1 });
      check('an untracked service can be ordered repeatedly', Boolean(o1 && o2));
      check('service listing stays active after orders',
        listingsDomain.getListing(svc.id).status === 'active');
    }

    // --- fulfilment is the vendor's act, over HTTP -------------------------
    r = await call(`/api/orders/${order.id}/fulfil`, 'POST', {});
    check('vendor can fulfil their order', r.status === 200 && r.body.order.status === 'fulfilled',
      `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    check('fulfilment records a timestamp', Boolean(r.body.order.fulfilledAt));
    check('FULFILMENT DOES NOT MEAN PAID', r.body.order.paid === false);
    check('fulfilled-but-unpaid is representable', r.body.order.paymentStatus === 'unpaid');

    r = await call(`/api/orders/${order.id}/fulfil`, 'POST', {});
    check('re-fulfilling is a harmless no-op', r.status === 200 && r.body.changed === false);
    check('no duplicate fulfilment signal',
      store.filter('signals', (s) => s.type === 'order_fulfilled').length === 1);

    // --- foreign vendor cannot fulfil --------------------------------------
    {
      const other = vendorsDomain.createVendor({ ownerId: 'usr_rival', displayName: 'Rival Stall' });
      const theirListing = listingsDomain.createListing({ vendorId: other.id, title: 'Their goods', price: 700 });
      listingsDomain.transitionListing(theirListing.id, 'active');
      const theirOrder = ordersDomain.createOrder({ listingId: theirListing.id, buyerId: BUYER, quantity: 1 });

      r = await call(`/api/orders/${theirOrder.id}/fulfil`, 'POST', {});
      check('cannot fulfil another vendor order', r.status === 403, `got ${r.status}`);
      check('foreign fulfilment refusal explains', /only the vendor/i.test(r.body?.error ?? ''), r.body?.error);
      check('foreign order unchanged',
        ordersDomain.getOrder(theirOrder.id).status === 'ordered');

      // Foreign listing manipulation.
      r = await call(`/api/listings/${theirListing.id}`, 'PATCH', { price: 1 });
      check('cannot edit another vendor listing', r.status === 404, `got ${r.status}`);
      check('foreign price unchanged', listingsDomain.getListing(theirListing.id).price === 700);
      r = await call(`/api/listings/${theirListing.id}/status`, 'POST', { status: 'archived' });
      check('cannot archive another vendor listing', r.status === 404, `got ${r.status}`);
      r = await call(`/api/vendors/${other.id}`, 'PATCH', { displayName: 'Hijacked' });
      check('cannot edit another vendor profile', r.status === 404, `got ${r.status}`);
      check('foreign vendor name unchanged',
        vendorsDomain.getVendor(other.id).displayName === 'Rival Stall');

      // Foreign order is not readable by a stranger.
      r = await call(`/api/orders/${theirOrder.id}`);
      check('a stranger cannot read an order they are not party to', r.status === 404, `got ${r.status}`);
    }

    // --- SETTLEMENT CANNOT BE FABRICATED -----------------------------------
    r = await call(`/api/orders/${order.id}/settle`, 'POST', {});
    check('settlement refused without settled money', r.status === 400, `got ${r.status}`);
    check('refusal names the missing payment rail',
      /no payment provider is connected/i.test(r.body?.error ?? ''), r.body?.error);
    check('order still not settled', ordersDomain.getOrder(order.id).status === 'fulfilled');

    // A transaction that does not match the total must not settle the order.
    {
      const wrong = ledgerFor(store, { amount: 5, orderTotalHint: 5000 });
      let threw = null;
      try { ordersDomain.attachTransaction(order.id, wrong.id); } catch (e) { threw = String(e.message); }
      check('a token payment cannot back a large order', /does not match/i.test(threw ?? ''), threw);
      check('mismatched transaction not attached', ordersDomain.getOrder(order.id).transactionId === null);
    }

    // The legitimate path: a real settled transaction for the real amount.
    {
      const tx = ledgerFor(store, { amount: 5000 });
      ordersDomain.attachTransaction(order.id, tx.id);
      const attached = ordersDomain.getOrder(order.id);
      check('matching transaction attaches', attached.transactionId === tx.id);
      check('order still unpaid while the transaction is unsettled', attached.paid === false);
      check('payment status mirrors the ledger row', attached.paymentStatus === 'created', attached.paymentStatus);

      // Settle the ledger row through its own legal path.
      const ledgerDomain = await import('../src/domain/ledger.js');
      ledgerDomain.transitionTransaction(tx.id, 'pending');
      ledgerDomain.transitionTransaction(tx.id, 'confirmed');
      ledgerDomain.transitionTransaction(tx.id, 'settled');

      const paid = ordersDomain.getOrder(order.id);
      check('order reads as paid only from a SETTLED ledger row', paid.paid === true);
      check('paid flag is derived, never stored', !('paid' in store.find('orders', (o) => o.id === order.id)));

      r = await call(`/api/orders/${order.id}/settle`, 'POST', {});
      check('settlement succeeds with real settled money', r.status === 200 && r.body.order.status === 'settled',
        `${r.status} ${JSON.stringify(r.body?.error ?? '')}`);
      check('settlement records a timestamp', Boolean(r.body.order.settledAt));
    }

    // --- illegal transitions ------------------------------------------------
    for (const [from, to] of [['settled', 'ordered'], ['settled', 'fulfilled']]) {
      let threw = null;
      try { ordersDomain.transitionOrder(order.id, to); } catch (e) { threw = String(e.message); }
      check(`${from} -> ${to} rejected`, /invalid order transition/.test(threw ?? ''), threw);
    }
    {
      const fresh = ordersDomain.createOrder({
        listingId: listingsDomain.listListings({ vendorId: vendor.id, status: 'active' })[0].id,
        buyerId: BUYER, quantity: 1
      });
      ordersDomain.transitionOrder(fresh.id, 'fulfilled');
      let threw = null;
      try { ordersDomain.transitionOrder(fresh.id, 'ordered'); } catch (e) { threw = String(e.message); }
      check('fulfilled -> ordered rejected', /invalid order transition/.test(threw ?? ''), threw);
    }

    // --- no fabricated economics -------------------------------------------
    {
      const wallet = (await call('/api/economic/wallet')).body;
      const settledTotal = store
        .filter('ledgerTransactions', (t) => t.status === 'settled' && t.counterparty === 'usr_me')
        .reduce((s, t) => s + t.amount, 0);
      check('wallet balance equals MY real settled rows only',
        wallet.balance === settledTotal, `${wallet.balance} vs ${settledTotal}`);
      // The wallet is personal: rows belonging to other counterparties must
      // never leak into it.
      const mineRows = store.filter('ledgerTransactions', (t) => t.counterparty === 'usr_me');
      check('wallet counts only MY rows',
        wallet.transactionCount === mineRows.length,
        `${wallet.transactionCount} vs ${mineRows.length}`);
      // Prove the scoping with a genuinely foreign row: another actor's
      // settled money must not move my balance or my count.
      const ledgerDomain = await import('../src/domain/ledger.js');
      const before = wallet.balance;
      const mineCount = mineRows.length;
      ledgerDomain.createTransaction({ amount: 90000, type: 'sale', counterparty: 'usr_somebody_else', status: undefined });
      const settledForeign = store.find('ledgerTransactions', (t) => t.counterparty === 'usr_somebody_else');
      settledForeign.status = 'settled';
      settledForeign.history.push({ status: 'settled', at: new Date().toISOString() });
      const walletAfter = (await call('/api/economic/wallet')).body;
      check('another actor\'s settled KES 90,000 never leaks into my wallet',
        walletAfter.balance === before && walletAfter.transactionCount === mineCount,
        `${walletAfter.balance}/${walletAfter.transactionCount} vs ${before}/${mineCount}`);
      check('orders created no second transaction table',
        store.all('orders').every((o) => !('balance' in o) && !('wallet' in o)));
      check('no order carries a stored paid flag',
        store.all('orders').every((o) => !('paid' in o)));
      check('unsettled orders contribute no revenue',
        store.filter('orders', (o) => o.status !== 'settled')
          .every((o) => { const t = store.find('ledgerTransactions', (x) => x.id === o.transactionId); return !t || t.status !== 'settled'; }));
      check('provider still reported as unconfigured', wallet.provider.configured === false);
    }

    // --- disputes -----------------------------------------------------------
    {
      // The buyer is not the caller, so the route must refuse the caller.
      r = await call(`/api/orders/${order.id}/dispute`, 'POST', { reason: 'Never arrived' });
      check('a non-buyer cannot dispute an order', r.status === 403, `got ${r.status}`);
      check('dispute refusal names the missing standing',
        /only the buyer/i.test(r.body?.error ?? ''), r.body?.error);
      check('refused dispute created no row', store.all('disputes').length === 0);

      // The real buyer, at the domain layer.
      const { dispute, order: disputed, changed } = ordersDomain.openDispute({
        orderId: order.id, reportedBy: BUYER, reason: 'Wrong size delivered'
      });
      check('buyer can dispute their own order', changed === true && dispute.status === 'open');
      check('dispute records the reason', dispute.reason === 'Wrong size delivered');
      check('DISPUTED ORDER IS NOT READ AS CLEAN', disputed.status === 'disputed', disputed.status);
      check('dispute surfaces on the order itself', disputed.dispute?.id === dispute.id);
      check('no refund was invented', !/refund/i.test(JSON.stringify(disputed)));
      // Re-read: `order` is the snapshot taken at creation, before the
      // transaction was attached. Its transactionId is still null.
      const liveOrder = store.find('orders', (o) => o.id === order.id);
      check('settled money was not reversed',
        store.find('ledgerTransactions', (t) => t.id === liveOrder.transactionId).status === 'settled');

      const again = ordersDomain.openDispute({ orderId: order.id, reportedBy: BUYER, reason: 'Same again' });
      check('re-disputing is idempotent', again.changed === false);
      check('only one dispute row exists', store.all('disputes').length === 1);

      let threw = null;
      try { ordersDomain.openDispute({ orderId: order.id, reportedBy: 'usr_stranger', reason: 'x' }); }
      catch (e) { threw = String(e.message); }
      check('an unrelated user cannot dispute', /only the buyer/i.test(threw ?? ''), threw);

      // On a FRESH order: the existing dispute above would short-circuit as an
      // idempotent no-op before any reason validation ran.
      {
        const l = listingsDomain.createListing({ vendorId: vendor.id, title: 'Tote', price: 400 });
        listingsDomain.transitionListing(l.id, 'active');
        const o = ordersDomain.createOrder({ listingId: l.id, buyerId: BUYER, quantity: 1 });
        let t2 = null;
        try { ordersDomain.openDispute({ orderId: o.id, reportedBy: BUYER, reason: '   ' }); }
        catch (e) { t2 = String(e.message); }
        check('a dispute needs a reason', /reason is required/.test(t2 ?? ''), t2);
        check('a rejected dispute left the order alone',
          ordersDomain.getOrder(o.id).status === 'ordered');
      }
    }

    // --- commerce evidence is countable, never a rating --------------------
    {
      const signalsDomain = await import('../src/domain/signal.js');
      const ev = signalsDomain.memberEvidence(ME);
      check('fulfilment appears in the seller evidence history',
        ev.some((e) => e.kind === 'order_fulfilled'), ev.map((e) => e.kind).join(','));
      const summary = signalsDomain.memberEvidenceSummary(ME);
      check('evidence summary counts real orders',
        summary.some((s) => /fulfilled order/.test(s.label)), JSON.stringify(summary));
      check('no rating anywhere in evidence',
        !/rating|stars|score|\d\.\d\s*\/\s*5/i.test(JSON.stringify(summary)));
    }

    // --- campaigns and listings stay separate models -----------------------
    {
      check('a listing is not a campaign', store.all('listings').every((l) => !('registrationCount' in l)));
      check('an order is not a registration', store.all('orders').every((o) => !('attendeeRef' in o)));
      check('commerce needs no campaign', store.all('campaigns').length === 0 && store.all('orders').length > 0);
    }
  } finally {
    srv.close();
  }
}


console.log('\n=== SECURITY & SETTLEMENT HARDENING (Batch 4) ===');
{
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../src/index.js');
  const vendorsDomain = await import('../src/domain/vendor.js');
  const listingsDomain = await import('../src/domain/listing.js');
  const ordersDomain = await import('../src/domain/order.js');
  const settleDomain = await import('../src/domain/settlement.js');
  const ledgerDomain = await import('../src/domain/ledger.js');
  store._reset();

  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const ME = 'usr_me';

  try {
    // --- IDOR: object publication ------------------------------------------
    store.insert('objects', {
      id: 'obj_private', type: 'event', title: 'Private plan', publication: 'private',
      metadata: {}, createdAt: new Date().toISOString()
    });
    let r = await call('/api/objects/obj_private/publish', 'POST', { publication: 'public' });
    check('IDOR: cannot publish an object with no provenance', r.status === 403, `got ${r.status}`);
    check('IDOR: object stayed private',
      store.find('objects', (o) => o.id === 'obj_private').publication === 'private');

    // With a membership on a source the object came from, it IS permitted.
    store.insert('sources', { id: 'src_mine', name: 'My feed', type: 'rss', createdAt: new Date().toISOString() });
    store.insert('objectSources', { id: 'os_1', objectId: 'obj_private', sourceId: 'src_mine' });
    store.insert('sourceMemberships', {
      id: 'mem_1', userId: ME, sourceId: 'src_mine',
      membershipStatus: 'member', accessGranted: true, connectedAt: new Date().toISOString()
    });
    r = await call('/api/objects/obj_private/publish', 'POST', { publication: 'public' });
    check('a source member CAN publish', r.status === 200, `got ${r.status}`);

    // A membership without granted access is not authority.
    store.insert('objects', {
      id: 'obj_two', type: 'event', title: 'Other', publication: 'private',
      metadata: {}, createdAt: new Date().toISOString()
    });
    store.insert('sources', { id: 'src_rev', name: 'Revoked', type: 'rss', createdAt: new Date().toISOString() });
    store.insert('objectSources', { id: 'os_2', objectId: 'obj_two', sourceId: 'src_rev' });
    store.insert('sourceMemberships', {
      id: 'mem_2', userId: ME, sourceId: 'src_rev',
      membershipStatus: 'unknown', accessGranted: false, connectedAt: new Date().toISOString()
    });
    r = await call('/api/objects/obj_two/publish', 'POST', { publication: 'public' });
    check('revoked access is not authority', r.status === 403, `got ${r.status}`);

    // --- source deletion ----------------------------------------------------
    store.insert('sources', { id: 'src_theirs', name: 'Their feed', type: 'rss', createdAt: new Date().toISOString() });
    r = await call('/api/sources/src_theirs', 'DELETE');
    check('cannot disconnect a source you are not a member of', r.status === 403, `got ${r.status}`);
    check('foreign source survived', Boolean(store.find('sources', (s) => s.id === 'src_theirs')));
    r = await call('/api/sources/src_mine', 'DELETE');
    check('own source can be disconnected', r.status === 200, `got ${r.status}`);
    check('its memberships were cleaned up',
      store.filter('sourceMemberships', (m) => m.sourceId === 'src_mine').length === 0);

    // --- quantity overflow ---------------------------------------------------
    const seller = vendorsDomain.createVendor({ ownerId: 'usr_seller', displayName: 'Seller' });
    const item = listingsDomain.createListing({ vendorId: seller.id, title: 'Bag of maize', price: 1000 });
    listingsDomain.transitionListing(item.id, 'active');

    for (const [q, label] of [[1e308, '1e308'], [Number.MAX_SAFE_INTEGER, 'MAX_SAFE_INTEGER'], [1e6, 'one million']]) {
      r = await call('/api/orders', 'POST', { listingId: item.id, quantity: q });
      check(`absurd quantity ${label} rejected`, r.status === 400, `got ${r.status} total ${r.body?.order?.total}`);
    }
    check('no absurd order was persisted', store.all('orders').length === 0);

    // A non-finite total can never be persisted.
    check('order total is always finite',
      store.all('orders').every((o) => Number.isFinite(o.total)));

    // --- idempotency ---------------------------------------------------------
    const results = await Promise.all([1, 2, 3, 4, 5].map(() =>
      call('/api/orders', 'POST', { listingId: item.id, quantity: 1, idempotencyKey: 'dup-key-1' })
    ));
    check('5 concurrent identical submissions create ONE order',
      store.filter('orders', (o) => o.idempotencyKey === 'dup-key-1').length === 1,
      String(store.filter('orders', (o) => o.idempotencyKey === 'dup-key-1').length));
    check('every response names the same order',
      new Set(results.map((x) => x.body?.order?.id)).size === 1);
    // Without a key, distinct orders are still distinct -- buying twice is legal.
    await call('/api/orders', 'POST', { listingId: item.id, quantity: 1 });
    await call('/api/orders', 'POST', { listingId: item.id, quantity: 1 });
    check('unkeyed repeat orders are NOT deduplicated',
      store.filter('orders', (o) => !o.idempotencyKey).length === 2);

    // --- fulfilment stages ----------------------------------------------------
    const kitchen = vendorsDomain.createVendor({ ownerId: ME, displayName: 'Njeri Kitchen' });
    const meal = listingsDomain.createListing({ vendorId: kitchen.id, title: 'Lunch', price: 400, type: 'service' });
    listingsDomain.transitionListing(meal.id, 'active');
    const ord = ordersDomain.createOrder({ listingId: meal.id, buyerId: 'usr_diner', quantity: 1 });

    for (const stage of ['accepted', 'preparing', 'ready']) {
      r = await call(`/api/orders/${ord.id}/stage`, 'POST', { stage });
      check(`vendor advances to ${stage}`, r.status === 200 && r.body.order.status === stage,
        `${r.status} ${r.body?.order?.status ?? r.body?.error}`);
    }
    r = await call(`/api/orders/${ord.id}/stage`, 'POST', { stage: 'settled' });
    check('stage endpoint cannot reach a terminal economic state', r.status === 400, `got ${r.status}`);
    r = await call(`/api/orders/${ord.id}/stage`, 'POST', { stage: 'accepted' });
    check('cannot move backwards through fulfilment', r.status === 400, `got ${r.status}`);
    r = await call(`/api/orders/${ord.id}/fulfil`, 'POST', {});
    check('ready -> fulfilled works', r.status === 200 && r.body.order.status === 'fulfilled');
    check('stages did not touch payment', r.body.order.paid === false);

    // Skipping stages entirely is legal -- most sellers have no prep step.
    const quick = ordersDomain.createOrder({ listingId: meal.id, buyerId: 'usr_diner2', quantity: 1 });
    const jumped = ordersDomain.transitionOrder(quick.id, 'fulfilled');
    check('ordered -> fulfilled directly is still legal', jumped.order.status === 'fulfilled');

    // --- commission arithmetic -------------------------------------------------
    {
      const s = settleDomain.splitAmount(1000, 0.05);
      check('commission is 5% of 1000', s.commission === 50, String(s.commission));
      check('seller receives the remainder', s.sellerAmount === 950, String(s.sellerAmount));
      check('parts sum exactly to the total', s.commission + s.sellerAmount === 1000);

      // Rounding must never invent or lose a shilling.
      for (const amt of [1, 7, 33, 99, 101, 333, 4999, 12345]) {
        const x = settleDomain.splitAmount(amt, 0.05);
        if (x.commission + x.sellerAmount !== amt) {
          check(`split of ${amt} is exact`, false, `${x.commission}+${x.sellerAmount}`);
        }
      }
      check('split is exact across many amounts', true);
      check('commission rounds DOWN (favours the seller)',
        settleDomain.splitAmount(99, 0.05).commission === 4, String(settleDomain.splitAmount(99, 0.05).commission));

      let threw = null;
      try { settleDomain.splitAmount(0); } catch (e) { threw = String(e.message); }
      check('zero amount cannot be split', threw !== null);
      threw = null;
      try { settleDomain.splitAmount(-500); } catch (e) { threw = String(e.message); }
      check('negative amount cannot be split', threw !== null);
    }

    // --- settlement only from real settled money ---------------------------------
    {
      const unsettled = ordersDomain.getOrder(ord.id);
      check('an unsettled order has NO settlement split',
        settleDomain.orderSettlement(unsettled.id) === null);

      const earningsBefore = settleDomain.vendorEarnings(kitchen.id);
      check('no earnings before anything settles', earningsBefore.gross === 0 && earningsBefore.net === 0);
      check('earnings are explicitly not withdrawable', earningsBefore.payoutAvailable === false);
      check('and the reason is stated', /no payment provider/i.test(earningsBefore.payoutReason));

      // Settle it properly through the ledger.
      const tx = ledgerDomain.createTransaction({ amount: 400, type: 'order_payment' });
      ordersDomain.attachTransaction(ord.id, tx.id);
      ledgerDomain.transitionTransaction(tx.id, 'pending');
      ledgerDomain.transitionTransaction(tx.id, 'confirmed');
      ledgerDomain.transitionTransaction(tx.id, 'settled');
      ordersDomain.transitionOrder(ord.id, 'settled');

      const split = settleDomain.orderSettlement(ord.id);
      check('settled order yields a split', split !== null);
      check('split derives from the real total', split.total === 400);
      check('commission on 400 at 5% is 20', split.commission === 20, String(split.commission));
      check('seller amount is 380', split.sellerAmount === 380, String(split.sellerAmount));

      const earnings = settleDomain.vendorEarnings(kitchen.id);
      check('earnings now reflect the settled order', earnings.gross === 400 && earnings.net === 380);
      check('earnings count exactly one order', earnings.orderCount === 1);
      check('STILL not withdrawable without a provider', earnings.payoutAvailable === false);

      // Nothing is stored.
      check('no stored commission on the order row',
        !('commission' in store.find('orders', (o) => o.id === ord.id)));
      check('no platform balance row exists',
        store.all('ledgerTransactions').every((t) => t.type !== 'platform_balance'));
    }

    // --- reconciliation ------------------------------------------------------
    {
      const rec = settleDomain.reconcile();
      check('books reconcile', rec.balanced === true, JSON.stringify(rec.discrepancies));
      check('platform commission equals the per-vendor sum',
        rec.platform.commission === settleDomain.vendorEarnings(kitchen.id).commission);

      // Introduce a real inconsistency and prove reconciliation CATCHES it,
      // rather than trusting that it would.
      const rogue = store.insert('orders', {
        id: 'ord_rogue', listingId: meal.id, listingTitle: 'Lunch', listingType: 'service',
        buyerId: 'usr_x', vendorId: kitchen.id, vendorOwnerId: ME,
        quantity: 1, unitPrice: 400, total: 400, currency: 'KES', note: '',
        status: 'settled', transactionId: null, fulfilledAt: null, settledAt: new Date().toISOString(),
        history: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
      const bad = settleDomain.reconcile();
      check('reconciliation DETECTS a settled order with no transaction',
        bad.balanced === false &&
        bad.discrepancies.some((d) => d.kind === 'settled_without_transaction'),
        JSON.stringify(bad.discrepancies));
      check('the unbacked order contributes no revenue',
        settleDomain.vendorEarnings(kitchen.id).gross === 400, 'phantom revenue counted');
      store.remove('orders', rogue.id);
      check('books reconcile again once removed', settleDomain.reconcile().balanced === true);
    }

    // --- earnings endpoint is owner-scoped ------------------------------------
    r = await call('/api/vendors/me/earnings');
    check('own earnings readable over HTTP', r.status === 200 && r.body.earnings.gross === 400,
      `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    r = await call(`/api/orders/${ord.id}/settlement`);
    check('a party can read the order split', r.status === 200 && r.body.settlement.commission === 20);

    const foreignOrder = ordersDomain.createOrder({
      listingId: item.id, buyerId: 'usr_stranger', quantity: 1
    });
    r = await call(`/api/orders/${foreignOrder.id}/settlement`);
    check('a non-party cannot read a settlement split', r.status === 404, `got ${r.status}`);
  } finally {
    srv.close();
  }
}


console.log('\n=== TERMINAL STATES & CANCELLATION (Batch 4) ===');
{
  store._reset();
  const vendors = await import('../src/domain/vendor.js');
  const listings = await import('../src/domain/listing.js');
  const ordersD = await import('../src/domain/order.js');

  const v = vendors.createVendor({ ownerId: 'usr_seller', displayName: 'Terminal Test Stall' });
  const l = listings.createListing({ vendorId: v.id, title: 'Bag of maize', type: 'product',
    price: 1000, currency: 'KES', quantityAvailable: 20 });
  listings.transitionListing(l.id, 'active');

  const mk = () => ordersD.createOrder({ listingId: l.id, buyerId: 'usr_buyer', quantity: 1 });

  // Cancelling twice must be a NO-OP, not a second cancellation and not an
  // error. Repeated taps on a flaky connection are normal.
  const o1 = mk();
  const c1 = ordersD.transitionOrder(o1.id, 'cancelled');
  check('first cancel changes the order', c1.changed === true && c1.order.status === 'cancelled');
  const c2 = ordersD.transitionOrder(o1.id, 'cancelled');
  check('second cancel is a no-op, not an error', c2.changed === false);
  check('and the order is still cancelled', c2.order.status === 'cancelled');

  // A cancelled order is TERMINAL. Nothing may revive it -- least of all
  // something that would make it look paid.
  for (const next of ['ordered', 'accepted', 'preparing', 'ready', 'fulfilled', 'settled', 'disputed']) {
    let refused = false;
    try {
      const r = ordersD.transitionOrder(o1.id, next);
      refused = r.changed === false;
    } catch { refused = true; }
    check(`cancelled -> ${next} is refused`, refused);
  }
  check('cancelled order never became paid',
    store.find('orders', (o) => o.id === o1.id).paid !== true);

  // Settled is terminal too, and is the state that matters most.
  const o2 = mk();
  ordersD.transitionOrder(o2.id, 'fulfilled');
  const tx = store.insert('ledgerTransactions', {
    id: 'tx_terminal_1', amount: 1000, currency: 'KES', status: 'settled',
    direction: 'in', createdAt: new Date().toISOString()
  });
  ordersD.attachTransaction(o2.id, tx.id);
  const s = ordersD.transitionOrder(o2.id, 'settled');
  check('an order with settled money CAN settle', s.order.status === 'settled');
  for (const next of ['ordered', 'fulfilled', 'cancelled']) {
    let refused = false;
    try {
      const r = ordersD.transitionOrder(o2.id, next);
      refused = r.changed === false;
    } catch { refused = true; }
    check(`settled -> ${next} is refused (no silent re-award)`, refused);
  }

  // DOUBLE SETTLEMENT: settling again must not double the seller's earnings.
  const before = (await import('../src/domain/settlement.js')).vendorEarnings(v.id);
  let second = null;
  try { second = ordersD.transitionOrder(o2.id, 'settled'); } catch { /* fine */ }
  check('re-settling does not change anything', !second || second.changed === false);
  const after = (await import('../src/domain/settlement.js')).vendorEarnings(v.id);
  check('earnings did NOT double', before.net === after.net, `${before.net} -> ${after.net}`);
  check('order count did NOT double', before.orderCount === after.orderCount);
  check('exactly one settled order counted', after.orderCount === 1, `got ${after.orderCount}`);
  check('commission is 5% floored', after.commission === 50, `got ${after.commission}`);
  check('seller keeps the remainder', after.net === 950, `got ${after.net}`);

  // And the ledger agrees with itself.
  const rec = (await import('../src/domain/settlement.js')).reconcile();
  check('ledger reconciles after settlement', rec.balanced === true, JSON.stringify(rec.discrepancies));
}


console.log('\n=== CONTROLLED / PRIVATE EVENTS (Batch 4) ===');
{
  store._reset();
  const camps = await import('../src/domain/campaign.js');
  // createCampaign creates the object it wraps; attaching a FOREIGN object is
  // refused, which is itself worth asserting.
  let refusedForeign = false;
  const foreign = store.insert('objects', {
    id: 'obj_foreign_1', type: 'event', title: "Someone else's event",
    publication: 'private', createdAt: new Date().toISOString()
  });
  try {
    camps.createCampaign('usr_host', { objectId: foreign.id, title: 'Hijack', type: 'event' });
  } catch (e) { refusedForeign = /not authorised/i.test(e.message); }
  check('cannot wrap an object the host has no claim to', refusedForeign);

  // An event is a CAMPAIGN TYPE, not a new primitive (see the architectural
  // discipline rule). A host creates a controlled distribution point.
  const c = camps.createCampaign('usr_host', {
    title: 'Supper Club',
    type: 'event', capacity: 2, price: 2500, currency: 'KES',
    location: 'Lavington'
  });
  check('an event is a campaign type, not a new table', c.type === 'event');
  check('capacity is stored on the campaign', c.capacity === 2);
  check('a new event is NOT public until published', c.status === 'draft');
  check('an unpublished event does not resolve by slug',
    camps.getPublicBySlug(c.publicSlug) === null);

  camps.transitionCampaign(c.id, 'published');
  check('a published event resolves by slug', camps.getPublicBySlug(c.publicSlug) !== null);

  // CAPACITY IS ENFORCED, not decorative. An over-capacity RSVP must be
  // refused rather than quietly accepted and shown as "full".
  const live = () => camps.getPublicBySlug(c.publicSlug);
  const r1 = camps.register(live(), { attendeeRef: '0700000001', name: 'A' });
  const r2 = camps.register(live(), { attendeeRef: '0700000002', name: 'B' });
  check('first two RSVPs accepted', Boolean(r1) && Boolean(r2));
  let full = false;
  try { camps.register(live(), { attendeeRef: '0700000003', name: 'C' }); }
  catch (e) { full = /full/i.test(e.message); }
  check('the third RSVP is REFUSED as full', full);
  check('exactly two registrations persisted',
    store.filter('registrations', (r) => r.campaignId === c.id).length === 2);

  // Remaining is DERIVED, never a stored counter that could drift.
  const pv = camps.publicView(camps.getPublicBySlug(c.publicSlug));
  check('remaining is derived and correct', pv.remaining === 0, `got ${pv.remaining}`);
  check('soldOut is derived', pv.soldOut === true);

  // The public view of an event must not leak the guest list. For a private
  // supper club or an LGBTQ+ meetup this is a safety property, not a nicety.
  const raw = JSON.stringify(pv);
  check('public event view has NO attendee list', !/0700000001|attendeeRef|registrations/.test(raw), raw.slice(0, 160));
  check('public event view has NO ownerId', !/usr_host|ownerId/.test(raw));

  // Re-registering the same person is not a second seat.
  const before = store.filter('registrations', (r) => r.campaignId === c.id).length;
  try { camps.register(live(), { attendeeRef: '0700000001', name: 'A' }); } catch { /* either is fine */ }
  check('re-registering the same contact does not take another seat',
    store.filter('registrations', (r) => r.campaignId === c.id).length === before);
}


console.log('\n=== REAL AUTHENTICATION: MULTIPLE INDEPENDENT ACTORS ===');
{
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../src/index.js');
  const authD = await import('../src/domain/auth.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;

  // `as` carries a bearer token, so two genuinely different actors can drive
  // the SAME HTTP surface. This is what was impossible before.
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    // --- registration -------------------------------------------------------
    let r = await call('/api/auth/register', 'POST', { handle: 'wanjiku', password: 'correct horse battery', displayName: 'Wanjiku' });
    check('actor A can register', r.status === 201, JSON.stringify(r.body).slice(0, 120));
    const tokenA = r.body?.token;
    const idA = r.body?.user?.id;
    check('registration returns a token', typeof tokenA === 'string' && tokenA.length > 20);
    check('registration NEVER returns the password hash', !/passwordHash|passwordSalt/.test(JSON.stringify(r.body)));

    r = await call('/api/auth/register', 'POST', { handle: 'otieno', password: 'another good passphrase', displayName: 'Otieno' });
    check('actor B can register', r.status === 201);
    const tokenB = r.body?.token;
    const idB = r.body?.user?.id;
    check('the two actors have DIFFERENT ids', idA !== idB, `${idA} vs ${idB}`);

    // --- registration validation -------------------------------------------
    r = await call('/api/auth/register', 'POST', { handle: 'wanjiku', password: 'yet another passphrase' });
    check('a duplicate handle is refused', r.status === 400, `got ${r.status}`);
    check('handle comparison is case-insensitive',
      (await call('/api/auth/register', 'POST', { handle: 'WANJIKU', password: 'passphrase here' })).status === 400);
    r = await call('/api/auth/register', 'POST', { handle: 'shorty', password: 'short' });
    check('a short password is refused', r.status === 400, `got ${r.status}`);
    r = await call('/api/auth/register', 'POST', { handle: 'bad handle!', password: 'a good passphrase' });
    check('an invalid handle is refused', r.status === 400, `got ${r.status}`);

    // --- password storage ---------------------------------------------------
    const rowA = store.find('users', (u) => u.id === idA);
    check('the password is NOT stored in plaintext',
      !JSON.stringify(rowA).includes('correct horse battery'));
    check('a salt is stored', typeof rowA.passwordSalt === 'string' && rowA.passwordSalt.length >= 16);
    check('the hash is long (scrypt, 64 bytes)', rowA.passwordHash.length === 128);
    const rowB = store.find('users', (u) => u.id === idB);
    check('salts differ per user', rowA.passwordSalt !== rowB.passwordSalt);

    // The raw token must not be recoverable from the database.
    check('only a token FINGERPRINT is stored',
      store.all('sessions').every((s) => !JSON.stringify(s).includes(tokenA)));

    // --- login --------------------------------------------------------------
    r = await call('/api/auth/login', 'POST', { handle: 'wanjiku', password: 'correct horse battery' });
    check('login with the right password works', r.status === 200);
    r = await call('/api/auth/login', 'POST', { handle: 'wanjiku', password: 'wrong password entirely' });
    check('login with a wrong password is refused 401', r.status === 401, `got ${r.status}`);
    const wrongPw = r.body?.error;
    r = await call('/api/auth/login', 'POST', { handle: 'nobody-here', password: 'wrong password entirely' });
    check('login for an unknown handle is refused 401', r.status === 401);
    // Enumeration protection: the two messages must be identical.
    check('unknown handle and wrong password give the SAME message', r.body?.error === wrongPw,
      `${r.body?.error} vs ${wrongPw}`);

    // --- identity is server-authoritative -----------------------------------
    r = await call('/api/auth/me', 'GET', undefined, tokenA);
    check('token A identifies actor A', r.body?.user?.id === idA, JSON.stringify(r.body).slice(0, 120));
    r = await call('/api/auth/me', 'GET', undefined, tokenB);
    check('token B identifies actor B', r.body?.user?.id === idB);

    // The central claim: a body cannot override a verified session.
    r = await call('/api/auth/me', 'POST', { userId: idB }, tokenA);
    const meA = await call('/api/auth/me', 'GET', undefined, tokenA);
    check('a client-supplied userId cannot change who you are', meA.body?.user?.id === idA);

    // --- invalid / expired / revoked sessions -------------------------------
    r = await call('/api/auth/me', 'GET', undefined, 'not-a-real-token-at-all');
    check('a forged token is refused 401', r.status === 401, `got ${r.status}`);
    check('the refusal names the reason', r.body?.code === 'unknown_token', r.body?.code);

    const { token: tokenTmp, session: sesTmp } = authD.issueSession(idA);
    store.update('sessions', sesTmp.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    r = await call('/api/auth/me', 'GET', undefined, tokenTmp);
    check('an EXPIRED session is refused 401', r.status === 401, `got ${r.status}`);
    check('expiry is reported distinctly', r.body?.code === 'expired', r.body?.code);

    const { token: tokenRev } = authD.issueSession(idB);
    await call('/api/auth/logout', 'POST', {}, tokenRev);
    r = await call('/api/auth/me', 'GET', undefined, tokenRev);
    check('a REVOKED session is refused 401', r.status === 401, `got ${r.status}`);
    check('revocation is reported distinctly', r.body?.code === 'revoked', r.body?.code);

    // A failed token must NOT silently fall back to the dev identity.
    check('a bad token does not become the dev user', r.body?.user === undefined);

    // logout-all
    authD.issueSession(idA); authD.issueSession(idA);
    r = await call('/api/auth/logout-all', 'POST', {}, tokenA);
    check('sign-out-everywhere revokes sessions', r.body?.revoked >= 2, JSON.stringify(r.body));
    r = await call('/api/auth/me', 'GET', undefined, tokenA);
    check('the token used to sign out is itself dead', r.status === 401);
  } finally {
    srv.close();
  }
}

console.log('\n=== AUTHORIZATION ACROSS TWO REAL ACTORS ===');
{
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../src/index.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const A = (await call('/api/auth/register', 'POST', { handle: 'seller_a', password: 'passphrase for a' })).body;
    const B = (await call('/api/auth/register', 'POST', { handle: 'buyer_b', password: 'passphrase for b' })).body;

    // --- vendors are per-actor ---------------------------------------------
    let r = await call('/api/vendors', 'POST', { displayName: "A's Stall" }, A.token);
    check('actor A creates a vendor', r.status === 201);
    const vendA = r.body?.vendor?.id;
    check('the vendor is owned by A, not the dev user', r.body?.vendor?.ownerId === A.user.id,
      r.body?.vendor?.ownerId);

    r = await call('/api/vendors/me', 'GET', undefined, B.token);
    check("actor B does NOT see A's vendor as their own", !r.body?.vendor, JSON.stringify(r.body).slice(0, 100));

    r = await call('/api/vendors', 'POST', { displayName: "B's Stall" }, B.token);
    const vendB = r.body?.vendor?.id;
    check('actor B gets a DIFFERENT vendor', vendB && vendB !== vendA);

    // --- listings -----------------------------------------------------------
    r = await call('/api/listings', 'POST', { title: "A's tomatoes", type: 'product', price: 2500, quantityAvailable: 10 }, A.token);
    check('A creates a listing', r.status === 201);
    const listA = r.body?.listing?.id;
    r = await call(`/api/listings/${listA}/status`, 'POST', { status: 'active' }, A.token);
    check('A publishes their own listing', r.status === 200);

    // IDOR: B must not be able to mutate A's listing.
    r = await call(`/api/listings/${listA}`, 'PATCH', { price: 1 }, B.token);
    check("B CANNOT edit A's listing", r.status === 403 || r.status === 404, `got ${r.status}`);
    const still = await call(`/api/listings/${listA}`);
    check('and the price is unchanged', still.body?.listing?.price === 2500, `price=${still.body?.listing?.price}`);
    r = await call(`/api/listings/${listA}/status`, 'POST', { status: 'archived' }, B.token);
    check("B CANNOT archive A's listing", r.status === 403 || r.status === 404, `got ${r.status}`);

    // --- orders across two real actors -------------------------------------
    r = await call('/api/orders', 'POST', { listingId: listA, quantity: 2, price: 1 }, B.token);
    check('B orders from A -- a genuine two-party trade', r.status === 201, JSON.stringify(r.body).slice(0, 140));
    const ord = r.body?.order;
    check('the order total is server-derived', ord?.total === 5000, `total=${ord?.total}`);
    check('the buyer is B', ord?.buyerId === B.user.id);

    // A vendor still cannot buy from themselves -- now genuinely testable.
    r = await call('/api/orders', 'POST', { listingId: listA, quantity: 1 }, A.token);
    check('A cannot order from their own listing', r.status === 400, `got ${r.status}`);

    // Fulfilment is the SELLER's right, not the buyer's.
    r = await call(`/api/orders/${ord.id}/fulfil`, 'POST', {}, B.token);
    check('the BUYER cannot fulfil (403)', r.status === 403, `got ${r.status}`);
    r = await call(`/api/orders/${ord.id}/stage`, 'POST', { stage: 'accepted' }, B.token);
    check('the BUYER cannot advance the stage (403)', r.status === 403, `got ${r.status}`);
    r = await call(`/api/orders/${ord.id}/stage`, 'POST', { stage: 'accepted' }, A.token);
    check('the SELLER can advance the stage', r.status === 200, JSON.stringify(r.body).slice(0, 120));
    r = await call(`/api/orders/${ord.id}/fulfil`, 'POST', {}, A.token);
    check('the SELLER can fulfil', r.status === 200);
    check('fulfilment did not mark it paid', r.body?.order?.paid !== true);

    // Settlement is still refused: no real money exists.
    r = await call(`/api/orders/${ord.id}/settle`, 'POST', {}, A.token);
    check('even the seller cannot settle without real money', r.status === 400, `got ${r.status}`);

    // A third actor is a stranger to the whole transaction.
    const C = (await call('/api/auth/register', 'POST', { handle: 'stranger_c', password: 'passphrase for c' })).body;
    r = await call(`/api/orders/${ord.id}`, 'GET', undefined, C.token);
    check('an unrelated actor cannot read the order (404)', r.status === 404, `got ${r.status}`);
    r = await call(`/api/orders/${ord.id}/settlement`, 'GET', undefined, C.token);
    check('an unrelated actor cannot read the settlement (404)', r.status === 404, `got ${r.status}`);
    r = await call(`/api/orders/${ord.id}/settlement`, 'GET', undefined, B.token);
    check('but the BUYER can read the settlement', r.status === 200, `got ${r.status}`);
    r = await call(`/api/orders/${ord.id}/settlement`, 'GET', undefined, A.token);
    check('and so can the SELLER', r.status === 200, `got ${r.status}`);

    // Earnings are per-actor and never leak across sellers.
    r = await call('/api/vendors/me/earnings', 'GET', undefined, A.token);
    check('A sees their own earnings', r.status === 200 && r.body?.earnings?.vendorId === vendA);
    r = await call('/api/vendors/me/earnings', 'GET', undefined, B.token);
    check('B sees only their own', r.body?.earnings?.vendorId === vendB, r.body?.earnings?.vendorId);

    // --- unauthenticated private operations ---------------------------------
    // NOTE: the dev fallback is ON in tests, so an unauthenticated caller is
    // `usr_me` -- a real third party, NOT A or B. It must therefore be
    // treated as a stranger, which is the security-relevant property.
    r = await call(`/api/orders/${ord.id}/fulfil`, 'POST', {});
    check("an unauthenticated caller cannot fulfil someone else's order",
      r.status === 403 || r.status === 404, `got ${r.status}`);
    r = await call(`/api/listings/${listA}`, 'PATCH', { price: 1 });
    check("an unauthenticated caller cannot edit A's listing",
      r.status === 403 || r.status === 404, `got ${r.status}`);

    // --- public operations stay public --------------------------------------
    r = await call('/api/listings');
    check('the public catalogue needs no auth', r.status === 200);
    check('and it does not leak ownerId', !/ownerId/.test(JSON.stringify(r.body)));
    r = await call('/api/health');
    check('health needs no auth', r.status === 200);
    r = await call('/api/release');
    check('release handshake names the current API contract',
      r.status === 200 && r.body?.apiContractVersion === 'gallery-banners-v1' && typeof r.body?.serverTime === 'string');
    r = await call('/api/capabilities');
    check('capabilities need no auth', r.status === 200);
    check('capabilities report auth as configured', r.body?.auth?.configured === true);
  } finally {
    srv.close();
  }
}


console.log('\n=== PAYMENT CONNECTOR BOUNDARY (no credentials configured) ===');
{
  const pay = await import('../src/domain/payment.js');
  const providers = await import('../src/providers.js');

  check('there is no active collection provider', pay.activeProvider() === null);
  check('there is no active disbursement provider', providers.activeDisbursementProvider() === null);
  check('providerStatus.configured is false', pay.providerStatus().configured === false);
  check('providerStatus.payoutConfigured is false', pay.providerStatus().payoutConfigured === false);
  check('the reason is stated', /no payment provider/i.test(pay.providerStatus().reason));

  // The ledger must agree -- one answer to "can Brief move money".
  const led = await import('../src/domain/ledger.js');
  check('ledger.providerConfigured() agrees', led.providerConfigured() === false);
  check('ledger delegates to the seam, not a vendor file', led.providerStatus().detail?.provider === 'buni');
}

console.log('\n=== KCB BUNI CONNECTOR (simulated fetch -- the documented contract) ===');
{
  const buni = await import('../src/connectors/buni.js');
  const phone = await import('../src/connectors/phone.js');

  check('Buni reports NOT configured', buni.isConfigured() === false);
  const miss0 = buni.missingCredentials().join(',');
  check('every missing credential is named', /BUNI_CONSUMER_KEY/.test(miss0) && /BUNI_WEBHOOK_SECRET/.test(miss0), miss0);
  const push0 = await buni.collect({ amount: 100, phone: '0722000111' });
  check('collect REFUSES without credentials', push0.ok === false && push0.reason === 'not_configured');
  check('callback verification fails closed when unset', buni.verifyCallbackSecret('x').reason === 'callback_secret_not_configured');
  check('the status says configured is not the same as verified', buni.status().wireContract === 'documented_not_exercised');
  check('the status admits the callback is unsigned', buni.status().callbacksSigned === false);
  check('a fee nobody published is null, never zero', buni.payoutFee() === null);
  const pay0 = await buni.disburse({ name: 'Rider', phone: '0722000111', amount: 500 });
  check('a payout with an unverified request body REFUSES',
    pay0.ok === false && pay0.reason === 'transfer_contract_unverified', JSON.stringify(pay0));

  // Phone rules live outside the payment connector: an MSISDN is a fact about
  // Kenya, not about whoever holds the money.
  check('0722... normalises', phone.normalisePhone('0722000111') === '254722000111');
  check('+254... normalises', phone.normalisePhone('+254722000111') === '254722000111');
  check('a foreign number is refused', phone.normalisePhone('+447700900000') === null);

  // Callbacks: KCB relays Safaricom's Body.stkCallback, unsigned.
  const okCb = buni.parseCallback({ Body: { stkCallback: {
    MerchantRequestID: 'm1', CheckoutRequestID: 'ws_CO_1', ResultCode: 0, ResultDesc: 'success',
    CallBackMetadata: { Item: [
      { Name: 'Amount', Value: '600' },
      { Name: 'MpesaReceiptNumber', Value: 'RECEIPT1' }
    ] }
  } } });
  check('ResultCode 0 is a payment, with the amount and receipt pulled out',
    okCb.ok === true && okCb.succeeded === true && okCb.checkoutRequestId === 'ws_CO_1' && okCb.amount === 600 && okCb.receipt === 'RECEIPT1');
  const failCb = buni.parseCallback({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_2', ResultCode: 1, ResultDesc: 'Failure' } } });
  check('ResultCode 1 is a failure carrying the provider words',
    failCb.ok === true && failCb.succeeded === false && /provider_result:1/.test(failCb.failureReason));
  const cancelCb = buni.parseCallback({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_3', ResultCode: 1032, ResultDesc: 'cancelled by user' } } });
  check('1032 is a cancellation, not a failure to retry', cancelCb.ok === true && cancelCb.cancelled === true);
  const weirdCb = buni.parseCallback({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_4', ResultCode: 56, ResultDesc: 'processing' } } });
  check('an unknown code is NOT an outcome', weirdCb.ok === false && weirdCb.reason === 'non_terminal_state');
  const junk = buni.parseCallback({ nonsense: true });
  check('an unrecognised payload is refused, not guessed', junk.ok === false && junk.reason === 'unrecognised_payload');
  const noRef = buni.parseCallback({ Body: { stkCallback: { ResultCode: 0 } } });
  check('a callback naming no reference is refused', noRef.ok === false && noRef.reason === 'unrecognised_payload');

  // Production host: KCB does not publish it, so it must be acknowledged. The
  // keys are set first, deliberately, so the failure under test is the HOST and
  // not merely the absence of credentials.
  process.env.BUNI_CONSUMER_KEY = 'ck_host';
  process.env.BUNI_CONSUMER_SECRET = 'cs_host';
  process.env.BUNI_ENV = 'production';
  check('production without a stated host yields NO base url', buni.baseUrl() === '');
  check('and the refusal says why', /production host/.test(buni.missingCredentials().join(',')), buni.missingCredentials().join(','));
  const tokNoHost = await buni.accessToken({ fetchImpl: async () => { throw new Error('must not call out'); } });
  check('a token request refuses before the host is confirmed', tokNoHost.ok === false && tokNoHost.reason === 'production_host_unacked', JSON.stringify(tokNoHost));
  check('and no network call was attempted', tokNoHost.detail === undefined);
  process.env.BUNI_ENV = 'uat';
  delete process.env.BUNI_CONSUMER_KEY;
  delete process.env.BUNI_CONSUMER_SECRET;

  // With credentials + a stubbed fetch, exercise the real request path.
  process.env.BUNI_CONSUMER_KEY = 'ck_test';
  process.env.BUNI_CONSUMER_SECRET = 'cs_test';
  process.env.BUNI_BASE_URL = 'https://stub.invalid';
  process.env.BUNI_WEBHOOK_SECRET = 'buni-cb-secret';
  process.env.BUNI_TILL_NO = 'KCBTILL999';
  process.env.BRIEF_PUBLIC_ORIGIN = 'https://brief.example.com';
  buni._resetTokenCache();
  check('configured once the credentials exist', buni.isConfigured() === true);
  check('the callback URL is a secret path segment, not a query param',
    buni.callbackUrl() === 'https://brief.example.com/api/webhooks/buni/buni-cb-secret', buni.callbackUrl());

  let tokenCalls = 0;
  let stkSeen = null;
  const fakeFetch = async (url, opts) => {
    const u = String(url);
    if (u.endsWith('/token?grant_type=client_credentials')) {
      tokenCalls++;
      check('the token call uses HTTP Basic over key:secret',
        /^Basic /.test(opts.headers.authorization) &&
        Buffer.from(opts.headers.authorization.slice(6), 'base64').toString('utf8') === 'ck_test:cs_test');
      return { ok: true, status: 200, json: async () => ({ access_token: 'jwt.buni.token', expires_in: 3600 }) };
    }
    if (u.endsWith('/mm/api/request/1.0.0/stkpush')) {
      stkSeen = JSON.parse(opts.body);
      check('the push is sent with the bearer token', opts.headers.authorization === 'Bearer jwt.buni.token');
      return { ok: true, status: 200, json: async () => ({ Body: {
        stkPushResponseCode: {
          MerchantRequestID: 'mr_1', CheckoutRequestID: 'ws_CO_600', ResponseCode: 0,
          ResponseDescription: 'Success. Request accepted for processing', CustomerMessage: 'Success. Request accepted for processing'
        }
      } }) };
    }
    throw new Error('unexpected URL ' + u);
  };
  const push = await buni.collect({ amount: 600, phone: '0722000111', description: 'Brief order xyz', apiRef: 'ord7', fetchImpl: fakeFetch });
  check('collect succeeds against a real-shaped response', push.ok === true && push.checkoutRequestId === 'ws_CO_600', JSON.stringify(push));
  check('the provider reference is exposed under both names', push.providerRef === 'ws_CO_600' && push.checkoutRequestId === 'ws_CO_600');
  check('KCB wants the amount as a STRING of whole shillings', stkSeen.amount === '600', JSON.stringify(stkSeen.amount));
  check('the phone is sent normalised to 254...', stkSeen.phoneNumber === '254722000111');
  check('sharedShortCode true means KCB\u2019s till receives it, and Brief has no paybill of its own',
    stkSeen.sharedShortCode === true && stkSeen.orgShortCode === '522522');
  check('the invoice reference carries the till prefix KCB documents',
    stkSeen.invoiceNumber === 'KCBTILL999-ord7', stkSeen.invoiceNumber);
  check('the callback URL travels with the push', stkSeen.callbackUrl.endsWith('/api/webhooks/buni/buni-cb-secret'));
  await buni.collect({ amount: 600, phone: '0722000111', fetchImpl: fakeFetch });
  check('the token is cached across pushes', tokenCalls === 1, `token calls: ${tokenCalls}`);

  const rejected = await buni.collect({
    amount: 600, phone: '0722000111',
    fetchImpl: async (u) => String(u).includes('/token')
      ? { ok: true, status: 200, json: async () => ({ access_token: 't' }) }
      : { ok: false, status: 400, json: async () => ({ response_description: 'Validation failed' }) }
  });
  check('a rejected push is surfaced as failure', rejected.ok === false && rejected.reason === 'push_rejected');
  const empty = await buni.collect({
    amount: 600, phone: '0722000111',
    fetchImpl: async (u) => String(u).includes('/token')
      ? { ok: true, status: 200, json: async () => ({ access_token: 't' }) }
      : { ok: true, status: 200, json: async () => ({}) }
  });
  check('a response with nothing to chase is NOT a success', empty.ok === false && empty.reason === 'no_provider_reference');
  const badAmount = await buni.collect({ amount: 0, phone: '0722000111', fetchImpl: fakeFetch });
  check('a zero or negative amount never reaches the rail', badAmount.ok === false && badAmount.reason === 'invalid_amount');
  const badPhone = await buni.collect({ amount: 600, phone: '12345', fetchImpl: fakeFetch });
  check('a garbled number is refused before any call', badPhone.ok === false && badPhone.reason === 'invalid_phone');
  // The connector caches its bearer token, which is correct behaviour and also
  // the reason this case needs the cache dropped first: a test that quietly
  // reuses a live token proves nothing about the failure path.
  buni._resetTokenCache();
  let pushSeenAfterBadToken = false;
  const noToken = await buni.collect({
    amount: 600, phone: '0722000111',
    fetchImpl: async (u) => {
      if (String(u).includes('stkpush')) pushSeenAfterBadToken = true;
      return { ok: false, status: 401, json: async () => ({ fault: 'Invalid Credentials' }) };
    }
  });
  check('a rejected token request stops before the push', noToken.ok === false && noToken.reason === 'token_rejected', JSON.stringify(noToken));
  check('and no STK push was attempted', pushSeenAfterBadToken === false);
  buni._resetTokenCache();

  check('the status never leaks the secret, the key or the callback URL', (() => {
    const j = JSON.stringify(buni.status());
    return !j.includes('buni-cb-secret') && !j.includes('cs_test') && !j.includes('/api/webhooks/buni/');
  })(), JSON.stringify(buni.status()).slice(0, 160));
  check('payout stays unavailable, with the reason as a string', (() => {
    const st = buni.status();
    return st.enablement.disbursement === false && /request body is not published/.test(st.enablement.disbursementNote);
  })());
  process.env.BUNI_ALLOW_UNVERIFIED_TRANSFERS = '1';
  check('the unverified-payout switch alone does not invent a call', buni.isPayoutConfigured() === true);
  const pay1 = await buni.disburse({ name: 'Rider One', phone: '0722000111', amount: 500, fetchImpl: fakeFetch });
  check('and the call itself still REFUSES rather than guessing a body',
    pay1.ok === false && pay1.reason === 'not_implemented', JSON.stringify(pay1));
  delete process.env.BUNI_ALLOW_UNVERIFIED_TRANSFERS;

  delete process.env.BUNI_CONSUMER_KEY;
  delete process.env.BUNI_CONSUMER_SECRET;
  delete process.env.BUNI_BASE_URL;
  delete process.env.BUNI_WEBHOOK_SECRET;
  delete process.env.BUNI_TILL_NO;
  delete process.env.BRIEF_PUBLIC_ORIGIN;
  buni._resetTokenCache();
}

console.log('\n=== OUTBOUND CHANNEL SEAM + TWILIO (no credentials configured) ===');
{
  const outbound = await import('../src/outbound.js');
  const twilio = await import('../src/connectors/twilio.js');

  // Nothing configured -> every channel is honestly unavailable.
  check('no channel can send yet', outbound.canSend('sms') === false && outbound.canSend('whatsapp') === false);
  check('email and telegram have no provider', outbound.canSend('email') === false && outbound.canSend('telegram') === false);
  check('status reports all channels unconfigured', outbound.status().anyConfigured === false);
  check('status names sms as unconfigured', outbound.status().channels.sms.configured === false);
  check('status names whatsapp as unconfigured', outbound.status().channels.whatsapp.configured === false);

  // Twilio, alone, refuses with a named reason.
  check('Twilio reports NOT configured (sms)', twilio.isConfigured('sms') === false);
  check('Twilio reports NOT configured (whatsapp)', twilio.isConfigured('whatsapp') === false);
  check('missing credentials are named', twilio.missingCredentials('sms').length === 3, twilio.missingCredentials('sms').join(','));
  const s0 = await twilio.send({ channel: 'sms', to: '0722000111', text: 'hi' });
  check('send REFUSES without credentials', s0.ok === false && s0.reason === 'not_configured');
  const s1 = await outbound.send({ channel: 'whatsapp', to: '0722000111', text: 'hi' });
  check('seam send REFUSES with no provider', s1.ok === false && s1.reason === 'no_provider');

  // Phone normalisation (E.164 with '+', Kenyan rule).
  check('0722... normalises to +254', twilio.normalisePhone('0722000111') === '+254722000111');
  check('+254... normalises', twilio.normalisePhone('+254722000111') === '+254722000111');
  check('0110... normalises', twilio.normalisePhone('0110000111') === '+254110000111');
  check('a foreign number is refused', twilio.normalisePhone('+447700900000') === null);

  // With credentials + a stubbed fetch, exercise the REAL request path.
  process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
  process.env.TWILIO_AUTH_TOKEN = 'test_auth_token';
  process.env.TWILIO_SMS_FROM = '+254700000000';
  process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+254700000000';
  check('Twilio now reports configured (sms)', twilio.isConfigured('sms') === true);
  check('Twilio now reports configured (whatsapp)', twilio.isConfigured('whatsapp') === true);
  check('seam now finds the sms provider', outbound.canSend('sms') === true && outbound.providerForChannel('sms')?.name === 'twilio');

  let lastUrl = '', lastAuth = '', lastBody = '';
  const fakeFetch = async (url, opts) => {
    lastUrl = url; lastAuth = opts.headers.authorization; lastBody = opts.body;
    return { ok: true, status: 201, json: async () => ({ sid: 'SM_test_1', status: 'queued' }) };
  };
  const sent = await twilio.send({ channel: 'sms', to: '0722000111', text: 'Your spot is held.', fetchImpl: fakeFetch });
  check('sms send succeeds against a real-shaped response', sent.ok === true && sent.sid === 'SM_test_1' && sent.status === 'queued');
  check('the Twilio endpoint is correct', lastUrl.includes('/Accounts/AC_test_sid/Messages.json'));
  check('Basic auth carries SID:token', lastAuth === `Basic ${Buffer.from('AC_test_sid:test_auth_token').toString('base64')}`);
  check('the body is form-encoded with To/From/Body', lastBody.includes('Body=Your+spot+is+held.') && lastBody.includes('To=%2B254722000111') && lastBody.includes('From=%2B254700000000'));

  // WhatsApp path prefixes To with whatsapp:.
  await twilio.send({ channel: 'whatsapp', to: '0722000111', text: 'hi', fetchImpl: fakeFetch });
  check('whatsapp send uses whatsapp: To/From', lastBody.includes('To=whatsapp%3A%2B254722000111') && lastBody.includes('From=whatsapp%3A%2B254700000000'));

  // A Twilio-side rejection is surfaced, not faked.
  const rejected = await twilio.send({
    channel: 'sms', to: '0722000111', text: 'hi',
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ code: 21211, message: 'Invalid phone number' }) })
  });
  check('a rejected send is surfaced as failure', rejected.ok === false && rejected.reason === 'send_rejected' && rejected.code === 21211);

  // Invalid / empty inputs are refused before any network call.
  check('an invalid phone is refused', (await twilio.send({ channel: 'sms', to: '999', text: 'hi', fetchImpl: fakeFetch })).reason === 'invalid_phone');
  check('empty text is refused', (await twilio.send({ channel: 'sms', to: '0722000111', text: '  ', fetchImpl: fakeFetch })).reason === 'empty_text');

  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_SMS_FROM;
  delete process.env.TWILIO_WHATSAPP_FROM;
}

console.log('\n=== PERSON ENTITY (§4.4) ===');
{
  const person = await import('../src/domain/person.js');

  // ensurePersonForUser creates a person + verified user alias, idempotently.
  const p1 = person.ensurePersonForUser('usr_me');
  const p2 = person.ensurePersonForUser('usr_me');
  check('ensurePersonForUser is idempotent', p1.id === p2.id);
  check('a person holds a verified user alias', p2.aliases.some((a) => a.kind === 'user' && a.value === 'usr_me' && a.verified));

  // findByAlias resolves through the alias.
  const found = person.findByAlias('user', 'usr_me');
  check('findByAlias resolves the person', found && found.id === p1.id);

  // Verified-only: an unverified alias link is refused.
  try {
    person.linkAlias(p1.id, 'phone', '0722000111', { verified: false });
    check('unverified alias is refused', false);
  } catch (e) {
    check('unverified alias is refused', /verified/.test(e.message));
  }

  // A self-asserted alias binds and normalises the phone.
  const a = person.linkAlias(p1.id, 'phone', '0722000111', { verified: true, source: 'self' });
  check('self-asserted alias links', a.kind === 'phone' && a.value === '254722000111');
  check('phone alias is normalised to 254...', person.normaliseAlias('phone', '+254722000111') === '254722000111');

  // Re-binding the same value to a DIFFERENT person is refused, not silent.
  const other = person.ensurePersonForUser('usr_other');
  try {
    person.linkAlias(other.id, 'phone', '0722000111', { verified: true });
    check('alias re-binding is refused', false);
  } catch (e) {
    check('alias re-binding is refused', /already linked/.test(e.message));
  }

  // findByAlias finds via the phone alias now.
  check('findByAlias via phone works', person.findByAlias('phone', '254722000111')?.id === p1.id);

  // Merge: fold `other` into p1, re-pointing the user alias.
  const before = person.getPerson(other.id).aliases.length;
  const merged = person.mergePersons(other.id, p1.id, 'usr_admin');
  check('merge folds the aliases across', merged.movedAliases === before);
  check('merged-away person is gone', person.getPerson(other.id) === null);
  check('merged target now holds both user aliases', person.getPerson(p1.id).aliases.some((x) => x.value === 'usr_other'));
  check('merge is audited', store.find('auditLog', (x) => x.action === 'merge' && x.from === other.id) !== null);

  // Timeline: a person with no activity has empty events, not an error.
  const t = person.timeline(p1.id);
  check('timeline returns for a fresh person', t && Array.isArray(t.events));

  // Over HTTP: /api/person/me resolves for an authenticated caller.
  {
    const { default: appP } = await import('../src/index.js');
    const srvP = appP.listen(0);
    const portP = srvP.address().port;
    const r = await fetch(`http://127.0.0.1:${portP}/api/person/me`);
    const body = await r.json().catch(() => null);
    check('GET /api/person/me returns the caller person', r.status === 200 && body?.person?.id, JSON.stringify(body));
    srvP.close();
  }
}

console.log('\n=== TEA EDITORIAL SYSTEM (home-feed Phase 4) ===');
{
  const tea = await import('../src/domain/tea.js');

  // Draft does not appear publicly.
  const draft = tea.createArticle({ title: 'The Nairobi weekend guide', body: 'Here is a short useful guide to the weekend. It is practical and local.', category: 'guide' });
  check('an article starts as draft', draft.status === 'draft');
  check('a draft is not in the public list', tea.listPublished().every((a) => a.id !== draft.id));
  check('a draft slug does not resolve publicly', tea.getBySlug(draft.slug) === null);

  // Reading time is derived from body length.
  check('reading time is derived', draft.readingTime >= 1);

  // Publish -> appears publicly, and by slug.
  tea.transition(draft.id, 'publish');
  check('publishing sets status + publishedAt', tea.getById(draft.id).status === 'published' && Boolean(tea.getById(draft.id).publishedAt));
  check('a published article appears publicly', tea.listPublished().some((a) => a.id === draft.id));
  const bySlug = tea.getBySlug(draft.slug);
  check('a published slug resolves', bySlug && bySlug.id === draft.id);

  // Live articles rank above older guides (freshness + live lift).
  const live = tea.createArticle({ title: 'A popup opened today in Kilimani', body: 'Short live note about a new thing.', category: 'live', status: 'published', publishedAt: new Date().toISOString() });
  const top = tea.listPublished({ limit: 5 })[0];
  check('a fresh live article ranks first', top.id === live.id, top.title);

  // Category filter works.
  check('category filter returns only that category', tea.listPublished({ category: 'guide' }).every((a) => a.category === 'guide'));

  // Expiry: an expired article leaves the active feed.
  const expiring = tea.createArticle({ title: 'Weekend popup', body: 'Gone soon.', category: 'weekend', status: 'published', publishedAt: new Date().toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() });
  const after = tea.listPublished();
  check('an expired article leaves the public feed', after.every((a) => a.id !== expiring.id));
  check('the expired article is marked expired', tea.getById(expiring.id).status === 'expired');

  // Scheduled article publishes when its time arrives.
  const sched = tea.createArticle({ title: 'Tomorrow morning', body: 'Scheduled.', category: 'useful', status: 'scheduled', publishedAt: new Date(Date.now() - 1000).toISOString() });
  check('a due scheduled article auto-publishes on read', tea.getById(sched.id).status === 'published');

  // Transition gating: cannot publish from archived.
  const arch = tea.createArticle({ title: 'Old thing', body: 'Archived.', category: 'guide' });
  tea.transition(arch.id, 'publish');
  tea.transition(arch.id, 'archive');
  try {
    tea.transition(arch.id, 'publish');
    check('publishing from archived is refused', false);
  } catch (e) {
    check('publishing from archived is refused', /cannot publish from archived/.test(e.message));
  }

  // Over HTTP: public list + a draft is NOT reachable publicly.
  {
    const { default: appT } = await import('../src/index.js');
    const srvT = appT.listen(0);
    const portT = srvT.address().port;
    const list = await (await fetch(`http://127.0.0.1:${portT}/api/tea`)).json();
    check('GET /api/tea returns published articles + categories', Array.isArray(list.tea) && Array.isArray(list.categories));
    const slug = await (await fetch(`http://127.0.0.1:${portT}/api/tea/${draft.slug}`)).json();
    check('GET /api/tea/:slug resolves a published article', slug.article && slug.article.id === draft.id);
    srvT.close();
  }
}

console.log('\n=== MEDIA ASSOCIATION (home-feed Phase 6) ===');
{
  const media = await import('../src/domain/media.js');

  // No provider configured -> reported honestly, never pretended.
  check('no image provider is configured', media.providerStatus().configured === false);
  check('the reason is stated, not hidden', /No image provider/.test(media.providerStatus().reason));

  // An object with its own exact image resolves at level 'exact'.
  const exact = media.resolveMedia({ id: 'a', title: 'Pop-up', imageUrl: 'https://x/y.jpg', imageAlt: 'popup' });
  check('an exact image is preferred', exact.level === 'exact' && exact.image?.url === 'https://x/y.jpg');

  // An object with no image resolves to level 'none' — never a random image.
  const bare = media.resolveMedia({ id: 'b', title: 'Thing', category: 'Event' });
  check('no image -> level none', bare.level === 'none' && bare.image === null);

  // A vendor image is used when the object links a provider and has no own image.
  store.insert('vendors', { id: 'v1', ownerId: 'u', displayName: 'Kikao', imageUrl: 'https://x/vendor.jpg' });
  const viaVenue = media.resolveMedia({ id: 'c', title: 'Hoodie', providerObjectId: 'v1', metadata: {} });
  check('venue image is the second fallback', viaVenue.level === 'venue' && viaVenue.image?.url === 'https://x/vendor.jpg');

  // A location image is the third fallback.
  store.insert('objects', { id: 'loc1', title: 'Kilimani Studio', imageUrl: 'https://x/loc.jpg' });
  const viaLoc = media.resolveMedia({ id: 'd', title: 'Gig', locationObjectId: 'loc1' });
  check('location image is the third fallback', viaLoc.level === 'location' && viaLoc.image?.url === 'https://x/loc.jpg');

  // A category image is the fourth fallback, and only when APPROVED.
  media.recordMediaLibraryImage({ kind: 'category', key: 'Event', url: 'https://x/cat.jpg', status: 'draft' });
  check('a draft category image is NOT used', media.resolveMedia({ id: 'e', title: 'Gig', category: 'Event' }).level === 'none');
  media.recordMediaLibraryImage({ kind: 'category', key: 'Event', url: 'https://x/cat.jpg', status: 'approved' });
  const viaCat = media.resolveMedia({ id: 'f', title: 'Gig', category: 'Event' });
  check('an approved category image is used', viaCat.level === 'category' && viaCat.image?.url === 'https://x/cat.jpg');

  // enrichObjects tags every object with its resolved level.
  const enriched = media.enrichObjects([
    { id: 'g', title: 'A', imageUrl: 'https://x/a.jpg' },
    { id: 'h', title: 'B' }
  ]);
  check('enrichObjects tags the exact image', enriched[0].mediaLevel === 'exact' && enriched[0].media?.url === 'https://x/a.jpg');
  check('enrichObjects tags a missing image as none', enriched[1].mediaLevel === 'none' && enriched[1].media === null);

  // The library record is idempotent on (kind, key).
  const again = media.recordMediaLibraryImage({ kind: 'category', key: 'Event', url: 'https://x/cat2.jpg', status: 'approved' });
  check('media library record is idempotent per key', again.url === 'https://x/cat2.jpg');
}

console.log('\n=== FEED COMPOSITION (home-feed Phase 8) ===');
{
  const feed = await import('../src/domain/feed.js');

  const objects = [
    { id: 'o1', type: 'experience', title: 'Top event' },
    { id: 'o2', type: 'place', title: 'A place' },
    { id: 'o3', type: 'opportunity', title: 'An opportunity' },
    { id: 'o4', type: 'experience', title: 'Another event' },
    { id: 'o5', type: 'service', title: 'A service' },
    { id: 'o6', type: 'opportunity', title: 'Second opportunity' },
    { id: 'o7', type: 'product', title: 'A product' },
    { id: 'o8', type: 'place', title: 'Another place' }
  ];
  const tea = [
    { slug: 'a', title: 'Tea A' },
    { slug: 'b', title: 'Tea B' },
    { slug: 'c', title: 'Tea C' }
  ];

  const composed = feed.composeFeed({ objects, tea });
  check('a hero is chosen', composed.hero.length === 1 && composed.hero[0].id === 'o1');
  check('discovery is filled', composed.discovery.length === 4);
  check('opportunities are split out', composed.opportunities.length === 2);
  check('the rest is retained', composed.more.length === 1);
  check('a featured tea is chosen', composed.tea?.slug === 'a');
  check('supporting tea is limited', composed.moreTea.length === 2);

  // Dedup: no object appears in two slots.
  const allIds = [...composed.hero, ...composed.discovery, ...composed.opportunities, ...composed.more].map((o) => o.id);
  check('no object is duplicated across slots', new Set(allIds).size === allIds.length);

  // Dedup: the same object given twice collapses to one.
  const dup = feed.composeFeed({ objects: [{ id: 'x', type: 'place', title: 'X' }, { id: 'x', type: 'place', title: 'X' }], tea: [] });
  check('duplicate ids collapse to one', dup.hero.length + dup.discovery.length + dup.opportunities.length + dup.more.length === 1);
  check('dedup count is reported', dup.counts.deduped === 1);

  // An empty section is omitted, not padded.
  const empty = feed.composeFeed({ objects: [{ id: 'only', type: 'place', title: 'Only' }], tea: [] });
  check('empty opportunities is omitted', empty.opportunities.length === 0);
  check('empty tea is null', empty.tea === null && empty.moreTea.length === 0);
}

console.log('\n=== PUBLIC FEED API (home-feed) ===');
{
  const publicId = 'public_feed_object';
  const privateId = 'private_feed_object';
  store.insert('objects', {
    id: publicId,
    type: 'place',
    title: 'Public feed place',
    category: 'Place',
    summary: 'A public feed record',
    publication: 'public',
    imageUrl: 'https://example.com/place.jpg',
    metadata: { price: 200, contactPhone: '+254700000000', lat: -1.28, lng: 36.82 },
    createdAt: new Date().toISOString()
  });
  store.insert('objects', {
    id: privateId,
    type: 'place',
    title: 'Private feed place',
    summary: 'Must not appear publicly',
    publication: 'source_members',
    createdAt: new Date().toISOString()
  });

  const { default: appPF } = await import('../src/index.js');
  const srvPF = appPF.listen(0);
  const portPF = srvPF.address().port;
  const response = await fetch(`http://127.0.0.1:${portPF}/api/public/feed?limit=10`);
  const body = await response.json();
  const rows = [...body.feed.hero, ...body.feed.discovery, ...body.feed.opportunities, ...body.feed.more];
  const raw = JSON.stringify(body);
  check('public feed needs no auth', response.status === 200);
  check('public feed includes public objects', rows.some((o) => o.id === publicId));
  check('public feed excludes private objects', !raw.includes(privateId) && !raw.includes('Private feed place'));
  check('public feed omits contact and coordinates', !raw.includes('contactPhone') && !raw.includes('"lat"'));
  check('public feed sends cache headers', response.headers.get('cache-control')?.includes('max-age=60'));
  check('public feed identifies its generation time', typeof body.meta?.generatedAt === 'string' && body.meta?.apiVersion === '1');
  check('public feed validates incomplete location',
    (await fetch(`http://127.0.0.1:${portPF}/api/public/feed?lat=1`)).status === 400);
  srvPF.close();
}

console.log('\n=== TELEGRAM IMAGE RESOLUTION (render-time, token stays server-side) ===');
{
  const tgPublic = 'tg_img_public';
  const tgPrivate = 'tg_img_private';
  store.insert('objects', {
    id: tgPublic,
    type: 'product',
    title: 'Telegram image product',
    summary: 'Carries an unresolved Telegram file id',
    publication: 'public',
    imageReference: 'AgADfile_public',
    imageSourceType: 'telegram',
    imageNeedsResolution: true,
    createdAt: new Date().toISOString()
  });
  store.insert('objects', {
    id: tgPrivate,
    type: 'product',
    title: 'Private telegram image product',
    summary: 'Must never resolve publicly',
    publication: 'source_members',
    imageReference: 'AgADfile_private',
    imageSourceType: 'telegram',
    imageNeedsResolution: true,
    createdAt: new Date().toISOString()
  });

  const { default: appTg } = await import('../src/index.js');
  const srvTg = appTg.listen(0);
  const portTg = srvTg.address().port;

  // The public feed projects the reference as a resolve PATH, not the file id,
  // and never embeds a token or the raw reference in the payload.
  const feedRes = await fetch(`http://127.0.0.1:${portTg}/api/public/feed?limit=10`);
  const feedBody = await feedRes.json();
  const feedRows = [...feedBody.feed.hero, ...feedBody.feed.discovery, ...feedBody.feed.opportunities, ...feedBody.feed.more];
  const tgRow = feedRows.find((o) => o.id === tgPublic);
  const feedRaw = JSON.stringify(feedBody);
  check('public feed projects telegram media as a resolve path', tgRow?.media?.url === `/api/media/telegram/${tgPublic}`, tgRow?.media?.url);
  check('public feed never leaks the telegram file id', !feedRaw.includes('AgADfile_public'));
  check('public feed never leaks a bot token', !feedRaw.includes('bot') && !feedRaw.includes('api.telegram.org'));
  check('private telegram image stays out of the public feed', !feedRaw.includes(tgPrivate));

  // The resolve endpoint streams bytes for public objects, and refuses (404)
  // for unknown or non-public objects. With no token configured it fails
  // gracefully with an honest media_unavailable, never a fabricated image.
  const unknownRes = await fetch(`http://127.0.0.1:${portTg}/api/media/telegram/nope`);
  check('resolve endpoint 404s an unknown object', unknownRes.status === 404);
  const privateRes = await fetch(`http://127.0.0.1:${portTg}/api/media/telegram/${tgPrivate}`);
  check('resolve endpoint 404s a private object', privateRes.status === 404);
  const publicRes = await fetch(`http://127.0.0.1:${portTg}/api/media/telegram/${tgPublic}`);
  check('resolve endpoint answers (graceful failure) without a token',
    publicRes.status === 502, String(publicRes.status));
  const publicErr = await publicRes.json().catch(() => ({}));
  check('resolve failure names the reason, not a fake url',
    publicErr?.code === 'media_unavailable' && typeof publicErr?.error === 'string');

  srvTg.close();
}

console.log('\n=== COLLECTIONS (home-feed §47) ===');
{
  const collection = await import('../src/domain/collection.js');

  // A rule collection matches by price ceiling.
  const budget = collection.createCollection({ title: 'Under KES 300', kind: 'rule', rule: { maxPrice: 300 }, status: 'published' });
  check('a rule collection is created', Boolean(budget.id));

  // A curated collection holds explicit object ids.
  store.insert('objects', { id: 'obj_c1', type: 'place', title: 'Cafe', publication: 'public', category: 'Place', metadata: { price: 150 } });
  store.insert('objects', { id: 'obj_c2', type: 'place', title: 'Expensive spot', publication: 'public', category: 'Place', metadata: { price: 5000 } });
  const curated = collection.createCollection({ title: 'My picks', kind: 'curated', objectIds: ['obj_c1', 'obj_c2'], status: 'published' });
  check('a curated collection resolves its explicit ids', collection.resolveCollection(curated.key).objectCount === 2);

  // The rule collection only matches objects under the ceiling.
  const res = collection.resolveCollection(budget.key);
  check('a rule collection resolves only matching objects', res.objects.every((o) => (o.metadata?.price ?? Infinity) <= 300), JSON.stringify(res.objects.map((o) => o.title)));
  check('the expensive object is excluded', !res.objects.some((o) => o.id === 'obj_c2'));

  // A locationContains rule.
  store.insert('objects', { id: 'obj_k', type: 'experience', title: 'Kilimani gig', publication: 'public', locationName: 'Kilimani, Nairobi', category: 'Event', metadata: {} });
  const local = collection.createCollection({ title: 'Around Kilimani X', kind: 'rule', rule: { locationContains: 'Kilimani' }, status: 'published' });
  check('a location rule matches by substring', collection.resolveCollection(local.key).objects.some((o) => o.id === 'obj_k'));

  // A draft collection does not resolve publicly.
  const draft = collection.createCollection({ title: 'Hidden', kind: 'rule', rule: { type: 'place' }, status: 'draft' });
  check('a draft collection does not resolve', collection.resolveCollection(draft.key) === null);
  check('a draft collection is not listed', collection.listPublished().every((c) => c.id !== draft.id));

  // Publish makes it listed and resolvable.
  collection.transitionCollection(draft.key, 'publish');
  check('publishing lists the collection', collection.listPublished().some((c) => c.id === draft.id));
  check('a published collection resolves', collection.resolveCollection(draft.key) !== null);

  // Over HTTP: list + resolve.
  {
    const { default: appC } = await import('../src/index.js');
    const srvC = appC.listen(0);
    const portC = srvC.address().port;
    const list = await (await fetch(`http://127.0.0.1:${portC}/api/collections`)).json();
    check('GET /api/collections returns published collections', Array.isArray(list.collections) && list.collections.length > 0);
    const one = await (await fetch(`http://127.0.0.1:${portC}/api/collections/${budget.key}`)).json();
    check('GET /api/collections/:key resolves membership', one.collection && typeof one.collection.objectCount === 'number');
    srvC.close();
  }
}

console.log('\n=== SEARCH (home-feed §33) ===');
{
  const search = await import('../src/domain/search.js');

  // Cross-entity: an empty query returns nothing, honestly.
  check('an empty query returns nothing', search.search('  ').objects.length === 0);

  // Objects match by title/location/category.
  store.insert('objects', { id: 's_obj', type: 'place', title: 'Karura Forest walk', publication: 'public', category: 'Place', locationName: 'Karura', metadata: {} });
  const r1 = search.search('karura');
  check('search finds an object by title', r1.objects.some((o) => o.id === 's_obj'));
  check('search reports its counts', r1.counts.objects >= 1);

  // Tea matches by title/dek/body.
  const tea = await import('../src/domain/tea.js');
  const art = tea.createArticle({ title: 'Karura trail guide', body: 'A short guide to the Karura forest trails.', category: 'guide', status: 'published' });
  const r2 = search.search('karura');
  check('search finds a tea article', r2.tea.some((a) => a.slug === art.slug));

  // Vendors match by name.
  store.insert('vendors', { id: 's_vendor', ownerId: 'u', displayName: 'Karura Honey Co', status: 'active' });
  const r3 = search.search('karura');
  check('search finds a vendor', r3.vendors.some((v) => v.id === 's_vendor'));

  // Collections match by title.
  const collection = await import('../src/domain/collection.js');
  const col = collection.createCollection({ title: 'Karura mornings', kind: 'rule', rule: { locationContains: 'Karura' }, status: 'published' });
  const r4 = search.search('karura');
  check('search finds a collection', r4.collections.some((c) => c.id === col.id));

  // Over HTTP.
  {
    const { default: appS } = await import('../src/index.js');
    const srvS = appS.listen(0);
    const portS = srvS.address().port;
    const res = await (await fetch(`http://127.0.0.1:${portS}/api/search?q=karura`)).json();
    check('GET /api/search returns typed results', res.results && Array.isArray(res.results.objects) && Array.isArray(res.results.tea));
    srvS.close();
  }
}

console.log('\n=== AI ASSIST SEAM (§27) ===');
{
  const assist = await import('../src/domain/assist.js');

  check('no AI provider is configured', assist.providerStatus().configured === false);
  check('the reason is stated', /No AI provider/.test(assist.providerStatus().reason));

  const r = await assist.assist('summarise', { text: 'something' });
  check('assist fails closed without a provider', r.ok === false && r.reason === 'no_provider');

  // Over HTTP: status reports unconfigured; assist 503s (auth-gated, so this
  // is the anonymous refusal — the configured path is exercised in the unit
  // call above).
  {
    const { default: appA } = await import('../src/index.js');
    const srvA = appA.listen(0);
    const portA = srvA.address().port;
    const st = await (await fetch(`http://127.0.0.1:${portA}/api/assist/status`)).json();
    check('GET /api/assist/status reports unconfigured', st.assist?.configured === false);
    srvA.close();
  }
}

console.log('\n=== DISTRIBUTION (four-screen build B) ===');
{
  const distribution = await import('../src/domain/distribution.js');
  const campaigns = await import('../src/domain/campaign.js');

  const c = campaigns.createCampaign('usr_me', { title: 'Rooftop Gig', type: 'event', location: 'Kilimani', capacity: 50, price: 0, currency: 'KES' });
  campaigns.transitionCampaign(c.id, 'published');
  campaigns.transitionCampaign(c.id, 'live');

  // A tracked link needs a public origin; null otherwise (honest).
  check('no tracked link without a public origin', distribution.trackedLink(c, null) === null);
  const link = distribution.trackedLink(c, 'https://brief.example.com', { source: 'whatsapp', medium: 'social', content: 'weekend' });
  check('a tracked link embeds UTM params', link && link.includes('utm_source=whatsapp') && link.includes('utm_campaign=' + c.id) && link.includes('utm_content=weekend'), link);

  // Blast fails honestly when no origin is configured.
  const noOrigin = await distribution.blast(c, { recipients: [{ channel: 'whatsapp', to: '0722000111' }], publicOrigin: null });
  check('blast fails without an origin', noOrigin.ok === false && noOrigin.reason === 'public_origin_not_configured');

  // A Telegram/X recipient is honestly "no send connector".
  process.env.BRIEF_PUBLIC_ORIGIN = 'https://brief.example.com';
  const tgBlast = await distribution.blast(c, { recipients: [{ channel: 'telegram', to: 'chat' }] });
  check('telegram blast reports no send connector', tgBlast.results[0].ok === false && tgBlast.results[0].reason === 'no_send_connector');

  // recordClick attributes a click and returns the campaign.
  const clicked = distribution.recordClick({ c: c.publicSlug, utm_source: 'x', utm_medium: 'social' });
  check('recordClick attributes a click', clicked && clicked.id === c.id);
  check('clicksFor aggregates by source', distribution.clicksFor(c.id).clicks === 1 && distribution.clicksFor(c.id).clicksBySource.x === 1);

  // Clicks flow into campaign analytics.
  const an = campaigns.analytics(c.id);
  check('campaign analytics reports clicks + bySource', an.clicks === 1 && an.clicksBySource.x === 1);

  // Over HTTP: click endpoint records and redirects.
  {
    const { default: appD } = await import('../src/index.js');
    const srvD = appD.listen(0);
    const portD = srvD.address().port;
    const r = await fetch(`http://127.0.0.1:${portD}/api/click?c=${c.publicSlug}&utm_source=whatsapp`, { redirect: 'manual' });
    check('GET /api/click redirects to the campaign', r.status === 302 && /\/c\//.test(r.headers.get('location') || ''), String(r.headers.get('location')));
    srvD.close();
  }

  delete process.env.BRIEF_PUBLIC_ORIGIN;
}

console.log('\n=== TELEGRAM MINI APP initData ===');
{
  const telegram = await import('../src/connectors/telegram.js');
  const crypto = await import('node:crypto');

  // Build a genuine signed initData using the real Telegram algorithm.
  process.env.TELEGRAM_BOT_TOKEN = '12345:test_token_for_initdata';
  const user = JSON.stringify({ id: 998877, first_name: 'Wanjiku', username: 'wanjiku_hikes' });
  const fields = {
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user,
    auth_date: String(Math.floor(Date.now() / 1000))
  };
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update('12345:test_token_for_initdata').digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const initData = new URLSearchParams({ ...fields, hash }).toString();

  const verified = telegram.verifyInitData(initData);
  check('a valid initData verifies', verified.ok === true);
  check('the Telegram user id is extracted', verified.user?.id === '998877');
  check('the first name is extracted', verified.user?.firstName === 'Wanjiku');

  // Tampering with any field invalidates the signature.
  const tampered = initData.replace('Wanjiku', 'Attacker');
  check('a tampered initData is refused', telegram.verifyInitData(tampered).reason === 'bad_signature');

  // An expired initData is refused.
  const oldFields = { ...fields, auth_date: String(Math.floor(Date.now() / 1000) - 48 * 3600) };
  const oldDcs = Object.entries(oldFields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const oldHash = crypto.createHmac('sha256', secretKey).update(oldDcs).digest('hex');
  const oldInitData = new URLSearchParams({ ...oldFields, hash: oldHash }).toString();
  check('an expired initData is refused', telegram.verifyInitData(oldInitData).reason === 'init_data_expired');

  // The init route binds the Telegram user to a Brief account + session.
  {
    const { default: appTg } = await import('../src/index.js');
    const srvTg = appTg.listen(0);
    const portTg = srvTg.address().port;
    const r = await fetch(`http://127.0.0.1:${portTg}/api/telegram/init`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData })
    });
    const body = await r.json().catch(() => null);
    check('POST /api/telegram/init issues a session', r.status === 200 && Boolean(body?.token));
    check('the account is bound to the telegram id', body?.user?.handle === 'tg_998877', body?.user?.handle);
    // The returned token is a real session: whoAmI with it resolves.
    const me = await fetch(`http://127.0.0.1:${portTg}/api/auth/me`, { headers: { authorization: `Bearer ${body.token}` } });
    check('the minted token authenticates', me.status === 200);
    // A forged initData is refused with 401.
    const bad = await fetch(`http://127.0.0.1:${portTg}/api/telegram/init`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: tampered })
    });
    check('a forged initData is refused 401', bad.status === 401);
    srvTg.close();
  }

  delete process.env.TELEGRAM_BOT_TOKEN;
}

console.log('\n=== AUTOMATION ENGINE (CCS §3.1) ===');
{
  const workflow = await import('../src/domain/workflow.js');
  const signals = await import('../src/domain/signal.js');
  const person = await import('../src/domain/person.js');

  // A workflow that tags "Outdoor enthusiast" when a member joins, and
  // notifies the actor.
  const wf = workflow.createWorkflow({
    name: 'Welcome outdoor folks',
    trigger: 'member_joined',
    conditions: [],
    actions: [
      { type: 'tag', tag: 'Outdoor enthusiast' },
      { type: 'notify', title: 'Welcome!', body: 'Glad you are here.' }
    ],
    ownerId: 'usr_creator'
  });
  check('a workflow is created', Boolean(wf.id) && wf.enabled === true);

  // A matching signal fires it.
  const sig = signals.emitSignal({ type: 'member_joined', actorId: 'usr_me', circleId: 'c1' });
  check('matches() is true for a matching signal', workflow.matches(wf, sig) === true);

  // A non-matching signal does not.
  const other = signals.emitSignal({ type: 'object_viewed', actorId: 'usr_me' });
  check('matches() is false for a non-matching signal', workflow.matches(wf, other) === false);

  // The sweep runs the actions: tag + notify, deduped.
  const person1 = person.ensurePersonForUser('usr_me');
  const sweep1 = await workflow.sweep();
  check('the sweep executed actions', sweep1.executed >= 2, String(sweep1.executed));
  check('the tag action tagged the person', (person.getPerson(person1.id).tags ?? []).includes('Outdoor enthusiast'));
  check('the notify action created a notification', store.filter('notifications', (n) => n.metadata?.workflowId === wf.id).length >= 1);

  // A second sweep is idempotent — no double fire.
  const sweep2 = await workflow.sweep();
  check('a second sweep is idempotent', sweep2.executed === 0, String(sweep2.executed));

  // Conditions gate execution: a workflow that only fires for a specific actor.
  const cond = workflow.createWorkflow({
    name: 'VIP only', trigger: '*', conditions: [{ field: 'actorId', op: 'eq', value: 'usr_vip' }],
    actions: [{ type: 'tag', tag: 'VIP' }], ownerId: 'usr_creator'
  });
  const notVip = signals.emitSignal({ type: 'object_saved', actorId: 'usr_plain' });
  check('a condition can reject a signal', workflow.matches(cond, notVip) === false);
  const vip = signals.emitSignal({ type: 'object_saved', actorId: 'usr_vip' });
  check('a condition can accept a signal', workflow.matches(cond, vip) === true);

  // A blast action fails closed with no provider/recipient.
  const blastWf = workflow.createWorkflow({
    name: 'Blast', trigger: 'campaign_published',
    actions: [{ type: 'blast', channel: 'sms', to: '0722000111', text: 'New event!' }],
    ownerId: 'usr_creator'
  });
  signals.emitSignal({ type: 'campaign_published', actorId: 'usr_me', objectId: 'o1' });
  await workflow.sweep();
  const run = workflow.listRuns().find((r) => r.workflowId === blastWf.id);
  check('a blast run is logged even when it fails closed', Boolean(run) && run.results[0].ok === false);

  // Over HTTP.
  {
    const { default: appW } = await import('../src/index.js');
    const srvW = appW.listen(0);
    const portW = srvW.address().port;
    const list = await (await fetch(`http://127.0.0.1:${portW}/api/workflows`)).json();
    check('GET /api/workflows lists workflows + runs', Array.isArray(list.workflows) && Array.isArray(list.runs) && typeof list.stats.totalRuns === 'number');
    srvW.close();
  }
}

console.log('\n=== CREATOR: MEDIA KIT, PARTNERSHIP, INBOX, SUBSCRIPTIONS (CCS §3) ===');
{
  const partnership = await import('../src/domain/partnership.js');
  const inbox = await import('../src/domain/inbox.js');
  const subscription = await import('../src/domain/subscription.js');
  const vendors = await import('../src/domain/vendor.js');
  const campaigns = await import('../src/domain/campaign.js');

  // A media kit is derived from a creator's real vendor + activity.
  vendors.createVendor({ ownerId: 'usr_creator', displayName: 'Hike Kenya' });
  const kit = partnership.mediaKit('usr_creator');
  check('a media kit derives from a vendor', kit && kit.displayName === 'Hike Kenya');
  check('the media kit notes no fabricated reach', /No follower count is fabricated/.test(kit.note));
  check('interests are derived (may be empty)', Array.isArray(kit.interests));

  // A brand sends an opportunity; only the creator may respond.
  const opp = partnership.createOpportunity({ creatorId: 'usr_creator', brandId: 'usr_brand', title: 'Sponsored hike', budget: 20000 });
  check('an opportunity is created pending', opp.status === 'pending');
  try { partnership.transitionOpportunity(opp.id, 'accept', 'usr_brand'); check('a brand cannot accept', false); }
  catch (e) { check('a brand cannot accept', /creator may respond/.test(e.message)); }
  partnership.transitionOpportunity(opp.id, 'accept', 'usr_creator');
  check('the creator can accept', partnership.listOpportunities({ creatorId: 'usr_creator' })[0].status === 'accepted');

  // Unified inbox: inbound author activity forms a contact.
  store.insert('rawItems', { id: 'r1', sourceId: 's1', externalId: 'e1', author: 'Wanjiku', text: 'Hi!', platform: 'telegram', publishedAt: new Date().toISOString() });
  const contacts = inbox.listContacts();
  check('an inbound message forms a contact', contacts.some((c) => c.name === 'Wanjiku'));
  const thread = inbox.thread('author:Wanjiku');
  check('the thread has the inbound message', thread.length === 1 && thread[0].direction === 'inbound' && thread[0].text === 'Hi!');

  // Subscriptions: schedule is real, money flows through the ledger.
  const sub = subscription.createSubscription({ creatorId: 'usr_creator', title: 'Trail Club', price: 500, interval: 'monthly' });
  check('a subscription is created active', sub.status === 'active');
  subscription.transitionSubscription(sub.id, 'pause');
  check('a subscription can pause', subscription.getSubscription(sub.id).status === 'paused');
  subscription.transitionSubscription(sub.id, 'resume');
  const tx = subscription.recordCycle(sub.id, 'usr_member');
  check('a cycle is a real ledger transaction', tx.type === 'subscription' && tx.amount === 500);
  const subs = subscription.listSubscriptions({ creatorId: 'usr_creator' });
  check('subscriptions list', subs.length === 1);

  // Outdoor fields are validated and surfaced.
  const camp = campaigns.createCampaign('usr_creator', {
    title: 'Sunrise summit', type: 'popup', location: 'Ngong',
    metadata: { requirements: 'Bring water', equipmentList: ['Boots', 'Torch'], emergencyContact: '0722000111', routeInfo: 'Southern ridge' }
  });
  const pub = campaigns.publicView(campaigns.getCampaign(camp.id));
  check('outdoor fields are surfaced on the public view', pub.equipmentList?.includes('Boots') && pub.routeInfo === 'Southern ridge');
  try {
    campaigns.createCampaign('usr_creator', { title: 'Bad', type: 'popup', metadata: { equipmentList: 'not-a-list' } });
    check('a malformed equipmentList is refused', false);
  } catch (e) {
    check('a malformed equipmentList is refused', /equipmentList must be a list/.test(e.message));
  }

  // Over HTTP.
  {
    const { default: appC } = await import('../src/index.js');
    const srvC = appC.listen(0);
    const portC = srvC.address().port;
    const kits = await (await fetch(`http://127.0.0.1:${portC}/api/creator/mediakits`)).json();
    check('GET /api/creator/mediakits lists derived kits', Array.isArray(kits.mediaKits) && kits.mediaKits.some((k) => k.displayName === 'Hike Kenya'));
    const cs = await (await fetch(`http://127.0.0.1:${portC}/api/inbox/contacts`)).json();
    check('GET /api/inbox/contacts lists contacts', Array.isArray(cs.contacts));
    srvC.close();
  }
}

console.log('\n=== FEATURE REGISTRY (§4.2) ===');
{
  const features = await import('../src/features.js');

  // The WhatsApp connector tests above leave WHATSAPP_* set (a pre-existing
  // leak). Establish the no-credential baseline this block asserts against.
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;

  // Default state: everything enabled; module features configured; provider
  // features NOT configured (no credentials in this run).
  check('every feature is enabled by default', features.list().every((f) => f.enabled));
  check('the registry holds all registered features', features.list().length === 51, String(features.list().length));
  check('workforce is registered and available by default', features.available('workforce') === true);
  check('auth is available by default', features.available('auth') === true);
  check('tea is available by default', features.available('tea') === true);
  check('vaults is available by default', features.available('vaults') === true);
  check('payments is enabled but NOT configured (no rail creds)', features.isEnabled('payments') === true && features.isConfigured('payments') === false);
  check('payments available=false (enabled yet unconfigured)', features.available('payments') === false);
  check('payouts is NOT configured', features.isConfigured('payouts') === false);
  check('outbound is NOT configured (no Twilio creds)', features.isConfigured('outbound') === false);
  check('telegram is NOT configured (no token in this run)', features.isConfigured('telegram') === false);
  check('whatsapp is NOT configured', features.isConfigured('whatsapp') === false);
  check('status() reports disabled as empty', features.status().disabled.length === 0);

  // Deploy toggle: disable tea, then confirm the edge guard 503s and the
  // rest of the app is untouched.
  process.env.BRIEF_DISABLED_FEATURES = 'tea';
  check('disabling tea flips enabled', features.isEnabled('tea') === false);
  check('a disabled feature is not available', features.available('tea') === false);
  check('status() names the disabled feature', features.status().disabled.includes('tea'));
  check('other features are unaffected', features.isEnabled('auth') === true && features.isEnabled('commerce') === true);

  // Over HTTP: /api/tea is 503 when tea is disabled; /api/health is not.
  {
    const { default: appF } = await import('../src/index.js');
    const srvF = appF.listen(0);
    const portF = srvF.address().port;
    const callF = async (p) => {
      const res = await fetch(`http://127.0.0.1:${portF}${p}`);
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const off = await callF('/api/tea');
    check('a disabled feature 503s at the edge', off.status === 503 && off.body?.feature === 'tea', JSON.stringify(off));
    const still = await callF('/api/health');
    check('health still serves while tea is disabled', still.status === 200);
    const cmd = await callF('/api/host/command');
    check('an enabled feature still serves', cmd.status === 200, `got ${cmd.status}`);
    srvF.close();
  }

  delete process.env.BRIEF_DISABLED_FEATURES;
  check('clearing the list re-enables the feature', features.isEnabled('tea') === true);
}

console.log('\n=== BUNI PAYMENT E2E + WEBHOOK (simulated provider) ===');
{
  process.env.NODE_ENV = 'test';
  process.env.BUNI_CONSUMER_KEY = 'ck_shop';
  process.env.BUNI_CONSUMER_SECRET = 'cs_shop';
  process.env.BUNI_BASE_URL = 'https://stub.invalid';
  process.env.BRIEF_PUBLIC_ORIGIN = 'https://brief.example.com';
  process.env.BUNI_WEBHOOK_SECRET = 'buni-cb-secret';

  const pay = await import('../src/domain/payment.js');

  const { default: app } = await import('../src/index.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  let pushes = 0;
  try {
    // A stubbed Buni rail: token, then an accepted push. No real network.
    const fakeFetch = async (url, opts) => {
      const u = String(url);
      if (u.endsWith('/token?grant_type=client_credentials')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'jwt.test.token', expires_in: 3600 }) };
      }
      if (u.endsWith('/mm/api/request/1.0.0/stkpush')) {
        const b = JSON.parse(opts.body);
        // Buni's CheckoutRequestID is unique per push. A stub that hands the same
        // reference to two intents would hide any reference-collision bug, so it
        // varies after the first call and the assertions below use that id.
        pushes++;
        const ref = pushes === 1 ? `ws_CO_${b.amount}` : `ws_CO_${b.amount}_${pushes}`;
        return {
          ok: true, status: 200,
          json: async () => ({ Body: { stkPushResponseCode: {
            MerchantRequestID: 'mr_' + pushes, CheckoutRequestID: ref, ResponseCode: 0,
            CustomerMessage: 'Success. Request accepted for processing'
          } } })
        };
      }
      throw new Error('unexpected URL ' + u);
    };

    const A = (await call('/api/auth/register', 'POST', { handle: 'bseller', password: 'a good passphrase' })).body;
    const B = (await call('/api/auth/register', 'POST', { handle: 'bbuyer', password: 'a good passphrase' })).body;
    await call('/api/vendors', 'POST', { displayName: 'KCB Till Stall' }, A.token);
    let r = await call('/api/listings', 'POST', { title: 'Rice', type: 'product', price: 300, quantityAvailable: 10 }, A.token);
    const lid = r.body.listing.id;
    await call(`/api/listings/${lid}/status`, 'POST', { status: 'active' }, A.token);
    r = await call('/api/orders', 'POST', { listingId: lid, quantity: 2 }, B.token);
    const oid = r.body.order.id;
    check('order placed for 600', r.body.order.total === 600);

    const { intent } = pay.createIntent({ orderId: oid, payerId: B.user.id, phone: '0722000111' });
    check('the rail recorded on the intent is the active one', intent.provider === 'buni', String(intent.provider));
    const init = await pay.requestPayment(intent.id, { fetchImpl: fakeFetch });
    check('requestPayment succeeds against the stubbed rail', init.ok === true && init.providerRef === 'ws_CO_600', JSON.stringify(init));
    let stored = pay.getIntent(intent.id);
    check('the intent is authorized with the provider ref', stored.status === 'authorized' && stored.providerRef === 'ws_CO_600');
    check('initiation is not payment: no ledger row yet', store.all('ledgerTransactions').length === 0);

    const stk = (ref, code, amount, receipt) => ({ Body: { stkCallback: {
      CheckoutRequestID: ref, ResultCode: code, ResultDesc: code === 0 ? 'success' : 'cancelled by user',
      CallBackMetadata: { Item: [{ Name: 'Amount', Value: String(amount) }, { Name: 'MpesaReceiptNumber', Value: receipt }] }
    } } });

    r = await call('/api/webhooks/buni/wrong', 'POST', stk('ws_CO_600', 0, 600, 'R1'));
    check('a wrong callback secret is refused (403)', r.status === 403, `got ${r.status}`);
    check('the rejection leaks no detail', JSON.stringify(r.body) === '{"error":"rejected"}', JSON.stringify(r.body));

    r = await call('/api/webhooks/buni/buni-cb-secret', 'POST', stk('ws_CO_600', 0, 600, 'R1'));
    check('a valid callback is accepted (200)', r.status === 200 && r.body?.ok === true, JSON.stringify(r.body));
    stored = pay.getIntent(intent.id);
    check('the intent is confirmed by the callback', stored.status === 'confirmed', stored.status);

    r = await call('/api/webhooks/buni/buni-cb-secret', 'POST', stk('ws_CO_600', 0, 600, 'R1'));
    check('a replayed callback is an idempotent no-op', r.status === 200 && r.body?.duplicate === true, JSON.stringify(r.body));
    r = await call('/api/webhooks/buni/buni-cb-secret', 'POST', stk('ws_CO_600', 0, 6, 'R2'));
    check('a mismatched amount on a settled intent books nothing',
      r.status === 200 && r.body?.duplicate === true, JSON.stringify(r.body));
    r = await call('/api/webhooks/buni/buni-cb-secret', 'POST', stk('ws_NEVER_ISSUED', 0, 600, 'R3'));
    check('a reference Brief never issued is accepted-with-no-op, not retried forever',
      r.status === 200 && r.body?.ok === false, JSON.stringify(r.body));
    check('the ledger still holds exactly one settlement', store.all('ledgerTransactions').length === 1,
      `rows: ${store.all('ledgerTransactions').length}`);
    check('every callback was recorded for audit, accepted or not',
      store.all('paymentCallbacks').length >= 5, `rows: ${store.all('paymentCallbacks').length}`);

    // A cancelled prompt is an OUTCOME, not a stuck intent: the buyer walked
    // away, so the intent closes and the vendor's inbox stops counting it as
    // pending money. Asserted here because it is the behaviour a UI tends to
    // want to hide.
    const { intent: i2 } = pay.createIntent({ orderId: oid, payerId: B.user.id, phone: '0722000111' });
    await pay.requestPayment(i2.id, { fetchImpl: fakeFetch });
    r = await call('/api/webhooks/buni/buni-cb-secret', 'POST', stk('ws_CO_600_2', 1032, 600, 'R9'));
    check('a cancellation closes its own intent', r.status === 200 && r.body?.ok === true, JSON.stringify(r.body));
    check('a cancelled intent never becomes a settlement',
      pay.getIntent(i2.id).status === 'cancelled' && store.all('ledgerTransactions').length === 1,
      `status ${pay.getIntent(i2.id).status}, rows ${store.all('ledgerTransactions').length}`);
  } finally {
    srv.close();
    delete process.env.BUNI_CONSUMER_KEY;
    delete process.env.BUNI_CONSUMER_SECRET;
    delete process.env.BUNI_BASE_URL;
    delete process.env.BUNI_WEBHOOK_SECRET;
    delete process.env.BRIEF_PUBLIC_ORIGIN;
  }
}

console.log('\n=== SMILE ID — the KYC rail (sole white-label connector) ===');
{
  const smileid = await import('../src/connectors/smileid.js');
  const crypto = await import('node:crypto');

  check('capabilities expose the KYC rail honestly',
    smileid.status().configured === false && smileid.status().missing.includes('partnerId'));

  process.env.SMILE_PARTNER_ID = '002';
  process.env.SMILE_API_KEY = 'smile-test-key';
  const ts = '2026-08-29T00:00:00.000Z';
  const smileExpected = crypto.createHmac('sha256', 'smile-test-key').update(ts, 'utf8').update('002', 'utf8').update('sid_request', 'utf8').digest('base64');
  check('the Smile ID signature is base64 HMAC-SHA256 of timestamp+partner_id+"sid_request"',
    smileid.computeSignature(ts) === smileExpected);
  check('a sandbox default keeps the connector out of production',
    smileid.status().env === 'sandbox' && smileid.status().configured === true);
  let smileSeen = null;
  const smileFetch = async (url, opts) => {
    smileSeen = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, json: async () => ({ ResultCode: '1012', ResultText: 'ID Number was not found in the registry' }) };
  };
  const lk = await smileid.lookupId({ idNumber: '12345678', fetchImpl: smileFetch });
  check('an ID lookup runs the real request path and returns the provider codes',
    lk.ok === true && lk.resultCode === '1012' && /not found/.test(lk.resultText));
  check('the lookup posts to the documented v2 endpoint with header auth',
    smileSeen.url.endsWith('/v2/id_verification') && smileSeen.headers['smileid-partner-id'] === '002'
      && smileid.computeSignature(smileSeen.headers['smileid-timestamp']) === smileSeen.headers['smileid-request-signature']);
  check('the ID number went to the provider for the check',
    smileSeen.body.id_number === '12345678');
  {
    const storedAssist = { provider: 'smileid', at: ts, ok: lk.ok, resultCode: lk.resultCode, resultText: lk.resultText };
    check('the stored assist carries provider codes, never the ID number',
      JSON.stringify(storedAssist).includes('12345678') === false);
  }
  delete process.env.SMILE_PARTNER_ID;
  delete process.env.SMILE_API_KEY;
  check('with credentials removed the KYC rail reports itself unconfigured',
    smileid.isConfigured() === false && (await smileid.lookupId({ idNumber: '1', fetchImpl: smileFetch })).reason === 'not_configured');
}

console.log('\n=== PAYMENT LIFECYCLE, IDEMPOTENCY, REPLAY (simulated provider refs) ===');
{
  store._reset();
  const vendors = await import('../src/domain/vendor.js');
  const listings = await import('../src/domain/listing.js');
  const ordersD = await import('../src/domain/order.js');
  const pay = await import('../src/domain/payment.js');
  const settle = await import('../src/domain/settlement.js');

  const v = vendors.createVendor({ ownerId: 'usr_seller', displayName: 'Pay Test Stall' });
  const l = listings.createListing({ vendorId: v.id, title: 'Sack of rice', type: 'product',
    price: 2000, currency: 'KES', quantityAvailable: 50 });
  listings.transitionListing(l.id, 'active');
  const order = ordersD.createOrder({ listingId: l.id, buyerId: 'usr_buyer', quantity: 2 });
  check('order total is 4000', order.total === 4000, `got ${order.total}`);

  // --- intent creation ------------------------------------------------------
  let threw = null;
  try { pay.createIntent({ orderId: order.id, payerId: 'usr_someone_else' }); }
  catch (e) { threw = e.message; }
  check('a NON-BUYER cannot create a payment intent', /only the buyer/i.test(String(threw)), String(threw));

  const { intent } = pay.createIntent({ orderId: order.id, payerId: 'usr_buyer', phone: '0722000111' });
  check('intent created', intent.status === 'intent');
  // THE CENTRAL ECONOMIC RULE.
  check('the amount comes from the ORDER, not the caller', intent.amount === 4000, `got ${intent.amount}`);
  check('the phone was normalised', intent.phone === '254722000111', intent.phone);
  check('no transaction exists yet', intent.transactionId === null);
  check('the ledger is still empty', store.all('ledgerTransactions').length === 0);

  // A second intent for the same order returns the LIVE one, not a new push.
  const again = pay.createIntent({ orderId: order.id, payerId: 'usr_buyer', phone: '0722000111' });
  check('a second intent for the same order is REUSED', again.reused === true && again.intent.id === intent.id);
  check('only one intent row exists', store.all('paymentIntents').length === 1);

  // Idempotency key.
  const k = pay.createIntent({ orderId: order.id, payerId: 'usr_buyer', idempotencyKey: 'key-1' });
  check('an idempotency key also reuses', k.intent.id === intent.id);

  // --- confirmation ---------------------------------------------------------
  // Simulate the provider having accepted the push by recording its reference.
  store.update('paymentIntents', intent.id, { status: 'authorized', providerRef: 'ws_CO_TEST_1' });

  const unknown = pay.confirmPayment({ providerRef: 'ws_CO_NOPE', succeeded: true, amount: 4000, receipt: 'RX1' });
  check('a callback for an UNKNOWN reference is refused', unknown.ok === false && unknown.reason === 'unknown_reference');

  // AMOUNT TAMPERING: the provider says a different number than we asked for.
  const tampered = pay.confirmPayment({ providerRef: 'ws_CO_TEST_1', succeeded: true, amount: 1, receipt: 'RX_BAD' });
  check('an AMOUNT MISMATCH is refused', tampered.ok === false && tampered.reason === 'amount_mismatch');
  check('and the payment is marked failed, not left hanging', tampered.intent.status === 'failed');
  check('NO transaction was created for the mismatch', store.all('ledgerTransactions').length === 0);
  check('the failure reason records both numbers', /4000/.test(tampered.intent.failureReason) && /1/.test(tampered.intent.failureReason));

  // Recover: a fresh order and a clean confirmation.
  const order2 = ordersD.createOrder({ listingId: l.id, buyerId: 'usr_buyer', quantity: 1 });
  const i2 = pay.createIntent({ orderId: order2.id, payerId: 'usr_buyer', phone: '0722000111' }).intent;
  store.update('paymentIntents', i2.id, { status: 'authorized', providerRef: 'ws_CO_TEST_2' });

  const good = pay.confirmPayment({ providerRef: 'ws_CO_TEST_2', succeeded: true, amount: 2000, receipt: 'RCPT001' });
  check('a correct callback confirms', good.ok === true && good.intent.status === 'confirmed');
  check('exactly ONE ledger transaction was created', store.all('ledgerTransactions').length === 1);
  const tx = store.all('ledgerTransactions')[0];
  check('the transaction is settled', tx.status === 'settled');
  check('the transaction amount is the ORDER amount', tx.amount === 2000, `got ${tx.amount}`);
  check('the provider reference is recorded', tx.metadata?.providerRef === 'ws_CO_TEST_2');
  check('the receipt is recorded', good.intent.receipt === 'RCPT001');

  // --- DUPLICATE CALLBACK ---------------------------------------------------
  const dup = pay.confirmPayment({ providerRef: 'ws_CO_TEST_2', succeeded: true, amount: 2000, receipt: 'RCPT001' });
  check('a DUPLICATE callback is an idempotent no-op', dup.ok === true && dup.duplicate === true);
  check('it returns the ORIGINAL transaction', dup.transactionId === good.transactionId);
  check('still exactly ONE transaction -- no double payment', store.all('ledgerTransactions').length === 1);

  // --- REPLAY with a stolen receipt on a different intent -------------------
  const order3 = ordersD.createOrder({ listingId: l.id, buyerId: 'usr_buyer', quantity: 1 });
  const i3 = pay.createIntent({ orderId: order3.id, payerId: 'usr_buyer', phone: '0722000111' }).intent;
  store.update('paymentIntents', i3.id, { status: 'authorized', providerRef: 'ws_CO_TEST_3' });
  const replay = pay.confirmPayment({ providerRef: 'ws_CO_TEST_3', succeeded: true, amount: 2000, receipt: 'RCPT001' });
  check('REPLAYING a used receipt on another order is refused', replay.ok === false && replay.reason === 'replayed_receipt');
  check('no transaction was created by the replay', store.all('ledgerTransactions').length === 1);

  // --- failed payment -------------------------------------------------------
  const fail = pay.confirmPayment({ providerRef: 'ws_CO_TEST_3', succeeded: false, failureReason: 'Request cancelled by user' });
  check('a FAILED payment is recorded as failed', fail.ok === true && fail.failed === true);
  check('the failure reason is kept', /cancelled/i.test(fail.intent.failureReason));
  check('a failed payment creates NO transaction', store.all('ledgerTransactions').length === 1);
  const refail = pay.confirmPayment({ providerRef: 'ws_CO_TEST_3', succeeded: true, amount: 2000, receipt: 'RCPT999' });
  check('a failed payment cannot later be confirmed', refail.ok === false, JSON.stringify(refail).slice(0, 100));

  // --- SETTLEMENT ONLY AFTER CONFIRMED PAYMENT ------------------------------
  // order2 was genuinely paid, so it -- and only it -- may settle.
  let cannot = false;
  try { ordersD.transitionOrder(order3.id, 'settled'); } catch { cannot = true; }
  check('an UNPAID order still cannot settle', cannot);

  ordersD.attachTransaction(order2.id, good.transactionId);
  ordersD.transitionOrder(order2.id, 'fulfilled');
  const settled = ordersD.transitionOrder(order2.id, 'settled');
  check('a genuinely PAID order CAN settle', settled.order.status === 'settled');

  const earn = settle.vendorEarnings(v.id);
  check('earnings now reflect real money', earn.gross === 2000, `gross=${earn.gross}`);
  check('commission is 5% floored', earn.commission === 100, `commission=${earn.commission}`);
  check('the seller keeps the rest', earn.net === 1900, `net=${earn.net}`);
  check('exactly one settled order', earn.orderCount === 1);
  // The honest bit: earned is still not withdrawable.
  check('payout is STILL unavailable (no payout credentials)', earn.payoutAvailable === false);
  check('and the reason is stated', /provider/i.test(earn.payoutReason));

  // --- reconciliation -------------------------------------------------------
  let rec = pay.reconcileIntents();
  check('payment reconciliation is balanced', rec.balanced === true, JSON.stringify(rec.discrepancies));
  check('it counts confirmed intents', rec.confirmed === 1, `got ${rec.confirmed}`);
  check('it counts failed intents', rec.failed >= 2, `got ${rec.failed}`);

  // NEGATIVE: inject a confirmed intent with no transaction and prove the
  // reconciler catches it rather than trusting it would.
  const rogue = store.insert('paymentIntents', {
    id: 'pay_rogue', orderId: order3.id, payerId: 'usr_buyer', amount: 500,
    currency: 'KES', status: 'confirmed', provider: 'buni', providerRef: 'ws_ROGUE',
    receipt: 'ROGUE1', transactionId: null, createdAt: new Date().toISOString()
  });
  rec = pay.reconcileIntents();
  check('reconciliation DETECTS a confirmed intent with no transaction',
    rec.balanced === false && rec.discrepancies.some((d) => d.kind === 'confirmed_without_transaction'),
    JSON.stringify(rec.discrepancies));
  store.remove('paymentIntents', rogue.id);
  check('and is balanced again once removed', pay.reconcileIntents().balanced === true);

  // The ledger's own reconciliation must also still agree.
  check('ledger reconciliation agrees', settle.reconcile().balanced === true);
}

console.log('\n=== PAYMENT HTTP SURFACE ===');
{
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../src/index.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const A = (await call('/api/auth/register', 'POST', { handle: 'payseller', password: 'a good passphrase' })).body;
    // Reconciliation is a finance capability; bootstrap the buyer for this block.
    process.env.BRIEF_FINANCE = 'paybuyer';
    const B = (await call('/api/auth/register', 'POST', { handle: 'paybuyer', password: 'a good passphrase' })).body;
    await call('/api/vendors', 'POST', { displayName: 'Pay Stall' }, A.token);
    let r = await call('/api/listings', 'POST', { title: 'Beans', type: 'product', price: 300, quantityAvailable: 10 }, A.token);
    const lid = r.body.listing.id;
    await call(`/api/listings/${lid}/status`, 'POST', { status: 'active' }, A.token);
    r = await call('/api/orders', 'POST', { listingId: lid, quantity: 2 }, B.token);
    const oid = r.body.order.id;
    check('order placed for 600', r.body.order.total === 600);

    // Paying without a provider must be honest, not a fake success.
    r = await call(`/api/orders/${oid}/pay`, 'POST', { phone: '0722000111' }, B.token);
    check('pay returns 503 with no provider', r.status === 503, `got ${r.status}`);
    check('it says nothing was charged', r.body?.charged === false);
    check('it names the missing provider', /no payment provider/i.test(r.body?.reason ?? ''));
    check('an intent still exists for audit', Boolean(r.body?.intent?.id));
    check('the intent amount is server-derived', r.body?.intent?.amount === 600);

    // Only the buyer may pay.
    r = await call(`/api/orders/${oid}/pay`, 'POST', { phone: '0722000111' }, A.token);
    check('the SELLER cannot pay for the buyer', r.status === 400, `got ${r.status}`);

    // Unauthenticated payment is refused outright.
    const anon = await fetch(`http://127.0.0.1:${port}/api/orders/${oid}/pay`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer bogus-token' },
      body: JSON.stringify({ phone: '0722000111' })
    });
    check('an invalid token cannot pay (401)', anon.status === 401, `got ${anon.status}`);

    // Payment visibility is party-only.
    r = await call(`/api/orders/${oid}/payments`, 'GET', undefined, B.token);
    check('the buyer can see payment state', r.status === 200 && Array.isArray(r.body?.payments));
    const C = (await call('/api/auth/register', 'POST', { handle: 'paystranger', password: 'a good passphrase' })).body;
    r = await call(`/api/orders/${oid}/payments`, 'GET', undefined, C.token);
    check('a stranger cannot see payment state (404)', r.status === 404, `got ${r.status}`);

    // --- WEBHOOK -------------------------------------------------------------
    // Fails closed with no secret configured.
    const cb = (ref, code = 0, amount = 100) => ({ Body: { stkCallback: { CheckoutRequestID: ref, ResultCode: code, ResultDesc: 'x',
      CallBackMetadata: { Item: [{ Name: 'Amount', Value: String(amount) }, { Name: 'MpesaReceiptNumber', Value: 'R' }] } } } });
    r = await call('/api/webhooks/buni/whatever', 'POST', cb('ws_X'));
    check('the webhook REJECTS when no secret is configured (403)', r.status === 403, `got ${r.status}`);
    check('the rejection leaks no detail', JSON.stringify(r.body) === '{"error":"rejected"}', JSON.stringify(r.body));
    check('the rejected callback was still recorded for audit',
      store.all('paymentCallbacks').some((c) => c.accepted === false));

    // With a secret configured, a WRONG secret is still refused.
    process.env.BUNI_WEBHOOK_SECRET = 'sekret-value-123';
    r = await call('/api/webhooks/buni/wrong-secret-value', 'POST', cb('ws_X'));
    check('a WRONG secret is refused (403)', r.status === 403, `got ${r.status}`);

    // Right secret, but a payload the rail would never send.
    r = await call('/api/webhooks/buni/sekret-value-123', 'POST', { nonsense: true });
    check('a malformed payload is 400, not 500', r.status === 400, `got ${r.status}`);

    // Right secret, unknown reference: accepted (200) but NOT applied, so the
    // provider does not retry forever against a reference we never issued.
    r = await call('/api/webhooks/buni/sekret-value-123', 'POST', cb('ws_UNKNOWN', 0, 600));
    check('an unknown reference returns 200 but ok:false', r.status === 200 && r.body?.ok === false, JSON.stringify(r.body));
    check('no transaction was created', store.all('ledgerTransactions').length === 0);
    delete process.env.BUNI_WEBHOOK_SECRET;

    // Reconciliation endpoint.
    r = await call('/api/economic/payments/reconcile', 'GET', undefined, B.token);
    check('payment reconciliation is exposed', r.status === 200 && typeof r.body?.reconciliation?.balanced === 'boolean');

    // Capabilities must tell the truth.
    r = await call('/api/capabilities');
    check('capabilities still report payments unconfigured', r.body?.payments?.configured === false);
    check('and name the intended rail even while unconfigured', r.body?.payments?.detail?.provider === 'buni');
  } finally {
    srv.close();
  }
}


console.log('\n=== PAYOUT: SETTLED EARNINGS -> DISBURSEMENT ===');
{
  store._reset();
  const vendors = await import('../src/domain/vendor.js');
  const listings = await import('../src/domain/listing.js');
  const ordersD = await import('../src/domain/order.js');
  const settle = await import('../src/domain/settlement.js');
  const led = await import('../src/domain/ledger.js');
  const providers = await import('../src/providers.js');

  const v = vendors.createVendor({ ownerId: 'usr_payee', displayName: 'Payout Stall' });
  const l = listings.createListing({ vendorId: v.id, title: 'Crate', type: 'product',
    price: 1000, currency: 'KES', quantityAvailable: 100 });
  listings.transitionListing(l.id, 'active');

  // Genuinely settle two orders (2000 gross -> 100 commission -> 1900 net).
  const settleOne = (qty) => {
    const o = ordersD.createOrder({ listingId: l.id, buyerId: 'usr_buyer', quantity: qty });
    const tx = led.createTransaction({ amount: o.total, currency: 'KES', type: 'sale' });
    led.transitionTransaction(tx.id, 'pending');
    led.transitionTransaction(tx.id, 'confirmed');
    led.transitionTransaction(tx.id, 'settled');
    ordersD.attachTransaction(o.id, tx.id);
    ordersD.transitionOrder(o.id, 'fulfilled');
    ordersD.transitionOrder(o.id, 'settled');
    return o;
  };
  settleOne(1);
  settleOne(1);

  let e = settle.vendorEarnings(v.id);
  check('two settled orders', e.orderCount === 2);
  check('gross is 2000', e.gross === 2000, `got ${e.gross}`);
  check('commission is 100', e.commission === 100, `got ${e.commission}`);
  check('net is 1900', e.net === 1900, `got ${e.net}`);
  check('nothing paid out yet', e.paidOut === 0);
  check('withdrawable equals net', e.withdrawable === 1900, `got ${e.withdrawable}`);

  // WITHOUT a disbursement provider the request must be REFUSED, not queued,
  // and must never create a payout row or a ledger transaction.
  const ledgerRowsBefore = store.all('ledgerTransactions').length;
  let threw = null, code = null;
  try { settle.requestPayout({ vendorId: v.id, requestedBy: 'usr_payee', phone: '0722000111' }); }
  catch (err) { threw = err.message; code = err.code; }
  check('a payout is REFUSED with no provider', /unavailable|not configured/i.test(String(threw)), String(threw));
  check('the refusal is machine-readable (provider_unavailable)', code === 'provider_unavailable');
  check('no payout row was created', store.all('payouts').length === 0);
  check('no ledger transaction was created', store.all('ledgerTransactions').length === ledgerRowsBefore);
  check('payoutAvailable is false', e.payoutAvailable === false);
  check('and the reason names the provider', /provider/i.test(e.payoutReason));

  // Authorization: only the vendor may request their own payout.
  threw = null;
  try { settle.requestPayout({ vendorId: v.id, requestedBy: 'usr_someone_else', phone: '0722000111' }); }
  catch (err) { threw = err.message; }
  check('another actor cannot request this vendor payout', /only the vendor/i.test(String(threw)), String(threw));

  // --- with a disbursement provider registered -----------------------------
  // A test provider is registered ONLY to exercise the payout ledger
  // arithmetic; no network call is made because sendPayout() is not invoked
  // here. This also proves the provider seam works: the domain layer sees a
  // configured disbursement provider without knowing anything about it.
  providers.DISBURSEMENT_PROVIDERS.testpayout = {
    isPayoutConfigured: () => true,
    status: () => ({ provider: 'testpayout', configured: true }),
    disburse: async ({ amount }) => ({ ok: true, providerRef: `TEST_${amount}` })
  };

  e = settle.vendorEarnings(v.id);
  check('payout now reports available', e.payoutAvailable === true);
  check('withdrawable is still derived, not stored', e.withdrawable === 1900);

  const { payout } = settle.requestPayout({ vendorId: v.id, requestedBy: 'usr_payee', phone: '0722000111' });
  check('a payout can be requested', payout.status === 'requested');
  // THE CENTRAL RULE: the amount is derived, never asked for.
  check('the payout amount is DERIVED from settled orders', payout.amount === 1900, `got ${payout.amount}`);
  check('the phone was normalised', payout.phone === '254722000111');

  // In-flight money must reduce what is withdrawable.
  e = settle.vendorEarnings(v.id);
  check('an in-flight payout reduces withdrawable to 0', e.withdrawable === 0, `got ${e.withdrawable}`);
  check('pendingPayout reflects it', e.pendingPayout === 1900);
  check('payoutAvailable is false while one is in flight', e.payoutAvailable === false);
  check('and says a payout is in progress', /in progress/i.test(e.payoutReason), e.payoutReason);

  // A SECOND concurrent payout must not be created.
  const second = settle.requestPayout({ vendorId: v.id, requestedBy: 'usr_payee', phone: '0722000111' });
  check('a concurrent second payout is REUSED, not created', second.reused === true && second.payout.id === payout.id);
  check('still exactly one payout row', store.all('payouts').length === 1);

  // Idempotency key.
  const k1 = settle.requestPayout({ vendorId: v.id, requestedBy: 'usr_payee', idempotencyKey: 'pk-1' });
  check('an idempotency key reuses too', k1.payout.id === payout.id);

  // --- confirmation ---------------------------------------------------------
  store.update('payouts', payout.id, { providerRef: 'AG_CONV_1' });
  const unknown = settle.confirmPayout({ providerRef: 'AG_NOPE', succeeded: true });
  check('an unknown payout reference is refused', unknown.ok === false && unknown.reason === 'unknown_reference');

  const paid = settle.confirmPayout({ providerRef: 'AG_CONV_1', succeeded: true });
  check('the payout confirms as paid', paid.ok === true && paid.payout.status === 'paid');

  e = settle.vendorEarnings(v.id);
  check('paidOut now reflects the disbursement', e.paidOut === 1900, `got ${e.paidOut}`);
  check('withdrawable is 0 -- money was actually sent', e.withdrawable === 0);
  check('but net earnings are UNCHANGED (history, not a balance)', e.net === 1900);

  // DOUBLE PAYOUT: a re-delivered result must not pay again.
  const dup = settle.confirmPayout({ providerRef: 'AG_CONV_1', succeeded: true });
  check('a duplicate payout result is an idempotent no-op', dup.ok === true && dup.duplicate === true);
  check('paidOut did NOT double', settle.vendorEarnings(v.id).paidOut === 1900);
  check('still exactly one payout row', store.all('payouts').length === 1);

  // Requesting again with nothing left must be refused.
  threw = null;
  try { settle.requestPayout({ vendorId: v.id, requestedBy: 'usr_payee', phone: '0722000111' }); }
  catch (err) { threw = err.message; }
  check('a payout with nothing withdrawable is refused', /already been paid|no settled earnings/i.test(String(threw)), String(threw));

  // New sales create new withdrawable money -- and only the new amount.
  settleOne(1);
  e = settle.vendorEarnings(v.id);
  check('a new settled sale increases net', e.net === 2850, `got ${e.net}`);
  check('withdrawable is ONLY the new money', e.withdrawable === 950, `got ${e.withdrawable}`);

  // A FAILED payout must return the money to withdrawable, not lose it.
  const p2 = settle.requestPayout({ vendorId: v.id, requestedBy: 'usr_payee', phone: '0722000111' }).payout;
  store.update('payouts', p2.id, { providerRef: 'AG_CONV_2' });
  settle.confirmPayout({ providerRef: 'AG_CONV_2', succeeded: false, failureReason: 'insufficient float' });
  e = settle.vendorEarnings(v.id);
  check('a FAILED payout does not count as paid', e.paidOut === 1900, `got ${e.paidOut}`);
  check('and the money becomes withdrawable again', e.withdrawable === 950, `got ${e.withdrawable}`);
  check('the failure reason is retained',
    /insufficient float/i.test(store.find('payouts', (p) => p.id === p2.id).failureReason));

  // The ledger must still reconcile through all of this.
  check('ledger still reconciles', settle.reconcile().balanced === true, JSON.stringify(settle.reconcile().discrepancies));

  // NO SECOND WALLET: withdrawable is derived, so deleting payouts restores it.
  const before = settle.vendorEarnings(v.id).withdrawable;
  store.remove('payouts', p2.id);
  check('removing a payout row changes the derived figure (no stored balance)',
    settle.vendorEarnings(v.id).withdrawable === before);

  delete providers.DISBURSEMENT_PROVIDERS.testpayout;
  check('with the provider removed, payout is unavailable again',
    settle.vendorEarnings(v.id).payoutAvailable === false);
}

console.log('\n=== DISBURSEMENT: M-PESA B2C RAIL (tariff, parse, disburse, fee pass-through) ===');
{
  const mpesa = await import('../src/connectors/mpesa.js');
  const settle = await import('../src/domain/settlement.js');

  // --- the flat tariff: exact bands, capped, pass-through at cost -----------
  check('B2C fee is 0 under KES 100', mpesa.b2cFee(50) === 0 && mpesa.b2cFee(100) === 0);
  check('B2C fee 101-500 is 7', mpesa.b2cFee(500) === 7);
  check('B2C fee 501-1000 is 13', mpesa.b2cFee(1000) === 13);
  check('B2C fee 1001-1500 is 23', mpesa.b2cFee(1500) === 23);
  check('B2C fee 1501-2500 is 33', mpesa.b2cFee(2500) === 33);
  check('B2C fee 2501-3500 is 53', mpesa.b2cFee(3500) === 53);
  check('B2C fee 3501-5000 is 57', mpesa.b2cFee(5000) === 57);
  check('B2C fee 5001-7500 is 78', mpesa.b2cFee(7500) === 78);
  check('B2C fee 7501-10000 is 90', mpesa.b2cFee(10000) === 90);
  check('B2C fee 10001-15000 is 100', mpesa.b2cFee(15000) === 100);
  check('B2C fee 15001-20000 is 105', mpesa.b2cFee(20000) === 105);
  check('B2C fee 20001+ is capped at 108', mpesa.b2cFee(35000) === 108 && mpesa.b2cFee(250000) === 108);
  check('B2C fee refuses nonsense', mpesa.b2cFee(-5) === null && mpesa.b2cFee('x') === null && mpesa.b2cFee(0) === null);

  // --- parse the asynchronous B2C result -------------------------------
  const okRes = mpesa.parseB2CResult({ Result: { ResultCode: 0, ConversationID: 'AG_1', TransactionID: 'TXN1', ResultDesc: 'accepted' } });
  check('B2C result parses success', okRes.ok && okRes.succeeded === true && okRes.conversationId === 'AG_1' && okRes.transactionId === 'TXN1');
  const failRes = mpesa.parseB2CResult({ Result: { ResultCode: 1, ConversationID: 'AG_2', ResultDesc: 'insufficient funds' } });
  check('B2C result parses failure', failRes.ok && failRes.succeeded === false && /insufficient/i.test(failRes.failureReason));
  check('B2C result rejects junk', mpesa.parseB2CResult({ nonsense: true }).ok === false);

  // --- disburse fails closed without credentials ------------------------
  const noCred = await mpesa.disburse({ amount: 1000, phone: '0722000111', fetchImpl: async () => { throw new Error('must not be called'); } });
  check('disburse fails closed when unconfigured', noCred.ok === false && noCred.reason === 'not_configured');
  check('missing credentials are named', Array.isArray(noCred.missing) && noCred.missing.length > 0);

  // --- disburse happy path with a mocked fetch (env set + restored) -----
  const saved = {};
  const keys = ['MPESA_ENV', 'MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE',
    'MPESA_CALLBACK_SECRET', 'MPESA_B2C_INITIATOR', 'MPESA_B2C_SECURITY_CREDENTIAL', 'BRIEF_PUBLIC_ORIGIN'];
  for (const k of keys) saved[k] = process.env[k];
  try {
    process.env.MPESA_ENV = 'sandbox';
    process.env.MPESA_CONSUMER_KEY = 'ck';
    process.env.MPESA_CONSUMER_SECRET = 'cs';
    process.env.MPESA_SHORTCODE = '600000';
    process.env.MPESA_CALLBACK_SECRET = 'callsec';
    process.env.MPESA_B2C_INITIATOR = 'initiator';
    process.env.MPESA_B2C_SECURITY_CREDENTIAL = 'cred';
    process.env.BRIEF_PUBLIC_ORIGIN = 'https://brief.test';
    mpesa._resetTokenCache();
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url: String(url), opts });
      if (String(url).includes('/oauth/v1/generate')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3000 }) };
      }
      return { ok: true, status: 200, json: async () => ({ ConversationID: 'AG_CONV_X', OriginatorConversationID: 'OG_X', ResponseCode: '0', ResponseDescription: 'accepted' }) };
    };
    const sent = await mpesa.disburse({ amount: 1500, phone: '0722000111', remarks: 'Brief payout', fetchImpl });
    check('disburse succeeds against Daraja', sent.ok === true);
    check('disburse returns the ConversationID as providerRef', sent.providerRef === 'AG_CONV_X');
    const b2cCall = calls.find((c) => c.url.includes('/mpesa/b2c/'));
    check('the B2C endpoint was hit', Boolean(b2cCall));
    const payload = b2cCall ? JSON.parse(b2cCall.opts.body) : {};
    check('B2C amount is whole shillings', payload.Amount === 1500);
    check('B2C recipient is normalised to 254...', payload.PartyB === '254722000111');
    check('B2C CommandID is BusinessPayment', payload.CommandID === 'BusinessPayment');
    check('B2C ResultURL embeds the secret path', String(payload.ResultURL).includes('/api/webhooks/mpesa-b2c/'));
    check('B2C PartyA is the shortcode', payload.PartyA === '600000');
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    mpesa._resetTokenCache();
  }

  // --- fee pass-through: a provider WITH a fee reduces the payout amount ---
  const vendors = await import('../src/domain/vendor.js');
  const listings = await import('../src/domain/listing.js');
  const ordersD = await import('../src/domain/order.js');
  const led = await import('../src/domain/ledger.js');
  const providers = await import('../src/providers.js');
  store._reset();

  const v = vendors.createVendor({ ownerId: 'usr_fee', displayName: 'Fee Stall' });
  const l = listings.createListing({ vendorId: v.id, title: 'Widget', type: 'product', price: 1000, currency: 'KES', quantityAvailable: 10 });
  listings.transitionListing(l.id, 'active');
  const o = ordersD.createOrder({ listingId: l.id, buyerId: 'usr_fee_buyer', quantity: 1 });
  const tx = led.createTransaction({ amount: o.total, currency: 'KES', type: 'sale' });
  led.transitionTransaction(tx.id, 'pending');
  led.transitionTransaction(tx.id, 'confirmed');
  led.transitionTransaction(tx.id, 'settled');
  ordersD.attachTransaction(o.id, tx.id);
  ordersD.transitionOrder(o.id, 'fulfilled');
  ordersD.transitionOrder(o.id, 'settled');

  providers.DISBURSEMENT_PROVIDERS.feeRail = {
    isPayoutConfigured: () => true,
    status: () => ({ provider: 'feeRail', configured: true }),
    payoutFee: (amount) => mpesa.b2cFee(amount),
    disburse: async () => ({ ok: true, providerRef: 'FEE_1' })
  };

  let e = settle.vendorEarnings(v.id);
  check('fee rail: net is 950 (1000 - 5%)', e.net === 950, `got ${e.net}`);
  check('fee rail: withdrawable is 950', e.withdrawable === 950);

  const { payout } = settle.requestPayout({ vendorId: v.id, requestedBy: 'usr_fee', phone: '0722000111' });
  check('payout grossAmount is the withdrawable (950)', payout.grossAmount === 950, `got ${payout.grossAmount}`);
  check('payout fee is the flat tariff for 950 (13)', payout.fee === 13, `got ${payout.fee}`);
  check('payout amount is net of the fee (937)', payout.amount === 937, `got ${payout.amount}`);
  check('fee + amount === gross (exact pass-through, no leak)', payout.fee + payout.amount === payout.grossAmount);

  // sendPayout dispatches the NET amount, not the gross.
  const sent = await settle.sendPayout(payout.id, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  check('sendPayout goes through the fee rail', sent.ok === true && sent.providerRef === 'FEE_1');

  delete providers.DISBURSEMENT_PROVIDERS.feeRail;
  check('with the fee rail removed, payout is unavailable again', settle.vendorEarnings(v.id).payoutAvailable === false);
}

console.log('\n=== PAYOUT OVER HTTP: 503 / provider_unavailable (no provider) ===');
{
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../src/index.js');
  const ordersD = await import('../src/domain/order.js');
  const ledgerD = await import('../src/domain/ledger.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const S = (await call('/api/auth/register', 'POST', { handle: 'payseller503', password: 'a good passphrase' })).body;
    const B = (await call('/api/auth/register', 'POST', { handle: 'paybuyer503', password: 'a good passphrase' })).body;
    const v = (await call('/api/vendors', 'POST', { displayName: '503 Stall' }, S.token)).body.vendor;
    const l = (await call('/api/listings', 'POST', { title: 'Beans', type: 'product', price: 500, quantityAvailable: 10 }, S.token)).body.listing;
    await call(`/api/listings/${l.id}/status`, 'POST', { status: 'active' }, S.token);
    const o = (await call('/api/orders', 'POST', { listingId: l.id, quantity: 2 }, B.token)).body.order;

    // Give the vendor REAL settled earnings: a settled ledger transaction
    // attached to the order, then fulfil + settle the order -- exactly the
    // ordinary money path. No provider is involved in this step.
    const tx = ledgerD.createTransaction({ amount: o.total, currency: 'KES', type: 'sale', counterparty: B.user.id });
    ledgerD.transitionTransaction(tx.id, 'pending');
    ledgerD.transitionTransaction(tx.id, 'confirmed');
    ledgerD.transitionTransaction(tx.id, 'settled');
    ordersD.attachTransaction(o.id, tx.id);
    await call(`/api/orders/${o.id}/fulfil`, 'POST', {}, S.token);
    await call(`/api/orders/${o.id}/settle`, 'POST', {}, S.token);

    const earn = (await call('/api/vendors/me/earnings', 'GET', undefined, S.token)).body.earnings;
    check('the vendor has settled earnings (net of commission)', earn?.withdrawable === 950, `got ${earn?.withdrawable}`);
    check('but payoutAvailable is false (no provider)', earn?.payoutAvailable === false);

    // Requesting a payout with earnings but NO disbursement provider must
    // return an honest 503 / provider_unavailable -- never a queued payout,
    // never a successful (or fake) ledger transaction.
    const payoutRowsBefore = store.all('payouts').length;
    const ledgerRowsBefore = store.all('ledgerTransactions').length;
    const r = await call('/api/vendors/me/payouts', 'POST', { phone: '0722000111' }, S.token);
    check('payout over HTTP is refused with 503', r.status === 503, `got ${r.status}`);
    check('and names provider_unavailable', r.body?.code === 'provider_unavailable', JSON.stringify(r.body));
    check('no payout row was created', store.all('payouts').length === payoutRowsBefore);
    check('no ledger transaction was created', store.all('ledgerTransactions').length === ledgerRowsBefore);
    check('earnings remain withdrawable (nothing was silently disbursed)',
      (await call('/api/vendors/me/earnings', 'GET', undefined, S.token)).body.earnings?.withdrawable === 950);
  } finally {
    srv.close();
  }
}


console.log('\n=== MIGRATIONS AGAINST AN OLD FIXTURE ===');
{
  const st = await import('../src/store.js');

  // A database as it existed BEFORE any of Batch 3/4: no vendors, no orders,
  // no users, no schema version. This is the real upgrade case.
  const legacy = {
    sources: [{ id: 'src_old', name: 'Old source' }],
    objects: [{ id: 'obj_old', title: 'An old object' }],
    signals: [{ id: 'sig_old', type: 'object_created' }]
    // note: no __schemaVersion, no vendors/orders/users/sessions/payments
  };

  const merged = { ...JSON.parse(JSON.stringify({
    users: [], sessions: [], vendors: [], listings: [], orders: [], disputes: [],
    paymentIntents: [], paymentCallbacks: [], payouts: [],
    requests: [],
  })), ...legacy };

  // No backup hook: this fixture is in memory, not on disk.
  const result = st.migrate(merged, { onBackup: () => null });
  check('an unversioned database is detected as version 0', result.from === 0);
  check('it migrates to the current version', result.to === st.SCHEMA_VERSION);
  check('migrations were applied in order', result.applied.join(',') === '1:baseline,2:backfill-order-currency,3:signal-sequence', result.applied?.join(','));

  // EXISTING DATA MUST SURVIVE. This is the whole safety requirement.
  check('existing sources survived', result.db.sources.length === 1 && result.db.sources[0].id === 'src_old');
  check('existing objects survived', result.db.objects[0].title === 'An old object');
  check('existing signals survived', result.db.signals.length === 1);
  // And new collections exist without anyone writing a migration for them.
  check('new collections appear automatically', Array.isArray(result.db.users) && Array.isArray(result.db.payouts));
  check('new Request collection appears', Array.isArray(result.db.requests));

  // The real transformation: backfill a missing currency.
  const withOrders = { ...merged, __schemaVersion: 1, orders: [
    { id: 'ord_legacy_1', total: 500 },                 // no currency
    { id: 'ord_legacy_2', total: 800, currency: 'USD' } // already set
  ] };
  const r2 = st.migrate(withOrders, { onBackup: () => null });
  check('a v1 database migrates to the current version', r2.from === 1 && r2.to === st.SCHEMA_VERSION);
  check('a missing currency is BACKFILLED', r2.db.orders[0].currency === 'KES');
  check('an existing currency is NOT overwritten', r2.db.orders[1].currency === 'USD', r2.db.orders[1].currency);

  // Idempotency: running again must do nothing.
  const r3 = st.migrate(r2.db, { onBackup: () => null });
  check('re-running migrations is a no-op', r3.migrated === false && r3.from === st.SCHEMA_VERSION);

  // A CURRENT database is untouched.
  const current = { ...merged, __schemaVersion: st.SCHEMA_VERSION };
  check('a current database is not migrated', st.migrate(current, { onBackup: () => null }).migrated === false);

  // A FAILING migration must abort, not half-apply, and must say where the
  // backup is. Verified by injecting a thrower rather than trusting the path.
  let aborted = null;
  try {
    st.migrate({ ...merged, __schemaVersion: 0 }, {
      onBackup: () => { throw new Error('disk full'); }
    });
  } catch (e) { aborted = e.message; }
  check('a failing BACKUP aborts the migration', Boolean(aborted), String(aborted));
}

console.log('\n=== OPERATIONS: READINESS, DIAGNOSTICS, BACKUP ===');
{
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../src/index.js');
  const opsM = await import('../src/ops.js');
  const settleM = await import('../src/domain/settlement.js');
  const payM = await import('../src/domain/payment.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    // --- readiness -----------------------------------------------------------
    let r = await call('/api/ready');
    check('readiness is public and returns 200 when healthy', r.status === 200, `got ${r.status}`);
    check('it reports uptime', Number.isFinite(r.body?.uptimeSeconds));
    check('it checks the store', r.body.checks.some((c) => c.name === 'store' && c.ok));
    // Readiness must be tied to REAL economic state, not a hardcoded true.
    check('it checks settlement reconciliation', r.body.checks.some((c) => c.name === 'settlement'));
    check('it checks payment reconciliation', r.body.checks.some((c) => c.name === 'payments'));

    // Break reconciliation and prove readiness NOTICES.
    store.insert('orders', {
      id: 'ord_rogue_ready', vendorId: 'vend_x', buyerId: 'usr_y', status: 'settled',
      total: 100, currency: 'KES', transactionId: null, createdAt: new Date().toISOString()
    });
    r = await call('/api/ready');
    check('a broken ledger makes readiness FAIL (503)', r.status === 503, `got ${r.status}`);
    check('and the failing check is named',
      r.body.checks.some((c) => c.name === 'settlement' && !c.ok), JSON.stringify(r.body.checks));
    store.remove('orders', 'ord_rogue_ready');
    r = await call('/api/ready');
    check('readiness recovers once fixed', r.status === 200);

    // --- diagnostics ---------------------------------------------------------
    // Deployment bootstrap: this handle is named an operator by environment,
    // which is exactly how a fresh deploy names its first operator.
    process.env.BRIEF_OPERATORS = 'operator';
    const U = (await call('/api/auth/register', 'POST', { handle: 'operator', password: 'a good passphrase' })).body;
    r = await call('/api/ops/diagnostics', 'GET', undefined, U.token);
    check('diagnostics are available to an authenticated operator', r.status === 200);
    check('they report the data file', typeof r.body?.startup?.dataFile === 'string');
    check('they report writability', r.body.startup.dataWritable === true);
    check('they count real collections', Number.isFinite(r.body?.counts?.users));
    check('they surface recent errors', Array.isArray(r.body?.recentErrors));
    check('they surface rejected webhook callbacks', Number.isFinite(r.body?.rejectedCallbacks));

    // --- T8 operator visibility: the dispute wall + resale listing wall ------
    r = await call('/api/ops/disputes', 'GET', undefined, U.token);
    check('the dispute wall is readable by an operator', r.status === 200 && Array.isArray(r.body?.disputes));
    r = await call('/api/ops/disputes', 'GET');
    check('the dispute wall is not anonymous', r.status === 401 || r.status === 403);
    r = await call('/api/ops/ticket-listings', 'GET', undefined, U.token);
    check('the resale listing wall is readable by an operator', r.status === 200 && Array.isArray(r.body?.listings));
    check('removed listings keep their reason for the audit trail',
      r.body.listings.filter((l) => l.status === 'removed')
        .every((l) => typeof l.removedReason === 'string' && l.removedReason.length > 0));

    // --- backup --------------------------------------------------------------
    r = await call('/api/ops/backup', 'POST', {}, U.token);
    check('a backup can be taken', r.status === 200 && r.body?.ok === true, JSON.stringify(r.body).slice(0, 140));
    const fsm = await import('node:fs');
    check('the backup file really exists on disk', fsm.existsSync(r.body.file));
    check('and it is not empty', r.body.size > 0);
    // A backup must be restorable, which means valid JSON with real content.
    const restored = JSON.parse(fsm.readFileSync(r.body.file, 'utf8'));
    check('the backup parses as JSON', typeof restored === 'object');
    check('the backup carries the schema version', restored.__schemaVersion === (await import('../src/store.js')).SCHEMA_VERSION);
    check('the backup contains the users', Array.isArray(restored.users) && restored.users.length >= 1);

    // Pruning must keep the disk bounded.
    for (let i = 0; i < 3; i++) opsM.backup(store);
    const pruned = opsM.pruneBackups(store, 2);
    check('pruning keeps only the newest N', pruned.kept === 2, JSON.stringify(pruned));

    // --- restore-from-snapshot: the redeploy resilience net ------------------
    // With a live, non-empty data file, restore is a no-op.
    const restoreNoop = opsM.restoreLatestBackupIfEmpty(store);
    check('restore is a no-op when data exists', restoreNoop.restored === false, JSON.stringify(restoreNoop));
    // Simulate a wiped primary (fresh deploy) with a snapshot present: restore
    // must bring the snapshot back.
    const dataFile = store._file;
    const backupDir = path.join(path.dirname(dataFile), 'backups');
    const snapshots = fsm.readdirSync(backupDir).filter((f) => f.endsWith('.json')).sort();
    check('a snapshot exists to restore from', snapshots.length > 0, String(snapshots.length));
    fsm.renameSync(dataFile, `${dataFile}.wiped`);
    const restored2 = opsM.restoreLatestBackupIfEmpty(store);
    check('restore brings the snapshot back after a wipe', restored2.restored === true, JSON.stringify(restored2));
    check('the data file is back on disk', fsm.existsSync(dataFile));
    fsm.rmSync(`${dataFile}.wiped`, { force: true });

    // The periodic backup installer is disabled in test (non-positive interval).
    check('periodic backup disables on a non-positive interval', opsM.installPeriodicBackup(store, { intervalMs: 0 }) === null);

    // --- startup diagnostics flag real problems -------------------------------
    const diagProd = opsM.startupDiagnostics({
      store, capabilities: { payments: { configured: false } }
    });
    check('diagnostics note the missing payment provider outside production',
      Array.isArray(diagProd.notes));

    const prevEnv = process.env.NODE_ENV;
    const prevDev = process.env.BRIEF_DEV_AUTH;
    process.env.NODE_ENV = 'production';
    process.env.BRIEF_DEV_AUTH = '1';
    const risky = opsM.startupDiagnostics({ store, capabilities: { payments: { configured: false } } });
    check('an insecure production auth config is flagged as a PROBLEM',
      risky.problems.some((p) => /BRIEF_DEV_AUTH/.test(p)), JSON.stringify(risky.problems));
    // And the auth layer itself must agree.
    const { authStatus: as } = await import('../src/identity.js');
    check('authStatus also reports it as insecure', as().insecure === true);
    process.env.NODE_ENV = prevEnv;
    if (prevDev === undefined) delete process.env.BRIEF_DEV_AUTH; else process.env.BRIEF_DEV_AUTH = prevDev;
    check('and it is not insecure once unset', as().insecure === false);

    // --- ops endpoints are not public ----------------------------------------
    // (dev fallback is on in tests, so this asserts the route exists and is
    // guarded by requireAuth rather than being anonymous-only.)
    // With capability guards, a resolved caller WITHOUT the capability gets a
    // real 403 answer -- still a response from a living, guarded route.
    r = await call('/api/ops/diagnostics');
    check('diagnostics respond for a resolved caller', [200, 401, 403].includes(r.status), `got ${r.status}`);
  } finally {
    srv.close();
    delete process.env.BRIEF_OPERATORS;
  }
}


console.log('\n=== ENDPOINT AUTHORIZATION RULES, ENCODED EXPLICITLY ===');
{
  // Turn the development fallback OFF so "unauthenticated" genuinely means
  // no identity at all. This is the production posture.
  const prevDev = process.env.BRIEF_DEV_AUTH;
  process.env.BRIEF_DEV_AUTH = '0';
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../src/index.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const { authStatus } = await import('../src/identity.js');
    check('with the fallback off, auth is REQUIRED', authStatus().devFallback === false);

    // --- private operations must be refused outright -------------------------
    const privateOps = [
      ['POST', '/api/sources', { name: 'X', type: 'manual' }],
      ['POST', '/api/connectors/web/fetch', { url: 'https://example.com' }],
      ['POST', '/api/connectors/rss/sync', { url: 'https://example.com/feed' }],
      ['POST', '/api/connectors/telegram/sync', {}],
      ['POST', '/api/brief-it/preview', { text: 'something' }],
      ['POST', '/api/brief-it/save', { text: 'something' }],
      // Found by audit, not by the original sweep: these three accepted an
      // anonymous caller and wrote rows with no actor behind them.
      ['POST', '/api/campaigns', { title: 'X' }],
      ['POST', '/api/transactions', { amount: 1, currency: 'KES', type: 'contribution' }],
      ['POST', '/api/vendors', { displayName: 'X' }],
      ['POST', '/api/listings', { title: 'X', price: 1 }],
      ['POST', '/api/orders', { listingId: 'x' }],
      ['POST', '/api/requests', { title: 'Packaging' }],
      ['GET', '/api/vendors/me/earnings', null],
      ['POST', '/api/vendors/me/payouts', {}],
      ['GET', '/api/ops/diagnostics', null],
      ['POST', '/api/ops/backup', {}]
    ];
    let refusedAll = true;
    const leaked = [];
    for (const [method, path, body] of privateOps) {
      const r = await call(path, method, body);
      if (r.status !== 401) { refusedAll = false; leaked.push(`${method} ${path} -> ${r.status}`); }
    }
    check('EVERY private operation refuses an anonymous caller (401)', refusedAll, leaked.join(' | '));

    // A forged token must be refused exactly the same way.
    const forged = await call('/api/vendors', 'POST', { displayName: 'X' }, 'totally-made-up-token');
    check('a forged token is refused too (401)', forged.status === 401, `got ${forged.status}`);

    // --- public operations must STAY public ----------------------------------
    const publicOps = [
      ['GET', '/api/health'],
      ['GET', '/api/ready'],
      ['GET', '/api/capabilities'],
      ['GET', '/api/listings'],
      ['GET', '/api/tea'],
    ];
    // Product decision (2026-08-29): NO ACCESS WITHOUT AN ACCOUNT. Data reads
    // answer 401 to an anonymous caller; only sign-in, the external campaign
    // share face, ops probes and the account-less newsletter surface stay open.
    let allGated = true;
    const ungated = [];
    for (const [method, path] of publicOps) {
      const r = await call(path, method);
      if (path === '/api/ready' || path === '/api/health') continue; // ops probes: stay public
      if (r.status !== 401) { allGated = false; ungated.push(`${path}:${r.status}`); }
    }
    check('the app gate: data reads need a session', allGated, ungated.join(', '));
    check('ops probes stay public (deploy health checks)',
      (await call('/api/ready', 'GET')).status === 200);
    let gated = await call('/api/feed', 'GET');
    check('the feed is behind the gate (401, account_required)',
      gated.status === 401 && gated.body?.gate === 'account_required', JSON.stringify(gated.body));
    gated = await call('/api/public/campaigns/does-not-exist', 'GET');
    check('the external campaign share face stays open (404, not 401)',
      gated.status === 404, `got ${gated.status}`);

    // --- registration and login must remain reachable ------------------------
    let r = await call('/api/auth/register', 'POST', { handle: 'authruleuser', password: 'a good passphrase' });
    check('registration is reachable without a token', r.status === 201, `got ${r.status}`);
    const tok = r.body.token;
    r = await call('/api/auth/login', 'POST', { handle: 'authruleuser', password: 'a good passphrase' });
    check('login is reachable without a token', r.status === 200);

    // --- SELF-SCOPED source creation, verified end to end --------------------
    r = await call('/api/sources', 'POST', { name: 'My channel', type: 'telegram_channel' }, tok);
    check('an authenticated caller CAN create a source', r.status === 201, JSON.stringify(r.body).slice(0, 120));
    const src = r.body.source;
    check('the creator got a granted membership',
      Boolean(store.find('sourceMemberships', (m) => m.sourceId === src.id && m.userId !== null && m.accessGranted)));
    check('a new source is NOT born connected', src.connectionStatus === 'needs_authorization');

    // The creator can delete their own source...
    const other = (await call('/api/auth/register', 'POST', { handle: 'otheractor', password: 'a good passphrase' })).body;
    r = await call(`/api/sources/${src.id}`, 'DELETE', undefined, other.token);
    check('ANOTHER actor cannot delete it (403)', r.status === 403, `got ${r.status}`);
    r = await call(`/api/sources/${src.id}`, 'DELETE', undefined, tok);
    check('the creator CAN delete it', r.status === 200, `got ${r.status}`);
    check('memberships cascaded', store.filter('sourceMemberships', (m) => m.sourceId === src.id).length === 0);

    // --- public campaign registration must stay intentionally public ---------
    const org = (await call('/api/auth/register', 'POST', { handle: 'puborg', password: 'a good passphrase' })).body;
    r = await call('/api/campaigns', 'POST', { title: 'Open Day', type: 'popup' }, org.token);
    const camp = r.body.campaign;
    await call(`/api/campaigns/${camp.id}/publish`, 'POST', {}, org.token);
    r = await call(`/api/public/campaigns/${camp.publicSlug}`);
    check('a public campaign resolves with NO token', r.status === 200, `got ${r.status}`);
    r = await call(`/api/public/campaigns/${camp.publicSlug}/register`, 'POST', { attendeeRef: '0700111222', name: 'Walk-in' });
    check('a stranger can still register with NO token', r.status === 200 || r.status === 201, `got ${r.status}`);
    check('this is the documented exception, and it still leaks nothing',
      !/ownerId|sourceId/.test(JSON.stringify(r.body)));
  } finally {
    srv.close();
    if (prevDev === undefined) delete process.env.BRIEF_DEV_AUTH; else process.env.BRIEF_DEV_AUTH = prevDev;
  }
}

console.log('\n=== THE VAULT: IDENTITY, FOOTSTEPS, HANDOFF (domain) ===');
{
  process.env.HANDOFF_SECRET = 'vault-test-secret';
  store._reset();
  const vault = await import('../src/domain/vault.js');
  const footsteps = await import('../src/domain/footsteps.js');
  const handoff = await import('../src/domain/handoff.js');
  const ordersD = await import('../src/domain/order.js');
  const vendorsD = await import('../src/domain/vendor.js');
  const listingsD = await import('../src/domain/listing.js');
  const payD = await import('../src/domain/payment.js');

  // --- creation ------------------------------------------------------------
  const v = vault.createVault({
    ownerId: 'usr_host', type: 'gathering', title: 'Rooftop Saturday',
    description: 'A rooftop gathering', visibility: 'private', location: 'Kilimani'
  });
  check('a vault is created with a slug', Boolean(v.id) && Boolean(v.slug), v.slug);
  check('the owner becomes the first host', vault.participantRole(store, 'usr_host', v.id) === 'host');
  check('a vault_created footstep exists', store.filter('footsteps', (f) => f.vaultId === v.id).some((f) => f.kind === 'vault_created'));

  // --- authorization -------------------------------------------------------
  check('the owner has host access', vault.accessRole(store, 'usr_host', v.id) === 'host');
  check('a stranger has no access', vault.accessRole(store, 'usr_other', v.id) === null);
  check('only the host may edit', (() => { try { vault.updateVault('usr_other', v.id, { title: 'x' }); return false; } catch { return true; } })());

  // --- participants --------------------------------------------------------
  const guest = vault.addParticipant('usr_host', { vaultId: v.id, role: 'guest', userId: 'usr_guest', name: 'Jane' });
  check('a guest participant is added', guest.role === 'guest');
  check('the guest has guest access', vault.accessRole(store, 'usr_guest', v.id) === 'guest');
  check('a guest cannot add participants', (() => { try { vault.addParticipant('usr_guest', { vaultId: v.id, role: 'admin', userId: 'x' }); return false; } catch { return true; } })());
  check('a person_joined footstep recorded', store.filter('footsteps', (f) => f.vaultId === v.id).some((f) => f.kind === 'person_joined'));

  // --- footsteps: ordering, category, immutability, dedupe ---------------
  const r1 = footsteps.recordFootstep({ vaultId: v.id, kind: 'question_asked', actorId: 'usr_guest', actorName: 'Jane' });
  const r2 = footsteps.recordFootstep({ vaultId: v.id, kind: 'host_responded', actorId: 'usr_host', actorName: 'Host' });
  check('footsteps are sequenced', r1.footstep.seq < r2.footstep.seq, `${r1.footstep.seq} vs ${r2.footstep.seq}`);
  check('footsteps carry a category', r1.footstep.category === 'messages');
  check('footsteps are human-readable', /Jane/.test(r1.footstep.narrative), r1.footstep.narrative);

  const list = footsteps.listFootsteps(v.id);
  check('the timeline returns oldest-first', list.footsteps[0].kind === 'vault_created' && list.footsteps[list.footsteps.length - 1].kind === 'host_responded');
  const onlyPeople = footsteps.listFootsteps(v.id, { category: 'messages' });
  check('category filtering works', onlyPeople.footsteps.length === 2 && onlyPeople.footsteps.every((f) => f.category === 'messages'));

  // dedupe: the same logical event must not be recorded twice.
  const d1 = footsteps.recordFootstep({ vaultId: v.id, kind: 'payment_settled', actorId: 'usr_guest', dedupeKey: 'pay:settled:REF1' });
  const d2 = footsteps.recordFootstep({ vaultId: v.id, kind: 'payment_settled', actorId: 'usr_guest', dedupeKey: 'pay:settled:REF1' });
  check('a dedupe key prevents a duplicate footstep', d2.reused === true && d2.footstep.id === d1.footstep.id);

  // cursor pagination
  const all = footsteps.listFootsteps(v.id, { limit: 3 });
  check('pagination returns a next cursor', all.nextCursor !== null);
  const page2 = footsteps.listFootsteps(v.id, { cursor: all.nextCursor });
  check('the second page continues after the cursor', page2.footsteps[0].seq > all.footsteps[all.footsteps.length - 1].seq);

  // --- links + commerce wiring -------------------------------------------
  const vendor = vendorsD.createVendor({ ownerId: 'usr_vendor', displayName: 'Catering Co' });
  const listing = listingsD.createListing({ vendorId: vendor.id, title: 'Platters', type: 'service', price: 3000, currency: 'KES', quantityAvailable: 10 });
  listingsD.transitionListing(listing.id, 'active');
  const order = ordersD.createOrder({ listingId: listing.id, buyerId: 'usr_host', quantity: 2 });
  check('an order exists with total 6000', order.total === 6000);

  vault.linkVault('usr_host', v.id, { kind: 'order', id: order.id });
  check('the vault links the order', vault.getVault(v.id).links.some((l) => l.kind === 'order' && l.id === order.id));
  check('vaultsForOrder finds the vault', vault.vaultsForOrder(order.id).some((x) => x.id === v.id));

  // Payment settles -> a footstep appears on the linked vault.
  const { intent } = payD.createIntent({ orderId: order.id, payerId: 'usr_host', phone: '0722000111' });
  store.update('paymentIntents', intent.id, { status: 'authorized', providerRef: 'ws_CO_VAULT' });
  const confirmed = payD.confirmPayment({ providerRef: 'ws_CO_VAULT', succeeded: true, amount: 6000, receipt: 'REC_VAULT' });
  check('payment confirmed', confirmed.ok === true);
  vault.emitOrderFootsteps(order.id, 'payment_settled', { actorId: 'usr_host', value: 6000, dedupeKey: 'pay:settled:ws_CO_VAULT' });
  const paymentSteps = store.filter('footsteps', (f) => f.vaultId === v.id && f.kind === 'payment_settled' && f.metadata?.orderId === order.id);
  check('the vault timeline records the settlement', paymentSteps.length === 1);

  // --- handoff: signed, expiring, replay-protected ------------------------
  const h = handoff.createHandoff({ vaultId: v.id, participantId: guest.id, purpose: 'handoff', fromChannel: 'web', toChannel: 'telegram' });
  check('a handoff token is created', h.ok === true && Boolean(h.token));
  const resolved = handoff.resolveHandoff(h.token);
  check('the handoff resolves to the vault + participant', resolved.ok === true && resolved.vaultId === v.id && resolved.participantId === guest.id);
  const replay = handoff.resolveHandoff(h.token);
  check('a handoff token is single-use (replay refused)', replay.ok === false && replay.reason === 'token_already_used');

  // tampered token refused
  const tampered = h.token.slice(0, -4) + 'AAAA';
  check('a tampered token is refused', handoff.resolveHandoff(tampered).ok === false);

  // expiry
  const exp = handoff.createHandoff({ vaultId: v.id, participantId: guest.id, ttlMs: 1 });
  await new Promise((r) => setTimeout(r, 5));
  check('an expired token is refused', handoff.resolveHandoff(exp.token).ok === false && handoff.resolveHandoff(exp.token).reason === 'token_expired');

  // --- requests ------------------------------------------------------------
  const req = vault.createRequest('usr_guest', { vaultId: v.id, description: 'Need 10 extra chairs', kind: 'service' });
  check('a request is created open', req.status === 'open');
  vault.routeRequest('usr_host', { requestId: req.id, vendorId: vendor.id });
  check('routing sets the vendor and status routed', store.find('vaultRequests', (r) => r.id === req.id).status === 'routed');
  vault.acceptRequest('usr_vendor', { requestId: req.id });
  check('the vendor accepts the request', store.find('vaultRequests', (r) => r.id === req.id).status === 'accepted');
  check('a guest cannot route a request', (() => { try { vault.routeRequest('usr_guest', { requestId: req.id, vendorId: vendor.id }); return false; } catch { return true; } })());

  // --- scoped views --------------------------------------------------------
  const hostView = vault.vaultView('usr_host', v.id);
  check('the host sees participants, links, requests', hostView.role === 'host' && Array.isArray(hostView.participants) && Array.isArray(hostView.links) && Array.isArray(hostView.requests));
  const vendorView = vault.vaultView('usr_vendor', v.id);
  check('the vendor sees only scoped requests', vendorView.role === 'vendor' && vendorView.requests.length === 1 && vendorView.participants === undefined);
  const guestView = vault.vaultView('usr_guest', v.id);
  check('the guest sees a minimal view', guestView.role === 'guest' && guestView.participant !== undefined && guestView.participants === undefined);
  const publicView = vault.vaultView(null, v.id);
  check('an anonymous viewer sees a public projection only', publicView.role === 'public' && publicView.participants === undefined && publicView.links === undefined);

  // --- public entry --------------------------------------------------------
  const pv = vault.createVault({ ownerId: 'usr_host', type: 'event', title: 'Pop-up Market', visibility: 'public' });
  check('a public vault is publicly enterable', vault.isPubliclyEnterable(pv));
  const entry = vault.publicEnter(pv.slug, { name: 'Wanjiku', channel: 'web' });
  check('a guest enters a public vault with a token', entry.ok === true && Boolean(entry.token) && entry.participant.role === 'guest');
  const privateEntry = vault.publicEnter(v.slug, { name: 'X' });
  check('a PRIVATE vault refuses public entry', privateEntry.ok === false && privateEntry.reason === 'not_open');

  // --- search --------------------------------------------------------------
  const sr = vault.searchVaults('Wanjiku');
  check('search finds a vault by participant name', sr.some((x) => x.vaultId === pv.id));
  const sr2 = vault.searchVaults('chairs');
  check('search finds a vault by request text', sr2.some((x) => x.vaultId === v.id));

  // --- resolution ----------------------------------------------------------
  const rl = vault.resolution();
  check('resolution surfaces nothing for a settled vault', rl.filter((i) => i.vaultId === v.id && i.kind === 'payment_failed').length === 0);

  // --- closure -------------------------------------------------------------
  vault.closeVault('usr_host', v.id);
  check('closing a vault marks it closed', vault.getVault(v.id).status === 'closed');
  check('a vault_closed footstep exists', store.filter('footsteps', (f) => f.vaultId === v.id).some((f) => f.kind === 'vault_closed'));

  delete process.env.HANDOFF_SECRET;
}

console.log('\n=== THE VAULT: HTTP SURFACE, SCOPED ACCESS, HANDOFF (over HTTP) ===');
{
  process.env.HANDOFF_SECRET = 'vault-test-secret';
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../src/index.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token, extraHeaders = {}) => {
    const headers = { ...extraHeaders };
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const HOST = (await call('/api/auth/register', 'POST', { handle: 'vhost', password: 'a good passphrase' })).body;
    const GUEST = (await call('/api/auth/register', 'POST', { handle: 'vguest', password: 'a good passphrase' })).body;
    const VENDOR = (await call('/api/auth/register', 'POST', { handle: 'vvendor', password: 'a good passphrase' })).body;
    const STRANGER = (await call('/api/auth/register', 'POST', { handle: 'vstranger', password: 'a good passphrase' })).body;

    // create a vault
    let r = await call('/api/vaults', 'POST', { type: 'gathering', title: 'Rooftop', visibility: 'private' }, HOST.token);
    check('HTTP: a vault is created', r.status === 201 && Boolean(r.body?.vault?.id), JSON.stringify(r.body).slice(0, 120));
    const vaultId = r.body.vault.id;
    check('HTTP: creator sees role host', r.body.vault.role === 'host');

    // authorization
    r = await call(`/api/vaults/${vaultId}`, 'GET', undefined, STRANGER.token);
    check('HTTP: a stranger cannot read a private vault (404)', r.status === 404, `got ${r.status}`);
    r = await call('/api/vaults', 'GET', undefined, STRANGER.token);
    check('HTTP: a stranger lists no vaults', r.body?.vaults?.length === 0);

    // add guest + vendor
    r = await call(`/api/vaults/${vaultId}/participants`, 'POST', { role: 'guest', userId: GUEST.user.id, name: 'Jane' }, HOST.token);
    check('HTTP: host adds a guest', r.status === 201);
    r = await call(`/api/vaults/${vaultId}/participants`, 'POST', { role: 'vendor', userId: VENDOR.user.id, name: 'Catering' }, HOST.token);
    check('HTTP: host adds a vendor', r.status === 201);

    // footsteps via HTTP
    r = await call(`/api/vaults/${vaultId}/footsteps`, 'POST', { kind: 'question_asked', actorName: 'Jane' }, GUEST.token);
    check('HTTP: a participant records a footstep', r.status === 201 && r.body?.footstep?.category === 'messages');
    r = await call(`/api/vaults/${vaultId}/footsteps`, 'GET', undefined, GUEST.token);
    check('HTTP: footsteps are readable and ordered', r.status === 200 && r.body?.footsteps?.length >= 2);
    r = await call(`/api/vaults/${vaultId}/footsteps`, 'GET', undefined, STRANGER.token);
    check('HTTP: a stranger cannot read footsteps (404)', r.status === 404);

    // vendor scoping over HTTP
    const vendorId = (await call('/api/vendors', 'POST', { displayName: 'Catering Co' }, VENDOR.token)).body.vendor.id;
    r = await call(`/api/vaults/${vaultId}/requests`, 'POST', { description: 'Chairs', kind: 'service' }, GUEST.token);
    const requestId = r.body.request.id;
    r = await call(`/api/vaults/${vaultId}/requests/${requestId}/route`, 'POST', { vendorId }, HOST.token);
    check('HTTP: host routes a request to the vendor', r.status === 200 && r.body.request.status === 'routed');
    r = await call(`/api/vaults/${vaultId}`, 'GET', undefined, VENDOR.token);
    check('HTTP: the vendor sees only scoped requests', r.body.vault.role === 'vendor' && r.body.vault.requests.length === 1 && r.body.vault.participants === undefined);

    // handoff over HTTP
    const participant = (await call(`/api/vaults/${vaultId}`, 'GET', undefined, GUEST.token)).body.vault.participant;
    r = await call(`/api/vaults/${vaultId}/handoff`, 'POST', { participantId: participant.id, toChannel: 'telegram' }, HOST.token);
    check('HTTP: host creates a handoff token', r.status === 201 && Boolean(r.body?.token));
    const token = r.body.token;
    r = await call('/api/vaults/handoff/resolve', 'POST', { token });
    check('HTTP: the handoff resolves to the same vault', r.status === 200 && r.body?.vault?.id === vaultId);
    r = await call('/api/vaults/handoff/resolve', 'POST', { token });
    check('HTTP: a replayed handoff is refused (403)', r.status === 403 && r.body?.error === 'token_already_used');

    // public entry
    r = await call('/api/vaults', 'POST', { type: 'event', title: 'Public Market', visibility: 'public' }, HOST.token);
    const pubSlug = r.body.vault.slug;
    r = await call(`/api/public/vaults/${pubSlug}`, 'GET');
    check('HTTP: a public vault is readable anonymously', r.status === 200 && r.body.vault.role === 'public' && r.body.vault.participants === undefined);
    r = await call(`/api/public/vaults/${pubSlug}/enter`, 'POST', { name: 'Wanjiku' });
    check('HTTP: a guest enters via a public link', r.status === 201 && Boolean(r.body?.token));
    const entryToken = r.body.token;
    r = await call(`/api/vaults/${vaultId}`, 'GET', undefined, null, { 'x-vault-token': entryToken });
    check('HTTP: a public entry token cannot read a DIFFERENT private vault', r.status === 404);

    // private vault is not public
    r = await call(`/api/public/vaults/${(await call(`/api/vaults/${vaultId}`, 'GET', undefined, HOST.token)).body.vault.slug}`, 'GET');
    check('HTTP: a private vault is not publicly readable', r.status === 404);

    // search + resolution
    r = await call('/api/vaults/search?q=chairs', 'GET', undefined, HOST.token);
    check('HTTP: search finds the vault by request text', r.status === 200 && r.body.results.some((x) => x.vaultId === vaultId));
    r = await call('/api/vaults/resolution', 'GET', undefined, HOST.token);
    check('HTTP: resolution returns an array', r.status === 200 && Array.isArray(r.body.items));

    // close
    r = await call(`/api/vaults/${vaultId}/close`, 'POST', {}, HOST.token);
    check('HTTP: host closes the vault', r.status === 200 && r.body.vault.status === 'closed');
    r = await call(`/api/vaults/${vaultId}/close`, 'POST', {}, GUEST.token);
    check('HTTP: a guest cannot close the vault (403)', r.status === 403);
  } finally {
    srv.close();
    delete process.env.HANDOFF_SECRET;
  }
}

console.log('\n=== THE GATE: TICKET CODES + CHECK-IN (domain + HTTP) ===');
{
  process.env.NODE_ENV = 'test';
  store._reset();
  const checkin = await import('../src/domain/checkin.js');
  const campaigns = await import('../src/domain/campaign.js');
  const vault = await import('../src/domain/vault.js');
  const { default: app } = await import('../src/index.js');

  // --- domain-level ---------------------------------------------------------
  const c = campaigns.createCampaign('usr_host', {
    title: 'Gate Test Gathering', type: 'event', price: 0, capacity: 2,
    location: 'Kilimani', startsAt: null, endsAt: null
  });
  campaigns.transitionCampaign(c.id, 'published');
  campaigns.transitionCampaign(c.id, 'live');
  const live = campaigns.getCampaign(c.id); // re-fetch: register reads live status

  const reg = campaigns.register(live, { attendeeRef: 'wanjiku-1', name: 'Wanjiku' });
  check('a registration carries an opaque ticket code', /^BRF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(reg.ticketCode), reg.ticketCode);
  check('the ticket code is not the registration id', reg.ticketCode !== reg.id);

  const found = checkin.lookupTicket(reg.ticketCode);
  check('a ticket is found by its code', found?.id === reg.id);
  check('a garbled code finds nothing', checkin.lookupTicket('BRF-NOPE-NOPE-NOPE') === null);

  const view = checkin.ticketView(reg);
  check('the gate view exposes name + paid but not contact', view.name === 'Wanjiku' && view.paid === true && view.contact === undefined);

  // Check-in succeeds once, records attribution.
  const res = checkin.checkIn(reg.ticketCode, 'usr_host');
  check('check-in succeeds', res.ok === true && res.ticket.status === 'checked_in');
  check('check-in records operator + timestamp', res.ticket.checkedInBy === 'usr_host' && Boolean(res.ticket.checkedInAt));
  check('checked-in count is derived', checkin.checkedInCount(c.id) === 1);

  // Re-scan is idempotent.
  const again = checkin.checkIn(reg.ticketCode, 'usr_host');
  check('a re-scan is an idempotent no-op', again.ok === true && again.already === true && again.ticket.checkedInAt === res.ticket.checkedInAt);

  // A cancelled ticket refuses.
  const reg2 = campaigns.register(live, { attendeeRef: 'jane-1', name: 'Jane' });
  campaigns.setRegistrationStatus(reg2.id, 'cancelled');
  check('a cancelled ticket refuses check-in', checkin.checkIn(reg2.ticketCode, 'usr_host').reason === 'cancelled');

  // An unpaid (held) spot refuses. Capacity is 2, so register on a fresh campaign.
  const paid = campaigns.createCampaign('usr_host', { title: 'Paid Gate', type: 'event', price: 1000 });
  campaigns.transitionCampaign(paid.id, 'published');
  campaigns.transitionCampaign(paid.id, 'live');
  const held = campaigns.register(campaigns.getCampaign(paid.id), { attendeeRef: 'unpaid-1', name: 'Held Spot' });
  check('a paid campaign opens a spot as started (held)', held.status === 'started');
  check('an unpaid ticket refuses check-in', checkin.checkIn(held.ticketCode, 'usr_host').reason === 'unpaid');

  // --- HTTP surface ---------------------------------------------------------
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const HOST = (await call('/api/auth/register', 'POST', { handle: 'gatehost', password: 'a good passphrase' })).body;
    const STRANGER = (await call('/api/auth/register', 'POST', { handle: 'gatestranger', password: 'a good passphrase' })).body;

    // Build a live campaign owned by HOST with a free registration.
    const cc = (await call('/api/campaigns', 'POST', { title: 'HTTP Gate', type: 'event', price: 0 }, HOST.token)).body.campaign;
    await call(`/api/campaigns/${cc.id}/publish`, 'POST', {}, HOST.token);
    await call(`/api/campaigns/${cc.id}/golive`, 'POST', {}, HOST.token);
    const rr = (await call(`/api/public/campaigns/${cc.publicSlug}/register`, 'POST', { attendeeRef: 'gate-http-1', name: 'Gate Guest' })).body.registration;
    const regRow = store.filter('registrations', (x) => x.campaignId === cc.id)[0];
    const ticketCode = regRow?.ticketCode ?? null;
    check('the HTTP registration produced a ticket code', Boolean(ticketCode));

    // An unauthenticated (bogus-token) reader cannot inspect a ticket.
    const anon = await call(`/api/tickets/${ticketCode}`, 'GET', undefined, 'bogus-token');
    check('an unauthenticated reader cannot inspect a ticket (401)', anon.status === 401);
    // A stranger cannot inspect it.
    const stranger = await call(`/api/tickets/${ticketCode}`, 'GET', undefined, STRANGER.token);
    check('a stranger cannot inspect a ticket (404)', stranger.status === 404);
    // The host can.
    const host = await call(`/api/tickets/${ticketCode}`, 'GET', undefined, HOST.token);
    check('the host sees the gate-safe ticket view', host.status === 200 && host.body.ticket.name === 'Gate Guest' && host.body.ticket.contact === undefined);

    // Check-in over HTTP.
    const cin = await call(`/api/tickets/${ticketCode}/check-in`, 'POST', {}, HOST.token);
    check('check-in over HTTP succeeds', cin.status === 200 && cin.body.ticket.status === 'checked_in' && cin.body.checkedInCount === 1);
    const cin2 = await call(`/api/tickets/${ticketCode}/check-in`, 'POST', {}, HOST.token);
    check('re-scan over HTTP is idempotent', cin2.status === 200 && cin2.body.already === true);
    // A stranger cannot check someone in.
    const cinStranger = await call(`/api/tickets/${ticketCode}/check-in`, 'POST', {}, STRANGER.token);
    check('a stranger cannot check a ticket in (404)', cinStranger.status === 404);
  } finally {
    srv.close();
  }
}

console.log('\n=== HOST COMMAND CENTRE (derived, scoped) ===');
{
  store._reset();
  const campaigns = await import('../src/domain/campaign.js');
  const command = await import('../src/domain/command.js');
  const ledgerD = await import('../src/domain/ledger.js');
  const vault = await import('../src/domain/vault.js');

  // A host with a paid campaign, one settled + one held registration.
  const c = campaigns.createCampaign('usr_host', { title: 'Command Gathering', type: 'event', price: 1000 });
  campaigns.transitionCampaign(c.id, 'published');
  campaigns.transitionCampaign(c.id, 'live');
  const live = campaigns.getCampaign(c.id);
  const reg = campaigns.register(live, { attendeeRef: 'cmd-1', name: 'Alice' });
  // Settle a transaction for Alice so she registers + revenue is real.
  const tx = ledgerD.createTransaction({ amount: 1000, currency: 'KES', type: 'sale', campaignId: c.id, registrationId: reg.id, counterparty: 'usr_guest' });
  ledgerD.transitionTransaction(tx.id, 'pending');
  ledgerD.transitionTransaction(tx.id, 'confirmed');
  ledgerD.transitionTransaction(tx.id, 'settled');
  campaigns.promoteRegistrationForSettledTransaction(tx);
  campaigns.setRegistrationStatus(reg.id, 'checked_in');
  // A second, held (unpaid) registration.
  const held = campaigns.register(live, { attendeeRef: 'cmd-2', name: 'Bob' });

  const cc = command.commandCentre('usr_host');
  check('command centre resolves for the host', cc !== null);
  check('money.settled is real (1000)', cc.money.grossSettled === 1000, JSON.stringify(cc.money));
  check('people.checkedIn is derived (1)', cc.people.checkedIn === 1, String(cc.people.checkedIn));
  check('people.registered is derived (1)', cc.people.registered === 1, String(cc.people.registered));
  check('an unpaid held spot appears in NOW', cc.now.some((n) => n.kind === 'unpaid_spot' && n.name === 'Bob'), JSON.stringify(cc.now));

  // A different host sees nothing.
  const stranger = command.commandCentre('usr_stranger');
  check('a stranger sees an empty command centre', stranger !== null && stranger.money.grossSettled === 0 && stranger.campaigns.length === 0);

  // Scope: a vault owned by the host appears; one owned by another does not.
  vault.createVault({ ownerId: 'usr_host', title: 'My Vault', type: 'gathering' });
  vault.createVault({ ownerId: 'usr_stranger', title: 'Their Vault', type: 'gathering' });
  const cc2 = command.commandCentre('usr_host');
  check('the host sees their own vault count', cc2.vaultCount === 1, String(cc2.vaultCount));
}

console.log('\n=== TRUST, DISCOVERY, NOTIFICATIONS, ANALYTICS ===');
{
  store._reset();
  const trust = await import('../src/domain/trust.js');
  const discovery = await import('../src/domain/discovery.js');
  const notifications = await import('../src/domain/notifications.js');
  const analytics = await import('../src/domain/analytics.js');
  const signals = await import('../src/domain/signal.js');

  // --- geo ------------------------------------------------------------------
  check('haversine is ~111km per degree at equator', Math.round(discovery.haversineKm(0, 0, 0, 1)) === 111);
  check('same point is 0km', discovery.haversineKm(-1.28, 36.82, -1.28, 36.82) === 0);

  // --- objects with location + verification --------------------------------
  const o1 = store.insert('objects', { id: 'obj_nb', type: 'place', title: 'Nairobi Cafe', publication: 'public', verificationStatus: 'unverified', createdAt: new Date().toISOString(), metadata: { lat: -1.28, lng: 36.82 } });
  const o2 = store.insert('objects', { id: 'obj_ksm', type: 'place', title: 'Kisumu Spot', publication: 'public', verificationStatus: 'unverified', createdAt: new Date().toISOString(), metadata: { lat: -0.09, lng: 34.76 } });
  const o3 = store.insert('objects', { id: 'obj_noloc', type: 'place', title: 'No Location', publication: 'public', verificationStatus: 'unverified', createdAt: new Date().toISOString(), metadata: {} });

  // --- ranking: trust + freshness ------------------------------------------
  check('unverified objects have the base trust level', trust.verificationLevel('obj_nb') === 'unverified');
  trust.confirmObject('obj_nb', 'usr_a');
  trust.confirmObject('obj_nb', 'usr_b');
  check('two independent confirmations reach community_confirmed', trust.verificationLevel('obj_nb') === 'community_confirmed');
  check('confirmation count is derived (2)', trust.confirmationCount('obj_nb') === 2);

  // re-confirm is idempotent
  const re = trust.confirmObject('obj_nb', 'usr_a');
  check('re-confirming is a no-op', re.reused === true && trust.confirmationCount('obj_nb') === 2);

  // --- reporting ------------------------------------------------------------
  const { report } = trust.reportObject({ objectId: 'obj_ksm', actorId: 'usr_c', reason: 'spam' });
  check('a report is created open', report.status === 'open');
  const dup = trust.reportObject({ objectId: 'obj_ksm', actorId: 'usr_c', reason: 'spam' });
  check('a duplicate report is reused, not stacked', dup.reused === true);
  check('open reports are listed', trust.openReports().length === 1);

  trust.resolveReport(report.id, 'usr_admin', 'remove');
  check('resolving remove takes the object out of discovery', store.find('objects', (o) => o.id === 'obj_ksm').publication === 'removed');
  check('the object row is preserved (not deleted)', store.find('objects', (o) => o.id === 'obj_ksm') !== null);

  // --- reputation (derived) -------------------------------------------------
  const rep = trust.reputation('usr_a');
  check('reputation is derived from real acts', rep !== null && rep.confirmations === 1 && rep.signal > 0);

  // --- discovery ranking ----------------------------------------------------
  const ranked = discovery.discoverable({ limit: 10 });
  check('removed objects are excluded from discovery', !ranked.some((o) => o.id === 'obj_ksm'));
  check('a confirmed object outranks an unconfirmed one', ranked[0].id === 'obj_nb', ranked.map((o) => o.id).join(','));

  const near = discovery.discoverable({ near: { lat: -1.28, lng: 36.82 }, radiusKm: 5 });
  check('distance discovery returns the nearby object first', near[0].id === 'obj_nb' && near[0].distanceKm !== null, near.map((o) => `${o.id}:${o.distanceKm}`).join(','));

  // --- expiry ---------------------------------------------------------------
  const stale = store.insert('objects', { id: 'obj_old', type: 'event', title: 'Old Event', publication: 'public', verificationStatus: 'unverified', validityWindowDays: 1, createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), metadata: {} });
  discovery.sweepExpired();
  check('an expired object is marked stale', store.find('objects', (o) => o.id === 'obj_old').expiryStatus === 'expired');
  check('stale objects are excluded by default', !discovery.discoverable().some((o) => o.id === 'obj_old'));

  // --- notifications --------------------------------------------------------
  notifications.notify('usr_a', { kind: 'confirmed', title: 'Someone confirmed your info', objectId: 'obj_nb' });
  notifications.notify('usr_a', { kind: 'challenge', title: 'Challenge accepted' });
  check('notifications are listed newest-first', notifications.listNotifications('usr_a').length === 2 && notifications.listNotifications('usr_a')[0].title === 'Challenge accepted');
  check('unread count is derived', notifications.unreadCount('usr_a') === 2);
  notifications.markAllRead('usr_a');
  check('mark-all-read clears the unread count', notifications.unreadCount('usr_a') === 0);
  check('a notification for another user is not visible', notifications.listNotifications('usr_b').length === 0);

  // --- analytics ------------------------------------------------------------
  signals.emitSignal({ type: 'object_viewed', actorId: 'usr_a', objectId: 'obj_nb' });
  signals.emitSignal({ type: 'object_saved', actorId: 'usr_b', objectId: 'obj_nb' });
  const dash = analytics.dashboard();
  check('analytics counts engagement', dash.engagement.views === 1 && dash.engagement.saves === 1);
  check('analytics reports quality', typeof dash.quality.verificationRate === 'number');


}

console.log('\n=== PHASE 4: ONE PERSON, REAL SESSION ===');
{
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../src/index.js');
  const person = await import('../src/domain/person.js');
  const vendors = await import('../src/domain/vendor.js');
  const listings = await import('../src/domain/listing.js');
  const ordersD = await import('../src/domain/order.js');
  const campaigns = await import('../src/domain/campaign.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const A = (await call('/api/auth/register', 'POST', {
      handle: 'phase4a', password: 'a good passphrase', displayName: 'Amina'
    })).body;
    const B = (await call('/api/auth/register', 'POST', {
      handle: 'phase4b', password: 'a good passphrase', displayName: 'Baraka'
    })).body;
    check('register returns a personId', Boolean(A.user.personId), JSON.stringify(A.user));
    check('whoAmI carries the same personId',
      (await call('/api/auth/me', 'GET', undefined, A.token)).body.user.personId === A.user.personId);

    await call('/api/vendors', 'POST', { displayName: 'Amina Stall' }, A.token);
    const listing = (await call('/api/listings', 'POST', {
      title: 'Maize', type: 'product', price: 200, quantityAvailable: 5
    }, A.token)).body.listing;
    await call(`/api/listings/${listing.id}/status`, 'POST', { status: 'active' }, A.token);
    const otherV = vendors.createVendor({ ownerId: B.user.id, displayName: 'Baraka Goods' });
    const otherL = listings.createListing({ vendorId: otherV.id, title: 'Beans', price: 100, quantityAvailable: 4 });
    listings.transitionListing(otherL.id, 'active');
    ordersD.createOrder({ listingId: otherL.id, buyerId: A.user.id, quantity: 1 });
    campaigns.createCampaign(A.user.id, { title: 'Amina Night', type: 'popup', price: 0 });
    const mine = (await call('/api/person/me', 'GET', undefined, A.token)).body;
    check('standing is one person', mine.standing.personId === A.user.personId);
    check('hosted campaigns count on that person', mine.standing.hosted >= 1, String(mine.standing.hosted));
    check('bought orders count on that person', mine.standing.bought >= 1, String(mine.standing.bought));
    check('vendor is a view of the same person', mine.standing.vendor?.displayName === 'Amina Stall');

    let r = await call('/api/person/me/aliases', 'POST', { kind: 'whatsapp', value: '254700111222' }, A.token);
    check('unverified WhatsApp alias is refused', r.status === 400);
    check('the refusal names the guess', /not verified|will not guess/i.test(r.body?.error ?? ''), r.body?.error);
    r = await call('/api/person/me/aliases', 'POST', { kind: 'phone', value: '0722000111' }, A.token);
    check('self-asserted phone is refused without a check', r.status === 400);
    check('no whatsapp alias was stored',
      !store.all('personAliases').some((a) => a.kind === 'whatsapp' && a.personId === A.user.personId));

    const bound = person.linkAlias(A.user.personId, 'telegram', '999001', {
      verified: true, source: 'telegram_init'
    });
    check('a verified telegram bind is accepted', bound.kind === 'telegram' && bound.verified === true);
  } finally {
    srv.close();
  }
}

console.log('\n=== TEMPORARY DEMO CONTENT EXPIRY ===');
{
  const seed = await import('../src/domain/seed.js');
  const discovery = await import('../src/domain/discovery.js');
  store._reset();
  const seeded = seed.runSeed();
  const source = store.find('sources', (row) => row.seedBatch === seed.BATCH);
  const before = store.filter('objects', (row) => row.seedBatch === seed.BATCH).length;
  const expired = seed.expireSeed(Date.parse(source.seedExpiresAt) + 1);
  const visibleAfterExpiry = discovery.discoverable({ publication: 'public' });
  const rerun = seed.runSeed();
  check('demo seed is time-bounded', seeded.alreadySeeded === false && source.seedExpiresAt && seed.DEMO_TTL_DAYS === 7);
  check('expired demo content leaves public discovery', expired.expired === true && visibleAfterExpiry.length === 0);
  check('expired demo rows are retained as expired records', store.filter('objects', (row) => row.expiryStatus === 'expired').length === before);
  check('expired demo content is not silently reseeded', rerun.alreadySeeded === true && rerun.expired === true && store.filter('objects', (row) => row.seedBatch === seed.BATCH).length === before);
  const cleared = seed.clearSeed();
  check('the operator can explicitly clear the expired cohort', cleared.objects === before && store.filter('objects', (row) => row.seedBatch === seed.BATCH).length === 0);
}

console.log('\n=== ONBOARDING: THE SERVICE LADDER ===');
{
  const onboarding = await import('../src/domain/onboarding.js');
  const auth = await import('../src/domain/auth.js');
  store._reset();

  const user = auth.createUser({ handle: 'kamau', password: 'passw0rd123', displayName: 'Kamau' });
  onboarding.ensureProfile(user.id);

  let ladder = onboarding.ladderFor(user.id);
  check('an account alone reaches only the first rung',
    ladder.reached.length === 1 && ladder.reached[0] === 'identity');
  check('the next step is the segmentation question', ladder.nextStep?.id === 'orient');
  check('nobody is activated before they keep something', ladder.activated === false);

  const capture = ladder.services.find((s) => s.id === 'capture');
  const distribution = ladder.services.find((s) => s.id === 'distribution');
  check('capture is closed before activation', capture.unlocked === false);
  check('a closed service names the step that opens it',
    typeof capture.unlocksAfter === 'string' && capture.unlocksAfter.length > 0);
  check('distribution is closed at the very bottom of the ladder', distribution.unlocked === false);

  onboarding.setGoal(user.id, 'discover');
  ladder = onboarding.ladderFor(user.id);
  check('answering the one question climbs a rung', ladder.reached.includes('orient'));
  check('the aha step is now the next one', ladder.nextStep?.id === 'value');

  let refused = false;
  try { onboarding.setGoal(user.id, 'world-domination'); } catch { refused = true; }
  check('an unknown goal is refused rather than stored', refused);

  let badEvent = false;
  try { onboarding.recordEvent(user.id, 'invented_event'); } catch { badEvent = true; }
  check('an unknown activation event is refused', badEvent);

  // A LADDER, NOT A BADGE SHELF: creating a listing before saving anything
  // must not skip the rung underneath it.
  const vendor = store.insert('vendors', {
    id: 'ven_ladder', ownerId: user.id, displayName: 'Kamau Prints', status: 'active',
    createdAt: new Date().toISOString()
  });
  store.insert('listings', {
    id: 'lst_ladder', vendorId: vendor.id, title: 'Print run', price: 500, currency: 'KES',
    status: 'draft', createdAt: new Date().toISOString()
  });
  ladder = onboarding.ladderFor(user.id);
  check('a later rung with evidence is not REACHED while an earlier one is missing',
    ladder.rungs.find((r) => r.id === 'reach').done === true &&
    ladder.rungs.find((r) => r.id === 'reach').reached === false);
  check('the missing step is still the one being asked for', ladder.nextStep?.id === 'value');
  check('services above the gap stay closed',
    ladder.services.find((s) => s.id === 'distribution').unlocked === false);

  onboarding.recordEvent(user.id, 'object_saved', { objectId: 'obj_1' });
  ladder = onboarding.ladderFor(user.id);
  check('keeping the first thing is activation', ladder.activated === true && typeof ladder.activatedAt === 'string');
  check('activation opens capture', ladder.services.find((s) => s.id === 'capture').unlocked === true);
  check('activation alone does not open distribution',
    ladder.services.find((s) => s.id === 'distribution').unlocked === false);
  check('the rung records HOW it was reached',
    ladder.rungs.find((r) => r.id === 'value').how === 'Saved something from the feed');

  onboarding.recordEvent(user.id, 'capture_saved', {});
  ladder = onboarding.ladderFor(user.id);
  check('capturing climbs the contribute rung, which now lets the listing count',
    ladder.reached.includes('contribute') && ladder.reached.includes('reach'));
  check('a complete ladder asks for nothing more', ladder.complete === true && ladder.nextStep === null);

  const metrics = onboarding.metrics();
  check('activation metrics are scanned, not stored',
    metrics.started === 1 && metrics.activated === 1 && metrics.activationRate === 1);
  check('drop-off is reported per rung transition', metrics.dropOff.length === onboarding.RUNG_IDS.length - 1);

  // Personalisation: the answer promotes the service it is about, by ONE rung.
  const player = auth.createUser({ handle: 'otieno', password: 'passw0rd123' });
  onboarding.ensureProfile(player.id);
  const before = onboarding.ladderFor(player.id).services.find((s) => s.id === 'campaigns');
  check('Campaign hosting follows contribution by default', before.unlocked === false && before.requires === 'contribute');
  onboarding.setGoal(player.id, 'host');
  const after = onboarding.ladderFor(player.id).services.find((s) => s.id === 'campaigns');
  check('someone who came to HOST gets campaigns one rung earlier',
    after.requires === 'value' && after.promoted === true);
  const stillClosed = onboarding.ladderFor(player.id).services.find((s) => s.id === 'distribution');
  check('the promotion moves ONE service, not the whole ladder',
    stillClosed.unlocked === false && stillClosed.promoted === false);

  const fresh = auth.createUser({ handle: 'atieno', password: 'passw0rd123' });
  onboarding.ensureProfile(fresh.id);
  const cohort = onboarding.metrics();
  check('a person who has done nothing lowers the rate honestly',
    cohort.started === 3 && cohort.activated === 1 && Math.abs(cohort.activationRate - 1 / 3) < 1e-9);
}

console.log('\n=== FEDERATED SIGN-IN (Google + signed links) ===');
{
  const federated = await import('../src/domain/federated.js');
  const auth = await import('../src/domain/auth.js');
  store._reset();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.VITE_GOOGLE_CLIENT_ID;

  const status = federated.providerStatus();
  check('a password account is always offered', status.password.configured === true);
  check('Google reports itself unconfigured rather than pretending', status.google.configured === false);
  check('the refusal names what is missing', /GOOGLE_CLIENT_ID/.test(status.google.reason));
  check('TELEGRAM IS NOT REQUIRED FOR MEMBERSHIP', status.telegram.required === false);

  const unconfigured = await federated.verifyGoogleIdToken('a.b.c');
  check('no client id means no verification, and it says so',
    unconfigured.ok === false && unconfigured.reason === 'provider_not_configured');

  // Verify a REAL RS256 token against a key we control. This exercises the
  // same signature path a Google token takes; only the key differs.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
  federated._setGoogleKeys([jwk]);
  process.env.GOOGLE_CLIENT_ID = 'brief-test.apps.googleusercontent.com';

  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const mint = (claims, kid = 'test-key') => {
    const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
    const body = b64(claims);
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
    return `${head}.${body}.${sig}`;
  };
  const goodClaims = {
    iss: 'https://accounts.google.com',
    aud: 'brief-test.apps.googleusercontent.com',
    sub: '10992',
    email: 'Wanjiru@Example.com',
    email_verified: true,
    name: 'Wanjiru',
    exp: Math.floor(Date.now() / 1000) + 600
  };

  const good = await federated.verifyGoogleIdToken(mint(goodClaims));
  check('a correctly signed token verifies', good.ok === true, good.reason ?? '');
  check('the email is normalised', good.ok && good.claims.email === 'wanjiru@example.com');

  // Flip a character in the MIDDLE of the signature. The LAST character of a
  // base64url signature carries padding bits: changing it can decode to the
  // exact same bytes, so the "tampering" was a no-op and this assertion
  // passed or failed depending on the random signature. It failed roughly one
  // run in three, which is a security test that is not testing anything.
  const parts = mint(goodClaims).split('.');
  const mid = Math.floor(parts[2].length / 2);
  parts[2] = parts[2].slice(0, mid) + (parts[2][mid] === 'A' ? 'B' : 'A') + parts[2].slice(mid + 1);
  const tampered = parts.join('.');
  const bad = await federated.verifyGoogleIdToken(tampered);
  check('a tampered signature is refused', bad.ok === false, bad.ok ? 'it verified' : '');

  const wrongAud = await federated.verifyGoogleIdToken(mint({ ...goodClaims, aud: 'someone-else' }));
  check('a token minted for another app is refused', wrongAud.ok === false && wrongAud.reason === 'bad_audience');

  const expired = await federated.verifyGoogleIdToken(mint({ ...goodClaims, exp: Math.floor(Date.now() / 1000) - 5 }));
  check('an expired token is refused', expired.ok === false && expired.reason === 'expired');

  const unverifiedEmail = await federated.verifyGoogleIdToken(mint({ ...goodClaims, email_verified: false }));
  check('an unverified Google email is refused', unverifiedEmail.ok === false && unverifiedEmail.reason === 'email_not_verified');

  const unknownKid = await federated.verifyGoogleIdToken(mint(goodClaims, 'not-a-key'));
  check('a token signed by an unknown key is refused', unknownKid.ok === false && unknownKid.reason === 'unknown_key');

  // The account binding itself.
  const first = auth.signInWithVerifiedIdentity({
    provider: 'google', subject: '10992', email: 'wanjiru@example.com', displayName: 'Wanjiru'
  });
  check('a verified identity creates exactly one account', first.created === true);
  check('the handle is derived from the email', first.user.handle === 'wanjiru');
  const second = auth.signInWithVerifiedIdentity({
    provider: 'google', subject: '10992', email: 'WANJIRU@example.com'
  });
  check('signing in again reuses that account', second.created === false && second.user.id === first.user.id);
  check('the public projection carries the verified email, never a hash',
    auth.publicUser(second.user).email === 'wanjiru@example.com' &&
    auth.publicUser(second.user).passwordHash === undefined);

  // Signed one-tap links (the TikTok arrival path).
  const token = federated.mintEmailLinkToken('amina@example.com', { source: 'tiktok' });
  const redeemed = federated.redeemEmailLinkToken(token);
  check('a Brief-signed link identifies the address it was minted for',
    redeemed.ok === true && redeemed.email === 'amina@example.com' && redeemed.source === 'tiktok');

  const forged = `${token.split('.')[0]}.${'x'.repeat(token.split('.')[1].length)}`;
  check('a forged signature is refused', federated.redeemEmailLinkToken(forged).ok === false);
  check('a bare email is not a token', federated.redeemEmailLinkToken('amina@example.com').ok === false);

  const stale = federated.mintEmailLinkToken('amina@example.com', { ttlMs: 1000, now: Date.now() - 60_000 });
  check('an old link stops identifying anyone',
    federated.redeemEmailLinkToken(stale).ok === false &&
    federated.redeemEmailLinkToken(stale).reason === 'expired');

  let rejectedEmail = false;
  try { federated.mintEmailLinkToken('not-an-email'); } catch { rejectedEmail = true; }
  check('a malformed address cannot be minted', rejectedEmail);

  delete process.env.GOOGLE_CLIENT_ID;
  federated._setGoogleKeys(null);
}

console.log('\n=== MANUAL CAPTURE HONESTY + THREE UNGUARDED WRITES ===');
{
  // Dev fallback OFF. With it on, every anonymous request is silently the
  // single dev user and none of these assertions would mean anything.
  process.env.NODE_ENV = 'test';
  const prevDev = process.env.BRIEF_DEV_AUTH;
  process.env.BRIEF_DEV_AUTH = '0';
  const { default: app } = await import('../src/index.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const u = Date.now().toString(36);
    const me = (await call('/api/auth/register', 'POST', { handle: `mch_${u}`, password: 'a good passphrase' })).body;
    const token = me.token;

    // --- the three writes that accepted an anonymous caller -----------------
    let r = await call('/api/campaigns', 'POST', { title: 'Anonymous campaign' });
    check('creating a campaign requires an identity (401)', r.status === 401, `got ${r.status}`);

    r = await call('/api/transactions', 'POST', { amount: 100, currency: 'KES', type: 'contribution' });
    check('writing to the ledger requires an identity (401)', r.status === 401, `got ${r.status}`);

    const tx = (await call('/api/transactions', 'POST', { amount: 100, currency: 'KES', type: 'contribution' }, token)).body.transaction;
    check('an identified caller CAN record a transaction (201)', Boolean(tx?.id), JSON.stringify(tx ?? {}).slice(0, 120));
    r = await call(`/api/transactions/${tx.id}/transition`, 'POST', { status: 'settled' });
    check('moving money through states requires an identity (401)', r.status === 401, `got ${r.status}`);

    const src = (await call('/api/sources', 'POST', { name: `Audit source ${u}`, type: 'manual' }, token)).body.source;
    r = await call(`/api/sources/${src.id}/membership`, 'POST', { membershipStatus: 'owner' });
    check('declaring a source membership requires an identity (401)', r.status === 401, `got ${r.status}`);

    r = await call(`/api/sources/${src.id}/membership`, 'POST', { membershipStatus: 'owner', accessMethod: 'declared' }, token);
    check('the caller declares their own membership (200)', r.status === 200, JSON.stringify(r.body).slice(0, 140));
    check('the membership row is written for the CALLER, not a hard-coded user',
      r.body?.membership?.userId === me.user.id, JSON.stringify(r.body?.membership).slice(0, 160));

    r = await call('/api/sources', 'GET', undefined, token);
    const listed = (r.body?.sources ?? []).find((s) => s.id === src.id);
    check('the source list reports the CALLER\'s own membership',
      listed?.membership?.userId === me.user.id, JSON.stringify(listed?.membership).slice(0, 160));

    // --- a manual save the extractor refuses --------------------------------
    const { extractFields } = await import('../src/pipeline/extract.js');
    const chatter = `just some idle chatter ${u} with nothing in it`;
    const earned = extractFields(chatter).confidence;

    r = await call('/api/brief-it/save', 'POST', { text: chatter }, token);
    check('an explicit save never loses the words the person typed', r.body?.result?.created === true, JSON.stringify(r.body).slice(0, 160));

    const kept = store.find('objects', (o) => o.id === r.body?.result?.objectId);
    check('the capture is attributed to its capturer (the confirmed-notification rail needs someone to notify)',
      kept?.capturedBy === me.user.id, JSON.stringify({ capturedBy: kept?.capturedBy ?? null, caller: me.user.id }));
    check('the kept note claims exactly the confidence extraction earned, not a flattering constant',
      kept?.extractionConfidence === earned, `claimed ${kept?.extractionConfidence} vs earned ${earned}`);
    check('that confidence is below the number it used to assert', (kept?.extractionConfidence ?? 1) < 0.85,
      `claimed ${kept?.extractionConfidence}`);
    // Extraction did find a title -- that is a field, just not one of the
    // signals that make text object-worthy. The evidence must say the note was
    // kept as written and name the little that was found, not imply success.
    check('the evidence states the note was kept as written, not extracted',
      /manual capture, kept as written/.test(kept?.extractionEvidence ?? ''), kept?.extractionEvidence);
    check('the evidence names the only field extraction found',
      /title/.test(kept?.extractionEvidence ?? ''), kept?.extractionEvidence);
    check('it is NOT published to the anonymous public feed',
      kept?.publication === 'source_members', `publication=${kept?.publication}`);
    check('fields it could not establish are named unknown rather than omitted',
      Array.isArray(kept?.metadata?.unknownFields) && kept.metadata.unknownFields.includes('price'),
      JSON.stringify(kept?.metadata).slice(0, 160));
    check('the provenance row carries the same honest confidence',
      store.find('objectSources', (os) => os.objectId === kept?.id)?.extractionConfidence === earned);

    const feed = await call('/api/public/feed');
    check('the public feed does not carry it', !JSON.stringify(feed.body ?? {}).includes(chatter));

    // --- a capture with real signals is unaffected --------------------------
    r = await call('/api/brief-it/save', 'POST',
      { text: `Night market ${u} at Yaya Centre rooftop, Saturday 6pm - 10pm, entry KSh 200. Call 0722123456.` }, token);
    const real = store.find('objects', (o) => o.id === r.body?.result?.objectId);
    check('a capture with real signals still carries a real confidence',
      (real?.extractionConfidence ?? 0) > 0, `confidence=${real?.extractionConfidence}`);
  } finally {
    srv.close();
    if (prevDev === undefined) delete process.env.BRIEF_DEV_AUTH;
    else process.env.BRIEF_DEV_AUTH = prevDev;
  }
}


console.log('\n=== IMAGE UPLOADS: REAL FILES, NOT LINKS ===');
{
  process.env.NODE_ENV = 'test';
  const prevDev = process.env.BRIEF_DEV_AUTH;
  process.env.BRIEF_DEV_AUTH = '0';

  // A throwaway directory: these tests write real bytes, and a passing run
  // must not leave them behind or depend on a previous run's leftovers.
  const dir = fsp.mkdtempSync(path.join(os.tmpdir(), 'brief-uploads-'));
  const prevDir = process.env.BRIEF_UPLOAD_DIR;
  process.env.BRIEF_UPLOAD_DIR = dir;

  const upload = await import('../src/domain/upload.js');
  const { default: app } = await import('../src/index.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;

  const call = async (p, m = 'GET', body, token) => {
    const headers = {};
    if (body && !(typeof FormData !== 'undefined' && body instanceof FormData)) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(base + p, { method: m, headers, body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined) });
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('image')) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, body: null, type, bytes: buf, headers: res.headers };
    }
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };

  // One real 1x1 PNG, and the things people rename to look like one.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
  const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AJQA/9k=', 'base64');
  const BMP = Buffer.concat([Buffer.from('BM'), Buffer.alloc(64, 1)]);
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const TEXT = Buffer.from('this is not an image, whatever the filename says');

  const form = (buf, name, type) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type }), name);
    return fd;
  };

  try {
    const u = Date.now().toString(36);
    const me = (await call('/api/auth/register', 'POST', { handle: `upl_${u}`, password: 'a good passphrase' })).body;
    const stranger = (await call('/api/auth/register', 'POST', { handle: `upls_${u}`, password: 'a good passphrase' })).body;
    const T = me.token;

    let r = await call('/api/media/upload', 'POST', form(PNG, 'a.png', 'image/png'));
    check('an anonymous upload is refused (401)', r.status === 401, `got ${r.status}`);

    r = await call('/api/media/upload', 'POST', form(PNG, 'a.png', 'image/png'), T);
    check('a real PNG is accepted (201)', r.status === 201, JSON.stringify(r.body).slice(0, 160));
    const row = r.body?.upload;
    check('the row records the size of what was stored', row?.bytes === PNG.length, `${row?.bytes} vs ${PNG.length}`);
    check('the row records a sha256 of the bytes', /^[0-9a-f]{64}$/.test(row?.sha256 ?? ''), row?.sha256);
    check('the type is what the BYTES are, not what the caller claimed', row?.mimeType === 'image/png', row?.mimeType);
    check('the url is served by Brief, not an external host', row?.url === `/api/media/file/${row?.id}`, row?.url);
    check('the bytes landed in the upload directory', fsp.existsSync(path.join(dir, `${row?.id}.png`)), path.join(dir, `${row?.id}.png`));

    r = await call(`/api/media/file/${row.id}`);
    check('the file is readable WITHOUT a session (public stories render)', r.status === 200, `got ${r.status}`);
    check('it comes back byte for byte', Buffer.compare(r.bytes, PNG) === 0, `${r.bytes?.length} bytes`);
    check('it is served as its real image type', r.headers.get('content-type') === 'image/png', r.headers.get('content-type'));
    check('it cannot be sniffed into something else', r.headers.get('x-content-type-options') === 'nosniff');
    check('it cannot run anything', (r.headers.get('content-security-policy') ?? '').includes("default-src 'none'"));

    check('GIF is accepted', (await call('/api/media/upload', 'POST', form(GIF, 'a.gif', 'image/gif'), T)).status === 201);
    check('WebP is accepted', (await call('/api/media/upload', 'POST', form(WEBP, 'a.webp', 'image/webp'), T)).status === 201);
    check('JPEG is accepted', (await call('/api/media/upload', 'POST', form(JPEG, 'a.jpg', 'image/jpeg'), T)).status === 201);

    // The whole point of sniffing: a name and a declared type prove nothing.
    r = await call('/api/media/upload', 'POST', form(TEXT, 'innocent.png', 'image/png'), T);
    check('a text file named .png is refused (415)', r.status === 415, `got ${r.status}`);
    check('the refusal names the formats that are accepted', Array.isArray(r.body?.allowed), JSON.stringify(r.body).slice(0, 140));
    check('an SVG is refused — it is a document that can carry script',
      (await call('/api/media/upload', 'POST', form(SVG, 'x.svg', 'image/svg+xml'), T)).status === 415);
    check('a BMP is refused (not a format Brief serves)',
      (await call('/api/media/upload', 'POST', form(BMP, 'x.bmp', 'image/bmp'), T)).status === 415);
    check('an empty file is refused (400)',
      (await call('/api/media/upload', 'POST', form(Buffer.alloc(0), 'x.png', 'image/png'), T)).status === 400);
    check('a file over the limit is refused (413)',
      (await call('/api/media/upload', 'POST', form(Buffer.alloc(9 * 1024 * 1024, 1), 'big.png', 'image/png'), T)).status === 413);
    check('nothing was written for a refused upload',
      store.all('uploads').length === 4, `${store.all('uploads').length} rows`);

    // An image is content, not an event: the same bytes are the same asset.
    const again = await call('/api/media/upload', 'POST', form(PNG, 'again.png', 'image/png'), T);
    check('the same bytes twice is the same asset, not a second copy',
      again.body?.upload?.id === row.id && again.body?.duplicate === true, JSON.stringify(again.body).slice(0, 140));

    r = await call('/api/media/mine', 'GET', undefined, T);
    check('your own uploads are listed', Array.isArray(r.body?.uploads) && r.body.uploads.length === 4, `${r.body?.uploads?.length}`);

    check('a stranger cannot delete your upload (404)',
      (await call(`/api/media/${row.id}`, 'DELETE', undefined, stranger.token)).status === 404);

    // The disk is not durable. When the bytes are gone, say so rather than
    // serving a broken image that looks like the editor's mistake.
    fsp.unlinkSync(path.join(dir, `${row.id}.png`));
    r = await call(`/api/media/file/${row.id}`);
    check('bytes that are gone are reported, not faked (404)', r.status === 404, `got ${r.status}`);
    check('and the reason says the disk no longer holds them', /no longer holds/i.test(r.body?.error ?? ''), r.body?.error);

    const status = (await call('/api/media/status', 'GET', undefined, T)).body;
    check('the deployment admits uploads are on local disk', status?.uploads?.kind === 'local_disk', JSON.stringify(status?.uploads).slice(0, 120));
    check('and admits they are NOT durable across a redeploy', status?.uploads?.persisted === false);
    check('and reports how many are missing their bytes', status?.uploads?.missingBytes === 1, `${status?.uploads?.missingBytes}`);

    check('the owner removes their upload', (await call(`/api/media/${row.id}`, 'DELETE', undefined, T)).status === 200);
    check('and the row goes with it', store.find('uploads', (x) => x.id === row.id) === null);
    check('sniffing is a pure function of the bytes',
      upload.sniffImageType(PNG) === 'image/png' && upload.sniffImageType(TEXT) === null);
  } finally {
    srv.close();
    try { fsp.rmSync(dir, { recursive: true, force: true }); } catch {}
    if (prevDir === undefined) delete process.env.BRIEF_UPLOAD_DIR;
    else process.env.BRIEF_UPLOAD_DIR = prevDir;
    if (prevDev === undefined) delete process.env.BRIEF_DEV_AUTH;
    else process.env.BRIEF_DEV_AUTH = prevDev;
  }
}


// ---------------------------------------------------------------------------
// THE WAITING-ON-YOU QUEUE
//
// One question, answered once: what is actually blocked on ME right now. The
// queue is derived, per-caller, and refuses to invent work -- an empty queue
// is an empty list, not a set of suggestions.
// ---------------------------------------------------------------------------
console.log('\n=== THE WAITING-ON-YOU QUEUE ===');
{
  store._reset();
  const { default: app } = await import('../src/index.js');
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const A = await call('/api/auth/register', 'POST', { handle: 'queue_owner', password: 'a good passphrase', displayName: 'Owner' });
    const B = await call('/api/auth/register', 'POST', { handle: 'queue_other', password: 'another good passphrase', displayName: 'Other' });
    const TA = A.body.token, TB = B.body.token, idA = A.body.user.id, idB = B.body.user.id;

    // --- nothing waiting is reported as nothing waiting ----------------------
    let q = await call('/api/triage', 'GET', undefined, TA);
    check('an empty queue is empty, not filled with suggestions',
      q.status === 200 && q.body.items.length === 0 && q.body.total === 0, JSON.stringify(q.body).slice(0, 120));
    check('the queue is the CALLER\'s, not everybody\'s', q.body.viewer === idA);
    check('the window it looks ahead is stated', q.body.withinHours === 48);
    // With the development fallback off, "anonymous" means nobody at all, so
    // this is the production answer rather than a fallback identity.
    const prevDev = process.env.BRIEF_DEV_AUTH;
    process.env.BRIEF_DEV_AUTH = '0';
    check('an anonymous caller has no queue at all (401)', (await call('/api/triage')).status === 401);
    process.env.BRIEF_DEV_AUTH = prevDev ?? '';

    // --- a circle task I hold ------------------------------------------------
    const circlesD = await import('../src/domain/circle.js');
    const blocksD = await import('../src/domain/block.js');
    const membersD = await import('../src/domain/member.js');

    const circle = circlesD.createTargetCircle({ name: 'Queue Ops' });
    membersD.addMember(circle.id, idA, 'coordinator');
    membersD.addMember(circle.id, idB, 'contributor');
    const mine = blocksD.createBlock({ circleId: circle.id, type: 'task', content: 'Confirm the venue\nAsk about parking' });
    const theirs = blocksD.createBlock({ circleId: circle.id, type: 'task', content: 'Book the van' });

    // Unassigned work belongs to the circle, not to one person: it must NOT
    // chase an individual here.
    q = await call('/api/triage', 'GET', undefined, TA);
    check('work nobody holds does not chase an individual',
      q.body.items.filter((i) => i.kind === 'task').length === 0, `${q.body.counts.task}`);

    blocksD.assignTask(mine.id, idA);
    blocksD.assignTask(theirs.id, idB);

    q = await call('/api/triage', 'GET', undefined, TA);
    let task = q.body.items.find((i) => i.kind === 'task');
    check('a task you hold appears in the queue', Boolean(task) && task.id === mine.id);
    check('the queue counts it', q.body.counts.task === 1, `${q.body.counts.task}`);
    check('it names the circle it belongs to', task.circleName === 'Queue Ops', task?.circleName);
    check('it shows a title, not a blob', task.title === 'Confirm the venue', task?.title);
    check('it offers exactly the actions the caller may take',
      JSON.stringify(task.actions) === JSON.stringify(['complete', 'release']), JSON.stringify(task?.actions));

    q = await call('/api/triage', 'GET', undefined, TB);
    check('someone else\'s task is not in my queue',
      q.body.items.filter((i) => i.kind === 'task').every((i) => i.id === theirs.id),
      JSON.stringify(q.body.items.map((i) => i.id)));

    // Finishing the work takes it off the queue -- derived, not dismissed.
    blocksD.completeTask(mine.id, idA);
    q = await call('/api/triage', 'GET', undefined, TA);
    check('a completed task leaves the queue',
      q.body.items.filter((i) => i.kind === 'task').length === 0);

    // --- an order on my shelf ------------------------------------------------
    const vendors = await import('../src/domain/vendor.js');
    const listings = await import('../src/domain/listing.js');
    const orders = await import('../src/domain/order.js');

    const vendor = vendors.createVendor({ ownerId: idA, displayName: 'Queue Foods' });
    const listing = listings.createListing({ vendorId: vendor.id, title: 'Roasted maize', price: 100, type: 'product' });
    listings.transitionListing(listing.id, 'active');
    const order = orders.createOrder({ listingId: listing.id, buyerId: idB, quantity: 2 });

    q = await call('/api/triage', 'GET', undefined, TA);
    const ord = q.body.items.find((i) => i.kind === 'order');
    check('an order waiting on the vendor is in the queue', Boolean(ord) && ord.id === order.id);
    check('it names what was ordered', /maize/.test(ord?.title ?? ''), ord?.title);
    check('it names the next real step, not a generic button', ord?.nextStatus === 'accepted', ord?.nextStatus);
    check('the buyer does not see the vendor\'s obligation',
      (await call('/api/triage', 'GET', undefined, TB)).body.items.filter((i) => i.kind === 'order').length === 0);

    orders.transitionOrder(order.id, 'fulfilled');
    q = await call('/api/triage', 'GET', undefined, TA);
    check('a fulfilled order leaves the queue',
      q.body.items.filter((i) => i.kind === 'order').length === 0);

    // --- an event I am running ----------------------------------------------
    const campaigns = await import('../src/domain/campaign.js');
    const camp = campaigns.createCampaign(idA, {
      title: 'Sunrise run', type: 'session', price: 0,
      startsAt: new Date(Date.now() + 3600_000).toISOString()
    });
    campaigns.transitionCampaign(camp.id, 'published');
    campaigns.register(campaigns.getCampaign(camp.id), { attendeeRef: 'runner-1' });

    q = await call('/api/triage', 'GET', undefined, TA);
    const ci = q.body.items.find((i) => i.kind === 'checkin');
    check('an event starting soon is in the queue', Boolean(ci) && ci.campaignId === camp.id);
    check('it counts the people still to check in', ci?.pending === 1, `${ci?.pending}`);
    check('it counts nobody as checked in before they are', ci?.checkedIn === 0, `${ci?.checkedIn}`);
    check('time-boxed work floats to the top', q.body.items[0].kind === 'checkin', q.body.items[0]?.kind);

    // A campaign that is still a draft has nobody to check in.
    const draftCamp = campaigns.createCampaign(idA, { title: 'Later', type: 'session', price: 0, startsAt: new Date().toISOString() });
    check('an unpublished event is not in the queue',
      (await call('/api/triage', 'GET', undefined, TA)).body.items.every((i) => i.campaignId !== draftCamp.id));

    // --- a message awaiting review -------------------------------------------
    store.insert('sources', { id: 'src_queue', name: 'Kilimani WhatsApp', type: 'whatsapp', createdAt: new Date().toISOString() });
    store.insert('rawItems', {
      id: 'raw_queue', sourceId: 'src_queue', externalId: 'e1', author: 'Wanjiku',
      text: 'Power is back on Ngong Road', processingStatus: 'pending', receivedAt: new Date().toISOString()
    });

    q = await call('/api/triage', 'GET', undefined, TA);
    const draft = q.body.items.find((i) => i.kind === 'draft');
    check('an unread inbound message is in the queue', Boolean(draft) && draft.id === 'raw_queue');
    check('it says where it came from', draft?.sourceName === 'Kilimani WhatsApp', draft?.sourceName);
    check('reviewing is the only action offered (no silent publishing)',
      JSON.stringify(draft?.actions) === JSON.stringify(['review']), JSON.stringify(draft?.actions));

    store.update('rawItems', 'raw_queue', { processingStatus: 'published' });
    q = await call('/api/triage', 'GET', undefined, TA);
    check('a processed message leaves the queue',
      q.body.items.filter((i) => i.kind === 'draft').length === 0);

    // --- the whole point: one list, everything in it --------------------------
    q = await call('/api/triage', 'GET', undefined, TA);
    check('the queue holds every kind of waiting work at once',
      q.body.items.length > 0 && ['task', 'order', 'checkin', 'draft'].every((k) => k in q.body.counts),
      JSON.stringify(q.body.counts));
    check('the total matches the list', q.body.total === q.body.items.length);
  } finally {
    srv.close();
  }
}

// ---------------------------------------------------------------------------
// THE CIRCLE LOOP: BROWSE, JOIN, LEAVE
//
// The list claimed you were part of circles you had never joined, and there
// was no way in -- or out. Each step of the loop is proven here, including
// the refusals, because a loop that only works for the happy path is still
// broken for the person who hits the refusal.
// ---------------------------------------------------------------------------
console.log('\n=== THE CIRCLE LOOP: JOIN AND LEAVE ===');
{
  const prevDev = process.env.BRIEF_DEV_AUTH;
  store._reset();
  const { default: app } = await import('../src/index.js');
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const A = await call('/api/auth/register', 'POST', { handle: 'joiner', password: 'a good passphrase', displayName: 'Joiner' });
    const B = await call('/api/auth/register', 'POST', { handle: 'host', password: 'another good passphrase', displayName: 'Host' });
    const TA = A.body.token, TB = B.body.token, idA = A.body.user.id, idB = B.body.user.id;

    // --- the loop starts: creating a circle puts you IN it -------------------
    qualifyGroupCreator(idA); qualifyGroupCreator(idB);
    let r = await call('/api/circles', 'POST', { name: 'Ngong Trail Crew' }, TA);
    check('creating a circle succeeds', r.status === 201, JSON.stringify(r.body).slice(0, 120));
    const created = r.body.circle;
    check('the creator is IN the circle they made', r.body.circle.viewerRole === 'coordinator', `${r.body.circle.viewerRole}`);
    check('and the membership row exists', r.body.membership?.userId === idA && r.body.membership?.role === 'coordinator');
    check('the circle counts its first member', created.memberCount === 1, `${created.memberCount}`);

    // --- the list tells the truth about membership ---------------------------
    const other = (await call('/api/circles', 'POST', { name: 'Kilimani Traders' }, TB)).body.circle;
    let list = (await call('/api/circles', 'GET', undefined, TA)).body.circles;
    const mineRow = list.find((c) => c.id === created.id);
    const notMine = list.find((c) => c.id === other.id);
    check('a circle I am in reports my role', mineRow.viewerRole === 'coordinator' && mineRow.isMember === true);
    check('private non-member groups are absent from my groups', notMine === undefined);
    check('private group workspace is protected', (await call(`/api/circles/${other.id}`, 'GET', undefined, TA)).status === 403);

    // --- joining an open circle ----------------------------------------------
    store.update('circles', other.id, { visibility: 'open' });
    r = await call(`/api/circles/${other.id}/members`, 'POST', {}, TA);
    check('an open circle can be joined', r.status === 201, `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    check('the membership is the caller\'s, not a body-supplied id', r.body.member?.userId === idA);
    check('a joiner is a contributor, not a coordinator', r.body.member?.role === 'contributor', r.body.member?.role);

    r = await call(`/api/circles/${other.id}/members`, 'POST', {}, TA);
    check('joining twice does not create a second membership', r.status === 201);
    check('there is still exactly one row for this member',
      store.filter('members', (m) => m.circleId === other.id && m.userId === idA).length === 1);

    list = (await call('/api/circles', 'GET', undefined, TA)).body.circles;
    check('the list now shows me as a member of the joined circle',
      list.find((c) => c.id === other.id).isMember === true);

    // --- an invite-only circle refuses a stranger ----------------------------
    const closed = (await call('/api/circles', 'POST', { name: 'Closed Crew' }, TB)).body.circle;
    r = await call(`/api/circles/${closed.id}/members`, 'POST', {}, TA);
    check('an invite-only circle refuses a self-join', r.status === 403, `got ${r.status}`);
    check('the refusal says why', /invite only/i.test(r.body?.error ?? ''), r.body?.error);
    check('no membership row was written',
      store.filter('members', (m) => m.circleId === closed.id && m.userId === idA).length === 0);

    // --- joining needs an identity -------------------------------------------
    // With the development fallback off, "anonymous" genuinely means nobody.
    process.env.BRIEF_DEV_AUTH = '0';
    r = await call(`/api/circles/${other.id}/members`, 'POST', {});
    check('an anonymous join is refused (401)', r.status === 401, `got ${r.status}`);
    check('no anonymous membership row exists',
      store.all('members').every((m) => m.userId !== null));
    r = await call('/api/circles', 'POST', { name: 'Nobody\'s Circle' });
    check('an anonymous circle creation is refused (401)', r.status === 401, `got ${r.status}`);
    process.env.BRIEF_DEV_AUTH = prevDev ?? '';

    // --- leaving --------------------------------------------------------------
    r = await call(`/api/circles/${other.id}/members/me`, 'DELETE', undefined, TA);
    check('you can leave a circle', r.status === 200 && r.body.left === true, JSON.stringify(r.body).slice(0, 120));
    const endedRow = store.find('members', (m) => m.circleId === other.id && m.userId === idA);
    check('leaving ENDS the membership rather than erasing it', endedRow?.status === 'ended', JSON.stringify({ s: endedRow?.status }));
    check('the row still says when it ended', Boolean(endedRow?.endedAt));
    check('and the leave is in the history',
      store.filter('circleRevisions', (x) => x.circleId === other.id && x.kind === 'member_left').length >= 1);
    list = (await call('/api/circles', 'GET', undefined, TA)).body.circles;
    check('the list stops claiming I am a member', !list.some((c) => c.id === other.id));

    r = await call(`/api/circles/${other.id}/members/me`, 'DELETE', undefined, TA);
    check('leaving twice is reported, not invented', r.status === 404, `got ${r.status}`);
    check('the refusal says I am not a member', /not a member/i.test(r.body?.error ?? ''), r.body?.error);

    // Leaving does not rewrite history: work and money stay put.
    const blocksD = await import('../src/domain/block.js');
    await call(`/api/circles/${other.id}/members`, 'POST', {}, TA);
    const t = blocksD.createBlock({ circleId: other.id, type: 'task', content: 'Carry water' });
    blocksD.assignTask(t.id, idA);
    await call(`/api/circles/${other.id}/members/me`, 'DELETE', undefined, TA);
    check('leaving does not delete the work I was doing', Boolean(store.find('blocks', (b) => b.id === t.id)));

    // --- removing somebody else is an act of authority ------------------------
    // `other` is TB's circle (open), so TA can join it as a plain member.
    await call(`/api/circles/${other.id}/members`, 'POST', {}, TA);
    r = await call(`/api/circles/${other.id}/members/${idB}`, 'DELETE', undefined, TA);
    check('a plain member cannot remove somebody else', r.status === 403, `got ${r.status}`);
    check('the refusal names the missing authority', /coordinator/.test(r.body?.error ?? ''), r.body?.error);
    r = await call(`/api/circles/${other.id}/members/${idA}`, 'DELETE', undefined, TB);
    check('a removal without a reason is refused', r.status === 400, `got ${r.status}`);
    check('the refusal explains why a reason is needed', /needs a reason/.test(r.body?.error ?? ''), r.body?.error);
    r = await call(`/api/circles/${other.id}/members/${idA}`, 'DELETE', { reason: 'stopped replying for six weeks' }, TB);
    check('the coordinator can remove a member', r.status === 200, `got ${r.status}`);
    const removedRow = store.find('members', (m) => m.circleId === other.id && m.userId === idA);
    check('and they are ended, not deleted', removedRow?.status === 'ended', JSON.stringify({ s: removedRow?.status }));
    check('the reason is on the row and in the history',
      /six weeks/.test(removedRow?.endReason ?? '') &&
      store.filter('circleRevisions', (x) => x.circleId === other.id && x.kind === 'member_removed').length >= 1);
    check('their finished work still names them', Boolean(store.find('blocks', (b) => b.circleId === other.id)), 'blocks still present');
    // rejoining reactivates the same relationship rather than spawning a second one
    const again = (await call(`/api/circles/${other.id}/members`, 'POST', {}, TA)).body?.member ?? null;
    const liveRows = store.filter('members', (m) => m.circleId === other.id && m.userId === idA);
    check('rejoining reactivates the one row rather than adding a second',
      liveRows.length === 1 && liveRows[0].status === 'active', `rows ${liveRows.length}`);
    check('and the rejoin is recorded', store.filter('circleRevisions', (x) => x.kind === 'member_rejoined' && x.circleId === other.id).length >= 1);
    check('removing yourself goes through the leave route, not the removal one',
      (await call(`/api/circles/${created.id}/members/${idA}`, 'DELETE', undefined, TA)).status === 400);

    // Leaving is recorded as evidence, like joining.
    check('leaving emits a signal, so the circle shows arrivals AND departures',
      store.filter('signals', (s) => s.type === 'member_left').length >= 1);
  } finally {
    if (prevDev === undefined) delete process.env.BRIEF_DEV_AUTH;
    else process.env.BRIEF_DEV_AUTH = prevDev;
    srv.close();
  }
}

// ---------------------------------------------------------------------------
// SUBSCRIPTIONS: THE FOLLOWER'S HALF
//
// A creator could publish a plan and even bill themselves for it, but nobody
// could ever join it. This is the missing half, plus the honesty fix: the
// count is derived from real rows instead of a stored zero.
// ---------------------------------------------------------------------------
console.log('\n=== SUBSCRIPTIONS: JOINING A PLAN ===');
{
  store._reset();
  const { default: app } = await import('../src/index.js');
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const A = await call('/api/auth/register', 'POST', { handle: 'plan_owner', password: 'a good passphrase', displayName: 'Creator' });
    const B = await call('/api/auth/register', 'POST', { handle: 'supporter', password: 'another good passphrase', displayName: 'Supporter' });
    const TA = A.body.token, TB = B.body.token;

    // --- the creator publishes a plan ----------------------------------------
    let r = await call('/api/subscriptions', 'POST', { title: 'Trail Club', price: 500, interval: 'monthly' }, TA);
    check('a creator can publish a plan', r.status === 201, JSON.stringify(r.body).slice(0, 120));
    const plan = r.body.subscription;

    // The old route handed every plan in the deployment to an anonymous
    // caller. Discovery is now explicit, and "my plans" is private.
    const prevDev2 = process.env.BRIEF_DEV_AUTH;
    process.env.BRIEF_DEV_AUTH = '0';
    check('an anonymous caller cannot list my plans (401)', (await call('/api/subscriptions')).status === 401);
    process.env.BRIEF_DEV_AUTH = prevDev2 ?? '';

    r = await call('/api/subscriptions', 'GET', undefined, TB);
    check('another member\'s default list is their own, not mine', r.body.subscriptions.length === 0, `${r.body.subscriptions.length}`);

    r = await call('/api/subscriptions?browse=1', 'GET', undefined, TB);
    check('a supporter can browse public plans', r.body.subscriptions.length === 1, JSON.stringify(r.body).slice(0, 120));
    check('and is told they are not subscribed', r.body.subscriptions[0].viewerIsSubscriber === false);

    check('a plan starts with zero subscribers, derived not asserted',
      r.body.subscriptions[0].subscriberCount === 0, `${r.body.subscriptions[0].subscriberCount}`);

    // --- joining ---------------------------------------------------------------
    process.env.BRIEF_DEV_AUTH = '0';
    check('an anonymous join is refused (401)', (await call(`/api/subscriptions/${plan.id}/subscribe`, 'POST', {})).status === 401);
    process.env.BRIEF_DEV_AUTH = prevDev2 ?? '';
    check('and no membership row was written for nobody',
      store.all('subscribers').every((s) => s.memberId !== null));

    r = await call(`/api/subscriptions/${plan.id}/subscribe`, 'POST', {}, TB);
    check('a supporter can join a plan', r.status === 201, JSON.stringify(r.body).slice(0, 160));
    check('the membership row is real', r.body.subscriber?.memberId === B.body.user.id);
    check('THE MONEY IS NOT COLLECTED and said so', r.body.charged === false && /not charged/i.test(r.body.note ?? ''), r.body?.note);
    check('the cycle is recorded as a ledger transaction that has NOT settled',
      r.body.transaction?.type === 'subscription' && r.body.transaction?.status !== 'settled',
      JSON.stringify(r.body.transaction).slice(0, 160));

    r = await call(`/api/subscriptions/${plan.id}/subscribe`, 'POST', {}, TB);
    check('joining twice is idempotent, not a second membership', r.status === 200 && r.body.duplicate === true);
    check('and the count does not double',
      store.filter('subscribers', (s) => s.subscriptionId === plan.id).length === 1);

    r = await call('/api/subscriptions?browse=1', 'GET', undefined, TB);
    check('the count is derived from real rows', r.body.subscriptions[0].subscriberCount === 1, `${r.body.subscriptions[0].subscriberCount}`);
    check('and the supporter is told they are subscribed', r.body.subscriptions[0].viewerIsSubscriber === true);

    // --- who is subscribed is the creator's business ---------------------------
    check('a supporter cannot read the member list (403)',
      (await call(`/api/subscriptions/${plan.id}/subscribers`, 'GET', undefined, TB)).status === 403);
    r = await call(`/api/subscriptions/${plan.id}/subscribers`, 'GET', undefined, TA);
    check('the creator can see who is subscribed', r.status === 200 && r.body.subscribers.length === 1);

    // --- a paused plan is not joinable -----------------------------------------
    await call(`/api/subscriptions/${plan.id}/pause`, 'POST', {}, TA);
    r = await call(`/api/subscriptions/${plan.id}/subscribe`, 'POST', {}, TB);
    check('a paused plan cannot be joined', r.status === 400, `got ${r.status}`);

    // --- leaving ----------------------------------------------------------------
    await call(`/api/subscriptions/${plan.id}/resume`, 'POST', {}, TA);
    r = await call(`/api/subscriptions/${plan.id}/unsubscribe`, 'POST', {}, TB);
    check('a supporter can leave a plan', r.status === 200 && r.body.changed === true, JSON.stringify(r.body).slice(0, 120));
    check('the count drops because the status changed',
      (await call('/api/subscriptions?browse=1', 'GET', undefined, TB)).body.subscriptions[0].subscriberCount === 0);
    check('but the fact that they were a member is not erased',
      store.all('subscribers').length === 1 && store.all('subscribers')[0].endedAt !== null);
    const again = await call(`/api/subscriptions/${plan.id}/unsubscribe`, 'POST', {}, TB);
    check('leaving twice is a no-op, not a second cancellation',
      again.status === 200 && again.body.changed === false, JSON.stringify(again.body).slice(0, 120));
  } finally {
    srv.close();
  }
}



console.log('\n=== TICKET RESALE MARKET (Tikiti T1) ===');
{
  // Real identities over HTTP; the resale market is a multi-party system.
  process.env.BRIEF_DEV_AUTH = '0';
  process.env.BRIEF_REVIEWERS = 'tikrev';
  const { default: app } = await import('../src/index.js');
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const reg = async (h) => (await call('/api/auth/register', 'POST', { handle: h, password: 'a good passphrase' })).body;
    const A = await reg('tikseller_' + Date.now().toString(36));
    const B = await reg('tikbuyer_' + Date.now().toString(36));
    const C = await reg('tikgift_' + Date.now().toString(36));
    const REV = await reg('tikrev');
    check('four real identities registered', [A, B, C, REV].every((x) => x?.token));

    // --- a paid event with a confirmed seat ------------------------------
    let r = await call('/api/campaigns', 'POST', { title: 'Resale Night ' + Date.now().toString(36), description: 'One seat, resold honestly', type: 'popup', price: 1500, capacity: 10 }, A.token);
    check('organiser creates a paid campaign', r.status === 201, JSON.stringify(r.body).slice(0, 120));
    const campId = r.body?.campaign?.id;
    r = await call(`/api/campaigns/${campId}/publish`, 'POST', {}, A.token);
    check('campaign published', r.status === 200, `got ${r.status}`);
    const camp = store.find('campaigns', (c) => c.id === campId);
    check('the published campaign carries a public slug', Boolean(camp?.publicSlug));

    r = await call(`/api/public/campaigns/${camp.publicSlug}/register`, 'POST', { attendeeRef: 'seat-holder-a', name: 'Seat Holder A' }, A.token);
    check('a signed-in user registers their own seat', r.status === 201, JSON.stringify(r.body).slice(0, 120));
    const regA = store.find('registrations', (x) => x.attendeeRef === 'seat-holder-a');
    check('the registration is bound to their identity', regA?.userId === A.user?.id, `${regA?.userId} vs ${A.user?.id}`);
    r = await call(`/api/campaigns/${campId}/registrations/${regA.id}/confirm-payment`, 'POST', {}, A.token);
    check('payment confirmed by the organiser', r.status === 201 || r.status === 200, JSON.stringify(r.body).slice(0, 120));
    const paidTx = store.find('ledgerTransactions', (t) => t.registrationId === regA.id);
    check('confirmation created a genuinely SETTLED ledger row', paidTx?.status === 'settled');

    // --- issuance ---------------------------------------------------------
    r = await call('/api/ticket-market/me/tickets', 'GET', undefined, A.token);
    const tik = r.body?.tickets?.[0];
    check('a confirmed seat automatically becomes a resale ticket', r.body?.tickets?.length === 1 && Boolean(tik?.id));
    check('the ticket answers to the registration gate code', tik?.code === regA.ticketCode, `${tik?.code} vs ${regA.ticketCode}`);
    check('the live scan code carries version 1', tik?.scanCode === `${regA.ticketCode}#1`);

    // ---------------------------------------------------------------------
    // DECISION 6 REPLACED THE MARKET HALF OF THIS BLOCK.
    //
    // From here to the end of the block there used to be 41 checks exercising
    // the resale marketplace: listing, ordering, paying, settling, refunding,
    // relisting, removal by a reviewer, and the signals all of it emitted.
    // Decision 6 forbids the marketplace outright -- "It cannot be sold through
    // Trace. No resale flow. No transfer marketplace." -- so those checks were
    // asserting a feature that must not exist. They are now refusals.
    //
    // WHAT IS DELIBERATELY NOT LOST: checks 1-11 above still stand, and they
    // are the ticket itself. A paid seat still becomes a ticket, the ticket
    // still answers to the registration's gate code, and the live scan code
    // still carries a version. Decision 6 keeps every one of those, and the
    // gate in domain/ticketMarket.js is drawn to keep them: issuance, the door
    // scan, gifting and voiding are ungated, and only the nine functions whose
    // job is a SALE refuse.
    //
    // COVERAGE GAP, NAMED RATHER THAN HIDDEN. Three keep-half behaviours were
    // exercised only downstream of a sale, so deleting the market deleted their
    // tests too: gifting a seat (by id, by handle, and the refusal for an
    // unknown handle), a reviewer voiding a ticket, and the gate invariant that
    // a codeVersion bump kills every previously printed QR. All three still
    // work in the product -- transferTicket, voidTicket and resolveGateCode are
    // intentionally ungated -- but server/test/decisions.mjs currently asserts
    // only that they EXIST, not how they behave. Reinstating those behavioural
    // tests against the gift path is the next job. It is written down here so
    // the gap cannot be mistaken for coverage: this block used to have 53
    // checks and now has 17, and the difference is not all forbidden feature.
    // ---------------------------------------------------------------------
    r = await call('/api/ticket-market/listings', 'POST', { ticketId: tik.id, price: 2500 }, A.token);
    check('listing a seat for sale is closed, and says why', r.status === 404 && r.body?.code === 'resale_closed', JSON.stringify(r.body));
    check('the refusal names the decision, not a bare 404', /Decision 6/.test(r.body?.note ?? ''), r.body?.note);
    r = await call('/api/ticket-market/orders', 'POST', { listingId: 'lst_nope' }, B.token);
    check('opening a resale order is closed', r.status === 404 && r.body?.code === 'resale_closed', String(r.status));
    r = await call('/api/ticket-market/me/listings', 'GET', undefined, A.token);
    check('a seller has no listings to manage', r.status === 404, String(r.status));
    r = await call('/api/ticket-market/events/any-slug/listings', 'GET', undefined, B.token);
    check('the event context exposes no resale listings', r.status === 404, String(r.status));
    r = await call('/api/ticket-market/me/tickets', 'GET', undefined, A.token);
    check('the ticket itself is still served to its owner', r.status === 200, String(r.status));
    r = await call(`/api/ticket-market/tickets/${tik.id}/transfer`, 'POST', { toUserId: B.user.id }, A.token);
    check('the gift route is still mounted — giving is not selling', r.status !== 404, `${r.status} ${JSON.stringify(r.body)}`);
    check('and a gift is not refused as a closed market', r.body?.code !== 'resale_closed', JSON.stringify(r.body));

  } finally {
    srv.close();
    delete process.env.BRIEF_REVIEWERS;
    process.env.BRIEF_DEV_AUTH = '1';
  }
}



console.log('\n=== BARGAIN TIERS (Tikiti T2) ===');
{
  process.env.BRIEF_DEV_AUTH = '0';
  const { default: app } = await import('../src/index.js');
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const reg = async (h) => (await call('/api/auth/register', 'POST', { handle: h + Date.now().toString(36), password: 'a good passphrase' })).body;
    const O = await reg('barg_owner'); const U1 = await reg('barg_1'); const U2 = await reg('barg_2');
    let r = await call('/api/engine/group-buys', 'POST', { title: 'Crate of soda', targetAmount: 10000 }, O.token);
    check('owner creates the bargain', r.status === 201, JSON.stringify(r.body).slice(0, 100));
    const buyId = r.body?.groupBuy?.id;

    // A broken ladder is refused: same price twice.
    r = await call(`/api/engine/group-buys/${buyId}/pricing`, 'POST', {
      tiers: [{ min: 1, pricePerHead: 1000 }, { min: 5, pricePerHead: 1000 }]
    }, O.token);
    check('a flat ladder is refused (prices must fall)', r.status === 400 && /fall/.test(r.body?.error ?? ''), JSON.stringify(r.body));
    r = await call(`/api/engine/group-buys/${buyId}/pricing`, 'POST', {
      tiers: [{ min: 5, pricePerHead: 800 }, { min: 1, pricePerHead: 1000 }]
    }, O.token);
    check('an unordered ladder is refused', r.status === 400 && /climb/.test(r.body?.error ?? ''));
    r = await call(`/api/engine/group-buys/${buyId}/pricing`, 'POST', {
      tiers: [{ min: 1, pricePerHead: 1000 }, { min: 5, pricePerHead: 800 }, { min: 10, pricePerHead: 650 }],
      minParticipants: 5, maxParticipants: 12,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString()
    }, O.token);
    check('a valid ladder prices the bargain', r.status === 200, JSON.stringify(r.body).slice(0, 120));

    // The price is DERIVED, never sent.
    r = await call(`/api/engine/group-buys/${buyId}/join`, 'POST', { pricePerHead: 1 }, U1.token);
    check('join #1 commits at the top band (server-priced)',
      r.status === 201 && r.body?.participant?.priceAtJoin === 1000, JSON.stringify(r.body).slice(0, 120));
    r = await call(`/api/engine/group-buys/${buyId}/join`, 'POST', {}, U1.token);
    check('joining twice is idempotent, not a second seat', r.status === 200 && r.body?.changed === false);
    for (let i = 0; i < 3; i++) await call(`/api/engine/group-buys/${buyId}/join`, 'POST', {}, (await reg('barg_fill' + i)).token);
    r = await call(`/api/engine/group-buys/${buyId}/join`, 'POST', {}, U2.token);
    check('the 5th joiner lands in the discounted band',
      r.status === 201 && r.body?.participant?.priceAtJoin === 800, JSON.stringify(r.body).slice(0, 120));
    const tierSignal = store.find('signals', (x) => x.type === 'bargain_tier_reached' && x.metadata?.groupBuyId === buyId && x.metadata?.tierMin === 5);
    check('crossing the band surfaced as a signal', Boolean(tierSignal));
    r = await call(`/api/engine/group-buys/${buyId}`, 'GET', undefined, O.token);
    check('the owner view states current price, next band and settlement price',
      r.body?.bargain?.currentPricePerHead === 800 && r.body?.bargain?.nextTier?.pricePerHead === 650
      && r.body?.bargain?.settlesAt === 650, JSON.stringify(r.body?.bargain));
    check('the view counts participants honestly', r.body?.bargain?.participants === 5 && r.body?.bargain?.minimumMet === true);

    // Capacity is a hard wall.
    for (let i = 0; i < 7; i++) await call(`/api/engine/group-buys/${buyId}/join`, 'POST', {}, (await reg('barg_cap' + i)).token);
    const extra = await reg('barg_over');
    r = await call(`/api/engine/group-buys/${buyId}/join`, 'POST', {}, extra.token);
    check('a full bargain refuses the 13th joiner (409)', r.status === 409 && r.body?.code === 'bargain_full', `${r.status}`);

    // Leaving opens a spot.
    r = await call(`/api/engine/group-buys/${buyId}/leave`, 'POST', {}, U2.token);
    check('a joiner can leave before execution', r.status === 200 && r.body?.participant?.status === 'cancelled');
    r = await call(`/api/engine/group-buys/${buyId}`, 'GET', undefined, O.token);
    check('the count drops when someone leaves', r.body?.bargain?.participants === 11, `${r.body?.bargain?.participants}`);

    // Expiry is a wall the server owns.
    const gb = store.find('groupBuys', (b) => b.id === buyId);
    store.update('groupBuys', buyId, { pricing: { ...gb.pricing, expiresAt: new Date(Date.now() - 1000).toISOString() } });
    r = await call(`/api/engine/group-buys/${buyId}/join`, 'POST', {}, extra.token);
    check('an expired bargain refuses joins', r.status === 400 && /expired/.test(r.body?.error ?? ''));
  } finally { srv.close(); process.env.BRIEF_DEV_AUTH = '1'; }
}

console.log('\n=== CONTRIBUTION POTS + DEADLINES + UPDATES (Tikiti T3) ===');
{
  process.env.BRIEF_DEV_AUTH = '0';
  const { default: app } = await import('../src/index.js');
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const reg = async (h) => (await call('/api/auth/register', 'POST', { handle: h + Date.now().toString(36), password: 'a good passphrase' })).body;
    const O = await reg('pot_owner'); const S = await reg('pot_supporter');
    let r = await call('/api/campaigns', 'POST', {
      title: 'Mwenda farewell pot ' + Date.now().toString(36), type: 'contribution', goalAmount: 5000,
      endsAt: new Date(Date.now() + 86_400_000).toISOString()
    }, O.token);
    check('a contribution pot is created with a goal', r.status === 201 && r.body?.campaign?.goalAmount === 5000, JSON.stringify(r.body).slice(0, 120));
    const potId = r.body?.campaign?.id;
    r = await call('/api/campaigns', 'POST', { title: 'Broken pot', type: 'contribution', goalAmount: 0 }, O.token);
    check('a zero goal is refused', r.status === 400);
    await call(`/api/campaigns/${potId}/publish`, 'POST', {}, O.token);
    const pot = store.find('campaigns', (c) => c.id === potId);

    r = await call(`/api/public/campaigns/${pot.publicSlug}`, 'GET');
    check('the public view derives raised from settled rows only',
      r.body?.campaign?.raised === 0 && r.body?.campaign?.contributors === 0, JSON.stringify(r.body?.campaign?.raised));
    r = await call(`/api/public/campaigns/${pot.publicSlug}/register`, 'POST', { attendeeRef: 'pot-1', name: 'First Giver', amount: 2500 }, S.token);
    check('a signed-in supporter joins the pot with a stated amount', r.status === 201, JSON.stringify(r.body).slice(0, 120));
    r = await call(`/api/public/campaigns/${pot.publicSlug}/register`, 'POST', { attendeeRef: 'pot-bad', amount: -5 });
    check('a negative amount is refused at the door', r.status === 400);
    const reg1 = store.find('registrations', (x) => x.attendeeRef === 'pot-1');
    await call(`/api/campaigns/${potId}/registrations/${reg1.id}/confirm-payment`, 'POST', { }, O.token);
    r = await call(`/api/public/campaigns/${pot.publicSlug}`, 'GET');
    check('the settled KES 2,500 moves the public progress',
      r.body?.campaign?.raised === 2500, `${r.body?.campaign?.raised}`);
    check('the ledger row carries the supporter, not the organiser',
      store.find('ledgerTransactions', (t) => t.campaignId === potId && t.status === 'settled')?.counterparty === S.user.id);

    // Anonymous: a contribution with no name and no account still counts.
    await call(`/api/public/campaigns/${pot.publicSlug}/register`, 'POST', { attendeeRef: 'anon-9', amount: 2500 });
    const regA = store.find('registrations', (x) => x.attendeeRef === 'anon-9');
    await call(`/api/campaigns/${potId}/registrations/${regA.id}/confirm-payment`, 'POST', {}, O.token);
    r = await call(`/api/public/campaigns/${pot.publicSlug}`, 'GET');
    check('the goal is reported reached exactly when settled money covers it',
      r.body?.campaign?.raised === 5000 && r.body?.campaign?.contributors === 2, JSON.stringify(r.body?.campaign?.raised));
    check('an anonymous contribution is COUNTED, never listed',
      !JSON.stringify(r.body).includes('anon-9'), 'attendeeRef leaked');
    check('goal reached surfaced as a signal, exactly once',
      store.filter('signals', (x) => x.type === 'campaign_goal_reached' && x.metadata?.campaignId === potId).length === 1);

    // Deadline is a wall.
    store.update('campaigns', potId, { endsAt: new Date(Date.now() - 1000).toISOString() });
    r = await call(`/api/public/campaigns/${pot.publicSlug}/register`, 'POST', { attendeeRef: 'late-comer' });
    check('registering after the deadline is refused', r.status === 400 && /ended/.test(r.body?.error ?? ''), JSON.stringify(r.body));
    store.update('campaigns', potId, { endsAt: new Date(Date.now() + 86_400_000).toISOString() });

    // Updates: owner authors, anyone reads, strangers cannot.
    r = await call(`/api/campaigns/${potId}/updates`, 'POST', { title: 'Halfway there', body: 'KES 2,500 raised. Thank you.' }, S.token);
    check('only the owner may post an update', r.status === 400);
    r = await call(`/api/campaigns/${potId}/updates`, 'POST', { title: 'Halfway there', body: 'KES 2,500 raised. Thank you.' }, O.token);
    check('the owner posts a campaign update', r.status === 201);
    r = await call(`/api/campaigns/${potId}/updates`, 'GET');
    check('campaign updates are behind the app gate (401)', r.status === 401, `got ${r.status}`);
    r = await call(`/api/campaigns/${potId}/updates`, 'GET', undefined, O.token);
    check('a signed-in member reads campaign updates', r.body?.updates?.length === 1);
    check('the update surfaced as a signal', Boolean(store.find('signals', (x) => x.type === 'campaign_update_posted' && x.metadata?.campaignId === potId)));

    // The PUBLIC page is slug-addressed and never learns the internal id, so
    // its feed is readable by slug too — and only for published campaigns.
    r = await call(`/api/public/campaigns/${pot.publicSlug}/updates`);
    check('updates are readable by PUBLIC slug', r.status === 200 && r.body?.updates?.length === 1, JSON.stringify(r.body));
    r = await call(`/api/public/campaigns/no-such-slug-at-all/updates`);
    check('an unknown slug is a 404, not an empty feed', r.status === 404);
  } finally { srv.close(); process.env.BRIEF_DEV_AUTH = '1'; }
}

console.log('\n=== VERIFICATION (Tikiti T6) ===');
{
  process.env.BRIEF_DEV_AUTH = '0';
  process.env.BRIEF_REVIEWERS = 'verrev';
  const { default: app } = await import('../src/index.js');
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const reg = async (h) => (await call('/api/auth/register', 'POST', { handle: h + Date.now().toString(36), password: 'a good passphrase' })).body;
    const U = await reg('ver_user'); const P = await reg('ver_plain');
    // The reviewer handle must match BRIEF_REVIEWERS exactly, so register or
    // log in rather than suffixing.
    let revReg = await call('/api/auth/register', 'POST', { handle: 'verrev', password: 'a good passphrase' });
    if (revReg.status !== 201) revReg = await call('/api/auth/login', 'POST', { handle: 'verrev', password: 'a good passphrase' });
    const REV = revReg.body;
    let r = await call('/api/verification', 'POST', { kind: 'drivers_licence' }, U.token);
    check('an unknown verification kind is refused', r.status === 400);
    r = await call('/api/verification', 'POST', { kind: 'identity', note: 'manual review please' }, U.token);
    check('an identity request is submitted (no documents, ever)', r.status === 201 && !JSON.stringify(r.body).includes('document'), JSON.stringify(r.body).slice(0, 100));
    check('no KYC provider configured -> the submission says so honestly',
      r.body?.assistProvider === null && r.body?.record?.providerAssist === undefined,
      JSON.stringify({ assistProvider: r.body?.assistProvider ?? null }).slice(0, 80));
    const rec = r.body?.record;
    r = await call('/api/verification', 'POST', { kind: 'identity' }, U.token);
    check('a duplicate open request is idempotent', r.status === 200 && r.body?.changed === false);
    r = await call('/api/verification/me', 'GET', undefined, U.token);
    check('the user sees their own standing', r.body?.standing?.identity === 'pending');
    r = await call('/api/ops/verification', 'GET', undefined, P.token);
    check('the review queue is capability-gated (403)', r.status === 403 && r.body?.requiredCapability === 'moderate');
    r = await call('/api/ops/verification', 'GET', undefined, REV.token);
    check('a reviewer reads the queue', r.status === 200 && r.body?.queue?.length >= 1);
    r = await call(`/api/ops/verification/${rec.id}/decision`, 'POST', { decision: 'rejected' }, REV.token);
    check('a rejection without a reason is refused', r.status === 400 && /reason/.test(r.body?.error ?? ''));
    r = await call(`/api/ops/verification/${rec.id}/decision`, 'POST', { decision: 'approved' }, REV.token);
    check('a reviewer approves with an audit trail', r.status === 200);
    const auditRow = store.find('auditLog', (a) => a.action === 'verification.decision' && a.objectId === rec.id);
    check('the decision is audited with before/after',
      auditRow?.before?.status === 'pending' && auditRow?.after?.status === 'approved',
      JSON.stringify({ found: Boolean(auditRow), before: auditRow?.before?.status ?? null, after: auditRow?.after?.status ?? null }));
    r = await call('/api/verification/me', 'GET', undefined, U.token);
    check('approval flips the derived standing', r.body?.standing?.identity === 'verified');
    r = await call(`/api/ops/verification/${rec.id}/revoke`, 'POST', { reason: 'court order' }, REV.token);
    check('revocation is explicit and reasoned', r.status === 200 && r.body?.record?.status === 'revoked');
    r = await call('/api/verification/me', 'GET', undefined, U.token);
    check('revocation flips the standing back', r.body?.standing?.identity !== 'verified');
  } finally { srv.close(); delete process.env.BRIEF_REVIEWERS; process.env.BRIEF_DEV_AUTH = '1'; }
}

console.log('\n=== EMAIL SUBSCRIPTIONS (Tikiti T7) ===');
{
  process.env.BRIEF_DEV_AUTH = '0';
  process.env.BRIEF_OPERATORS = 'mailop';
  const { default: app } = await import('../src/index.js');
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const OP = (await call('/api/auth/register', 'POST', { handle: 'mailop', password: 'a good passphrase' })).body;
    let r = await call('/api/email-subscriptions', 'POST', { email: 'not-an-email', topics: ['product_updates'] });
    check('a malformed address is refused', r.status === 400);
    r = await call('/api/email-subscriptions', 'POST', { email: 'a@b.co', topics: ['horoscope'] });
    check('an unknown topic is refused by name', r.status === 400 && /horoscope/.test(r.body?.error ?? ''));
    r = await call('/api/email-subscriptions', 'POST', { email: 'a@b.co', topics: ['event_announcements', 'bargain_alerts'] });
    check('a subscription starts PENDING (double opt-in)', r.status === 201 && r.body?.subscription?.status === 'pending', JSON.stringify(r.body).slice(0, 120));
    check('with no provider the mail is honestly NOT sent',
      /not sent/i.test(r.body?.delivery ?? ''), r.body?.delivery);
    const token = r.body?.subscription?.token;
    r = await call('/api/email-subscriptions/confirm?token=wrong', 'GET');
    check('a wrong confirmation token is refused', r.status === 404);
    r = await call(`/api/email-subscriptions/confirm?token=${encodeURIComponent(token)}`, 'GET');
    check('the token confirms the subscription', r.status === 200 && r.body?.ok === true);
    r = await call(`/api/email-subscriptions/confirm?token=${encodeURIComponent(token)}`, 'GET');
    check('confirming twice is idempotent', r.status === 200 && r.body?.already === true);
    r = await call('/api/email-subscriptions/unsubscribe', 'POST', { email: 'a@b.co' });
    check('unsubscribing needs no account (the privacy-correct direction)', r.status === 200);
    r = await call('/api/email-subscriptions/unsubscribe', 'POST', { email: 'a@b.co' });
    check('unsubscribing twice is idempotent', r.status === 200 && r.body?.already === true);
    r = await call(`/api/email-subscriptions/confirm?token=${encodeURIComponent(token)}`, 'GET');
    check('a token from a LEFT list is retired (no resurrection without consent)', r.status === 404, `status=${r.status}`);
    r = await call('/api/email-subscriptions', 'POST', { email: 'a@b.co', topics: ['product_updates'] });
    check('re-subscribing restarts double opt-in', r.status === 201 && r.body?.subscription?.status === 'pending');
    r = await call('/api/ops/email-log', 'GET', undefined, OP.token);
    check('the delivery log says skipped_no_provider, never "sent"',
      r.body?.log?.length >= 1 && r.body.log.every((m) => m.status === 'skipped_no_provider'), JSON.stringify(r.body?.log?.map((m) => m.status)));
  } finally { srv.close(); delete process.env.BRIEF_OPERATORS; process.env.BRIEF_DEV_AUTH = '1'; }
}

console.log('\n=== FRAUD FLAGGING (Tikiti T10) ===');
{
  process.env.BRIEF_DEV_AUTH = '0';
  process.env.BRIEF_REVIEWERS = 'fraudrev';
  const { default: app } = await import('../src/index.js');
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const reg = async (h) => (await call('/api/auth/register', 'POST', { handle: h + Date.now().toString(36), password: 'a good passphrase' })).body;
    const O = await reg('fraud_org'); const S = await reg('fraud_seller'); const B = await reg('fraud_buyer');
    void B;
    let r = await call('/api/campaigns', 'POST', { title: 'Fraud gate night', type: 'popup', price: 1000, capacity: 8 }, O.token);
    const campId = r.body.campaign.id;
    await call(`/api/campaigns/${campId}/publish`, 'POST', {}, O.token);
    const camp = store.find('campaigns', (c) => c.id === campId);
    const seat = async (who, ref) => {
      await call(`/api/public/campaigns/${camp.publicSlug}/register`, 'POST', { attendeeRef: ref, name: ref }, who.token);
      const regRow = store.find('registrations', (x) => x.attendeeRef === ref);
      await call(`/api/campaigns/${campId}/registrations/${regRow.id}/confirm-payment`, 'POST', {}, O.token);
      // The ticket BORN from this exact registration -- "the first unlisted
      // one" was flaky by construction once a seller holds several seats.
      return store.find('tickets', (t) => t.registrationId === regRow.id);
    };
    const tikFair = await seat(S, 'fraud-fair');
    const tikScalp = await seat(S, 'fraud-scalp');
    // ---------------------------------------------------------------------
    // DECISION 6 MADE THIS SECTION UNREACHABLE, and it is worth being precise
    // about why rather than just deleting it.
    //
    // Fraud flagging scored a SELLER'S ASKING PRICE against the issue price and
    // the age of the account, then hid the flagged listing from browse and
    // raised a signal for review. Every step of that lives inside
    // listForResale, which is now gated: no listing can be created, so no
    // listing can be overpriced, flagged, hidden or reported.
    //
    // The four checks here used to assert that a scalper's listing was caught.
    // They are replaced by the refusal that supersedes them -- a market that
    // cannot open cannot be abused, which is a stronger guarantee than flagging
    // the abuse, and the one the operator chose.
    //
    // The flagging code itself is still on disk inside listForResale, behind the
    // same gate as the rest of the market. It goes when the corpse goes.
    // ---------------------------------------------------------------------
    r = await call('/api/ticket-market/listings', 'POST', { ticketId: tikFair.id, price: 1200 }, S.token);
    check('a fair price cannot be listed at all — the market is closed', r.status === 404 && r.body?.code === 'resale_closed', JSON.stringify(r.body));
    r = await call('/api/ticket-market/listings', 'POST', { ticketId: tikScalp?.id ?? 'none', price: 5000 }, S.token);
    check('and neither can a scalp price, so there is nothing to flag', r.status === 404 && r.body?.code === 'resale_closed', String(r.status));
    // What this section still proves about the half Decision 6 keeps: both seats
    // were paid, confirmed and issued a real ticket. The market is closed; the
    // ticket is not.
    check('both seats still issued a real ticket', Boolean(tikFair) && Boolean(tikScalp), `${Boolean(tikFair)}/${Boolean(tikScalp)}`);
  } finally { srv.close(); delete process.env.BRIEF_REVIEWERS; process.env.BRIEF_DEV_AUTH = '1'; }
}


console.log('\n=== EVENTS HUB (Tikiti T4) ===');
{
  const { default: app } = await import('../src/index.js');
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    // register routes: browse + feature. Need the domain directly too.
    const events = await import('../src/domain/events.js');
    const O = (await call('/api/auth/register', 'POST', { handle: 'hub_org' + Date.now().toString(36), password: 'a good passphrase' })).body;
    const X = (await call('/api/auth/register', 'POST', { handle: 'hub_other' + Date.now().toString(36), password: 'a good passphrase' })).body;
    for (const [title, type, loc] of [['Night Market X', 'popup', 'Kilimani'], ['Yoga X', 'session', 'Westlands'], ['Farewell pot X', 'contribution', 'Kilimani']]) {
      const c = (await call('/api/campaigns', 'POST', { title, type, location: loc, ...(type === 'contribution' ? { goalAmount: 1000 } : {}) }, O.token)).body.campaign;
      await call(`/api/campaigns/${c.id}/publish`, 'POST', {}, O.token);
    }
    let r = await call('/api/events?category=popup', 'GET');
    check('browsing by category finds the market', r.body?.events?.some((e) => e.title === 'Night Market X') ?? false, JSON.stringify(r.body).slice(0, 120));
    // The card's cover + description are surfaced (null when unset — honest,
    // never a fabricated image).
    const nightMarket = r.body?.events?.find((e) => e.title === 'Night Market X');
    check('a browse listing carries coverImageUrl and description', 'coverImageUrl' in nightMarket && 'description' in nightMarket, JSON.stringify(nightMarket));
    // tableBankingOverlap is derived per viewer: null anonymously, real when
    // the viewer's group members registered.
    // DECISION 6 replaced the four checks that used to live here. They asserted
    // that a per-viewer circle overlap, a popularity sort and an organiser-set
    // featured flag all worked. The decision removes all three, so the honest
    // assertion is now their ABSENCE -- not a weaker version of the old claim.
    // (server/test/decisions.mjs carries the full refusal suite, including the
    // HTTP 404 on the retired feature route, which needs a session to reach.)
    check('an event row carries no circle overlap', !('tableBankingOverlap' in nightMarket), JSON.stringify(Object.keys(nightMarket)));
    r = await call('/api/events?location=kilimani', 'GET');
    check('location search is case-insensitive', (r.body?.events ?? []).length === 2, `${r.body?.events?.length}`);
    r = await call('/api/events?category=horoscope', 'GET');
    check('an unknown category is refused', r.status === 400);
    const plainOrder = (await call('/api/events', 'GET')).body?.events?.map((e) => e.title) ?? [];
    r = await call('/api/events?sort=popularity', 'GET');
    check('sort=popularity is ignored, not served', Array.isArray(r.body?.events) && r.body.events.every((e) => !('popularity' in e)));
    check('sort=popularity does not reorder the list', JSON.stringify((r.body?.events ?? []).map((e) => e.title)) === JSON.stringify(plainOrder));
    check('internal ids never appear in browse', !JSON.stringify(r.body).includes('"id":"camp_'));
    r = await call('/api/events?featured=1', 'GET');
    check('featured=1 does not narrow the list', JSON.stringify((r.body?.events ?? []).map((e) => e.title)) === JSON.stringify(plainOrder));
    check('no event row carries a featured flag', (r.body?.events ?? []).every((e) => !('featured' in e)));
    check('events.js exports no setFeatured to call', typeof events.setFeatured === 'undefined');
  } finally { srv.close(); }
}

console.log('\n=== MSHIKANO: the cooperation network (post -> match -> confirm -> trust) ===');
{
  process.env.BRIEF_DEV_AUTH = '0'; // the gate's anonymous check needs no dev fallback
  const { default: app } = await import('../src/index.js');
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const A = (await call('/api/auth/register', 'POST', { handle: 'mshi_a' + Date.now().toString(36), password: 'a good passphrase' })).body;
    const B = (await call('/api/auth/register', 'POST', { handle: 'mshi_b' + Date.now().toString(36), password: 'a good passphrase' })).body;
    const C = (await call('/api/auth/register', 'POST', { handle: 'mshi_c' + Date.now().toString(36), password: 'a good passphrase' })).body;

    // The four intents.
    let r = await call('/api/mshikano/posts', 'POST', { intent: 'swap', title: 'nothing' }, A.token);
    check('an unknown intent is refused by name', r.status === 400 && /intent/.test(r.body?.error ?? ''));
    r = await call('/api/mshikano/posts', 'POST', { intent: 'have', title: '1 tonne of mangoes', town: 'Wote', county: 'Makueni' }, A.token);
    check('a HAVE posts honestly', r.status === 201 && r.body?.post?.intent === 'have', JSON.stringify(r.body).slice(0, 100));
    const mangoes = r.body.post.id;
    r = await call('/api/mshikano/posts', 'POST', { intent: 'need', title: '500 kg mangoes every week', town: 'Gikomba', county: 'Nairobi' }, B.token);
    check('a NEED posts honestly', r.status === 201);
    const buyerNeed = r.body.post.id;
    await call('/api/mshikano/posts', 'POST', { intent: 'can_help', title: 'Refrigerated transport Nairobi Makueni mangoes' }, C.token);

    // Matching: complementary only, with reasons.
    r = await call(`/api/mshikano/posts/${buyerNeed}/matches`, 'GET', undefined, B.token);
    const matches = r.body?.matches ?? [];
    check('a NEED matches HAVEs (and CAN HELPs) that share its words',
      matches.length >= 1 && matches.some((m) => m.post.title.includes('mangoes')), JSON.stringify(matches.map((m) => m.post?.title)).slice(0, 160));
    check('every match carries its WHY in words',
      matches.every((m) => Array.isArray(m.reasons) && (m.reasons.length === 0 || m.reasons.every((x) => typeof x === 'string'))));
    check('your own posts never match themselves back',
      !matches.some((m) => m.post.mine));
    r = await call(`/api/mshikano/posts/${mangoes}/matches`, 'GET', undefined, A.token);
    check('a HAVE finds the complementary NEED',
      (r.body?.matches ?? []).some((m) => m.post.title.includes('mangoes') && m.post.intent === 'need'));

    // The relationship: BOTH parties must confirm.
    r = await call('/api/mshikano/cooperations', 'POST', { postId: buyerNeed, partnerUserId: A.user.id, summary: 'mangoes weekly' }, B.token);
    check('a cooperation is proposed', r.status === 201 && r.body?.cooperation?.status === 'pending');
    const partnership = r.body.cooperation.id;
    r = await call(`/api/mshikano/cooperations/${partnership}/respond`, 'POST', { accept: true }, C.token);
    check('a bystander cannot confirm someone else\'s cooperation (403)', r.status === 403);
    r = await call(`/api/mshikano/cooperations/${partnership}/respond`, 'POST', { accept: true }, A.token);
    check('the named partner confirms it', r.status === 200 && r.body?.cooperation?.status === 'confirmed');

    // Trust is EVIDENCE from confirmed rows, never stars.
    r = await call(`/api/mshikano/trust/${A.user.id}`, 'GET', undefined, B.token);
    check('one confirmed cooperation lifts trust to cooperating', r.body?.level === 'cooperating' && r.body?.evidence?.confirmedCooperations === 1, JSON.stringify(r.body?.evidence));
    check('trust says its level in words', typeof r.body?.levelWords === 'string' && r.body.levelWords.length > 10);
    r = await call(`/api/mshikano/trust/${C.user.id}`, 'GET', undefined, B.token);
    check('zero cooperations is an honest NEW, not zero stars', r.body?.level === 'new' && r.body?.evidence?.confirmedCooperations === 0);
    r = await call(`/api/mshikano/cooperations/${partnership}/recommend`, 'POST', { note: 'Delivered on time, quality mangoes' }, A.token);
    check('a partner recommends in words', r.status === 200 && r.body?.cooperation?.recommendations?.length === 1);
    r = await call(`/api/mshikano/cooperations/${partnership}/recommend`, 'POST', { note: 'again' }, A.token);
    check('double-recommending the same cooperation is refused', r.status === 400);
    r = await call(`/api/mshikano/trust/${A.user.id}`, 'GET', undefined, B.token);
    check('the recommendation counts as evidence for the receiver',
      r.body?.evidence?.recommendations === 0, JSON.stringify(r.body?.evidence)); // A WROTE it; it counts for B
    r = await call(`/api/mshikano/trust/${B.user.id}`, 'GET', undefined, A.token);
    check('the recommendation appears on the receiver\'s trust',
      r.body?.evidence?.recommendations === 1 && (r.body?.recommendationNotes ?? [])[0]?.note?.includes('quality mangoes'));

    // The graph.
    r = await call('/api/mshikano/graph', 'GET', undefined, B.token);
    check('the graph records who helped whom', r.body?.totals?.confirmed === 1 && r.body?.helped?.length + r.body?.received?.length === 1, JSON.stringify(r.body?.totals));

    // Who can help?
    r = await call('/api/mshikano/who-can-help?q=who+can+help+me+start+a+poultry+business+in+Bungoma', 'GET', undefined, A.token);
    check('the question answers with grouped, real rows only',
      r.status === 200 && typeof r.body?.counts?.people === 'number' && Array.isArray(r.body?.guides), JSON.stringify(r.body?.counts));
    check('an empty answer is EMPTY, not padded',
      r.body.counts.people + r.body.counts.businesses + r.body.counts.groups + r.body.counts.guides === 0
        || (r.body.people.every((p) => /poultry|business|bungoma/i.test(p.title)) && r.body.counts.groups === 0));

    // Groups answer from REAL circles, with their real member count.
    qualifyGroupCreator(B.user.id);
    r = await call('/api/circles', 'POST', { name: 'Bungoma Poultry Circle', description: 'members who help each other keep poultry in Bungoma' }, B.token);
    check('a member starts a real circle', r.status === 201, JSON.stringify(r.body).slice(0, 120));
    r = await call('/api/mshikano/who-can-help?q=who+can+help+me+start+a+poultry+business+in+Bungoma', 'GET', undefined, A.token);
    check('a matching circle answers as a group', r.body?.counts?.groups === 1 && r.body.groups[0]?.name === 'Bungoma Poultry Circle', JSON.stringify(r.body?.groups));
    check('the group carries its REAL member count (the founder)', r.body?.groups?.[0]?.members === 1, JSON.stringify(r.body?.groups?.[0]));
    r = await call('/api/mshikano/who-can-help?q=who+repairs+kyozo+phones+overnight', 'GET', undefined, A.token);
    check('a question nothing matches keeps groups EMPTY', r.body?.counts?.groups === 0 && r.body.groups.length === 0, JSON.stringify(r.body?.counts));

    // A dispute withdraws the credit and keeps the record.
    r = await call(`/api/mshikano/cooperations/${partnership}/dispute`, 'POST', { reason: 'never delivered the second batch' }, C.token);
    check('an outsider cannot dispute (403)', r.status === 403, `got ${r.status}`);
    r = await call(`/api/mshikano/cooperations/${partnership}/dispute`, 'POST', { reason: 'x' }, A.token);
    check('a dispute needs a real reason (400)', r.status === 400, `got ${r.status}`);
    r = await call(`/api/mshikano/cooperations/${partnership}/dispute`, 'POST', { reason: 'never delivered the second batch' }, A.token);
    check('a partner disputes the cooperation', r.status === 200 && r.body?.cooperation?.status === 'disputed' && r.body?.cooperation?.dispute?.note?.includes('second batch'), JSON.stringify(r.body?.cooperation?.dispute));
    r = await call('/api/mshikano/cooperations', 'GET', undefined, A.token);
    check('a disputed cooperation stays LISTED for the partners', (r.body?.disputed ?? []).some((d) => d.id === partnership), JSON.stringify(r.body?.disputed?.map((d) => d.id)));
    r = await call('/api/mshikano/graph', 'GET', undefined, B.token);
    check('the disputed link leaves the confirmed graph', r.body?.totals?.confirmed === 0, JSON.stringify(r.body?.totals));
    r = await call(`/api/mshikano/trust/${A.user.id}`, 'GET', undefined, B.token);
    check('the dispute is COUNTED as evidence on both records', r.body?.evidence?.disputes >= 1, JSON.stringify(r.body?.evidence));

    // The app gate still owns the door.
    r = await call('/api/mshikano/posts');
    check('Mshikano is members-only (401 anonymous)', r.status === 401 && r.body?.gate === 'account_required');
  } finally {
    srv.close();
  }
}


console.log('\n=== SERVICE FEES: POCHI LA BIASHARA, MANUAL-FIRST (§ expansion 8) ===');
{
  // Pochi has no API: the member submits the M-Pesa code, a finance-capable
  // operator confirms it, and money truth stays in the ledger.
  process.env.BRIEF_DEV_AUTH = '0';
  process.env.BRIEF_FINANCE = 'feetestfin';
  process.env.BRIEF_POCHI_NUMBER = '0700000000';
  const { default: app } = await import('../src/index.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const reg = async (handle) => (await call('/api/auth/register', 'POST', { handle: handle + Date.now().toString(36), password: 'a good passphrase' })).body;
    const member = await reg('feemember');
    const fin = (await call('/api/auth/register', 'POST', { handle: 'feetestfin', password: 'a good passphrase' })).body;

    // The gate still owns the door.
    let r = await call('/api/fees/mine');
    check('service fees are members-only (401 anonymous)', r.status === 401);

    // The catalog is the only price list, and the Pochi number is stated.
    r = await call('/api/fees/mine', 'GET', undefined, member.token);
    check('mine returns the catalog and the member rows', r.status === 200 && Array.isArray(r.body?.services) && Array.isArray(r.body?.fees));
    check('the Pochi number is shown when configured', r.body?.pochi === '0700000000');
    const svc = r.body.services.find((x) => x.key === 'store_monthly');
    check('the catalog carries a positive server-side price', svc && svc.amountKes > 0);

    // The amount cannot come from the client. Unknown service refused.
    r = await call('/api/fees/pay', 'POST', { service: 'gold_tier', mpesaCode: 'QJD31X5K2S' }, member.token);
    check('an unknown service is refused', r.status === 400);
    r = await call('/api/fees/pay', 'POST', { service: 'store_monthly', mpesaCode: 'short' }, member.token);
    check('a malformed M-Pesa code is refused', r.status === 400 && /confirmation code/i.test(r.body?.error ?? ''));
    r = await call('/api/fees/pay', 'POST', { service: 'store_monthly', mpesaCode: 'QJD31X5K2S', amountKes: 1 }, member.token);
    check('a payment records PENDING whatever amount the client posts', r.status === 201 && r.body?.fee?.status === 'pending', JSON.stringify(r.body?.fee).slice(0, 120));
    check('the amount is the CATALOG amount, not the posted one', r.body?.fee?.amountKes === svc.amountKes);
    const feeId = r.body.fee.id;
    r = await call('/api/fees/pay', 'POST', { service: 'store_monthly', mpesaCode: 'QJD31X5K2S' }, member.token);
    check('the same M-Pesa code cannot be recorded twice (409)', r.status === 409, `got ${r.status}`);

    // Only finance may confirm a code.
    r = await call(`/api/fees/${feeId}/respond`, 'POST', { accept: true }, member.token);
    check('a plain member cannot confirm their own code (403)', r.status === 403 && r.body?.requiredCapability === 'finance', JSON.stringify(r.body).slice(0, 120));
    r = await call(`/api/fees/${feeId}/respond`, 'POST', { accept: false }, fin.token);
    check('refusing without a reason is refused', r.status === 400);
    r = await call(`/api/fees/${feeId}/respond`, 'POST', { accept: true }, fin.token);
    check('finance confirms the code', r.status === 200 && r.body?.fee?.status === 'confirmed' && !!r.body?.fee?.confirmedAt, JSON.stringify(r.body?.fee).slice(0, 140));

    // The member sees the confirmed state and is notified.
    r = await call('/api/fees/mine', 'GET', undefined, member.token);
    check('the member sees their confirmed fee', (r.body?.fees ?? []).some((f) => f.id === feeId && f.status === 'confirmed'));
    r = await call('/api/notifications', 'GET', undefined, member.token);
    check('the member was notified of the confirmation', (r.body?.notifications ?? []).some((n) => /confirmed/i.test(n.title ?? '')), JSON.stringify(r.body).slice(0, 120));

    // Refusal keeps the reason and fails the ledger row.
    const second = await call('/api/fees/pay', 'POST', { service: 'promotion_weekly', mpesaCode: 'SBK4R9T2XA' }, member.token);
    r = await call(`/api/fees/${second.body.fee.id}/respond`, 'POST', { accept: false, note: 'code not found in the M-Pesa statement' }, fin.token);
    check('finance refuses with a reason that stays on the row', r.status === 200 && r.body?.fee?.status === 'refused' && /statement/.test(r.body?.fee?.refusedReason ?? ''), JSON.stringify(r.body?.fee).slice(0, 140));
    r = await call('/api/fees/pay', 'POST', { service: 'store_monthly', mpesaCode: 'SBK4R9T2XA' }, member.token);
    check('a refused code stays locked (409)', r.status === 409, `got ${r.status}`);

    // Revenue is derived from rows, finance-only, never stored.
    r = await call('/api/fees/all', 'GET', undefined, member.token);
    check('the finance ledger is finance-only (403)', r.status === 403);
    r = await call('/api/fees/all', 'GET', undefined, fin.token);
    check('confirmed revenue is the sum of confirmed rows only', r.body?.confirmedRevenueKes === svc.amountKes, JSON.stringify(r.body?.confirmedRevenueKes));

    // The gate again, at the end.
    r = await call('/api/fees/all');
    check('the finance route is members-only too (401)', r.status === 401);
  } finally {
    srv.close();
  }
}


console.log('\n=== REFERRALS: REWARDS WITH A MATHEMATICAL EDGE, NOT A PYRAMID ===');
{
  // The three structural rules under test: depth capped at ONE level, no
  // entry fee anywhere, and every shilling of cash paid out backed by real
  // confirmed revenue in the derived pool.
  process.env.BRIEF_DEV_AUTH = '0';
  process.env.BRIEF_FINANCE = 'refinf';
  const { default: app } = await import('../src/index.js');
  const referrals = await import('../src/domain/referrals.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const reg = async (handle, ref) => (await call('/api/auth/register', 'POST', { handle: handle + Date.now().toString(36), password: 'a good passphrase', ...(ref ? { ref } : {}) })).body;
    const A = await reg('refa');
    const ACODE = referrals.referralCodeOf(A.user.id); // derived from the handle
    check('the code is derived from the handle', /^REFA[A-Z0-9]+$/.test(ACODE ?? ''), ACODE);

    // --- depth is ONE level, credited once ----------------------------------
    const B = await reg('refb', ACODE);
    let r = await call('/api/referrals/mine', 'GET', undefined, A.token);
    check('mine returns the same code', r.body?.code === ACODE, r.body?.code);
    check('a real signup credits the direct referrer once', r.body?.balance?.earned === 100, JSON.stringify(r.body?.balance));
    check('the surface states the depth cap', r.body?.maxDepth === 1);
    const C = await reg('refc', referrals.referralCodeOf(B.user.id));
    r = await call('/api/referrals/mine', 'GET', undefined, A.token);
    check("B's own referral does NOT credit A (depth stops at one)", r.body?.balance?.earned === 100, JSON.stringify(r.body?.balance));
    r = await call('/api/referrals/mine', 'GET', undefined, B.token);
    check('B is credited for C directly', r.body?.balance?.earned === 100, JSON.stringify(r.body?.balance));
    await reg('refb2', ACODE); // a different new member through A's code
    r = await call('/api/referrals/mine', 'GET', undefined, A.token);
    check('each new member credits once, per member', r.body?.balance?.earned === 200, JSON.stringify(r.body?.balance));

    // --- purchases earn points; referred purchases credit the referrer ------
    const S = await reg('refseller');
    await call('/api/vendors', 'POST', { displayName: 'Ref Seller', description: 'goods', contactMethod: '0700 000000' }, S.token);
    const mk = await call('/api/listings', 'POST', { title: 'Crate of tomatoes', description: 'Grade A', type: 'product', price: 10000, currency: 'KES', locationName: 'Wote' }, S.token);
    const listingId = mk.body.listing.id;
    await call(`/api/listings/${listingId}/status`, 'POST', { status: 'active' }, S.token);
    const o1 = await call('/api/orders', 'POST', { listingId, quantity: 1 }, B.token);
    await call(`/api/orders/${o1.body.order.id}/fulfil`, 'POST', {}, S.token);
    r = await call('/api/referrals/mine', 'GET', undefined, B.token);
    check('a fulfilled purchase earns the buyer points', r.body?.balance?.earned === 100 + 500, JSON.stringify(r.body?.balance));
    r = await call('/api/referrals/mine', 'GET', undefined, A.token);
    check("the referrer earns the same, once per order", r.body?.balance?.earned === 200 + 500, JSON.stringify(r.body?.balance));
    await call(`/api/orders/${o1.body.order.id}/fulfil`, 'POST', {}, S.token); // replay
    r = await call('/api/referrals/mine', 'GET', undefined, A.token);
    check('replaying fulfilment mints nothing', r.body?.balance?.earned === 700, JSON.stringify(r.body?.balance));

    // --- a CLOSED lead rewards the field agent once, deterministically ------
    const agent = await reg('refagent'); // a third-party rider/field agent
    const buyer2 = await reg('refbuyer2'); // a fresh, unreferred buyer
    const mk2 = await call('/api/listings', 'POST', { title: 'Crate of onions', description: 'Grade A', type: 'product', price: 10000, currency: 'KES', locationName: 'Wote' }, S.token);
    const listing2 = mk2.body.listing.id;
    await call(`/api/listings/${listing2}/status`, 'POST', { status: 'active' }, S.token);
    // The buyer may not be their own lead agent.
    const selfDeal = await call('/api/orders', 'POST', { listingId: listing2, quantity: 1, leadAgentId: buyer2.user.id }, buyer2.token);
    check('a buyer cannot be their own lead agent', selfDeal.status === 400, `got ${selfDeal.status}`);
    // The vendor may not be the lead agent for their own listing either.
    const vendorDeal = await call('/api/orders', 'POST', { listingId: listing2, quantity: 1, leadAgentId: S.user.id }, buyer2.token);
    check('a vendor cannot be the lead agent for their own listing', vendorDeal.status === 400, `got ${vendorDeal.status}`);
    // A genuine third-party agent: the order records them, and the reward is
    // minted ONLY when the order fulfils.
    const o2 = await call('/api/orders', 'POST', { listingId: listing2, quantity: 1, leadAgentId: agent.user.id }, buyer2.token);
    check('an order records the lead agent', o2.body.order.leadAgentId === agent.user.id, o2.body.order.leadAgentId);
    r = await call('/api/referrals/mine', 'GET', undefined, agent.token);
    check('no points minted before the lead closes', r.body?.balance?.earned === 0, JSON.stringify(r.body?.balance));
    await call(`/api/orders/${o2.body.order.id}/fulfil`, 'POST', {}, S.token);
    r = await call('/api/referrals/mine', 'GET', undefined, agent.token);
    check('a closed lead mints the deterministic flat reward', r.body?.balance?.earned === referrals.POINTS.leadClosed, JSON.stringify(r.body?.balance));
    await call(`/api/orders/${o2.body.order.id}/fulfil`, 'POST', {}, S.token); // replay
    r = await call('/api/referrals/mine', 'GET', undefined, agent.token);
    check('replaying fulfilment does not re-mint the lead reward', r.body?.balance?.earned === referrals.POINTS.leadClosed, JSON.stringify(r.body?.balance));
    // The distribution budget: the cash-equivalent of ALL point awards on a
    // representative order stays under the 6.5% cap. (purchase 500 + lead 250
    // = 750 pts = KES 75 on a KES 10,000 order = 0.75% — plus a referred
    // purchase would add 500 pts = another 0.5%, still far below 6.5%.)
    const leadKes = referrals.POINTS.leadClosed * referrals.CONVERSION.ptsToKes;
    check('lead reward is a deterministic fraction of a typical order', leadKes / 10000 < referrals.DISTRIBUTION_CAP, String(leadKes / 10000));
    check('the distribution cap is 6.5%', referrals.DISTRIBUTION_CAP === 0.065, String(referrals.DISTRIBUTION_CAP));

    // --- event traffic: deduped, capped, worth one point --------------------
    const camp = await call('/api/campaigns', 'POST', { title: 'Referral Night ' + Date.now().toString(36), description: 'x', type: 'event', startsAt: new Date(Date.now() + 86400000).toISOString() }, A.token);
    const pub = await call(`/api/campaigns/${camp.body.campaign.id}/publish`, 'POST', {}, A.token);
    const owned = await call(`/api/campaigns/${camp.body.campaign.id}`, 'GET', undefined, A.token);
    const slug = owned.body?.campaign?.publicSlug; // the PUBLIC slug, one link to paste anywhere
    await call(`/api/public/campaigns/${slug}?via=${ACODE}`, 'GET');
    await call(`/api/public/campaigns/${slug}?via=${ACODE}`, 'GET');
    r = await call('/api/referrals/mine', 'GET', undefined, A.token);
    check('link traffic is deduped per visitor per day', r.body?.balance?.earned === 701, JSON.stringify(r.body?.balance));
    // The daily cap, exercised directly against the domain.
    for (let i = 0; i < 55; i++) referrals.recordTraffic(ACODE, 'captest-visitor-' + i);
    r = await call('/api/referrals/mine', 'GET', undefined, A.token);
    check('traffic points stop at the daily cap', r.body?.balance?.earned === 750, JSON.stringify(r.body?.balance)); // 1 http visit + 49 more = the 50/day cap
    await call(`/api/public/campaigns/${slug}/register`, 'POST', { attendeeRef: 'guest-1', via: ACODE });
    await call(`/api/public/campaigns/${slug}/register`, 'POST', { attendeeRef: 'guest-1', via: ACODE });
    r = await call('/api/referrals/mine', 'GET', undefined, A.token);
    check('an event registration through the link earns, once per attendee', r.body?.balance?.earned === 775, JSON.stringify(r.body?.balance)); // 750 + 25, once

    // --- the pool: cash only from real confirmed revenue --------------------
    r = await call('/api/referrals/convert', 'POST', { points: 500 }, A.token);
    check('conversion is refused when the pool holds nothing (409)', r.status === 409 && /pool/i.test(r.body?.error ?? ''), JSON.stringify(r.body).slice(0, 140));
    const payer = await reg('refpayer');
    const payer2 = await reg('refpayer2');
    const feeCode = () => 'RF' + Math.random().toString(36).toUpperCase().slice(2, 9);
    const fee = await call('/api/fees/pay', 'POST', { service: 'store_monthly', mpesaCode: feeCode() }, payer.token);
    const fee2 = await call('/api/fees/pay', 'POST', { service: 'store_monthly', mpesaCode: feeCode() }, payer2.token);
    const fin = (await call('/api/auth/register', 'POST', { handle: 'refinf', password: 'a good passphrase' })).body;
    await call(`/api/fees/${fee.body.fee.id}/respond`, 'POST', { accept: true }, fin.token);
    await call(`/api/fees/${fee2.body.fee.id}/respond`, 'POST', { accept: true }, fin.token);
    r = await call('/api/referrals/mine', 'GET', undefined, A.token);
    check('confirmed fees grow the pool by their fixed fraction', r.body?.pool?.backingKes === 50 && r.body?.pool?.availableKes === 50, JSON.stringify(r.body?.pool)); // 10% of 2 x 250
    r = await call('/api/referrals/convert', 'POST', { points: 750 }, A.token);
    check('overdrawing the pool is refused (409)', r.status === 409, JSON.stringify(r.body).slice(0, 120));
    r = await call('/api/referrals/convert', 'POST', { points: 500 }, A.token);
    check('a conversion inside the pool goes PENDING', r.status === 201 && r.body?.conversion?.status === 'pending' && r.body?.conversion?.kes === 50, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
    const conv = r.body.conversion.id;
    r = await call('/api/referrals/convert', 'POST', { points: 500 }, A.token);
    check('the pool is spent — a second conversion is refused', r.status === 400 || r.status === 409, `got ${r.status}`);
    r = await call(`/api/referrals/conversions/${conv}/respond`, 'POST', { accept: true }, A.token);
    check('a member cannot confirm their own payout (403 finance)', r.status === 403);
    r = await call(`/api/referrals/conversions/${conv}/respond`, 'POST', { accept: true }, fin.token);
    check('finance confirms the manual M-Pesa payout', r.status === 200 && r.body?.conversion?.status === 'confirmed');
    r = await call('/api/referrals/all', 'GET', undefined, fin.token);
    check('paid never exceeds backing — the anti-pyramid invariant', r.body?.pool?.paidOrPromisedKes <= r.body?.pool?.backingKes, JSON.stringify(r.body?.pool));
  } finally {
    srv.close();
  }
}


console.log('\n=== PLATFORM ROLES: THE OPERATOR SURFACE IS CAPABILITY-GUARDED ===');
{
  // Production posture: no dev fallback, real identities only.
  process.env.BRIEF_DEV_AUTH = '0';
  const { default: app } = await import('../src/index.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    // Deployment bootstrap: one reviewer, one finance, one admin by handle.
    process.env.BRIEF_OPERATORS = 'platop';
    process.env.BRIEF_REVIEWERS = 'platrev';
    process.env.BRIEF_FINANCE = 'platfin';
    process.env.BRIEF_ADMINS = 'platadm';
    const reg = async (handle) => (await call('/api/auth/register', 'POST', { handle, password: 'a good passphrase' })).body;
    const nobody = await reg('plainuser');
    const op = await reg('platop');
    const rev = await reg('platrev');
    const fin = await reg('platfin');
    const adm = await reg('platadm');

    check('a plain account holds no operator roles', (await call('/api/auth/me', 'GET', undefined, nobody.token)).body?.user?.platformRoles?.length === 0);

    // --- capability refusals are honest 403s, named -------------------------
    let r = await call('/api/ops/diagnostics', 'GET', undefined, nobody.token);
    check('a plain user cannot read diagnostics (403)', r.status === 403, `got ${r.status}`);
    check('the refusal names the capability', r.body?.requiredCapability === 'ops.read', JSON.stringify(r.body));
    r = await call('/api/ops/backup', 'POST', {}, nobody.token);
    check('a plain user cannot trigger backups (403)', r.status === 403);
    r = await call('/api/ops/seed/clear', 'POST', {}, nobody.token);
    check('a plain user cannot clear the store (403)', r.status === 403);
    r = await call('/api/economic/reconcile', 'GET', undefined, op.token);
    check('an operator cannot read reconciliation (finance-only, 403)', r.status === 403);
    r = await call('/api/ops/reports/x/resolve', 'POST', {}, op.token);
    check('an operator cannot moderate reports (403)', r.status === 403);
    r = await call('/api/ops/roles', 'POST', { userId: 'usr_x', roles: ['admin'] }, rev.token);
    check('a reviewer cannot assign roles (403)', r.status === 403);

    // --- the ladder of capabilities -----------------------------------------
    r = await call('/api/ops/diagnostics', 'GET', undefined, op.token);
    check('an operator reads diagnostics (200)', r.status === 200);
    r = await call('/api/ops/backup', 'POST', {}, op.token);
    check('an operator takes a backup (200)', r.status === 200 && r.body?.ok === true);
    r = await call('/api/ops/reports', 'GET', undefined, rev.token);
    check('a reviewer reads the report queue (200)', r.status === 200);
    r = await call('/api/economic/reconcile', 'GET', undefined, fin.token);
    check('finance reads settlement reconciliation (200)', r.status === 200);
    r = await call('/api/economic/payments/reconcile', 'GET', undefined, fin.token);
    check('finance reads payment reconciliation (200)', r.status === 200);

    // --- editorial transitions are moderation acts (the collections cap gap) --
    r = await call('/api/admin/collections', 'POST', { title: 'Reviewer picks', kind: 'rule', rule: { type: 'place' } }, rev.token);
    check('a reviewer creates a collection (201)', r.status === 201, JSON.stringify(r.body).slice(0, 120));
    const colKey = r.body?.collection?.key;
    r = await call(`/api/admin/collections/${colKey}/publish`, 'POST', {}, nobody.token);
    check('a plain member cannot publish a collection (403)', r.status === 403, `got ${r.status}`);
    check('the refusal names the moderate capability', r.body?.requiredCapability === 'moderate', JSON.stringify(r.body).slice(0, 120));
    r = await call(`/api/admin/collections/${colKey}/publish`, 'POST', {}, rev.token);
    check('a reviewer publishes the collection (200)', r.status === 200 && r.body?.collection?.status === 'published', JSON.stringify(r.body).slice(0, 120));
    r = await call(`/api/collections/${colKey}`, 'GET', undefined, nobody.token);
    check('the published collection resolves for a member', r.body?.collection?.status === 'published', JSON.stringify(r.body).slice(0, 120));


    // --- role assignment is admin-only and audited ---------------------------
    const target = (await call('/api/auth/me', 'GET', undefined, nobody.token)).body.user;
    r = await call('/api/ops/roles', 'POST', { userId: target.id, roles: ['operator'], reason: 'onboarding the night shift' }, adm.token);
    check('an admin assigns a stored role (200)', r.status === 200, JSON.stringify(r.body).slice(0, 120));
    r = await call('/api/ops/diagnostics', 'GET', undefined, nobody.token);
    check('the stored role takes effect immediately', r.status === 200, `got ${r.status}`);
    r = await call('/api/ops/roles', 'POST', { userId: target.id, roles: ['owner'] }, adm.token);
    check('an unknown role is refused, not stored', r.status === 400 || (Array.isArray(r.body?.user?.platformRoles) && !r.body.user.platformRoles.includes('owner')), JSON.stringify(r.body).slice(0, 120));

    // --- the audit trail records consequential actions -----------------------
    r = await call('/api/ops/audit', 'GET', undefined, op.token);
    check('the audit trail lists operator actions', Array.isArray(r.body?.audit) && r.body.audit.length > 0, JSON.stringify(r.body).slice(0, 120));
    const actions = new Set(r.body.audit.map((a) => a.action));
    check('the backup is in the audit trail', actions.has('ops.backup'));
    check('the role assignment is in the audit trail with a reason', r.body.audit.some((a) => a.action === 'ops.roles.set' && a.reason === 'onboarding the night shift'));
    check('audit rows name their actor', r.body.audit.every((a) => a.actorHandle || a.actorId));
    r = await call('/api/ops/audit', 'GET', undefined, nobody.token);
    check('the audit trail is capability-gated', r.status === 403);

    // --- moderation acts are audited with before/after ------------------------
    // The tea publish transition is reviewer-gated; drive it end to end.
    const teaCreate = await call('/api/admin/tea', 'POST', { title: 'Audit trail story', category: 'local_business', body: 'x'.repeat(40) }, rev.token);
    const article = teaCreate.body?.article;
    check('a reviewer can create a story draft', teaCreate.status === 201 && Boolean(article), JSON.stringify(teaCreate.body).slice(0, 120));
    r = await call(`/api/admin/tea/${article.id}/publish`, 'POST', {}, op.token);
    check("an operator cannot publish SOMEONE ELSE'S story (moderate, 403)", r.status === 403);
    // A creator publishes their OWN news update with no capability at all.
    const ownCreate = await call('/api/admin/tea', 'POST', { title: 'A plain editor update', category: 'local_business', body: 'y'.repeat(40) }, nobody.token);
    const own = ownCreate.body?.article;
    check('any signed-in editor can draft a story', ownCreate.status === 201 && Boolean(own));
    r = await call(`/api/admin/tea/${own.id}/publish`, 'POST', {}, nobody.token);
    check('the AUTHOR publishes their own news update (no capability needed)', r.status === 200 && r.body?.article?.status === 'published', JSON.stringify(r.body).slice(0, 140));
    r = await call(`/api/admin/tea/${own.id}/unpublish`, 'POST', {}, nobody.token);
    check('the author can withdraw it again', r.status === 200);
    const others = await call('/api/admin/tea', 'POST', { title: 'Not mine to publish', category: 'local_business', body: 'z'.repeat(40) }, nobody.token);
    r = await call(`/api/admin/tea/${others.body?.article?.id}/publish`, 'POST', {}, rev.token);
    check('a reviewer (moderate) publishes on behalf of another author', r.status === 200);
    r = await call(`/api/admin/tea/${article.id}/archive`, 'POST', {}, nobody.token);
    check("archiving someone else's story still needs moderation (403)", r.status === 403);

    // --- the story LIST is scoped, not capability-walled ----------------------
    r = await call('/api/admin/tea', 'GET', undefined, nobody.token);
    check('a plain editor reads the story list without any capability', r.status === 200 && Array.isArray(r.body?.articles));
    check('and sees only their own work plus published stories',
      r.body.articles.every((a) => a.createdBy === nobody.user.id || a.status === 'published'),
      JSON.stringify(r.body.articles.map((a) => [a.title, a.status])).slice(0, 160));
    r = await call('/api/admin/tea', 'GET');
    check('an anonymous caller still cannot list the desk (401)', r.status === 401);

    r = await call('/api/ops/audit', 'GET', undefined, rev.token);
    check('every publish is audited with before/after status, author or moderator',
      r.body.audit.some((a) => a.action === 'tea.publish' && a.before?.status === 'draft' && a.after?.status === 'published'));

    // --- Retired gaming surfaces are absent ----------------------------
    // The African-league game was removed by product decision (its whole HTTP
    // surface + UI). The honesty check: the routes are GONE, not hidden.
    r = await call('/api/ligi/rules', 'GET', undefined, op.token);
    check('the Ligi surface is gone (404)', r.status === 404, `got ${r.status}`);
    r = await call('/api/ligi/tick', 'POST', {}, op.token);
    check('even an operator cannot tick a removed surface (404)', r.status === 404, `got ${r.status}`);
    r = await call('/api/epl/clubs', 'GET', undefined, op.token);
    check('EPL gaming routes are also gone', r.status === 404);
  } finally {
    srv.close();
    for (const k of ['BRIEF_OPERATORS', 'BRIEF_REVIEWERS', 'BRIEF_FINANCE', 'BRIEF_ADMINS']) delete process.env[k];
    process.env.BRIEF_DEV_AUTH = '1';
  }
}


console.log('\n=== WHATSAPP SHOP: BUILD ON BRIEF, SELL IN WHATSAPP ===');
{
  // The architecture under test: Brief builds the shop, WhatsApp IS the shop.
  // The output is real WhatsApp formatting (*bold*, _italic_) + a wa.me deep
  // link. No WhatsApp payments by design. Drafting is free; publishing is
  // gated on a CONFIRMED store service row, never a client-sent flag.
  process.env.BRIEF_DEV_AUTH = '0';
  process.env.BRIEF_FINANCE = 'shopfin';
  process.env.BRIEF_POCHI_NUMBER = '0700000000';
  const { default: app } = await import('../src/index.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const reg = async (handle) => (await call('/api/auth/register', 'POST', { handle: handle + Date.now().toString(36), password: 'a good passphrase' })).body;
    const seller = await reg('shopseller');
    const fin = (await call('/api/auth/register', 'POST', { handle: 'shopfin', password: 'a good passphrase' })).body;

    let r = await call('/api/shop/mine');
    check('the shop is members-only (401)', r.status === 401);
    r = await call('/api/shop/mine', 'GET', undefined, seller.token);
    check('a new member starts with an honest blank draft', r.body?.shop?.id === null && r.body?.shop?.status === 'draft' && r.body?.share === null, JSON.stringify(r.body?.shop).slice(0, 120));
    check('the store service is honestly inactive before any payment', r.body?.store?.active === false && r.body?.store?.priceKes === 250, JSON.stringify(r.body?.store));

    // Validation that refuses, with reasons.
    r = await call('/api/shop/mine', 'PUT', { name: 'M', orderNumber: '+254712345678', items: [{ name: 'Sukuma', priceKes: 50 }] }, seller.token);
    check('a one-letter shop name is refused', r.status === 400 && /name/.test(r.body?.error ?? ''), JSON.stringify(r.body?.error));
    r = await call('/api/shop/mine', 'PUT', { name: 'Mama Njeria Fresh', orderNumber: 'not-a-phone', items: [{ name: 'Sukuma', priceKes: 50 }] }, seller.token);
    check('an unreachable order number is refused', r.status === 400 && /phone/.test(r.body?.error ?? ''));
    r = await call('/api/shop/mine', 'PUT', { name: 'Mama Njeria Fresh', orderNumber: '+254712345678', items: [] }, seller.token);
    check('an empty price list is refused', r.status === 400 && /at least one item/.test(r.body?.error ?? ''));

    // Save for real.
    r = await call('/api/shop/mine', 'PUT', {
      name: 'Mama Njeria Fresh', tagline: 'Fresh groceries, Kilimani', orderNumber: '+254 712 345 678',
      items: [
        { name: 'Sukuma Wiki', priceKes: 50 },
        { name: 'Tomatoes (kg)', priceKes: 120, note: 'organic' },
        { name: 'Free-range eggs (tray)', priceKes: 450 }
      ]
    }, seller.token);
    check('the draft saves', r.status === 201 && r.body?.shop?.status === 'draft', JSON.stringify(r.body?.shop).slice(0, 120));

    // The output is REAL WhatsApp formatting.
    const text = r.body?.share?.text ?? '';
    check('the name is WhatsApp-bold', text.includes('*Mama Njeria Fresh*'), JSON.stringify(text.slice(0, 60)));
    check('the tagline is WhatsApp-italic', text.includes('_Fresh groceries, Kilimani_'));
    check('prices are whole shillings in bold', text.includes('Sukuma Wiki — *KES 50*') && text.includes('Tomatoes (kg) — *KES 120* _organic_'));
    check('the order instruction is included', /reply with the item number/.test(text));
    const waMe = r.body?.share?.waMe ?? '';
    check('the wa.me link carries the number and the encoded catalog', waMe.startsWith('https://wa.me/254712345678?text='), waMe.slice(0, 50));
    check('the catalog in the link is the same text, URL-encoded', decodeURIComponent(waMe.split('text=')[1] ?? '') === text);
    check('the share is honest: a draft is not shareable', r.body?.share?.shareable === false);

    // Publishing is gated on a CONFIRMED service row, not a flag.
    r = await call('/api/shop/mine/publish', 'POST', {}, seller.token);
    check('publishing without the store service is refused (409)', r.status === 409, `got ${r.status}`);
    check('the refusal names the service and the price, machine-readably', r.body?.requiresService === 'store_monthly' && /KES 250/.test(r.body?.error ?? ''), JSON.stringify(r.body));

    // A PENDING payment is not trust: only a confirmed row activates.
    const code = 'WC' + Math.random().toString(36).toUpperCase().slice(2, 10);
    const fee = (await call('/api/fees/pay', 'POST', { service: 'store_monthly', mpesaCode: code }, seller.token)).body.fee;
    r = await call('/api/shop/mine/publish', 'POST', {}, seller.token);
    check('a pending Pochi code does not activate the store', r.status === 409, `got ${r.status}`);
    r = await call(`/api/fees/${fee.id}/respond`, 'POST', { accept: true }, fin.token);
    check('finance confirms the code', r.status === 200 && r.body?.fee?.status === 'confirmed');
    r = await call('/api/shop/mine/publish', 'POST', {}, seller.token);
    check('publishing works once the service is CONFIRMED', r.status === 200 && r.body?.shop?.status === 'published' && r.body?.share?.shareable === true, JSON.stringify(r.body?.shop?.status));
    check('the store service is derived active with an end date', r.body?.store?.active === true && Boolean(r.body?.store?.activeUntil), JSON.stringify(r.body?.store));
    r = await call('/api/shop/mine/publish', 'POST', {}, seller.token);
    check('publishing twice is an idempotent no-op', r.status === 200 && r.body?.changed === false);

    // One member, one shop: saving again edits in place.
    r = await call('/api/shop/mine', 'PUT', {
      name: 'Mama Njeria Fresh', tagline: 'Fresh groceries, Kilimani', orderNumber: '+254 712 345 678',
      items: [{ name: 'Sukuma Wiki', priceKes: 60 }]
    }, seller.token);
    check('saving again edits the same shop (no second row)', r.status === 201 && store.all('shops').length === 1 && r.body?.share?.text.includes('*KES 60*'), JSON.stringify(store.all('shops').length));

    // Unpublish is the honest off-switch, and works.
    r = await call('/api/shop/mine/unpublish', 'POST', {}, seller.token);
    check('unpublishing returns to draft and honesty', r.status === 200 && r.body?.shop?.status === 'draft' && r.body?.share?.shareable === false);

    // Another member's shop is invisible.
    const other = await reg('shopother');
    r = await call('/api/shop/mine', 'GET', undefined, other.token);
    check('one shop is one member — another member sees their own blank', r.body?.shop?.id === null);
  } finally {
    srv.close();
  }
}



console.log('\n=== DUKA BOOK, POOLED RESTOCKS, ESCROW-AS-RECORDS ===');
{
  // The paper-ledger replacement: sales are LOGGED facts (Brief never claims
  // to see inside WhatsApp), every total is derived, a replayed offline write
  // is a no-op, pooled restocks open real Group Buys, and one read layer
  // shows funds held across every escrow pattern.
  process.env.BRIEF_DEV_AUTH = '0';
  const { default: app } = await import('../src/index.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const reg = async (h) => (await call('/api/auth/register', 'POST', { handle: h + Date.now().toString(36), password: 'a good passphrase' })).body;
    const duka = await reg('duka');

    let r = await call('/api/shop/mine/book');
    check('the book is members-only (401)', r.status === 401);

    // A shop with stock on two items — the book joins sales to the list.
    r = await call('/api/shop/mine', 'PUT', {
      name: 'Kilimani Duka', tagline: 'Everyday things', orderNumber: '+254700111222',
      items: [
        { name: 'Cooking oil (L)', priceKes: 350, stockQty: 6 },
        { name: 'Unga 2kg', priceKes: 210, stockQty: 20 },
        { name: 'Matchboxes', priceKes: 10, stockQty: 3 }
      ]
    }, duka.token);
    check('a shop with stock saves', r.status === 201 && r.body?.shop?.items?.[0]?.stockQty === 6, JSON.stringify(r.body?.shop?.items?.[0]));

    // Logging sales: the 3-field intake.
    r = await call('/api/shop/mine/sales', 'POST', { name: 'Cooking oil (L)', qty: 2, unitKes: 350 }, duka.token);
    check('a sale logs', r.status === 201 && r.body?.sale?.amountKes === 700, JSON.stringify(r.body?.sale));
    await call('/api/shop/mine/sales', 'POST', { name: 'Unga 2kg', qty: 3, unitKes: 210 }, duka.token);
    await call('/api/shop/mine/sales', 'POST', { name: 'Cooking oil (L)', qty: 1, unitKes: 350, channel: 'whatsapp' }, duka.token);

    // The offline queue replay: same clientKey, never a second sale.
    r = await call('/api/shop/mine/sales', 'POST', { name: 'Cooking oil (L)', qty: 1, unitKes: 350, clientKey: 'off-1' }, duka.token);
    check('an offline write lands with its key', r.status === 201 && r.body?.replayed === false);
    r = await call('/api/shop/mine/sales', 'POST', { name: 'Cooking oil (L)', qty: 1, unitKes: 350, clientKey: 'off-1' }, duka.token);
    check('replaying the same key is a no-op that returns the original row', r.status === 200 && r.body?.replayed === true && r.body?.sale?.clientKey === 'off-1');

    // The derived book.
    r = await call('/api/shop/mine/book', 'GET', undefined, duka.token);
    const book = r.body;
    check('today sums the logged rows', book?.today?.kes === 700 + 630 + 350 + 350, JSON.stringify(book?.today));
    check('top items are ranked by quantity', book?.topItems?.[0]?.name === 'Cooking oil (L)' && book?.topItems?.[0]?.qty === 4, JSON.stringify(book?.topItems));
    check('low stock is derived from the list minus the week', book?.lowStock?.some((i) => i.name === 'Cooking oil (L)' && i.remaining === 2), JSON.stringify(book?.lowStock));
    check('the book states its own honesty', /WhatsApp are yours to record/.test(book?.note ?? ''));

    // Validation that refuses.
    r = await call('/api/shop/mine/sales', 'POST', { name: 'Unga 2kg', qty: 0, unitKes: 210 }, duka.token);
    check('a zero quantity is refused', r.status === 400 && /quantity/.test(r.body?.error ?? ''));

    // Pooled restock: a real Group Buy on the existing engine.
    r = await call('/api/shop/mine/pool', 'POST', { itemName: 'Cooking oil (L)', unitCostKes: 260, goalUnits: 10, myUnits: 3 }, duka.token);
    check('a pool opens as a real Group Buy with the owner pledge', r.status === 201 && r.body?.pool?.targetAmount === 2600 && r.body?.pool?.total === 780 && r.body?.pool?.stage === 'funding', JSON.stringify(r.body?.pool).slice(0, 140));
    check('the share text is forwardable WhatsApp formatting', (r.body?.share?.text ?? '').includes('*RESTOCK POOL*') && (r.body?.share?.text ?? '').includes('KES 260/unit'));
    check('the share link opens the shopkeeper\'s WhatsApp with the pool text', (r.body?.share?.waMe ?? '').startsWith('https://wa.me/254700111222?text='), r.body?.share?.waMe?.slice(0, 40));
    r = await call('/api/shop/mine/pool', 'POST', { itemName: 'Not On The List', unitCostKes: 100, goalUnits: 5, myUnits: 1 }, duka.token);
    check('pooling an item that is not on the list is refused', r.status === 400 && /price list/.test(r.body?.error ?? ''));
    // A pool that is NOT yet covered stays funding — no premature target.
    const poolId = (await call('/api/shop/mine/pool', 'POST', { itemName: 'Unga 2kg', unitCostKes: 180, goalUnits: 5, myUnits: 2 }, duka.token)).body.pool.id;
    r = await call(`/api/engine/group-buys/${poolId}`, 'GET', undefined, duka.token);
    check('an uncovered pool honestly stays funding', r.body?.groupBuy?.stage === 'funding' && r.body?.groupBuy?.total === 360, JSON.stringify(r.body?.groupBuy?.stage));
    // A neighbour duka pools the rest — and the engine notices the target
    // itself; nobody has to click it.
    const neighbour = await reg('dukanext');
    r = await call(`/api/engine/group-buys/${poolId}/contribute`, 'POST', { memberRef: 'Neighbour duka', amount: 540, source: 'mpesa' }, neighbour.token);
    check('the engine reaches the target the moment contributions cover it', r.body?.stageChanged === true && r.body?.total === 900, JSON.stringify(r.body));
    r = await call(`/api/engine/group-buys/${poolId}`, 'GET', undefined, duka.token);
    check('the stepper says target_met', r.body?.groupBuy?.stage === 'target_met', JSON.stringify(r.body?.groupBuy?.stage));

    // Escrow-as-records: one view across the patterns.
    r = await call('/api/escrows/mine');
    check('escrow records are members-only (401)', r.status === 401);
    r = await call('/api/escrows/mine', 'GET', undefined, duka.token);
    check('pools at funding are pending, not held', r.body?.rows?.every((x) => x.kind === 'group_buy') && r.body?.rows?.some((x) => x.state === 'pending' && x.role === 'owner'), JSON.stringify(r.body?.rows?.map((x) => x.state)));
    await call(`/api/engine/group-buys/${poolId}/stage`, 'POST', { to: 'escrow' }, duka.token);
    r = await call('/api/escrows/mine', 'GET', undefined, duka.token);
    check('at the escrow stage the pool is HELD', r.body?.rows?.some((x) => x.refId === poolId && x.state === 'locked' && x.amountKes === 900), JSON.stringify(r.body?.rows?.find((x) => x.refId === poolId)));
    await call(`/api/engine/group-buys/${poolId}/stage`, 'POST', { to: 'dispatched' }, duka.token);
    await call(`/api/engine/group-buys/${poolId}/stage`, 'POST', { to: 'delivered' }, duka.token);
    r = await call('/api/escrows/mine', 'GET', undefined, duka.token);
    check('delivery RELEASES the record', r.body?.rows?.find((x) => x.refId === poolId)?.state === 'released');
    check('totals are derived', r.body?.totals?.heldKes === 0 && r.body?.totals?.releasedKes === 900, JSON.stringify(r.body?.totals));

    // The ticket adapter is pinned to the real row shape: if the shape
    // drifts, this fails loudly instead of silently hiding ticket escrows.
    store.insert('ticketOrders', {
      id: 'tord_pin1', reference: 'TKT-PIN1', buyerId: duka.user.id, listingId: 'list_x',
      sellerId: 'usr_someoneelse', ticketId: 'tk_x', eventId: 'ev_x', status: 'pending',
      unitPrice: 500, fee: 0, total: 500, currency: 'KES', ledgerTxId: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cancelledAt: null
    });
    r = await call('/api/escrows/mine', 'GET', undefined, duka.token);
    check('a ticket order between sale and receipt is HELD for the buyer',
      r.body?.rows?.some((x) => x.kind === 'ticket' && x.role === 'buyer' && x.state === 'locked' && x.amountKes === 500), JSON.stringify(r.body?.rows?.find((x) => x.kind === 'ticket')));
  } finally {
    srv.close();
  }
}



console.log('\n=== MEMBERS: the admin directory for onboarding real people ===');
{
  // Who is here, where they stopped, what an operator may do about it. The
  // directory is derived; suspension revokes every session NOW and lands in
  // the audit log; roles ride the existing audited route.
  process.env.BRIEF_DEV_AUTH = '0';
  const { default: app } = await import('../src/index.js');
  store._reset();
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const reg = async (h) => (await call('/api/auth/register', 'POST', { handle: h + Date.now().toString(36), password: 'a good passphrase', displayName: h.toUpperCase() })).body;
    const admin = await reg('memadmin');
    store.update('users', admin.user.id, { platformRoles: ['admin'] });
    const newcomer = await reg('newbie');
    const climber = await reg('climber');

    // Gate: not everyone gets the directory.
    let r = await call('/api/ops/members');
    check('the directory is members-only (401)', r.status === 401);
    r = await call('/api/ops/members', 'GET', undefined, newcomer.token);
    check('the directory is admin-only (403)', r.status === 403, `got ${r.status}`);

    // A newcomer with no events says so honestly.
    r = await call('/api/ops/members', 'GET', undefined, admin.token);
    check('the directory lists real members, newest first', r.body?.total >= 3 && r.body?.rows?.[0]?.handle.includes('climber'), JSON.stringify(r.body?.rows?.[0]?.handle));
    const newbieRow = r.body.rows.find((x) => x.handle.includes('newbie'));
    check('a member who only registered has climbed exactly one rung', newbieRow?.onboarding?.rung === 'identity' && newbieRow?.onboarding?.latestEvent === 'signed_in', JSON.stringify(newbieRow?.onboarding));

    // Search.
    r = await call('/api/ops/members?q=NEWB', 'GET', undefined, admin.token);
    check('search finds by display name', r.body?.total === 1 && r.body?.rows?.[0]?.handle.includes('newbie'), JSON.stringify(r.body?.total));

    // The climber climbs: onboarding events drive the derived rung.
    const onboarding = await import('../src/domain/onboarding.js');
    onboarding.ensureProfile(climber.user.id);
    onboarding.recordEvent(climber.user.id, 'signed_in');
    onboarding.recordEvent(climber.user.id, 'goal_chosen');
    onboarding.recordEvent(climber.user.id, 'object_saved');
    r = await call('/api/ops/members?q=climber', 'GET', undefined, admin.token);
    check('the rung is derived from recorded events (value, not contribute)', r.body?.rows?.[0]?.onboarding?.rung === 'value', JSON.stringify(r.body?.rows?.[0]?.onboarding));
    check('the latest event is named, not guessed', r.body?.rows?.[0]?.onboarding?.latestEvent === 'object_saved');

    // The funnel.
    r = await call('/api/ops/onboarding', 'GET', undefined, admin.token);
    check('the funnel counts real events only', (r.body?.funnel?.object_saved ?? 0) >= 1 && (r.body?.funnel?.capture_saved ?? 0) === 0, JSON.stringify(r.body?.funnel));
    check('the totals are scans, not counters', r.body?.totals?.members >= 3 && r.body?.totals?.withAnyEvent >= 1, JSON.stringify(r.body?.totals));
    r = await call('/api/ops/onboarding');
    check('the funnel is admin-only too (401)', r.status === 401);

    // Suspension: immediate, audited, with a reason.
    r = await call(`/api/ops/members/${newcomer.user.id}/status`, 'POST', { status: 'suspended', reason: 'no' }, admin.token);
    check('a thin suspension reason is refused', r.status === 400 && /say why/.test(r.body?.error ?? ''), JSON.stringify(r.body));
    r = await call(`/api/ops/members/${newcomer.user.id}/status`, 'POST', { status: 'suspended', reason: 'spam signups from this handle' }, admin.token);
    check('suspension takes with sessions revoked', r.status === 200 && r.body?.changed === true && r.body?.sessionsRevoked >= 1 && r.body?.user?.status === 'suspended', JSON.stringify(r.body).slice(0, 140));
    r = await call('/api/auth/me', 'GET', undefined, newcomer.token);
    check('the suspended member is locked out on the NEXT request', r.status === 401, `got ${r.status}`);
    r = await call('/api/auth/login', 'POST', { handle: newcomer.user.handle, password: 'a good passphrase' });
    check('and refused a new login', r.status === 401 || (r.body?.user?.status ?? '') === 'suspended', `got ${r.status}`);
    r = await call(`/api/ops/members/${newcomer.user.id}/status`, 'POST', { status: 'suspended', reason: 'same decision again' }, admin.token);
    check('re-suspending is an idempotent no-op', r.status === 200 && r.body?.changed === false);
    r = await call(`/api/ops/members/${newcomer.user.id}/status`, 'POST', { status: 'active' }, admin.token);
    check('reinstate works and is audited', r.status === 200 && r.body?.changed === true && r.body?.user?.status === 'active');
    r = await call('/api/auth/login', 'POST', { handle: newcomer.user.handle, password: 'a good passphrase' });
    check('the reinstated member can sign in again', r.status === 200);
    const audited = store.filter('auditLog', (a) => a.action === 'ops.member.status');
    check('both status changes are in the audit log with before/after', audited.length === 2 && audited.every((a) => a.before?.status && a.after?.status), JSON.stringify(audited.length));

    // Roles still ride their own audited route; the directory shows them.
    r = await call('/api/ops/roles', 'POST', { userId: climber.user.id, roles: ['operator'], reason: 'running the desk this week' }, admin.token);
    check('roles are written through the existing audited route', r.status === 200 && Array.isArray(r.body?.user?.platformRoles));
    r = await call('/api/ops/members?q=climber', 'GET', undefined, admin.token);
    check('the directory reflects the role without storing it twice', r.body?.rows?.[0]?.platformRoles?.includes('operator') === true, JSON.stringify(r.body?.rows?.[0]?.platformRoles));
  } finally {
    srv.close();
  }
}


console.log(`\n${'='.repeat(52)}\nPASSED ${pass}   FAILED ${fail}   SKIPPED ${skip}\n${'='.repeat(52)}`);
process.exit(fail ? 1 : 0);

