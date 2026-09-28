// SPACES ROUTES (Brief 2.0 — The Digital Landlord)
//
// Exposes the Space domain over HTTP.
// Identity is always caller-authoritative; pricing is server-derived.
import * as shopTeam from '../domain/shopTeam.js';
import { callerId } from '../identity.js';
import { store } from '../store.js';
import * as spaces from '../domain/space.js';
import * as spaceProfileDomain from '../domain/spaceProfile.js';
import * as audience from '../domain/spaceAudience.js';
import * as page from '../domain/spacePublicPage.js';
import * as outbound from '../outbound.js';
import { requireAuthMw, recordError } from './helpers.js';

/**
 * The origin a shared link should carry. Only ever an origin the deployment
 * STATEMENT supplies (BRIEF_PUBLIC_ORIGIN): deriving it from a Host header
 * would let a stranger print another hostname on a business's page, and a
 * Railway app hostname is not something to engrave on a sticker. Without it the
 * page still renders — it simply omits the canonical link rather than guessing.
 */
function publicOrigin() {
  const raw = process.env.BRIEF_PUBLIC_ORIGIN;
  return raw ? String(raw).replace(/\/+$/, '') : null;
}

/** A page is a mirror, so it must never be cached into a stale reflection. */
function noCacheHtml(res, status = 200) {
  res.status(status);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.type('html');
}

/** A space row by slug or id — both, because a printed sticker and an API call
 *  reach the same place, and a page must answer for whichever a caller has. */
function requireSpace(slugOrId) {
  const key = String(slugOrId ?? '').trim();
  if (!key) return null;
  return store.find('spaces', (s) => s.slug === key || s.id === key) ?? null;
}

export function register(app) {
  const teamCall = (fn) => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status ?? 400).json({ error: e.message }); } };
  app.get('/api/shop-teams', requireAuthMw, teamCall(req => ({ shops: shopTeam.myTeams(callerId(req)) })));
  app.get('/api/spaces/:id/team', requireAuthMw, teamCall(req => shopTeam.view(req.params.id, callerId(req))));
  app.post('/api/spaces/:id/team/members', requireAuthMw, teamCall(req => shopTeam.setMember(req.params.id, callerId(req), req.body ?? {})));
  app.patch('/api/spaces/:id/team/brand', requireAuthMw, teamCall(req => shopTeam.editBrand(req.params.id, callerId(req), req.body ?? {})));

  // --- THE PUBLIC FACE: a real, server-rendered page per public Space -------
  //
  // Rendered here, not inside the React bundle, for one reason: the sharing
  // channel is a WhatsApp status, and link previews do not execute JavaScript.
  // The same projection backs the API, so the page and the directory can never
  // disagree about a price or an hour.
  app.get('/s/:slug', (req, res) => {
    const row = requireSpace(req.params.slug);
    if (!row || row.visibility !== 'public' || row.status !== 'active') {
      const info = page.unavailableReason(req.params.slug);
      noCacheHtml(res, info.status);
      return res.send(page.renderUnavailable(info, { origin: publicOrigin() }));
    }
    const view = page.publicPageView(row, { origin: publicOrigin() });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type('html').status(200).send(page.renderPage(view));
    // One view row per opening of the page, and nowhere else. A fetch of the
    // JSON API is not somebody looking at the shop, so it does not record.
    audience.recordView(row.id, { viewerId: callerId(req) });
  });

  // The same page as data: what the in-app mirror renders, and what anybody who
  // wants to build on the projection can read. It records a view, because a page
  // opening is what a view IS — whether the HTML was rendered here or the same
  // rows were read by the app. The directory card read does NOT record: scrolling
  // past a name is not walking up to a shop.
  app.get('/api/public/spaces/:slug/page', (req, res) => {
    const row = requireSpace(req.params.slug);
    if (!row || row.visibility !== 'public' || row.status !== 'active') {
      return res.status(404).json({ error: 'space not found', note: 'A private space has no public page.' });
    }
    audience.recordView(row.id, { viewerId: callerId(req) });
    const view = page.publicPageView(row, { origin: publicOrigin() });
    // A follow is that person's own row, so it may come back to them — and only
    // to them. Without this, a page offers "Follow" to someone already following.
    const me = callerId(req);
    res.json({ space: me ? { ...view, following: audience.isFollowing(row.id, me) } : view });
  });

  // The only write a stranger may make against a public page: a report row.
  // Accepts a plain form post so the page needs no JavaScript, and answers
  // with HTML that states exactly what happened (and what did not).
  app.post('/s/:slug/report', (req, res) => {
    const reason = (req.body ?? {}).reason;
    const result = page.reportSpace(req.params.slug, {
      reason: typeof reason === 'string' ? reason : '',
      reporterId: callerId(req)
    });
    if (result.error) {
      noCacheHtml(res, result.status ?? 400);
      return res.send(page.renderNote({ heading: 'That report was not recorded.', line: result.error }));
    }
    noCacheHtml(res, 200);
    return res.send(page.renderNote({ heading: 'Reported.', line: result.note }));
  });

  // Index of live public pages. Only when the deployment states its own origin,
  // because a sitemap must contain absolute URLs — an invented hostname would be
  // a claim about whose site these pages are on.
  app.get('/sitemap-spaces.xml', (_req, res) => {
    const origin = publicOrigin();
    if (!origin) {
      // RETURN, or the send below runs too and Express throws
      // "cannot set headers after they are sent" — found by booting the built
      // app locally, not by a suite: a response that is already half-sent makes
      // any test that only reads the status code look fine.
      return res.status(503).type('text/plain').send(
        'This Brief deployment has not declared its public origin (BRIEF_PUBLIC_ORIGIN), so it will not publish a sitemap of absolute URLs.'
      );
    }
    const rows = page.publicSlugs();
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/xml').status(200).send(page.sitemapXml(origin, rows));
  });

  // --- The PUBLIC DIRECTORY: every public, active space, for discovery and
  // collaboration. No session required; the projection is the safe public one. ---
  app.get('/api/public/spaces', (req, res) => {
    const mode = String(req.query?.mode ?? '').trim();
    const rows = spaces.listPublicSpaces(Number(req.query?.limit) || 50, mode ? { mode } : {});
    res.json({
      spaces: rows,
      // Sent so a directory can render the arms it can filter by and nothing
      // else. An empty directory still gets the taxonomy, because the reason it
      // is empty is not a missing category.
      modes: spaces.SPACE_MODES,
      filtered: mode ? { mode, modeLabel: spaces.modeLabel(mode) } : null
    });
  });

  // --- ONE public space, by slug: the DIRECTORY card. It deliberately does not
  // record a view — a view belongs to a page opening (see /s/:slug and
  // /api/public/spaces/:slug/page), and counting a card fetch would inflate the
  // one number the vendor is shown.
  app.get('/api/public/spaces/:slug', (req, res) => {
    const view = spaces.findPublicSpace(req.params.slug);
    if (!view) return res.status(404).json({ error: 'space not found' });
    // The follow state is that person's own row, so it may be returned to them.
    // Without this a page would offer "Follow" to someone already following.
    const me = callerId(req);
    res.json({ space: me ? { ...view, following: audience.isFollowing(view.id, me) } : view });
  });

  // The owner's own read of their public face: the link to paste, what a
  // stranger sees, and any reports filed. Member-scoped, never public.
  app.get('/api/spaces/:id/public-page', requireAuthMw, (req, res) => {
    try {
      const raw = requireSpace(req.params.id);
      if (!raw) return res.status(404).json({ error: 'space not found' });
      const me = callerId(req);
      if (raw.ownerId !== me) return res.status(403).json({ error: 'only the owner can read this' });
      const live = raw.visibility === 'public' && raw.status === 'active';
      res.json({
        // The mirror is what the owner sees here — the same projection a
        // stranger gets, so they cannot be shown a better shop than they have.
        view: live ? page.publicPageView(raw, { origin: publicOrigin() }) : null,
        path: `/s/${raw.slug ?? raw.id}`,
        originDeclared: Boolean(publicOrigin()),
        open: live,
        moderation: raw.publicPageModeration?.hidden ? { hidden: true, hiddenAt: raw.publicPageModeration.hiddenAt } : null,
        reason: raw.publicPageModeration?.hidden
          ? 'This public page is hidden following review. Only an authorized reviewer may reinstate it. Selling and existing orders are unchanged.'
          : !live
          ? raw.status !== 'active'
            ? 'This space is archived, so its page is down.'
            : `This space is ${raw.visibility ?? 'private'}, so it has no public page.`
          : null,
        reports: page.reportsForSpace(raw.id),
        note: 'The page is a mirror of this space. Edit the space; the page follows. Nothing here is editable from the page.'
      });
    } catch (err) {
      res.status(400).json({ error: String(err.message ?? err) });
    }
  });

  // --- The owner's audience panel: followers, broadcasts, insights, templates
  app.get('/api/spaces/:id/audience', requireAuthMw, (req, res) => {
    try {
      const space = spaces.getRawSpace(req.params.id);
      if (!space) return res.status(404).json({ error: 'space not found' });
      const me = callerId(req);
      if (space.ownerId !== me) {
        // A non-owner gets only what a stranger may see, never the numbers.
        return res.json({ ...audience.publicExtras(space), canManage: false, insights: null });
      }
      res.json(audience.audienceView(space, { viewerId: me }));
    } catch (err) {
      res.status(400).json({ error: String(err.message ?? err) });
    }
  });

  app.post('/api/spaces/:id/follow', requireAuthMw, (req, res) => {
    const result = audience.followSpace(req.params.id, callerId(req));
    if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
    res.json(result);
  });

  app.delete('/api/spaces/:id/follow', requireAuthMw, (req, res) => {
    const result = audience.unfollowSpace(req.params.id, callerId(req));
    if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
    res.json(result);
  });

  app.post('/api/spaces/:id/broadcasts', requireAuthMw, (req, res) => {
    const result = audience.postBroadcast(req.params.id, {
      actorId: callerId(req), text: (req.body ?? {}).text, kind: (req.body ?? {}).kind ?? 'update'
    });
    if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
    res.status(201).json(result);
  });

  app.delete('/api/spaces/:id/broadcasts/:broadcastId', requireAuthMw, (req, res) => {
    const result = audience.deleteBroadcast(req.params.broadcastId, { actorId: callerId(req) });
    if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
    res.json(result);
  });

  app.get('/api/spaces/:id/templates', requireAuthMw, (req, res) => {
    res.json({ templates: audience.templatesFor(req.params.id) });
  });

  app.post('/api/spaces/:id/templates', requireAuthMw, (req, res) => {
    const result = audience.createTemplate(req.params.id, {
      actorId: callerId(req), label: (req.body ?? {}).label, body: (req.body ?? {}).body
    });
    if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
    res.status(201).json({ ...result, templates: audience.templatesFor(req.params.id) });
  });

  app.patch('/api/spaces/:id/templates/:templateId', requireAuthMw, (req, res) => {
    const result = audience.updateTemplate(req.params.templateId, {
      actorId: callerId(req), label: (req.body ?? {}).label, body: (req.body ?? {}).body
    });
    if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
    res.json({ ...result, templates: audience.templatesFor(req.params.id) });
  });

  app.delete('/api/spaces/:id/templates/:templateId', requireAuthMw, (req, res) => {
    const result = audience.deleteTemplate(req.params.templateId, { actorId: callerId(req) });
    if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
    res.json({ ...result, templates: audience.templatesFor(req.params.id) });
  });

  app.patch('/api/spaces/:id/featured', requireAuthMw, (req, res) => {
    try {
      const updated = spaces.setFeatured(req.params.id, {
        callerId: callerId(req), listingIds: (req.body ?? {}).listingIds ?? []
      });
      if (!updated) return res.status(404).json({ error: 'space not found' });
      res.json({ space: updated });
    } catch (err) {
      res.status(400).json({ error: String(err.message ?? err) });
    }
  });

  // --- List caller's spaces ---
  app.get('/api/spaces', (req, res) => {
    try {
      const me = callerId(req);
      if (!me) {
        return res.json({ spaces: [] });
      }
      const mode = String(req.query?.mode ?? '').trim();
      const list = spaces.listSpacesForOwner(me, mode ? { mode } : {});
      res.json({
        spaces: list,
        // The taxonomy comes from the server, so a client that groups by mode
        // cannot invent one, and a mode nobody offered is never silently filed
        // under "other".
        modes: spaces.SPACE_MODES,
        filtered: mode ? { mode, modeLabel: spaces.modeLabel(mode) } : null,
        note: 'Grouped by the arm of the business its owner named. A space with no mode is unstated, not retail.'
      });
    } catch (err) {
      recordError('spaces_list_failed', err);
      res.status(500).json({ error: 'failed to list spaces' });
    }
  });

  // The spaces this member follows. Public projections only.
  app.get('/api/spaces/followed/mine', requireAuthMw, (req, res) => {
    const me = callerId(req);
    const rows = audience.followedSpaces(me);
    res.json({
      spaces: rows.map((r) => ({ ...spaces.publicSpaceView(r.space), followedAt: r.followedAt })),
      note: 'A card appears because you followed it. Unfollow it and it disappears here.'
    });
  });

  // --- Create a new space ---
  app.post('/api/spaces', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const { name, type, mode, goal, targetValueKes, image, visibility, initialOffer, profile } = req.body || {};

      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Space name is required' });
      }

      const created = spaces.createSpace({
        ownerId: me,
        name,
        type,
        // Which arm of the business. Validated by the domain, not here, so the
        // refusal wording is the same whether it arrives on create or PATCH.
        mode,
        goal,
        targetValueKes,
        image,
        visibility,
        initialOffer,
        // The genesis set — validated + timestamped by the profile domain, so a
        // client cannot write a fake "confirmed today" stamp.
        spaceProfile: profile ?? null
      });

      res.status(201).json({ space: created });
    } catch (err) {
      recordError('space_create_failed', err);
      res.status(400).json({ error: err.message || 'failed to create space' });
    }
  });

  // --- The space SCHEMA: its definition, its answers, and what they imply ---
  // The field list comes from the server so the wizard and the workspace render
  // the same questions the pipeline reads. Nothing is invented client-side.
  app.get('/api/spaces/profile-schema', (_req, res) => {
    res.json({ fields: spaces.spaceProfileSchema() });
  });

  // --- Get space by ID ---
  app.get('/api/spaces/:id', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      res.setHeader('Cache-Control', 'no-store');
      // This is the full owner workspace (conversations, activity and money),
      // not a public profile. Staff use /team; visitors use /public/spaces.
      const raw = spaces.getRawSpace(req.params.id);
      if (!raw || raw.ownerId !== me) return res.status(404).json({ error: 'space not found' });
      const space = spaces.getSpace(req.params.id, { callerId: me });
      if (!space) {
        return res.status(404).json({ error: 'space not found' });
      }
      // The taxonomy travels with the row it describes, so an editor that lets
      // an owner name their arm of the business never has to keep its own copy
      // of the list — and can never offer an arm the server would refuse.
      res.json({ space, modes: spaces.SPACE_MODES });
    } catch (err) {
      recordError('space_get_failed', err);
      res.status(500).json({ error: 'failed to get space' });
    }
  });

  // --- Update a space ---
  app.delete('/api/spaces/:id', requireAuthMw, (req, res) => {
    try {
      const result = spaces.deleteSpace(req.params.id, { callerId: callerId(req) });
      if (!result) return res.status(404).json({ error: 'space not found' });
      res.json(result);
    } catch (e) {
      res.status(403).json({ error: String(e.message ?? e) });
    }
  });

  app.get('/api/spaces/:id/operating', requireAuthMw, (req, res) => {
    try {
      const view = spaces.getSpaceOperating(req.params.id, { callerId: callerId(req) });
      if (!view) return res.status(404).json({ error: 'space not found' });
      res.json(view);
    } catch (err) {
      const status = /not authorized/i.test(err.message ?? String(err)) ? 403 : 400;
      res.status(status).json({ error: err.message || 'failed to read the space profile' });
    }
  });

  app.patch('/api/spaces/:id/profile', requireAuthMw, (req, res) => {
    try {
      const result = spaceProfileDomain.setProfile(req.params.id, {
        callerId: callerId(req),
        fields: (req.body || {}).fields ?? (req.body || {})
      });
      if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
      res.json({
        space: spaces.getSpace(req.params.id, { callerId: callerId(req) }),
        changed: result.changed,
        confirmed: result.confirmed
      });
    } catch (err) {
      recordError('space_profile_update_failed', err);
      res.status(400).json({ error: err.message || 'failed to update the space profile' });
    }
  });

  // "Still true." A confirmation is a real event with a timestamp — it is NOT a
  // silent reset of a countdown and it does not pretend to be new information.
  app.post('/api/spaces/:id/profile/:key/confirm', requireAuthMw, (req, res) => {
    try {
      const result = spaceProfileDomain.confirmField(req.params.id, req.params.key, { callerId: callerId(req) });
      if (result.error) return res.status(result.status ?? 400).json({ error: result.error });
      res.json({ space: spaces.getSpace(req.params.id, { callerId: callerId(req) }) });
    } catch (err) {
      recordError('space_profile_confirm_failed', err);
      res.status(400).json({ error: err.message || 'failed to confirm that answer' });
    }
  });

  app.patch('/api/spaces/:id', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const updated = spaces.updateSpace(req.params.id, req.body || {}, { callerId: me });
      if (!updated) {
        return res.status(404).json({ error: 'space not found' });
      }
      res.json({ space: updated });
    } catch (err) {
      recordError('space_update_failed', err);
      res.status(400).json({ error: err.message || 'failed to update space' });
    }
  });

  // --- Create an offer inside a space ---
  app.post('/api/spaces/:id/offers', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const { title, description, price, currency, type, images, quantityAvailable } = req.body || {};

      if (!title || price === undefined) {
        return res.status(400).json({ error: 'title and price are required' });
      }

      const listing = spaces.createSpaceOffer(req.params.id, {
        title,
        description,
        price,
        currency,
        type,
        images,
        quantityAvailable,
        callerId: me
      });

      res.status(201).json({ offer: listing });
    } catch (err) {
      recordError('space_offer_create_failed', err);
      res.status(400).json({ error: err.message || 'failed to create offer' });
    }
  });

  // --- Publish an offer inside a space ---
  app.post('/api/spaces/:id/offers/:offerId/publish', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const published = spaces.publishSpaceOffer(req.params.id, req.params.offerId, { callerId: me });
      res.json({ offer: published });
    } catch (err) {
      recordError('space_offer_publish_failed', err);
      res.status(400).json({ error: err.message || 'failed to publish offer' });
    }
  });

  // --- List space activities ---
  app.get('/api/spaces/:id/activities', (req, res) => {
    try {
      const limit = parseInt(req.query.limit || '50', 10);
      const activities = spaces.getSpaceActivities(req.params.id, { limit });
      res.json({ activities });
    } catch (err) {
      recordError('space_activities_failed', err);
      res.status(500).json({ error: 'failed to get activities' });
    }
  });

  // --- Record a custom space activity ---
  app.post('/api/spaces/:id/activities', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const { kind, title, description, metadata } = req.body || {};
      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }

      const act = spaces.recordSpaceActivity({
        spaceId: req.params.id,
        kind: kind || 'note',
        title,
        description,
        metadata,
        actorId: me
      });

      res.status(201).json({ activity: act });
    } catch (err) {
      recordError('space_activity_record_failed', err);
      res.status(400).json({ error: err.message || 'failed to record activity' });
    }
  });

  // --- Get space conversations ---
  app.get('/api/spaces/:id/conversations', requireAuthMw, (req, res) => {
    try {
      const convs = spaces.getSpaceConversations(req.params.id);
      res.json({ conversations: convs });
    } catch (err) {
      recordError('space_conversations_failed', err);
      res.status(500).json({ error: 'failed to get conversations' });
    }
  });

  // --- Create conversation (Customer enquiry) ---
  app.post('/api/spaces/:id/conversations', (req, res) => {
    try {
      const { offerId, customerName, customerContact, message } = req.body || {};

      if (!customerName || !message) {
        return res.status(400).json({ error: 'customerName and message are required' });
      }

      const conv = spaces.createSpaceConversation({
        spaceId: req.params.id,
        offerId,
        customerName,
        customerContact,
        message
      });

      res.status(201).json({ conversation: conv });
    } catch (err) {
      recordError('space_conversation_create_failed', err);
      res.status(400).json({ error: err.message || 'failed to create conversation' });
    }
  });

  // --- Post message in conversation ---
  app.post('/api/spaces/:id/conversations/:convId/messages', requireAuthMw, async (req, res) => {
    try {
      const me = callerId(req);
      const { text, sender, from } = req.body || {};
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: 'Message text is required' });
      }
      const f = from || 'owner';

      // Two-way WhatsApp: an owner/seller reply to a customer who has a known
      // WhatsApp number is dispatched out through the outbound seam (Meta
      // Cloud API direct, or a BSP fallback). The delivery result is stored on
      // the message, never fabricated — no provider => an honest "not sent".
      let whatsappDelivery = null;
      const existing = spaces.getSpaceConversation(req.params.convId);
      if (existing && (f === 'owner' || f === 'seller') && existing.customerContact) {
        whatsappDelivery = await outbound.send({
          channel: 'whatsapp',
          to: existing.customerContact,
          text: String(text).trim()
        });
      }

      const conv = spaces.postSpaceMessage({
        spaceId: req.params.id,
        conversationId: req.params.convId,
        text,
        sender: sender || 'Seller',
        from: f,
        callerId: me,
        whatsappDelivery
      });

      res.json({ conversation: conv, whatsappDelivery });
    } catch (err) {
      recordError('space_message_post_failed', err);
      res.status(400).json({ error: err.message || 'failed to post message' });
    }
  });

  // --- Send Quote in conversation ---
  app.post('/api/spaces/:id/conversations/:convId/quote', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const { title, priceKes, notes } = req.body || {};
      if (!title || !priceKes) {
        return res.status(400).json({ error: 'title and priceKes are required' });
      }

      const quote = spaces.createSpaceQuote({
        spaceId: req.params.id,
        conversationId: req.params.convId,
        title,
        priceKes,
        notes,
        callerId: me
      });

      res.status(201).json({ quote });
    } catch (err) {
      recordError('space_quote_create_failed', err);
      res.status(400).json({ error: err.message || 'failed to create quote' });
    }
  });

  // --- Trigger M-Pesa STK Prompt ---
  app.post('/api/spaces/:id/conversations/:convId/mpesa-prompt', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const { quoteId, phoneNumber, amountKes, description } = req.body || {};
      if (!amountKes) {
        return res.status(400).json({ error: 'amountKes is required' });
      }

      const prompt = spaces.triggerMpesaPrompt({
        spaceId: req.params.id,
        conversationId: req.params.convId,
        quoteId,
        phoneNumber,
        amountKes,
        description,
        callerId: me
      });

      res.status(201).json({ prompt });
    } catch (err) {
      recordError('space_mpesa_prompt_failed', err);
      res.status(400).json({ error: err.message || 'failed to trigger M-Pesa prompt' });
    }
  });

  // --- Complete M-Pesa Payment & Auto-Convert to Order ---
  app.post('/api/spaces/:id/conversations/:convId/mpesa-complete', (req, res) => {
    try {
      const { paymentRequestId, mpesaReceipt, amountPaid } = req.body || {};
      if (!paymentRequestId) {
        return res.status(400).json({ error: 'paymentRequestId is required' });
      }

      const result = spaces.completeMpesaPayment({
        spaceId: req.params.id,
        conversationId: req.params.convId,
        paymentRequestId,
        mpesaReceipt,
        amountPaid
      });

      res.json(result);
    } catch (err) {
      recordError('space_mpesa_complete_failed', err);
      res.status(400).json({ error: err.message || 'failed to complete M-Pesa payment' });
    }
  });

  // --- Inbound WhatsApp Webhook Router ---
  app.post('/api/spaces/:id/whatsapp/inbound', (req, res) => {
    try {
      const { from, customerName, text, offerId } = req.body || {};
      if (!from || !text) {
        return res.status(400).json({ error: 'from phone and text are required' });
      }

      const conversation = spaces.routeInboundWhatsAppMessage({
        spaceId: req.params.id,
        from,
        customerName: customerName || 'WhatsApp Customer',
        text,
        offerId
      });

      res.status(201).json({ conversation });
    } catch (err) {
      recordError('space_whatsapp_inbound_failed', err);
      res.status(400).json({ error: err.message || 'failed to route WhatsApp message' });
    }
  });

  // --- Get Space Money & Duka Ledger Summary ---
  app.get('/api/spaces/:id/money', requireAuthMw, (req, res) => {
    try {
      const summary = spaces.getSpaceMoneySummary(req.params.id);
      res.json({ money: summary });
    } catch (err) {
      recordError('space_money_summary_failed', err);
      res.status(500).json({ error: 'failed to get money summary' });
    }
  });

  // --- Record an Expense / Supply Cost ---
  app.post('/api/spaces/:id/expenses', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const { category, description, amountKes, date } = req.body || {};
      if (!description || !amountKes) {
        return res.status(400).json({ error: 'description and amountKes are required' });
      }

      const expense = spaces.recordSpaceExpense({
        spaceId: req.params.id,
        category,
        description,
        amountKes,
        date,
        callerId: me
      });

      res.status(201).json({ expense });
    } catch (err) {
      recordError('space_expense_record_failed', err);
      res.status(400).json({ error: err.message || 'failed to record expense' });
    }
  });

  // --- List Space Expenses ---
  app.get('/api/spaces/:id/expenses', requireAuthMw, (req, res) => {
    try {
      const expenses = spaces.getSpaceExpenses(req.params.id);
      res.json({ expenses });
    } catch (err) {
      recordError('space_expenses_list_failed', err);
      res.status(500).json({ error: 'failed to list expenses' });
    }
  });

  // --- Record a Customer Credit Tab (DukaBook) ---
  app.post('/api/spaces/:id/tabs', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const { customerName, customerContact, amountKes, note } = req.body || {};
      if (!customerName || !amountKes) {
        return res.status(400).json({ error: 'customerName and amountKes are required' });
      }

      const tab = spaces.recordCustomerTab({
        spaceId: req.params.id,
        customerName,
        customerContact,
        amountKes,
        note,
        callerId: me
      });

      res.status(201).json({ tab });
    } catch (err) {
      recordError('space_tab_record_failed', err);
      res.status(400).json({ error: err.message || 'failed to record customer tab' });
    }
  });

  // --- Record Payment on Customer Tab ---
  app.post('/api/spaces/:id/tabs/:tabId/payments', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const { amountKes, note } = req.body || {};
      if (!amountKes) {
        return res.status(400).json({ error: 'amountKes is required' });
      }

      const updatedTab = spaces.recordTabPayment({
        spaceId: req.params.id,
        tabId: req.params.tabId,
        amountKes,
        note,
        callerId: me
      });

      res.json({ tab: updatedTab });
    } catch (err) {
      recordError('space_tab_payment_failed', err);
      res.status(400).json({ error: err.message || 'failed to record tab payment' });
    }
  });

  // --- List Customer Tabs ---
  app.get('/api/spaces/:id/tabs', requireAuthMw, (req, res) => {
    try {
      const tabs = spaces.getSpaceTabs(req.params.id);
      res.json({ tabs });
    } catch (err) {
      recordError('space_tabs_list_failed', err);
      res.status(500).json({ error: 'failed to list customer tabs' });
    }
  });

  // --- Create an Inter-County Cargo Dispatch ---
  app.post('/api/spaces/:id/dispatches', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const {
        orderId,
        destinationCounty,
        destinationTown,
        carrierSacco,
        waybillRef,
        receiverName,
        receiverPhone,
        conductorContact,
        stageFeeKes,
        notes, deliveryMode, estimatedDelivery, quantity
      } = req.body || {};

      const dispatch = spaces.createSpaceDispatch({
        spaceId: req.params.id,
        orderId,
        destinationCounty,
        destinationTown,
        carrierSacco,
        waybillRef,
        receiverName,
        receiverPhone,
        conductorContact,
        stageFeeKes,
        notes, deliveryMode, estimatedDelivery, quantity,
        callerId: me
      });

      res.status(201).json({ dispatch });
    } catch (err) {
      recordError('space_dispatch_create_failed', err);
      res.status(400).json({ error: err.message || 'failed to create cargo dispatch' });
    }
  });

  // --- List Space Dispatches ---
  app.get('/api/spaces/:id/dispatches', requireAuthMw, (req, res) => {
    try {
      const space = store.find('spaces', s => s.id === req.params.id && s.ownerId === callerId(req));
      if (!space) return res.status(404).json({ error: 'Space not found' });
      const dispatches = spaces.getSpaceDispatches(req.params.id);
      res.json({ dispatches });
    } catch (err) {
      recordError('space_dispatches_list_failed', err);
      res.status(500).json({ error: 'failed to list dispatches' });
    }
  });

  // --- Update Dispatch Status ---
  app.patch('/api/spaces/:id/dispatches/:dispatchId', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const { status, conductorContact, location, estimatedDelivery } = req.body || {};

      const updated = spaces.updateDispatchStatus({
        spaceId: req.params.id,
        dispatchId: req.params.dispatchId,
        status,
        conductorContact, location, estimatedDelivery,
        callerId: me
      });

      res.json({ dispatch: updated });
    } catch (err) {
      recordError('space_dispatch_update_failed', err);
      res.status(400).json({ error: err.message || 'failed to update dispatch' });
    }
  });

  // --- Create order from space ---
  app.post('/api/spaces/:id/orders', requireAuthMw, (req, res) => {
    try {
      const me = callerId(req);
      const { offerId, customerId, customerName, quantity, deliveryNotes } = req.body || {};

      if (!offerId) {
        return res.status(400).json({ error: 'offerId is required' });
      }

      const order = spaces.createSpaceOrder({
        spaceId: req.params.id,
        offerId,
        customerId,
        customerName,
        quantity: quantity || 1,
        deliveryNotes,
        callerId: me
      });

      res.status(201).json({ order });
    } catch (err) {
      recordError('space_order_create_failed', err);
      res.status(400).json({ error: err.message || 'failed to create order' });
    }
  });
}
