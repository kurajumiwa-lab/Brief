import crypto from 'node:crypto';
import * as tracking from '../domain/orderTracking.js';
import { requireAuth } from './helpers.js';
import { requireFeature } from '../features.js';

// In-memory, bounded per-IP abuse protection; no email/order values in keys or logs.
const buckets = new Map();
function limit(req, res, kind, max, scope = req.ip) {
  const now = Date.now(),
    key = `${kind}:${crypto.createHash('sha256').update(String(scope)).digest('hex')}`;
  if (buckets.size > 5000)
    for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
  if (!buckets.has(key) && buckets.size >= 10000) {
    res.status(429).json({ error: 'Please try again later.' });
    return false;
  }
  const entry = buckets.get(key);
  const bucket =
    entry && entry.until > now
      ? entry
      : { count: 0, until: now + 10 * 60 * 1000 };
  bucket.count++;
  buckets.set(key, bucket);
  if (bucket.count > max) {
    res.setHeader('Retry-After', Math.ceil((bucket.until - now) / 1000));
    res
      .status(429)
      .json({ error: 'Too many tracking attempts. Please try again later.' });
    return false;
  }
  return true;
}
const run = (res, fn) => {
  try {
    const result = fn();
    if (!res.headersSent) res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
};
export function register(app) {
  const prefix = '/api/public/order-tracking';
  app.use(prefix, requireFeature('commerce'), (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.post(`${prefix}/lookup`, (req, res) => {
    if (limit(req, res, 'lookup', 20))
      run(res, () => tracking.lookup(req.body?.orderNumber, req.body?.email));
  });
  app.post(`${prefix}/read`, (req, res) => {
    if (limit(req, res, 'read-edge', 1000))
      run(res, () => {
        const order = tracking.readToken(req.body?.token);
        if (limit(req, res, 'read-order', 100, order.id))
          return { tracking: tracking.project(order) };
      });
  });
  app.post(`${prefix}/requests`, (req, res) => {
    if (limit(req, res, 'request-edge', 100))
      run(res, () => {
        const order = tracking.readToken(req.body?.token);
        if (limit(req, res, 'request-order', 15, order.id))
          return {
            tracking: tracking.addRequest(req.body?.token, req.body ?? {})
          };
      });
  });
  app.get('/api/orders/:id/tracking', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const me = requireAuth(req, res);
    if (me) run(res, () => tracking.accountTracking(req.params.id, me));
  });
  app.put('/api/orders/:id/delivery-details', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const me = requireAuth(req, res);
    if (me)
      run(res, () =>
        tracking.setDeliveryDetails(req.params.id, me, req.body ?? {})
      );
  });
  app.post('/api/orders/:id/tracking-requests/:requestId', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const me = requireAuth(req, res);
    if (me)
      run(res, () => ({
        tracking: tracking.respond(
          req.params.id,
          req.params.requestId,
          me,
          req.body?.status
        )
      }));
  });
}
