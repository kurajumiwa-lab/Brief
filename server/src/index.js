// ---------------------------------------------------------------------------
// BRIEF INGESTION SERVER
//
// Secrets live here and only here (spec 28). The client never sees a bot
// token, an app secret or a webhook signing key -- it talks to these routes.
//
// ROUTING LAYOUT: this file owns app setup, middleware, frontend serving and
// boot. The 179 API routes live in server/src/routes/*.js -- one module per
// domain -- and are mounted below. A feature is independently integrable:
// add/remove a single mount line, and the module owns its own routes, imports
// and local guards.
// ---------------------------------------------------------------------------

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { store } from './store.js';
import * as auth from './domain/auth.js';
import * as ops from './ops.js';
import * as workflow from './domain/workflow.js';
import * as intake from './domain/engine/intake.js';
import * as engineReview from './domain/engine/review.js';
import * as deadLetters from './domain/engine/deadLetters.js';
import * as schedules from './domain/engine/schedules.js';
import * as campaigns from './domain/campaign.js';
import * as ledger from './domain/ledger.js';
import * as telegram from './connectors/telegram.js';
import * as whatsapp from './connectors/whatsapp.js';
import * as scheduler from './pipeline/scheduler.js';
import * as calendar from './domain/calendar.js';
import * as shopBrief from './domain/shopBrief.js';
import * as demoSeed from './domain/seed.js';
import { authStatus } from './identity.js';
import { recordError } from './routes/helpers.js';
import { callerId } from './identity.js';
import { register as authRoutes } from './routes/auth.js';
import { register as onboardingRoutes } from './routes/onboarding.js';
import { register as personalRoutes } from './routes/personal.js';
import { register as entitiesRoutes } from './routes/entities.js';
import { register as graphRoutes } from './routes/graph.js';
import { register as healthRoutes } from './routes/health.js';
import { register as opsRoutes } from './routes/ops.js';
import { register as quoteRoutes } from './routes/quotes.js';
import { register as workOrderRoutes } from './routes/workOrders.js';
import { register as matchingRoutes } from './routes/matching.js';
import { register as supplyRoutes } from './routes/supply.js';
import { register as externalPlacesRoutes } from './routes/externalPlaces.js';
import { register as requestsRoutes } from './routes/requests.js';
import { register as sourcesRoutes } from './routes/sources.js';
import { register as connectorsRoutes } from './routes/connectors.js';
import { register as briefitRoutes } from './routes/briefit.js';
import { register as objectsRoutes } from './routes/objects.js';
import { register as notificationsRoutes } from './routes/notifications.js';
import { register as groupWorkspaceRoutes } from './routes/groupWorkspaces.js';
import { register as spaceModerationRoutes } from './routes/spaceModeration.js';
import { register as circlesRoutes } from './routes/circles.js';
import { register as guardianRoutes } from './routes/guardians.js';
import { register as triageRoutes } from './routes/triage.js';
import { register as economicRoutes } from './routes/economic.js';
import { register as feesRoutes } from './routes/fees.js';
import { register as shopRoutes } from './routes/shop.js';
import { register as shopBriefRoutes } from './routes/shopBrief.js';
import { register as referralsRoutes } from './routes/referrals.js';
import { register as productReviewRoutes } from './routes/productReviews.js';
import { register as orderTrackingRoutes } from './routes/orderTracking.js';
import { register as commerceRoutes } from './routes/commerce.js';
import { register as commandRoutes } from './routes/command.js';
import { register as campaignsRoutes } from './routes/campaigns.js';
import { register as ticketMarketRoutes } from './routes/ticketmarket.js';
import { register as verificationRoutes } from './routes/verification.js';
import { register as eventsRoutes } from './routes/events.js';
import { register as bannersRoutes } from './routes/banners.js';
import { register as vaultsRoutes } from './routes/vaults.js';
import { register as peopleRoutes } from './routes/people.js';
import { register as teaRoutes } from './routes/tea.js';
import { register as wireRoutes } from './routes/wire.js';
import { register as mediaRoutes } from './routes/media.js';
import { register as feedRoutes } from './routes/feed.js';
import { register as settlementRoutes } from './settlement/routes.js';
import { start as startSettlementReconciler } from './settlement/reconciler.js';
import { register as collectionsRoutes } from './routes/collections.js';
import { register as personalCollectionsRoutes } from './routes/personalCollections.js';
import { register as searchRoutes } from './routes/search.js';
import { register as assistRoutes } from './routes/assist.js';
import { register as distributionRoutes } from './routes/distribution.js';
import { register as workflowRoutes } from './routes/workflow.js';
import { register as creatorRoutes } from './routes/creator.js';
import { register as advertisingRoutes } from './routes/advertising.js';
import { register as calendarRoutes } from './routes/calendar.js';
import { register as hudumaRoutes } from './routes/huduma.js';
import { register as engineRoutes } from './routes/engine.js';
import { register as coopRoutes } from './routes/coop.js';
import { register as groupBuyRoutes } from './routes/groupbuy.js';
import { register as spacesRoutes } from './routes/spaces.js';
import { register as procurementRoutes } from './routes/procurement.js';
import { register as participantTrustRoutes } from './routes/participantTrust.js';
import { register as workPaymentRoutes } from './routes/workPayment.js';
import { register as attributionRoutes } from './routes/attribution.js';
import { register as partnerRoutes } from './routes/partner.js';
import { register as fieldAgentRoutes } from './routes/fieldAgent.js';
import { register as workforceRoutes } from './routes/workforce.js';
import { register as lipaMdogoRoutes } from './routes/lipaMdogo.js';
import { register as tableBankingRoutes } from './routes/tableBanking.js';
import { register as rolesRoutes } from './routes/roles.js';
import { register as gapsRoutes } from './routes/gaps.js';
import { register as priceSignalsRoutes } from './routes/priceSignals.js';
import { register as pulseRoutes } from './routes/pulse.js';
import { register as precedentRoutes } from './routes/precedent.js';
import { register as errandsRoutes } from './routes/errands.js';
import { register as worldRoutes } from './routes/world.js';
import { register as businessFeedRoutes } from './routes/businessFeed.js';
import { register as discoverRoutes } from './routes/discover.js';
import { register as pickupsRoutes } from './routes/pickups.js';
import { register as positionRoutes } from './routes/position.js';
import { register as commitmentsRoutes } from './routes/commitments.js';
import { register as reciprocityRoutes } from './routes/reciprocity.js';

// Refuse an insecure production environment before binding a public port.
// The development identity is also impossible to activate in auth.js itself.
if (process.env.NODE_ENV === 'production') {
  if (process.env.BRIEF_DEV_AUTH === '1') throw new Error('BRIEF_DEV_AUTH=1 is forbidden in production');
  if (!process.env.BRIEF_DATA_DIR) throw new Error('BRIEF_DATA_DIR is required in production (mount a persistent volume)');
}

const app = express();

// HTML-escape for meta-tag injection: a campaign title or description is
// user-authored and must never break out of an attribute/string context.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The compiled React/Vite frontend, served by Express in production. Resolved
// from THIS file's location (server/src) so it is correct regardless of the
// deployment working directory (/app, /app/server, or anywhere else): the
// build always lands at <repo>/preview/dist.
const FRONTEND_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), // server/src
  '..', '..', 'preview', 'dist'
);

// Raw body retained for webhook signature verification -- the HMAC must be
// computed over the exact bytes Meta sent, not a re-serialized object.
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));
// The public page's one form (an abuse report) is a plain HTML POST, so it
// arrives urlencoded, not as JSON. 32kb is plenty for 500 characters of words.
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use((req, res, next) => {
  // Same-origin clients need no CORS headers. Explicit cross-origin clients
  // must be listed by the operator; wildcard reads amplify bearer-token XSS.
  const allowed = [process.env.BRIEF_PUBLIC_ORIGIN, ...(process.env.BRIEF_CORS_ORIGINS ?? '').split(',')]
    .map(value => { try { return new URL(value.trim()).origin; } catch { return null; } });
  res.vary('Origin');
  if (req.headers.origin && allowed.includes(req.headers.origin)) {
    res.setHeader('access-control-allow-origin', req.headers.origin);
    res.setHeader('access-control-allow-headers', 'content-type,authorization,x-telegram-bot-api-secret-token,x-hub-signature-256');
    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  }
  next();
});
app.options('*', (req, res) => req.headers.origin && !res.getHeader('access-control-allow-origin')
  ? res.sendStatus(403) : res.sendStatus(204));

// The production client calls the API under the /ingest prefix (the dev server
// strips it with a Vite proxy; in production Express serves the API directly).
// Strip the prefix here so /ingest/api/* resolves exactly like /api/*. This is
// a no-op for the dev server, whose proxy never forwards the prefix.
app.use((req, _res, next) => {
  if (req.url.startsWith('/ingest')) {
    req.url = req.url.slice('/ingest'.length) || '/';
  }
  next();
});

// Demo content is a temporary welcome cohort, not a permanent fixture layer.
// Expiry runs opportunistically before every request so a seven-day test window
// disappears even when the deployment has no cron worker. Real user rows never
// carry the demo batch marker and are untouched.
app.use((_req, _res, next) => {
  try { demoSeed.expireSeed(); } catch { /* diagnostics/read paths must stay live */ }
  next();
});

// Resolve the bearer token (or cookie) into a verified identity BEFORE any
// route runs. Sets req.auth, or req.authError when a token was presented and
// failed. Every authority check reads this through identity.callerId().
app.use(auth.authMiddleware);
// Structured request logs. Records method/route/status/duration/actor -- never
// bodies, tokens or query strings.
app.use(ops.requestLogger);

// ---------------------------------------------------------------------------
// THE APP GATE (product decision, 2026-08-29): no access without an account.
//
// Every /api route now requires a signed-in session. The exceptions are the
// surfaces that must work for a person who has no account YET, or for the
// outside world:
//   /api/auth/*            sign-in itself (register, login, google, providers)
//   /api/public/campaigns/*  the EXTERNAL share face (QR / WhatsApp links) --
//                           gating it would break the product's purpose
//   /api/health, /api/readiness  ops probes
//   /api/media/file/*      images referenced by the public share pages
//   /api/media/telegram/*  Telegram image references resolved at render time
//                          for public feed cards (object id is an unlisted
//                          handle; the route still enforces publication=public)
// Everything else -- feed, objects, signals -- answers 401 until the
// caller has an account. The client enforces the same rule with a wall; this
// is the enforcement that actually matters.
// ---------------------------------------------------------------------------
//   /api/config, /api/release  version/metadata probes the client shakes
//                           hands with at boot, before any account exists
//   /api/ready               deploy-platform health checks
//   /api/email-subscriptions  the newsletter surface -- subscribing and
//                           UNSUBSCRIBING must work account-less (privacy)
//   /api/webhooks/*          machine-to-machine inbound callbacks (Telegram,
//                           WhatsApp, payment rail). Each verifies its OWN
//                           credential (secret header, HMAC signature, or a
//                           secret path segment), so it must not ALSO demand a
//                           Brief session -- a provider callback has no Brief
//                           account. This is what lets a real Telegram update
//                           reach the ingestion pipeline in production.
//   /api/telegram/init       Telegram Mini App auth -- the HMAC initData is
//                           the credential; no Brief session exists yet.
//   /api/huduma/webhooks/*   M-Pesa Daraja callbacks, secret path segment.
//   /api/locations*, /api/graph/*, /api/nearby  the LOCAL ACTIVITY GRAPH
//                           (public location discovery pages like /explore/
//                           kilimani, related content, nearby) — every payload
//                           is the public projection of public objects only
// Groups directory is an opt-in metadata-only projection, never a workspace.
const PUBLIC_WITHOUT_SESSION = /^\/(auth|entities|locations|graph|nearby|collections\/personal|public\/(campaigns|feed|enterprises|capabilities|spaces|order-tracking|product-reviews)|groups\/directory|circles\/join|health|ready|readiness|media\/(file|telegram)|config|release|email-subscriptions|webhooks|telegram\/init|huduma\/webhooks|price-signals|pulse|world|discover\/(summary|business))(\/|$)/;
app.use('/api', (req, res, next) => {
  // Wanderly browse is a public, allowlisted listing projection (no attendee
  // identities or owner IDs). Only these GETs; authoring still needs a session.
  if (req.method === 'GET' && /^\/events(?:\/categories)?\/?$/.test(req.path)) return next();
  if (PUBLIC_WITHOUT_SESSION.test(req.path)) return next();
  const me = callerId(req);
  if (me) return next();
  return res.status(401).json({
    error: req.authError === 'expired' ? 'your session has expired, please sign in again' : 'authentication required',
    code: req.authError ?? 'no_token',
    gate: 'account_required'
  });
});

// ---------------------------------------------------------------------------
// ROUTE MOUNTS -- one per domain module.
// ---------------------------------------------------------------------------
authRoutes(app);
onboardingRoutes(app);
personalRoutes(app);
entitiesRoutes(app);
graphRoutes(app);
healthRoutes(app);
opsRoutes(app);
requestsRoutes(app);
supplyRoutes(app);
externalPlacesRoutes(app);
matchingRoutes(app);
quoteRoutes(app);
workOrderRoutes(app);
sourcesRoutes(app);
connectorsRoutes(app);
briefitRoutes(app);
objectsRoutes(app);
notificationsRoutes(app);
circlesRoutes(app);
spaceModerationRoutes(app);
groupWorkspaceRoutes(app);
guardianRoutes(app);
triageRoutes(app);
economicRoutes(app);
feesRoutes(app);
shopRoutes(app);
shopBriefRoutes(app);
referralsRoutes(app);
commerceRoutes(app);
orderTrackingRoutes(app);
productReviewRoutes(app);
commandRoutes(app);
campaignsRoutes(app);
ticketMarketRoutes(app);
verificationRoutes(app);
eventsRoutes(app);
bannersRoutes(app);
vaultsRoutes(app);
peopleRoutes(app);
teaRoutes(app);
wireRoutes(app);
mediaRoutes(app);
feedRoutes(app);
collectionsRoutes(app);
personalCollectionsRoutes(app);
searchRoutes(app);
assistRoutes(app);
distributionRoutes(app);
workflowRoutes(app);
creatorRoutes(app);
advertisingRoutes(app);
calendarRoutes(app);
hudumaRoutes(app);
engineRoutes(app);
coopRoutes(app);
groupBuyRoutes(app);
spacesRoutes(app);
procurementRoutes(app);
participantTrustRoutes(app);
workPaymentRoutes(app);
attributionRoutes(app);
partnerRoutes(app);
fieldAgentRoutes(app);
workforceRoutes(app);
lipaMdogoRoutes(app);
tableBankingRoutes(app);
rolesRoutes(app);
gapsRoutes(app);
priceSignalsRoutes(app);
pulseRoutes(app);
precedentRoutes(app);
errandsRoutes(app);
discoverRoutes(app);
businessFeedRoutes(app);
worldRoutes(app);
pickupsRoutes(app);
positionRoutes(app);
commitmentsRoutes(app);
reciprocityRoutes(app);
settlementRoutes(app);

// The settlement reconciler is NOT started here. It is installed below, beside
// the other five sweeps, inside the NODE_ENV !== 'test' guard — a sweep started
// at import time is carried by every process that imports the app, tests
// included. See settlement/reconciler.js.

// --- Production frontend serving -------------------------------------------
//
// In production Express serves the compiled Vite build (FRONTEND_DIST) and
// falls back to index.html for client-side routes. This is a no-op when the
// build does not exist (development/test), so the API-only server behaves
// exactly as it always has.
// Serve the compiled frontend whenever the build exists.
//
// Deliberately NOT gated on NODE_ENV: Railway/nixpacks does not reliably set
// NODE_ENV=production, and gating on it silently disabled frontend serving so
// the deployed site returned 404 on '/'. The build's presence is the only
// honest signal — if the Vite output exists, serve it; if not, the API-only
// server behaves exactly as before.
const servingFrontend = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));

if (servingFrontend) {
  const indexHtml = fs.readFileSync(path.join(FRONTEND_DIST, 'index.html'), 'utf8');

  // Open Graph / social preview injection.
  //
  // Link crawlers (WhatsApp, Telegram, X, Facebook) do NOT run JavaScript, so
  // the SPA's static index.html shows no preview. This route renders a small
  // HTML shell for /c/:slug with og:*/twitter:* meta filled from the campaign's
  // publicView, then still loads the same SPA bundle so a real browser gets the
  // full app. No private data is emitted: only the public projection.
  app.get('/c/:slug', (req, res) => {
    const c = campaigns.getPublicBySlug(req.params.slug);
    if (!c) {
      // Not found / not public: fall through to the SPA shell, which renders
      // its honest "not available" state.
      return res.type('html').send(indexHtml);
    }
    const pv = campaigns.publicView(c);
    const title = pv.title;
    const desc = pv.description || 'A gathering on Brief';
    const origin = process.env.BRIEF_PUBLIC_ORIGIN
      ? process.env.BRIEF_PUBLIC_ORIGIN.replace(/\/+$/, '')
      : null;
    const url = origin ? `${origin}/c/${pv.slug}` : null;
    const image = pv.image ?? null;

    const tags = [
      `<meta property="og:type" content="website" />`,
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
      `<meta property="og:description" content="${escapeHtml(desc)}" />`,
      `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
      `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
      `<meta name="twitter:description" content="${escapeHtml(desc)}" />`,
      ...(url ? [`<meta property="og:url" content="${escapeHtml(url)}" />`] : []),
      // Only a real image is emitted -- never a placeholder.
      ...(image ? [
        `<meta property="og:image" content="${escapeHtml(image)}" />`,
        `<meta name="twitter:image" content="${escapeHtml(image)}" />`
      ] : [])
    ].join('\n    ');

    const html = indexHtml.replace(
      /<title>.*?<\/title>/,
      `<title>${escapeHtml(title)}</title>\n    ${tags}`
    );
    res.type('html').send(html);
  });

  // CloudBites is a public, opt-in concept landing page. Give non-JS link
  // previews an accurate title and description without pretending that its
  // sample menu, discount or courier network is already live.
  app.get(['/cloudbites', '/cloudbites/'], (_req, res) => {
    const title = 'CloudBites — a delivery-only kitchen concept on Brief';
    const desc = 'Explore a sample workday lunch menu and illustrative Nairobi delivery areas. Ordering is not live.';
    const html = indexHtml.replace(/<title>.*?<\/title>/,
      `<title>${escapeHtml(title)}</title>\n    <meta name="description" content="${escapeHtml(desc)}" />\n    <meta property="og:title" content="${escapeHtml(title)}" />\n    <meta property="og:description" content="${escapeHtml(desc)}" />`);
    res.type('html').send(html);
  });

  // Static assets: JS/CSS bundles, images, etc. `index: false` so '/' is
  // handled by the explicit fallback below rather than a silent directory
  // serve, and so an asset miss is not masked by a directory index.
  app.use(express.static(FRONTEND_DIST, {
    index: false,
    setHeaders: (res, filePath) => {
      // Telegram Mini Apps cache index.html hard. A stale shell keeps serving
      // the previous hashed bundle, so UI fixes never appear in the WebView.
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    }
  }));

  // Replay the SAME source-controlled brand cards, not a second static demo.
  app.get(['/intro', '/intro/', '/intro/index.html'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type('html').send(indexHtml);
  });

  // SPA fallback: any GET that is neither the API nor a real asset resolves to
  // index.html, so client-side routes (e.g. /marketplace) do not 404.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next(); // API miss: 404 as API, never the SPA shell
    if (req.path.includes('.')) return next();       // a real asset request; 404 if absent
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

// When no frontend build is present, '/' returns an actionable message instead
// of Express's bare "Cannot GET /" — the operator sees what is missing and how
// to fix it.
if (!servingFrontend) {
  app.get('/', (_req, res) => {
    res.status(503).type('text/plain').send(
      'Brief is running (API only). The frontend build is missing.\n' +
      `Expected at: ${FRONTEND_DIST}\n` +
      'Run `npm run build:client` at deploy time (railway.json buildCommand).\n'
    );
  });
}

// A failing connector must never take Brief down (spec 30).
app.use((err, _req, res, _next) => {
  // A body express could not parse is a CLIENT error. Returning 500 made
  // retry-on-5xx senders (Telegram, Meta) replay a payload that can never
  // succeed. The message stays generic -- no stack traces, no internals.
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    recordError('server', null, 'malformed request body');
    return res.status(400).json({ error: 'malformed request body' });
  }
  // Body larger than the configured limit is also a client error.
  if (err?.type === 'entity.too.large') {
    recordError('server', null, 'request body too large');
    return res.status(413).json({ error: 'request body too large' });
  }
  recordError('server', null, String(err?.message ?? err));
  res.status(500).json({ error: 'internal error' });
});

const PORT = process.env.PORT || 8787;
if (process.env.NODE_ENV !== 'test') {
  // Persistence net: bring back the latest snapshot if the data file is gone
  // (e.g. a fresh deploy on Railway's ephemeral filesystem with a re-attached
  // volume), and take rolling snapshots so a crash or forced kill never loses
  // more than the last interval. The graceful-shutdown backup still runs too.
  // store.js recovered the primary before any domain imported live rows.
  ops.installPeriodicBackup(store, {
    intervalMs: Number(process.env.BRIEF_BACKUP_INTERVAL_MS) || 15 * 60 * 1000
  });
  // THE OPERATIONS ENGINE (EVENT-ENGINE.md §7). One tick does four things:
  // react to what happened (signals after the cursor), fire what is due, retry
  // what broke, and look at what has been sitting in a state too long. It is
  // idempotent by design and OFF in tests (NODE_ENV=test).
  //
  // Boot recovery first: an `intakeEvents` row left `processing` is the
  // residue of a crash, and leaving it invisible is the failure mode this
  // engine exists to remove.
  intake.recoverStale();
  // The engine's own rules are ROWS, seeded once by slug: a restart re-asserts
  // the defaults without duplicating them, and never reverts an operator's edit.
  workflow.ensureDefaultRules();
  workflow.installSweep({
    intervalMs: Number(process.env.BRIEF_WORKFLOW_INTERVAL_MS) || 60 * 1000
  });
  // Calendar/wait-list and advertiser expiration share the same durable
  // domain rules. This timer is a worker hook in the JSON adapter; production
  // should replace it with a claimed database job.
  calendar.installSweep({
    intervalMs: Number(process.env.BRIEF_CALENDAR_INTERVAL_MS) || 60 * 1000
  });
  // The morning brief: an hourly-by-default look at the owners who ASKED for a
  // brief, each gated on their own chosen hour and deduped to one per day.
  // Nothing is sent to anyone who never asked, and nothing at all is sent for a
  // day whose rows are empty. See domain/shopBrief.js.
  shopBrief.installSweep({
    intervalMs: Number(process.env.BRIEF_SHOPBRIEF_INTERVAL_MS) || 15 * 60 * 1000
  });
  // Web/RSS ingestion: poll enabled sources on a cadence so feeds arrive
  // without a manual sync. Idempotent (dedup by source+item), per-source
  // isolated, and off in tests.
  scheduler.installPoller({
    intervalMs: Number(process.env.BRIEF_INGEST_INTERVAL_MS) || 15 * 60 * 1000
  });
  // The settlement reconciler: hourly sweep for stuck rail attempts. Boot-time
  // start is safe — it only reads and escalates, never transitions money. It
  // lives here with the other sweeps rather than at import time so that a
  // process importing the app under NODE_ENV=test carries no hourly timer; the
  // timer is unref'd as well, so the two mistakes cannot recur together.
  startSettlementReconciler();

  const server = app.listen(PORT, '0.0.0.0', () => {
    const diag = ops.startupDiagnostics({
      store, capabilities: { payments: ledger.providerStatus() }
    });
    ops.logInfo('server_started', { port: Number(PORT), env: diag.env, dataFile: diag.dataFile });
    // Say, in one line, whether the frontend is being served and from where —
    // a 404-on-"/" deployment is diagnosed instantly instead of at 3am.
    ops.logInfo('frontend_serving', {
      serving: servingFrontend,
      dist: FRONTEND_DIST,
      reason: servingFrontend ? null : `no build found at ${FRONTEND_DIST} — run \`npm run build:client\``
    });
    ops.logInfo('connectors', {
      telegram: telegram.isConfigured(),
      whatsapp: whatsapp.isConfigured(),
      payments: ledger.providerConfigured(),
      auth: authStatus().configured,
    });
    // The synchronous `configured` flag above is only half the truth. Fire the
    // verified getMe + getWebhookInfo round trip once at boot so an operator
    // sees whether Telegram is genuinely operational (token valid + webhook
    // installed), without blocking startup. Never logs the token.
    if (telegram.isConfigured()) {
      telegram.status().then((s) => {
        ops.logInfo('telegram_status', {
          operational: s.operational,
          bot: s.bot?.username ?? null,
          webhookUrl: s.webhook?.url ?? null,
          pendingUpdateCount: s.webhook?.pendingUpdateCount ?? null,
          diagnostic: s.diagnostic ?? null
        });
      }).catch((e) => {
        // status() is designed not to throw, but a boot-time probe must never
        // become an unhandled rejection that shows up as a crash.
        ops.logWarn('telegram_status_check_failed', { message: String(e?.message ?? e) });
      });
    }
    // Anything that would surprise an operator is said out loud at boot,
    // rather than discovered at the first real payment.
    for (const p of diag.problems) ops.logError('startup_problem', { problem: p });
    for (const n of diag.notes) ops.logWarn('startup_note', { note: n });
  });

  // Finish in-flight requests before exiting, and take a final backup so a
  // deploy always leaves a restorable snapshot behind.
  ops.installGracefulShutdown(server, {
    onShutdown: () => { try { ops.backup(store); } catch { /* never block exit */ } }
  });
}

export default app;
