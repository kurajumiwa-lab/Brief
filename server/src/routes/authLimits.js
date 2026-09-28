// Bounded, in-process abuse protection. IP and normalized target budgets are
// complementary; neither is a substitute for mailbox ownership proof. At
// scale/multi-instance deploys use a shared limiter at the edge too.
import crypto from 'node:crypto';
const buckets = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 10000;
const keyFor = (kind, value) => `${kind}:${crypto.createHash('sha256').update(String(value ?? '').trim().toLowerCase()).digest('hex')}`;

export function clearAuthLimit(kind, value) { buckets.delete(keyFor(kind, value)); }
export function limitAuth(req, res, kind, max, value = req.ip, now = Date.now()) {
  // The broad historical integration suite deliberately registers many
  // actors through one localhost IP. Only that suite opts out; targeted
  // production-safety tests exercise the real limiter without this switch.
  if (process.env.NODE_ENV === 'test' && process.env.BRIEF_TEST_SKIP_AUTH_LIMITS === '1') return true;
  for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
  const key = keyFor(kind, value);
  if (!buckets.has(key) && buckets.size >= MAX_KEYS) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Please try again later.' });
    return false;
  }
  const bucket = buckets.get(key) ?? { count: 0, until: now + WINDOW_MS };
  bucket.count++;
  buckets.set(key, bucket);
  if (bucket.count > max) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.until - now) / 1000))));
    res.status(429).json({ error: 'Please try again later.' });
    return false;
  }
  return true;
}
