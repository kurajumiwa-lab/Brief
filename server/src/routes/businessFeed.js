import { callerId } from '../identity.js';
import { requireAuth } from './helpers.js';
import { requireFeature } from '../features.js';
import * as feed from '../domain/businessFeed.js';
const buckets = new Map();
function send(res, fn) {
  try {
    res.json(fn());
  } catch (e) {
    if (e.status) res.status(e.status).json({ error: e.message });
    else {
      console.error('Business feed unavailable', e);
      res
        .status(503)
        .json({
          error: 'Discovery could not be loaded or saved. Please retry.'
        });
    }
  }
}
export function register(app) {
  app.use(
    '/api/discover/business',
    (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      res.vary('Authorization');
      next();
    },
    requireFeature('feed')
  );
  app.get('/api/discover/business', (req, res) =>
    send(res, () => feed.feed(callerId(req), req.query))
  );
  const write = (fn) => (req, res) => {
    const actor = requireAuth(req, res);
    if (!actor) return;
    const now = Date.now();
    for (const [key, b] of buckets) if (b.until < now) buckets.delete(key);
    if (buckets.size >= 5000 && !buckets.has(actor)) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'Please retry later.' });
    }
    const b = buckets.get(actor) || { count: 0, until: now + 60000 };
    b.count++;
    buckets.set(actor, b);
    if (b.count > 120) {
      res.setHeader('Retry-After', Math.ceil((b.until - now) / 1000));
      return res
        .status(429)
        .json({ error: 'Too many changes. Please wait a moment.' });
    }
    send(res, () => fn(actor, req.body || {}));
  };
  app.put(
    '/api/discover/business/preferences',
    write((actor, body) => ({
      preferences: feed.updatePreferences(actor, body)
    }))
  );
  app.post('/api/discover/business/actions', write(feed.act));
  app.post(
    '/api/discover/business/reset',
    write((actor, body) => ({ preferences: feed.reset(actor, body.what) }))
  );
}
