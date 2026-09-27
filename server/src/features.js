// ---------------------------------------------------------------------------
// FEATURE REGISTRY
//
// The single authority on "is this feature on, and can it actually run?".
//
//   key         stable name (also the deploy-toggle key)
//   domain      which route module owns it
//   label       human-readable, for the capabilities table
//   configured  a FUNCTION over live state -- provider credentials, never a
//               stored flag -- so it can never drift from reality
//
// Three states compose:
//   enabled      deploy-time switch: BRIEF_DISABLED_FEATURES=a,b,c turns a
//                feature off without a code change (routes 503 at the edge).
//   configured   runtime availability: does it have what it needs to run?
//   available    enabled && configured
//
// "Shelf space" (report §4.2): an unwired feature sits in this table, visible
// and toggleable, and its `configured` is false until its credentials exist.
// The requireFeature() guard removes a DISABLED feature from the request path;
// the provider-backed features keep their richer, tested domain-level 503s for
// "not configured" -- this registry reports that state, it does not duplicate
// it.
// ---------------------------------------------------------------------------

import * as providers from './providers.js';
import * as outbound from './outbound.js';
import * as telegram from './connectors/telegram.js';
import * as whatsapp from './connectors/whatsapp.js';

const DEFINITIONS = [
  { key: 'work_orders', domain: 'workOrders', label: 'Work and fulfillment coordination', configured: () => true },
  { key: 'request_quotes', domain: 'quotes', label: 'Request commercial proposals', configured: () => true },
  { key: 'request_matching', domain: 'matching', label: 'Demand-to-capability matching', configured: () => true },
  { key: 'supply', domain: 'supply', label: 'Enterprises and capabilities', configured: () => true },
  { key: 'requests', domain: 'requests', label: 'Business requests', configured: () => true },
  { key: 'repeat_procurement', domain: 'procurement', label: 'Repeat procurement memory', configured: () => true },
  { key: 'participant_trust', domain: 'participantTrust', label: 'Participant trust & economic history', configured: () => true },
  { key: 'attribution', domain: 'attribution', label: 'Distribution provenance (partner/program/cohort/invite)', configured: () => true },
  { key: 'partner', domain: 'partner', label: 'Distribution partners & revenue share', configured: () => true },
  { key: 'field_agents', domain: 'fieldAgent', label: 'Field agents & territory overrides', configured: () => true },
  { key: 'workforce', domain: 'workforce', label: 'Workforce: onboarding, territories, work programs, proof & settlement', configured: () => true },
  { key: 'lipa_mdogo', domain: 'lipaMdogo', label: 'Asset-financing records & collection (Lipa Mdogo)', configured: () => true },
  { key: 'table_banking', domain: 'tableBanking', label: 'Table banking (contributions, rotation, loans)', configured: () => true },
  // Always-configured: these run on the local store and need no credential.
  { key: 'auth',      domain: 'auth',       label: 'Accounts & sessions',             configured: () => true },
  { key: 'onboarding',domain: 'onboarding', label: 'Onboarding & service ladder',     configured: () => true },
  { key: 'sources',   domain: 'sources',    label: 'Sources',                         configured: () => true },
  { key: 'connectors',domain: 'connectors', label: 'Ingest connectors (web/RSS)',     configured: () => true },
  { key: 'briefit',   domain: 'briefit',    label: 'Capture ("Brief It")',            configured: () => true },
  { key: 'objects',   domain: 'objects',    label: 'Objects, discovery & trust',      configured: () => true },
  { key: 'circles',   domain: 'circles',    label: 'Circles, blocks & signals',       configured: () => true },
  { key: 'triage',    domain: 'triage',     label: 'The waiting-on-you queue',        configured: () => true },
  { key: 'economic',  domain: 'economic',   label: 'Ledger & transactions',           configured: () => true },
  { key: 'commerce',  domain: 'commerce',   label: 'Commerce (vendors/listings/orders)', configured: () => true },
  { key: 'campaigns', domain: 'campaigns',  label: 'Campaigns, registration & gate',  configured: () => true },
  { key: 'vaults',    domain: 'vaults',     label: 'The Vault (context layer)',       configured: () => true },
  { key: 'command',   domain: 'command',    label: 'Host command centre',             configured: () => true },
  { key: 'people',    domain: 'people',     label: 'Person entity (timeline & identity)', configured: () => true },
  { key: 'tea',       domain: 'tea',        label: 'Tea editorial system',              configured: () => true },
  { key: 'wire',      domain: 'wire',       label: 'Kenya + world news wire',           configured: () => true },
  { key: 'media',     domain: 'media',      label: 'Media association & image library',  configured: () => true },
  { key: 'feed',      domain: 'feed',       label: 'Composed home feed',                 configured: () => true },
  { key: 'collections', domain: 'collections', label: 'Editorial collections',           configured: () => true },
  { key: 'search',     domain: 'search',      label: 'Cross-entity search',              configured: () => true },
  { key: 'assist',     domain: 'assist',      label: 'AI-assisted editorial drafting',    configured: () => true },
  { key: 'distribution', domain: 'distribution', label: 'Campaign blast + UTM attribution',  configured: () => true },
  { key: 'workflows',  domain: 'workflow',    label: 'Automation engine (trigger/condition/action)', configured: () => true },
  { key: 'partnership', domain: 'creator',    label: 'Media kit, partnership, inbox & subscriptions', configured: () => true },
  // Yard Engine shelves. These are local logic and can be disabled independently
  // without removing the existing creator/event/commerce paths.
  { key: 'creator_profiles', domain: 'creator', label: 'Creator profiles & rate cards', configured: () => true },
  { key: 'advertising', domain: 'advertising', label: 'Advertiser campaigns & matching', configured: () => true },
  { key: 'matching', domain: 'advertising', label: 'Creator matching & reservations', configured: () => true },
  { key: 'ad_assets', domain: 'advertising', label: 'Ad assets & distribution kits', configured: () => true },
  { key: 'calendar', domain: 'calendar', label: 'Calendar & waiting lists', configured: () => true },
  { key: 'vendor_syndication', domain: 'vendor', label: 'Vendor capabilities & syndication', configured: () => true },
  // Provider-backed: configured derives from LIVE credentials, never stored flag.
  { key: 'payments',  domain: 'commerce',   label: 'Payment collection (KCB Buni M-Pesa STK)',   configured: () => providers.providerStatus().configured },
  { key: 'payouts',   domain: 'commerce',   label: 'Merchant payouts (disbursement)', configured: () => providers.providerStatus().payoutConfigured },
  { key: 'outbound',  domain: 'connectors', label: 'Outbound messaging',              configured: () => outbound.status().anyConfigured },
  { key: 'telegram',  domain: 'connectors', label: 'Telegram ingest',                 configured: () => telegram.isConfigured() },
  { key: 'whatsapp',  domain: 'connectors', label: 'WhatsApp ingest',                 configured: () => whatsapp.isConfigured() },
  // HudumaLink: the WhatsApp + M-Pesa distributed action layer. It runs its
  // full conversational + order + escrow state machines without any credential
  // (those run against the local store); `configured` reports whether the live
  // outbound + payment + crypto seams are wired, which the routes surface as an
  // honest 503 rather than faking a send or a charge.
  { key: 'huduma', domain: 'huduma', label: 'HudumaLink (WhatsApp + M-Pesa services)',
    configured: () => true },
  // Engine: sync core + universal router + tier guardrails. Runs against the
  // local store; the router's webhook signing and outbound channels fail
  // closed (named, honest) until their credentials exist.
  { key: 'engine', domain: 'engine', label: 'Engine (sync + router + tiers)', configured: () => true },
  // Mshikano: the peer-to-peer cooperation network. Local store, no
  // credential needed; every trust number derives from confirmed rows.
  { key: 'mshikano', domain: 'coop', label: 'Mshikano cooperation network', configured: () => true }
];

const byKey = new Map(DEFINITIONS.map((d) => [d.key, d]));

/** The deploy-time disable list, read fresh so tests and ops can change it live. */
function disabledList() {
  const raw = process.env.BRIEF_DISABLED_FEATURES || '';
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

export function isEnabled(key) {
  return byKey.has(key) && !disabledList().has(key);
}

export function isConfigured(key) {
  const def = byKey.get(key);
  if (!def) return false;
  try { return Boolean(def.configured()); } catch { return false; }
}

/** enabled && configured -- the one answer "can a user use this right now?". */
export function available(key) {
  return isEnabled(key) && isConfigured(key);
}

/** One feature's public state, for the capabilities table. */
export function featureState(key) {
  const def = byKey.get(key);
  return {
    key,
    label: def.label,
    domain: def.domain,
    enabled: isEnabled(key),
    configured: isConfigured(key),
    available: available(key)
  };
}

export function list() {
  return [...byKey.keys()].map(featureState);
}

/** The whole table plus the disabled keys, for /api/capabilities. */
export function status() {
  const features = list();
  return {
    features,
    disabled: features.filter((f) => !f.enabled).map((f) => f.key)
  };
}

/**
 * Express guard for a deploy-time-disabled feature. A disabled feature 503s at
 * the edge so it leaves the request path without a code change. It deliberately
 * does NOT gate on `configured`: provider-backed features keep their richer,
 * tested domain-level "not configured" responses -- this guard is only the
 * deploy switch.
 */
export function requireFeature(key) {
  return (req, res, next) => {
    if (!isEnabled(key)) {
      return res.status(503).json({ error: `feature disabled: ${key}`, feature: key, disabled: true });
    }
    next();
  };
}
