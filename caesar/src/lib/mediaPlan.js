/**
 * THE MEDIA PLAN — pure arithmetic for capture, compression and budget.
 *
 * Nothing in this file touches a browser API. That is not a stylistic choice;
 * it is the only way any of it can be tested. Measured in this environment
 * (jsdom 25 / node 22): `canvas.getContext("2d")` returns null, `createImageBitmap`
 * and `OffscreenCanvas` are undefined, `MediaRecorder` and `mediaDevices` are
 * undefined. A compression strategy that cannot be exercised in CI is a
 * strategy nobody can refactor with confidence.
 *
 * So the decisions live here — which size, which quality, which container, how
 * many bytes — and the adapters (`compressImage.js`, `recordVoice.js`, added in
 * PR C) do nothing but perform the one step they are told to perform. Every
 * question worth arguing about is answerable from this file alone:
 *
 *   · How big is a post allowed to get?            → PLAN.image.budgetBytes
 *   · Do we lose resolution or quality first?      → chooseEncoding's loop order
 *   · How long may a voice note run?               → PLAN.voice.maxSeconds
 *   · Which audio container on this phone?         → pickAudioContainer
 *
 * The loop order is the interesting decision. It spends *quality* before it
 * spends *resolution*: a photographed price board at 1280 px and quality 0.50
 * is still readable, while the same photo at 640 px and quality 0.72 is not.
 * For this product the legible text inside a photo is the whole point of the
 * photo, so resolution is the last thing to go.
 *
 * Simulated over a plausible bytes-per-pixel range for a 12 MP source at a
 * 120 KB budget, the loop cost 1–3 encodes typically and 6 at worst, and never
 * reached the 800 or 640 rungs. Those rungs stay because a 108 MP file, or a
 * future "document" mode, can reach them.
 */

/** Every number the plan uses is here, and nowhere else. */
export const PLAN = Object.freeze({
  image: {
    /** What one photo may cost a reader on a metered bundle. */
    budgetBytes: 120 * 1024,
    /** Longest edge, descending. Resolution is spent last. */
    rungs: [1280, 1024, 800, 640],
    /** Encoder quality, descending. Spent first. */
    qualities: [0.72, 0.62, 0.5],
    /** WebP first; JPEG is the universal fallback, not a preference. */
    formats: ["image/webp", "image/jpeg"],
    /** The composer preview must not download the full encode twice. */
    thumbnail: { longestEdge: 320, budgetBytes: 18 * 1024 },
  },
  voice: {
    /** 24 kbps mono Opus is transparent for speech and poor for music. */
    bitrate: 24_000,
    /** A hard stop, not a suggestion: 60 s at 24 kbps is 176 KB as displayed. */
    maxSeconds: 60,
    /** Order matters: Opus is roughly half the size of AAC for the same speech. */
    containers: ["audio/webm;codecs=opus", "audio/mp4"],
  },
  /** Baseline for a text-only post, matching the composer's existing estimate. */
  textBaselineKb: 1.2,
});

const round1 = (value) => Math.round((Number(value) || 0) * 10) / 10;

/**
 * Fit width×height inside a longest-edge box.
 *
 * Never upscales: a 900×600 photo asked for a 1280 box stays 900×600, because
 * re-encoding an image larger than it is adds bytes and no detail.
 *
 * @returns {{width: number, height: number} | null} null when the input is not
 *   a usable pixel size, so callers cannot silently divide by zero.
 */
export function scaledSize(width, height, longestEdge) {
  const w = Number(width);
  const h = Number(height);
  const edge = Number(longestEdge);
  if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(edge)) return null;
  if (w <= 0 || h <= 0 || edge <= 0) return null;

  const factor = Math.min(1, edge / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * factor)),
    height: Math.max(1, Math.round(h * factor)),
  };
}

/**
 * Walk the ladder until the encode fits the budget.
 *
 * `encode({ width, height, quality })` is injected and must resolve to
 * `{ bytes, mime, blob }`. Injecting it keeps this function testable without a
 * canvas, and keeps the DOM adapter from growing its own copy of the policy.
 *
 * Outcomes, all explicit — the caller never has to interpret a thrown error to
 * know what happened:
 *
 *   { ok: true,  withinBudget: true,  ... }  a rung fitted
 *   { ok: true,  withinBudget: false, ... }  every rung was over; smallest kept
 *   { ok: false, reason }                    nothing usable was produced
 *
 * @param {object} options
 * @param {number} options.width   source pixels
 * @param {number} options.height  source pixels
 * @param {(target: {width: number, height: number, quality: number}) => Promise<{bytes: number, mime?: string, blob?: Blob}>} options.encode
 * @param {number} [options.budget] bytes
 */
export async function chooseEncoding({ width, height, encode, budget = PLAN.image.budgetBytes } = {}) {
  if (typeof encode !== "function") return { ok: false, reason: "no-encoder", attempts: 0 };
  if (!scaledSize(width, height, Math.max(Number(width) || 0, Number(height) || 0))) {
    return { ok: false, reason: "invalid-dimensions", attempts: 0 };
  }

  const limit = Number.isFinite(Number(budget)) && Number(budget) > 0 ? Number(budget) : PLAN.image.budgetBytes;

  let attempts = 0;
  let last = null;
  let lastSize = null;

  for (const rung of PLAN.image.rungs) {
    const target = scaledSize(width, height, rung);
    if (!target) continue;

    // A source smaller than the rung produces the same pixels at the next rung
    // down. Re-encoding identical dimensions is pure waste.
    const key = `${target.width}x${target.height}`;
    if (key === lastSize) continue;
    lastSize = key;

    for (const quality of PLAN.image.qualities) {
      attempts += 1;
      let encoded;
      try {
        encoded = await encode({ ...target, quality });
      } catch (error) {
        return { ok: false, reason: "encode-failed", attempts, error };
      }

      const bytes = Number(encoded?.bytes);
      if (!Number.isFinite(bytes) || bytes <= 0) {
        return { ok: false, reason: "encoder-returned-nothing", attempts };
      }

      last = {
        width: target.width,
        height: target.height,
        quality,
        bytes,
        mime: encoded.mime ?? null,
        blob: encoded.blob ?? null,
      };

      if (bytes <= limit) return { ok: true, withinBudget: true, attempts, budget: limit, ...last };
    }
  }

  // Never throw away the work: hand back the smallest thing we managed to make
  // and let the caller decide whether to publish it with the size stated.
  return { ok: Boolean(last), withinBudget: false, attempts, budget: limit, ...(last || { reason: "no-targets" }) };
}

/** Container for the recorder, chosen by capability rather than user agent. */
export function pickAudioContainer(isSupported = () => false) {
  for (const type of PLAN.voice.containers) {
    try {
      if (isSupported(type)) return type;
    } catch {
      // A browser that throws on the question is a browser that cannot answer yes.
    }
  }
  return null;
}

/** Encoder target format: WebP where it is honoured, JPEG where it is not. */
export function pickImageFormat(isSupported = () => false) {
  for (const type of PLAN.image.formats) {
    try {
      if (isSupported(type)) return type;
    } catch {
      /* as above */
    }
  }
  return null;
}

/**
 * What a recording is allowed to cost, in bytes, and whether it was cut short.
 *
 * Computed from bitrate rather than measured, because the caller needs the
 * number *before* recording starts (to warn) and after it stops (to store). The
 * adapter's measured size wins when the two disagree; this is the ceiling.
 */
export function voiceBudget(seconds, { bitrate = PLAN.voice.bitrate, maxSeconds = PLAN.voice.maxSeconds } = {}) {
  const raw = Number(seconds);
  const safe = Number.isFinite(raw) && raw > 0 ? raw : 0;
  const capped = Math.min(safe, maxSeconds);
  return {
    seconds: round1(capped),
    bytes: Math.round((capped * bitrate) / 8),
    capped: safe > maxSeconds,
    maxSeconds,
  };
}

/**
 * The composer's estimate, in the same unit and to the same rounding as the card.
 *
 * `format.dataSize()` divides by 1024 and rounds, so the numbers this returns
 * are the numbers a reader sees. That equality is the point: a composer that
 * quotes one size and a feed that prints another teaches people to trust
 * neither.
 */
export function postKilobytes({ textKb = PLAN.textBaselineKb, photoBytes = 0, voiceBytes = 0 } = {}) {
  const text = Number.isFinite(Number(textKb)) && Number(textKb) > 0 ? Number(textKb) : PLAN.textBaselineKb;
  const photo = Number(photoBytes) > 0 ? Number(photoBytes) / 1024 : 0;
  const voice = Number(voiceBytes) > 0 ? Number(voiceBytes) / 1024 : 0;
  return round1(text + photo + voice);
}

export default {
  PLAN,
  scaledSize,
  chooseEncoding,
  pickAudioContainer,
  pickImageFormat,
  voiceBudget,
  postKilobytes,
};
