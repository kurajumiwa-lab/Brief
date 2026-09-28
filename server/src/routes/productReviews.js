import multer from 'multer';
import { requireAuth } from './helpers.js';
import { callerId } from '../identity.js';
import { requireFeature } from '../features.js';
import * as reviews from '../domain/productReviews.js';
import * as uploads from '../domain/upload.js';
const buckets = new Map();
function limit(req, res, scope, max) {
  const now = Date.now(),
    key = `${scope}:${callerId(req) || req.ip}`;
  if (buckets.size > 2000)
    for (const [k, v] of buckets) if (v.until < now) buckets.delete(k);
  if (buckets.size >= 5000 && !buckets.has(key)) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Please try again later.' });
    return false;
  }
  let b = buckets.get(key);
  if (!b || b.until < now) b = { count: 0, until: now + 600000 };
  b.count++;
  buckets.set(key, b);
  if (b.count > max) {
    res.setHeader('Retry-After', Math.ceil((b.until - now) / 1000));
    res
      .status(429)
      .json({ error: 'Too many review actions. Please try again later.' });
    return false;
  }
  return true;
}
const run = (res, fn) => {
  try {
    res.json(fn());
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
};
export function register(app) {
  for (const path of ['/api/public/product-reviews', '/api/product-reviews'])
    app.use(path, requireFeature('commerce'), (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    });
  app.get('/api/public/product-reviews', (req, res) =>
    run(res, () => reviews.catalog(req.query))
  );
  app.get('/api/public/product-reviews/:id/media', (req, res) =>
    run(res, () => reviews.gallery(req.params.id, req.query))
  );
  app.get('/api/public/product-reviews/:id', (req, res) =>
    run(res, () => reviews.page(req.params.id, req.query, callerId(req)))
  );
  app.get('/api/product-reviews/moderation', (req, res) => {
    const me = requireAuth(req, res);
    if (me) run(res, () => reviews.moderation(me));
  });
  app.get('/api/product-reviews/:id/context', (req, res) => {
    const me = requireAuth(req, res);
    if (me) run(res, () => reviews.context(req.params.id, me));
  });
  app.post('/api/product-reviews/:id/submit', (req, res) => {
    const me = requireAuth(req, res);
    if (me && limit(req, res, 'submit', 10))
      run(res, () => ({
        review: reviews.create(req.params.id, me, req.body || {})
      }));
  });
  app.post('/api/product-reviews/:id/vote', (req, res) => {
    const me = requireAuth(req, res);
    if (me && limit(req, res, 'vote', 100))
      run(res, () => ({
        review: reviews.vote(req.params.id, me, req.body?.vote)
      }));
  });
  app.post('/api/product-reviews/:id/response', (req, res) => {
    const me = requireAuth(req, res);
    if (me && limit(req, res, 'response', 30))
      run(res, () => ({
        review: reviews.respond(req.params.id, me, req.body?.body)
      }));
  });
  app.post('/api/product-reviews/:id/report', (req, res) => {
    const me = requireAuth(req, res);
    if (me && limit(req, res, 'report', 15))
      run(res, () => reviews.report(req.params.id, me, req.body || {}));
  });
  app.delete('/api/product-reviews/:id', (req, res) => {
    const me = requireAuth(req, res);
    if (me) run(res, () => reviews.withdraw(req.params.id, me));
  });
  app.post('/api/product-reviews/:id/moderate', (req, res) => {
    const me = requireAuth(req, res);
    if (me) run(res, () => reviews.moderate(req.params.id, me, req.body || {}));
  });
  const accept = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: uploads.maxBytes(), files: 1, fields: 2, parts: 3 }
  }).single('file');
  app.post(
    '/api/product-reviews/media',
    requireFeature('media'),
    (req, res) => {
      const me = requireAuth(req, res);
      if (!me || !limit(req, res, 'upload', 30)) return;
      accept(req, res, (err) => {
        if (err)
          return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
            error:
              err.code === 'LIMIT_FILE_SIZE'
                ? `Each file must be under ${Math.round(uploads.maxBytes() / 1048576)} MB.`
                : 'The upload could not be read.'
          });
        if (!req.file)
          return res
            .status(400)
            .json({ error: 'Choose a photo or short video.' });
        const result = uploads.saveReviewUpload({
          bytes: req.file.buffer,
          ownerId: me,
          originalName: req.file.originalname,
          alt: req.body?.alt
        });
        if (!result.ok)
          return res.status(result.status).json({ error: result.error });
        const u = result.upload;
        res.json({
          media: {
            id: u.id,
            url: u.url,
            kind: u.mimeType.startsWith('video/') ? 'video' : 'image',
            alt: u.alt || 'Customer review media'
          },
          storage: 'local',
          limit: uploads.maxBytes()
        });
      });
    }
  );
}
