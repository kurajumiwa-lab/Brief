// MEDIA ROUTES — provider status, editorial media library, and real uploads.
//
// Public: report whether an image provider is configured (honest, never
// implied). Editorial: record/approve a category image for the fallback chain.
// Uploads: accept an actual image FILE, store it, and serve its bytes back.
import fs from 'node:fs';
import { canReadWorkEvidence } from '../domain/workOrders.js';
import { canReadWorkforceEvidence } from '../domain/workExecution.js';
import { canReadQuoteEvidence } from '../domain/quotes.js';
import multer from 'multer';
import { hasCapability } from '../identity.js';
import { requireAuth, requireCap } from './helpers.js';
import { requireFeature } from '../features.js';
import { store } from '../store.js';
import * as media from '../domain/media.js';
import * as upload from '../domain/upload.js';
import * as publicFeed from '../domain/publicFeed.js';
import * as telegram from '../connectors/telegram.js';

export function register(app) {
  app.use('/api/media', requireFeature('media'));

  /** Provider status: which image providers are configured (usually none). */
  /**
   * Storage truth: provider + on-disk health. Deliberately available to any
   * signed-in user — §18: the upload surface must expose the real durability
   * of local bytes rather than implying cloud persistence.
   */
  app.get('/api/media/status', (req, res) => {
    if (!requireAuth(req, res)) return;
    res.json({ media: media.providerStatus(), uploads: upload.storageStatus() });
  });

  /** Record a category/editorial image (editor-only; the route gates auth). */
  app.post('/api/admin/media', (req, res) => {
    const me = requireCap(req, res, 'ops.run');
    if (!me) return;
    try {
      res.status(201).json({
        image: media.recordMediaLibraryImage({
          kind: req.body?.kind,
          key: req.body?.key,
          url: req.body?.url,
          alt: req.body?.alt ?? null,
          attribution: req.body?.attribution ?? null,
          status: req.body?.status ?? 'draft'
        })
      });
    } catch (e) {
      res.status(400).json({ error: String(e.message ?? e) });
    }
  });

  // -------------------------------------------------------------------------
  // REAL FILE UPLOADS
  //
  // `memoryStorage`, not disk: the domain sniffs the magic bytes before
  // anything is written, so nothing lands on disk until it is known to be an
  // image. The cap is enforced TWICE — here on the wire (multer aborts an
  // oversized body) and again in the domain (defence in depth, and it is the
  // domain that has to answer with a reason a person can act on).
  // -------------------------------------------------------------------------
  const acceptOneImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: upload.maxBytes(), files: 1, fields: 8, parts: 9 }
  }).single('file');

  app.post('/api/media/upload', (req, res) => {
    if (!requireAuth(req, res)) return;
    acceptOneImage(req, res, (err) => {
      if (err) {
        // Multer's own refusals, translated into the same shape the domain
        // uses. An oversized body is cut off on the wire, never stored.
        const tooBig = err?.code === 'LIMIT_FILE_SIZE';
        return res.status(tooBig ? 413 : 400).json({
          error: tooBig
            ? `that image is larger than the ${(upload.maxBytes() / 1048576).toFixed(0)} MB limit`
            : String(err?.message ?? 'the upload could not be read'),
          code: tooBig ? 'file_too_large' : 'upload_unreadable'
        });
      }
      if (!req.file) {
        return res.status(400).json({
          error: 'no file was received; attach the image as the "file" field',
          code: 'no_file'
        });
      }
      const result = upload.saveUpload({
        bytes: req.file.buffer,
        ownerId: req.auth?.userId ?? null,
        originalName: req.file.originalname,
        alt: req.body?.alt,
        purpose: req.body?.purpose ?? 'public'
      });
      if (!result.ok) {
        return res.status(result.status).json({
          error: result.error,
          code: result.code,
          ...(result.allowed ? { allowed: result.allowed } : {}),
          ...(result.limit ? { limit: result.limit } : {})
        });
      }
      res.status(result.duplicate ? 200 : 201).json({
        upload: result.upload,
        duplicate: Boolean(result.duplicate)
      });
    });
  });

  /** The caller's own uploads. */
  app.get('/api/media/mine', (req, res) => {
    if (!requireAuth(req, res)) return;
    res.json({ uploads: upload.listUploads(req.auth.userId) });
  });

  /**
   * Resolve a Telegram image reference to its bytes at render time.
   *
   * Ingestion stores the Bot API `file_id` (never a public URL); this endpoint
   * is the second half of media association. It resolves the reference through
   * getFile server-side, fetches the bytes with the token (which never leaves
   * the server), and streams them back. Readable WITHOUT a session because a
   * published feed card has to render for someone who has not signed in -- but
   * ONLY for objects that are actually public, and the object id is the same
   * unlisted-handle trade-off the upload route already documents.
   *
   * An optional `:index` selects the Nth image from the object's provenance
   * (gallery support): galleries expose `/api/media/telegram/:objectId/:index`
   * URLs and the index is resolved against the same collectObjectImages() scan
   * the projection used, so it always points at the same photo. Without an
   * index the endpoint keeps the original cover-image behaviour.
   *
   * A deleted / inaccessible file returns 404/410 honestly; it never surfaces
   * a token-bearing URL or a fake image.
   */
  app.get('/api/media/telegram/:objectId/:index?', async (req, res) => {
    const object = store.find('objects', (o) => o.id === req.params.objectId);
    if (!object || object.publication !== 'public') {
      return res.status(404).json({ error: 'not found', code: 'not_found' });
    }
    let reference = object.imageReference;
    if (req.params.index !== undefined) {
      const index = Number(req.params.index);
      const images = publicFeed.collectObjectImages(object.id);
      const image = Number.isInteger(index) && index >= 0 ? images[index] : null;
      // Web URLs are served directly by the client; only Telegram references
      // go through this resolver.
      if (!image || !image.reference || /^https?:\/\//i.test(image.reference)) {
        return res.status(404).json({ error: 'not found', code: 'not_found' });
      }
      reference = image.reference;
    }
    if (!reference) {
      return res.status(404).json({ error: 'not found', code: 'not_found' });
    }
    const result = await telegram.getFileBytes(reference);
    if (!result.ok) {
      const status = result.status === 413 ? 413 : (result.status === 404 ? 410 : 502);
      return res.status(status).json({
        error: result.error,
        code: result.status === 413 ? 'file_too_large' : 'media_unavailable'
      });
    }
    res.setHeader('content-type', result.contentType);
    res.setHeader('content-length', String(result.buffer.length));
    // The bytes behind a file_id can change (Telegram may re-serve), so cache
    // briefly rather than forever.
    res.setHeader('cache-control', 'public, max-age=300');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; sandbox");
    res.setHeader('content-disposition', 'inline');
    res.end(result.buffer);
  });

  /** Remove one of your own uploads, bytes and all. */
  app.delete('/api/media/:id', (req, res) => {
    if (!requireAuth(req, res)) return;
    const result = upload.deleteUpload(req.params.id, req.auth.userId);
    if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
    res.json({ removed: true });
  });

  /**
   * The bytes themselves.
   *
   * Readable WITHOUT a session, because a published story, banner or feed card
   * has to render for someone who has not signed in. The id is a random,
   * unlisted handle, and nothing enumerates these — the trade-off is stated
   * rather than hidden.
   */
  app.get('/api/media/file/:id', (req, res) => {
    const row = upload.getUpload(req.params.id);
    const privateEvidence = row?.purpose === 'private_evidence' || row?.purpose === 'private_request' || row?.purpose === 'private_quote' || row?.purpose === 'private_work';
    if (privateEvidence && (!req.auth?.userId || (row.ownerId !== req.auth.userId && !(row.purpose === 'private_evidence' && hasCapability(req.auth.userId,'moderate')) && !(row.purpose === 'private_quote' && canReadQuoteEvidence(req.auth.userId,row.id)) && !(row.purpose === 'private_work' && (canReadWorkEvidence(req.auth.userId,row.id) || canReadWorkforceEvidence(req.auth.userId,row.id)))))) {
      res.setHeader('Cache-Control','no-store');
      return res.status(404).json({error:'image not found',code:'not_found'});
    }
    const result = upload.readFile(req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    const ext = result.row.mimeType.split('/')[1] ?? 'bin';
    res.setHeader('content-type', result.row.mimeType);
    res.setHeader('content-length', String(result.size));
    // Public bytes are immutable. Private evidence is never publicly cached.
    res.setHeader('cache-control', privateEvidence ? 'private, no-store' : 'public, max-age=31536000, immutable');
    if (privateEvidence) res.setHeader('vary', 'Authorization, Cookie');
    // An image is served as an image: never sniffed into something else, and
    // never allowed to run anything.
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; sandbox");
    res.setHeader('content-disposition', `inline; filename="brief-${result.row.id}.${ext}"`);
    const stream = fs.createReadStream(result.file);
    stream.on('error', () => {
      // Headers are already sent, so the honest answer is to end the response
      // rather than write an error body that would corrupt the image.
      try { res.destroy(); } catch {}
    });
    stream.pipe(res);
  });
}
