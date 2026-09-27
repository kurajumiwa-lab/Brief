// ---------------------------------------------------------------------------
// UPLOADS — real image files, held by Brief rather than referenced by a link.
//
// The editorial studio used to accept only a URL, which meant every photo in
// every story was somebody else's asset on somebody else's server: it could
// rot, hotlink-block, or change under the story without a trace. This module
// lets a person put an actual file in.
//
// RULES, because accepting bytes from a stranger is the dangerous part:
//
//   1. The declared type is never believed. The type comes from MAGIC BYTES
//      read from the file itself. A text file renamed `photo.png` is a text
//      file, and is refused. So is an SVG, which is a document that can carry
//      script, not an image we can safely serve inline.
//   2. Nothing the caller says about the file's NAME is used to build a path.
//      The stored name is `<our id>.<ext from the sniffed type>`, written into
//      a directory Brief owns. There is no traversal to guard against because
//      no caller-supplied path component is ever used.
//   3. The size is capped before the bytes are kept (multer enforces the same
//      cap on the wire, so an oversized upload is cut off, not stored).
//   4. An upload needs an identity. Anonymous rows are how unattributable
//      content arrives.
//   5. The bytes live on the local disk of a single process. That disk does
//      not survive a redeploy. So the ROW records that fact, and a request for
//      bytes that are gone answers 404 with a reason rather than serving a
//      broken image and pretending otherwise.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { store, newId } from '../store.js';
import { now } from '../routes/helpers.js';

// Resolved the same way the store resolves its data directory (relative to
// this file, NOT the working directory) so the two can never disagree about
// where Brief keeps its state.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export function dataDir() {
  return process.env.BRIEF_DATA_DIR || path.join(HERE, '..', 'data');
}

/**
 * Read lazily, not once at import: the directory is an environment decision,
 * and the test suite points it at a temporary directory per run.
 */
export function uploadDir() {
  return process.env.BRIEF_UPLOAD_DIR || path.join(dataDir(), 'uploads');
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // 8 MB
export function maxBytes() {
  const n = Number(process.env.BRIEF_UPLOAD_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_BYTES;
}

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

/**
 * What the bytes actually are, judged by the bytes.
 *
 * Deliberately narrow: four raster formats a browser can render and that
 * cannot carry script. Returns null for anything else, including SVG and
 * AVIF (AVIF is fine to add later; it simply is not proven here yet).
 */
export function sniffImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'image/png';
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
      (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) {
    return 'image/gif';
  }
  // WEBP: "RIFF" .... "WEBP"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return 'image/webp';
  }
  return null;
}

/** Keep a display name, but never a path and never anything unprintable. */
function cleanName(name) {
  return String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .slice(0, 120);
}

function ensureDir() {
  const dir = uploadDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function filePathFor(row) {
  if (!row) return null;
  return path.join(uploadDir(), `${row.id}.${EXTENSIONS[row.mimeType] ?? 'bin'}`);
}

export function getUpload(id) {
  return store.find('uploads', (u) => u.id === id) ?? null;
}

/**
 * Store one uploaded image.
 *
 * Returns `{ ok: true, upload, duplicate }` or `{ ok: false, status, code,
 * error }`. Never throws for an ordinary refusal — a person picking the wrong
 * file is a normal event, not an exception.
 */
export function saveUpload({ bytes, ownerId, originalName = null, alt = null, purpose = 'public' }) {
  if (!['public','private_evidence','private_request','private_quote','private_work'].includes(purpose)) return {ok:false,status:400,code:'invalid_purpose',error:'invalid upload purpose'};
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (!ownerId) {
    return { ok: false, status: 401, code: 'no_identity', error: 'authentication required' };
  }
  if (buf.length === 0) {
    return { ok: false, status: 400, code: 'empty_file', error: 'the file is empty' };
  }
  const limit = maxBytes();
  if (buf.length > limit) {
    return {
      ok: false,
      status: 413,
      code: 'file_too_large',
      error: `that image is ${(buf.length / 1048576).toFixed(1)} MB; the limit is ${(limit / 1048576).toFixed(0)} MB`,
      limit
    };
  }

  const mimeType = sniffImageType(buf);
  if (!mimeType) {
    return {
      ok: false,
      status: 415,
      code: 'unsupported_image_type',
      error: 'only JPEG, PNG, WebP and GIF images can be uploaded',
      allowed: ALLOWED_TYPES
    };
  }

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

  // The same person uploading the same bytes twice gets the same asset back
  // rather than a second copy: an image is content, not an event.
  const existing = store.find('uploads', (u) => u.ownerId === ownerId && u.sha256 === sha256 && (u.purpose ?? 'public') === purpose);
  if (existing && fs.existsSync(filePathFor(existing))) {
    return { ok: true, upload: existing, duplicate: true };
  }

  const row = store.insert('uploads', {
    id: newId('upl'),
    ownerId,
    purpose,
    mimeType,
    bytes: buf.length,
    sha256,
    originalName: cleanName(originalName) || null,
    alt: alt ? String(alt).slice(0, 240) : null,
    url: null, // filled in below once the id exists
    createdAt: now()
  });
  row.url = `/api/media/file/${row.id}`;
  store.update('uploads', row.id, { url: row.url });

  ensureDir();
  const dest = filePathFor(row);
  const tmp = `${dest}.part`;
  try {
    // Write to a temp name then rename, so a crash mid-write cannot leave a
    // half-image that later serves as a corrupt file.
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    fs.renameSync(tmp, dest);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    store.remove('uploads', row.id);
    return {
      ok: false,
      status: 503,
      code: 'storage_unavailable',
      error: `the image could not be saved: ${e.message}`
    };
  }

  return { ok: true, upload: row, duplicate: false };
}

/** The caller's own uploads, newest first. */
export function listUploads(ownerId) {
  return store
    .filter('uploads', (u) => u.ownerId === ownerId && (u.purpose ?? 'public') === 'public')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Only the owner removes one, and the bytes go with the row. */
export function deleteUpload(id, ownerId) {
  const row = getUpload(id);
  // 404, not 403: existence is not disclosed to a stranger.
  if (!row || row.ownerId !== ownerId) {
    return { ok: false, status: 404, code: 'not_found', error: 'upload not found' };
  }
  if(row.purpose==='private_work' && store.find('workOrders',w=>w.evidence.some(e=>e.uploadId===id)))return {ok:false,status:409,code:'evidence_in_use',error:'Operational evidence is retained in Work history'};
  if (row.purpose === 'private_work' && store.find('workProofs', p => p.photos?.includes(id))) return { ok: false, status: 409, code: 'evidence_in_use', error: 'This photo is retained as proof of submitted workforce work' };
  if (row.purpose === 'private_quote' && store.find('requestQuotes', q => [...q.offers.map(o=>o.terms),q.draft].filter(Boolean).some(t=>t.evidence.some(e=>e.uploadId===id)))) {
    return {ok:false,status:409,code:'evidence_in_use',error:'This image is retained as part of a commercial record'};
  }
  if (row.purpose === 'private_evidence' && store.find('verificationRecords', r => r.scope === 'supply' && r.evidence?.some(e => e.uploadId === id))) {
    return {ok:false,status:409,code:'evidence_retained',error:'Submitted evidence is retained for verification history'};
  }
  try {
    const p = filePathFor(row);
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
  store.remove('uploads', row.id);
  return { ok: true, removed: true };
}

/**
 * READ MODEL for a file request: the row, the path, and whether the bytes are
 * actually still there.
 *
 * This exists because the disk is not durable: after a redeploy onto a fresh
 * container the rows survive (they are in the JSON store) and the bytes do
 * not. Saying so is the honest behaviour; serving a 200 with nothing in it is
 * not.
 */
export function readFile(id) {
  const row = getUpload(id);
  if (!row) return { ok: false, status: 404, code: 'not_found', error: 'image not found' };
  const file = filePathFor(row);
  let size = null;
  try {
    size = fs.statSync(file).size;
  } catch {
    return {
      ok: false,
      status: 404,
      code: 'bytes_missing',
      error: 'this image was uploaded to a local disk that no longer holds it. Upload it again.',
      row
    };
  }
  return { ok: true, row, file, size };
}

/**
 * What the deployment can honestly promise about uploaded images.
 *
 * `persisted: false` is the truth for a single process on an ephemeral
 * filesystem, and it is far more useful stated than discovered.
 */
export function storageStatus() {
  let dirWritable = false;
  let dirError = null;
  try {
    ensureDir();
    const probe = path.join(uploadDir(), '.probe');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    dirWritable = true;
  } catch (e) {
    dirError = e.message;
  }
  const all = store.all('uploads');
  let missing = 0;
  for (const row of all) {
    try { fs.statSync(filePathFor(row)); } catch { missing++; }
  }
  return {
    enabled: true,
    kind: 'local_disk',
    // NOT an object store, and not a volume that survives a redeploy.
    persisted: false,
    dir: uploadDir(),
    writable: dirWritable,
    dirError,
    maxBytes: maxBytes(),
    allowedTypes: ALLOWED_TYPES,
    count: all.length,
    missingBytes: missing,
    reason: dirWritable
      ? 'Uploads are stored on this server\'s local disk. They survive a restart ' +
        'but not a redeploy to a fresh container; point BRIEF_UPLOAD_DIR at a ' +
        'mounted volume to keep them.'
      : `Upload storage is not writable: ${dirError}`
  };
}
