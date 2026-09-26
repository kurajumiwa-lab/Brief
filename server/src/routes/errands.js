// ---------------------------------------------------------------------------
// ERRANDS ROUTES — the lobby board over real rows.
//
// Reading the board is open to any signed-in member. ACCEPTING is not: the
// domain checks a real record as a field agent, partner or rider and answers
// 403 with the reason and the way to change it, so the client never has to
// guess — and never renders an "Accept" button that the server would refuse.
//
// The carrier roster is deliberately NOT served here. A count is enough for a
// poster to know whether anyone is around; names are only ever exchanged once a
// carrier takes the errand (see the view: carrierName appears after acceptance).
// ---------------------------------------------------------------------------

import * as errands from '../domain/errands.js';
import { requireAuth } from './helpers.js';

const send = (res, result, key = 'errand') => {
  if (result?.error) {
    return res.status(result.status ?? 400).json({
      error: result.error,
      ...(result.eligibility ? { eligibility: result.eligibility } : {})
    });
  }
  return res.json(result ?? {});
};

export function register(app) {
  app.get('/api/errands/eligibility', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const gate = errands.canCarry(me);
    res.json({ ...gate, carriersAround: errands.carryBoard().length });
  });

  app.get('/api/errands/providers', (_req, res) => {
    res.json(errands.providers());
  });

  app.get('/api/errands', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    // The tile list comes from the server, so the grid and the store can never
    // disagree about what kinds exist. A client-side copy would be a second
    // taxonomy that drifts the first time one of them is edited.
    const kind = req.query.kind ?? null;
    res.json({
      open: errands.listErrands({ kind, viewerId: me, status: 'open' }),
      mine: errands.myErrands(me),
      eligibility: errands.canCarry(me),
      carriersAround: errands.carryBoard().length,
      carriers: errands.carryBoard(),
      kinds: errands.ERRAND_KINDS,
      filtered: kind != null && String(kind) !== '' && String(kind) !== 'any',
      stages: errands.LOOP_STAGES
    });
  });

  app.post('/api/errands', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const b = req.body ?? {};
    send(res, errands.postErrand({
      actorId: me,
      what: b.what,
      pickup: b.pickup,
      dropoff: b.dropoff,
      whenNeeded: b.whenNeeded,
      offeredFeeKes: b.offeredFeeKes,
      note: b.note,
      sizeOrWeight: b.sizeOrWeight,
      kind: b.kind
    }));
  });

  app.get('/api/errands/stated-fees', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    res.json({ fees: errands.listStatedFees({}) });
  });

  app.get('/api/errands/:id', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const row = errands.getErrand(req.params.id, me);
    if (!row) return res.status(404).json({ error: 'errand not found' });
    res.json({ errand: row });
  });

  const advance = (path, fn) => {
    app.post(path, (req, res) => {
      const me = requireAuth(req, res);
      if (!me) return;
      send(res, fn(req.params.id, me, req.body ?? {}));
    });
  };

  advance('/api/errands/:id/accept', (id, me) => errands.acceptErrand(id, { carrierId: me }));
  advance('/api/errands/:id/picked', (id, me) => errands.markPicked(id, { actorId: me }));
  advance('/api/errands/:id/delivered', (id, me, body) => errands.markDelivered(id, { actorId: me, photo: body.photo }));
  advance('/api/errands/:id/pod', (id, me, body) => errands.attachPod(id, { actorId: me, photo: body.photo }));
  advance('/api/errands/:id/position', (id, me, body) => errands.sharePosition(id, { actorId: me, lat: body.lat, lon: body.lon, accuracy: body.accuracy }));
  advance('/api/errands/:id/cancel', (id, me, body) => errands.cancelErrand(id, { actorId: me, reason: body.reason }));
  advance('/api/errands/:id/settle', (id, me) => errands.confirmSettled(id, { actorId: me }));
  advance('/api/errands/:id/rate', (id, me, body) => errands.rateErrand(id, { actorId: me, stars: body.stars, note: body.note }));
}
