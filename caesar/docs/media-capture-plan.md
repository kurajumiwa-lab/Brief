# Media capture and compression — implementation plan

**Status:** plan only. No code changed by this document.
**Baseline:** `main` @ `8965ea3`, suite **104 passing / 7 files**, build ✓ 1.9 s.
**Scope:** the composer's camera and microphone, and what happens to the bytes
before they are stored. Nothing else.

---

## 0. The one-sentence version

Replace three fixed illustration chips and a hard-coded voice note with device
capture that re-encodes before it stores anything, holds every post to a stated
byte budget, and keeps the existing 104 tests as the fence around behaviour that
must not move.

---

## 1. Where capture stands today (verified, not remembered)

| Piece | Today | Anchor |
|---|---|---|
| Photo | Three chips — `market`, `farm`, `coast` — each a ~1.2 KB in-palette SVG from a fixed set | `ComposePage.jsx:17-21` (the set), `:137-152` (the chips), `data/imagery.js` |
| Voice | A button that attaches the literal `{ seconds: 24, kb: 108 }`. Nothing is recorded, nothing plays | `ComposePage.jsx:159` |
| Data estimate | `text bytes + (image ? 140 : 0) + voice.kb` | `ComposePage.jsx:12-15` |
| Stored cost | `dataKb = 1.2 + voice.kb + (image ? 140 : 0)`, recomputed on publish | `store/appStore.js:135-152` |
| Alt text | Set to the string `"Image attached to the post"` | `store/appStore.js:145` |
| Rendering | `<img src>` or the data-saver placeholder; voice shown as a bar with a size label and no player | `components/PostCard.jsx:163-210` |
| Persistence | The **entire** store as one JSON string in `localStorage["caesar.prototype"]` | `lib/storage.js`, `SCHEMA_VERSION = 1` |

Two things worth naming before anything else:

1. **The 140 KB is a constant.** The SVG it prices is about 1.2 KB, so the
   composer currently *over*-states every sample photo by roughly 139 KB. The
   estimate screen inherits that number, which is why the data metric reads
   212 KB for a network whose photographs total 5 KB.
2. **The prototype already admits all of this**, in the composer
   (`ComposePage.jsx:165-167`) and in the Safety centre
   (`SafetyPage.jsx:260-263`), and two tests pin those sentences
   (`controls.test.jsx:218-223`). Real capture makes both statements false on
   purpose — see §7a. That is the whole reason this plan exists rather than a
   patch.

---

## 2. The constraint nobody wrote down: there is no server

This is the load-bearing decision, so it goes before the fun parts.

- `localStorage` is roughly **5 MB per origin**, and it already holds every
  post, user, reaction, report and queued action. A single 120 KB photo becomes
  ~160 KB once base64-encoded; **thirty photos would consume the entire app.**
- Worse, `commit()` serialises the whole store on every interaction
  (`appStore.js:43-46`). Media inside the store would mean `JSON.stringify` of
  the media library on every thumbs-up.

**Decision:** media bytes never enter the store.

```
post.media = { id: "m-8f3a", mime: "image/webp", bytes: 118432,
               width: 1024, height: 768 }        ← a few dozen bytes
bytes        live in IndexedDB, keyed by id       ← src/lib/mediaStore.js
```

The card resolves `media.id` to an object URL at render time. `dataKb` remains a
number derived from **measured** bytes, so the feed card, the data saver, the
composer estimate and `/measure` keep agreeing by construction.

Two consequences worth stating plainly:

- **A memory fallback is mandatory** — IndexedDB is absent in jsdom, in Safari
  private mode, and on quota errors. That fallback is not a test-only path; it
  is the same code a locked-down browser gets.
- **Object URLs cannot be persisted.** They must be created on mount and revoked
  on unmount, or a long session leaks the whole library. That gets a test.

---

## 3. Target flow

### 3.1 Photo (P0)

`<input type="file" accept="image/*" capture="environment">` — the camera roll and
the phone's own camera, on every browser, with no permission prompt to mishandle.
A live `getUserMedia` viewfinder is P2, not because it is hard but because the
file input already covers the product's need at a fraction of the surface area.

```
idle → picking → decoding → compressing (rung 2/4, 78 KB…) → ready | too-large | failed
```

- Progress is shown as *rung and current size*, not a spinner. On a slow phone
  the compression is visible work, and hiding it is how people tap twice.
- `failed` covers: unsupported codec, corrupt file, zero-byte file, and
  "this device cannot decode that image" — each with its own sentence.
- `too-large` should not normally occur; the loop in §4.1 makes it unreachable
  for any input under ~50 MP. If it happens, the post is still allowed with the
  smallest encode and the card says the size.

### 3.2 Voice (P0)

Hold to record, timer, **60-second hard stop**, discard on cancel, and a
permission-denied path that explains rather than fails silently.

| Platform | Container | Detect via |
|---|---|---|
| Chrome / Android | `audio/webm;codecs=opus` | `MediaRecorder.isTypeSupported` |
| Safari 14.3+ | `audio/mp4` (AAC) | same |
| Neither | file input `accept="audio/*"` | fallback |

AAC on iOS is bigger than Opus for the same duration. That is accepted and
**labelled** rather than hidden: the card prints the measured size either way.

### 3.3 What does not change

Text posts still cost 1.2 KB. The three illustration chips stay in the tree as
the **labelled fallback** when `captureAvailable()` is false — which is the
likely state inside the Arena preview iframe (see §10.1). The demo stays complete
without a camera; it just stops claiming the camera is real.

---

## 4. Compression strategy

### 4.1 Images

```
File → createImageBitmap(blob, { imageOrientation: "from-image" })
     → canvas at scaled size → toBlob(type, quality) → budget loop
```

| Setting | Value | Why |
|---|---|---|
| Longest edge ladder | `1280 → 1024 → 800 → 640` | 1024 is sharp on a 3× phone at feed width; 640 is the floor that is still legible |
| Quality ladder | `0.72 → 0.62 → 0.50` | below 0.5, WebP smears text long before it stops being obvious |
| Feed budget | **120 KB** | a post must not cost a day's bundle to read one item |
| Thumbnail | 320 px, ≤ **18 KB** | the composer preview should not download the full encode twice |
| Format | WebP if `toBlob` honours the request, else JPEG | feature-detect by output type, never by user agent |

The loop is deterministic: try the largest rung at the highest quality; if over
budget, drop quality at that rung; when the quality ladder is exhausted, step
down a rung. Hard ceiling is 4 × 3 = **12 encodes**, each cheaper than the last.

Simulated over a plausible bytes-per-pixel range for a 12 MP (4032×3024) source,
budget 120 KB:

| bytes/px @ q0.72 | encodes | result |
|---|---|---|
| 0.08 | 1 | 1280×960 @ 0.72 · 96 KB |
| 0.10 | 1 | 1280×960 @ 0.72 · 120 KB |
| 0.12 | 2 | 1280×960 @ 0.62 · 118 KB |
| 0.14 | 3 | 1280×960 @ 0.50 · 119 KB |
| 0.16 | 5 | 1024×768 @ 0.62 · 101 KB |
| 0.18 | 5 | 1024×768 @ 0.62 · 113 KB |
| 0.20 | 6 | 1024×768 @ 0.50 · 109 KB |

Two things fall out of that, both deciding:

1. **It is 1–3 encodes typically, 6 in the bad case — not the 1–2 I first
   assumed.** Cheap enough to run on the main thread; no worker needed for a
   feed-sized photo.
2. **The loop spends quality before it spends resolution.** Every outcome above
   lands at 1280 or 1024; 800 and 640 are unreachable for a phone photo of this
   size. That is the right order for this product — resolution is what makes a
   photographed price board legible, and a 640 px image of a price list is
   worthless no matter how clean the compression.

**Orientation:** re-encoding drops EXIF, which is exactly what we want for GPS
privacy — but it also drops the rotation flag. A portrait photo must not arrive
sideways, so orientation is applied at decode (`imageOrientation: "from-image"`,
and `<img>` + `image-orientation: from-image` on the fallback path). This gets a
fixture in the QA set, not a unit test.

**Privacy, stated as a feature:** canvas re-encode strips GPS, device make,
serial and timestamps. On a product whose Safety centre is about who can find
you, keeping camera EXIF would be a defect, not a detail.

### 4.2 Voice

| | Today (sample) | Target |
|---|---|---|
| Bitrate | 190 KB / 42 s ⇒ **~36 kbps** | **24 kbps** mono Opus |
| 42 s | 190 KB | **126 000 bytes** → shown as **123 KB** |
| 60 s cap | — | **180 000 bytes** → shown as **176 KB** |
| Playback | no player | `<audio controls>` with the measured size beside it |

Sizes above are exact bytes; the figure in brackets is what `dataSize()`
(`format.js`) prints after dividing by 1024. The plan keeps both because the
whole point is that the interface and the measurement screen show the same
number — and "126 KB" is not what the app would display.

24 kbps mono Opus is transparent for speech and poor for music — acceptable,
because this is a voice *post*. If the listening test in §7d says otherwise, the
only knob that moves is the bitrate (24 → 32 kbps ⇒ 42 s = 168 000 bytes, shown
as 164 KB), and the budget in §4.1 does not move.

### 4.3 The resulting ceiling

```
worst case post = 1.2 KB text + 120 KB photo + 176 KB voice ≈ 297 KB
typical post    = 120–140 KB
today's feed    = 212 KB, 90% of it one unconverted 190 KB voice note
```

That last line is the honest one: **compression will not move `/measure`'s
212 KB on its own**, because the seed's photographs are 1 KB SVGs. What changes
is the *ceiling*, which becomes enforceable and testable. §6 adds a row to
`/measure` — share of posts within budget — so the promise is measurable rather
than asserted.

---

## 5. Quality trade-offs

| Asset | Today | After | Smaller by | What is lost |
|---|---|---|---|---|
| 12 MP phone photo (2–4 MB) | rejected — no path exists | ≤120 KB, 1024 px WebP | ~95% | pixel-peeping detail; a 1024 px image is not printable |
| Feed thumbnail | n/a | ≤18 KB | — | nothing a phone screen shows |
| 42 s voice | 190 KB | 123 KB (24 kbps) | 35% | nothing measurable in speech; music and background become muddy |
| Text post | 1.2 KB | 1.2 KB | 0 | nothing |

Three rules the implementation must keep:

1. **The budget is a budget, not a quality guarantee.** There is no perceptual
   metric in CI, and pretending otherwise would be the same sin as a retention
   number from one browser.
2. **Text-in-photo is the known risk.** A photographed price board at
   1024 px / q0.72 may stop being readable, and for this product that photo is
   the most valuable one in the feed. Decision rule: if the QA set's price board
   fails at the standard rung, add a "document" mode (1280 px, q0.82, 220 KB
   budget) rather than raising the ceiling for every photo of a goat.
3. **No filters, no crops, no auto-enhance.** The product's claim is that people
   are describing what they actually saw. A beauty filter would undercut it.

---

## 6. Data model and storage

```diff
 post = {
   id, circleId, authorId, lang, body, createdAt, reactions, status,
-  image: "data:image/svg+xml,…" | null,
-  imageAlt: "Image attached to the post",
-  voice: { seconds: 42, kb: 190 } | null,
-  dataKb: 191.2,
+  media: {                                  // null for text posts
+    id: "m-8f3a", kind: "photo" | "voice",
+    mime: "image/webp", bytes: 118432,
+    width: 1024, height: 768,               // photos
+    seconds: 42,                            // voice
+    alt: "Tomato crates at Kibuye, Monday", // author-written, required
+    transcript: null,                       // optional, P1
+  },
+  dataKb: 116.0,                            // measured, not estimated
 }
```

- `SCHEMA_VERSION` → **2**. `storage.js:39` already discards a payload whose
  version differs and reseeds, so existing local posts are lost on upgrade. That
  is the correct trade (documented in the release note), and it is *only*
  acceptable because the seed re-creation is deterministic.
- **Seed media stays inline** — the SVGs are ~1 KB and the seed must not depend
  on IndexedDB being available on first paint.
- `mediaStore` API: `put(blob, meta) → id`, `get(id) → Blob`, `del(id)`,
  `usage() → bytes`, `supported`. IDB database `caesar.media` v1, one store,
  key = media id.
- **Quota failure is a state, not a crash**: `QuotaExceededError` →
  "This device is out of storage for photos. Delete a post with a photo and try
  again." Silence here would lose a post someone spent five minutes writing.

### Alt text

The brief lists accessibility as a feature. A photo without alt text is invisible
to a screen-reader user, so the field is **required** for photos and blocks
publish with the same tone the 8-character rule already uses. Voice posts get an
optional transcript (P1) — captions are the accessibility answer for audio, and
an optional field is honest about it being unfinished.

---

## 7. Tests

### 7a. Protecting the existing 104 — the fence, and the two permitted edits

The rule: **no existing test is deleted or weakened to make a new one pass.** An
assertion may change only where the *product* changed, in the same commit, with
the reason in the message.

Required changes, both in PR C and nowhere earlier:

| Location | Now | Becomes |
|---|---|---|
| `controls.test.jsx:218-223` | voice button is labelled `(sample)`; composer states it never opens the camera or microphone | voice button opens the recorder; permission-denied explains itself; **the fallback** still labels samples |
| `SafetyPage.jsx:260-263` | "Real media capture … never opens your camera or microphone" | removed in the same commit, replaced by whatever remains genuinely unbuilt |

Everything else stays byte-identical as a regression fence: `ranking` (20),
`reputation` (9), `feed` (12), `metrics` (12), `storage` (11), `shell` (14), and
the other 24 in `controls`.

### 7b. New pure unit tests — no DOM, no mocks

`src/test/mediaPlan.test.js`

- `scaledSize(4032, 3024, 1024)` → `{ width: 1024, height: 768 }`; portrait,
  square, 1×1, and 0×0 inputs; never upscales a smaller image.
- The budget loop, given an injected `encode(size, quality) → bytes`, returns the
  first attempt under budget, and exhausts in a fixed order.
- An always-over-budget encoder returns the smallest attempt, never throws.
- `bytesFor(42, 24000)` = `126 000`; the 60 s cap; a zero-second recording.
- Container selection from a support predicate, including the "neither" case.

### 7c. Adapter contract tests — fakes at the platform seam

- `compressImage(file, { decode, encode })` with fake codecs: the resulting
  `post.media.bytes` equals the fake blob's size, and `post.dataKb` equals
  `1.2 + bytes/1024` rounded the way `format.js` rounds. This ties §4 to §6 to
  the number `/measure` prints.
- `mediaStore` on its memory fallback: put/get/del/usage, an id that never
  existed, and a duplicate put.
- `useMediaObjectUrl` creates exactly one URL per mount and revokes it on
  unmount (`URL.createObjectURL` / `revokeObjectURL` stubs join the existing
  jsdom shims in `src/test/setup.js` — `URL.createObjectURL` is `undefined` in
  jsdom 25, measured, not assumed).
- Data saver with real media: the placeholder prints the **measured** size and
  "Play it" / "Load it" bring the asset back.

### 7d. What cannot be tested here — and the QA matrix that covers it

Measured in this environment (jsdom 25, node 22):

| API | Present | So |
|---|---|---|
| `canvas.getContext("2d")` | `null` | no real re-encode in CI, ever |
| `canvas.toBlob` | unusable | same |
| `createImageBitmap`, `OffscreenCanvas` | `undefined` | same |
| `MediaRecorder`, `navigator.mediaDevices` | `undefined` | no real recording in CI |
| `URL.createObjectURL` | `undefined` | stub required |
| `indexedDB` | `undefined` | memory fallback is the tested path |

Therefore the following are **manual QA**, on real devices, and the PR is not
done until each has a recorded result:

1. Android Chrome: 12 MP photo → ≤120 KB, upright, no GPS in the output.
2. iOS Safari: photo uploads; voice records as `audio/mp4`; player works.
3. Desktop Firefox: WebP path and JPEG fallback both render.
4. A rotated portrait photo arrives upright (EXIF orientation).
5. 61 seconds of speech → recording stops at 60 s, stored ≤180 KB.
6. Reload → photo and voice still there (IndexedDB, not the store).
7. Offline reload → assets still render from the device.
8. Quota: fill storage, confirm the sentence appears and nothing is silently lost.
9. Camera/mic denied → the explanation, not a dead button.
10. **Preview iframe** — see §10.1. Expected: permission denied; the fallback
    must carry the demo.

---

## 8. Scope and isolation

**Added (7):**

```
src/lib/mediaPlan.js        pure: ladders, budgets, scaledSize, loop decision
src/lib/mediaStore.js       IndexedDB + memory fallback, one small API
src/lib/compressImage.js    the DOM adapter (decode → canvas → encode)
src/lib/recordVoice.js      MediaRecorder adapter + capability detection
src/hooks/useMediaObjectUrl.js
src/components/MediaCapture.jsx   the composer's controls
src/components/VoicePlayer.jsx
```

**Touched (5):** `pages/ComposePage.jsx`, `components/PostCard.jsx`,
`store/appStore.js` (`addPost` signature), `pages/SafetyPage.jsx` (one bullet),
`test/setup.js` (two stubs).

**Untouched, deliberately:** `ranking.js`, `reputation.js`, `selectors.js`,
`metrics.js`, `i18n.js`, `seed.js`, every other page, `vercel.json`, and the
Brief app entirely.

**No new runtime dependencies.** Canvas, `MediaRecorder` and IndexedDB are
platform APIs; a bundle that grows to compress images would be a joke at the
product's own expense. Bundle should stay within a few KB of the current
269 KB / 84 KB gzip.

**Rollback:** everything sits behind `captureAvailable()`. If it returns false —
or if a release goes wrong — the old sample path renders unchanged. Rolling back
is a one-line predicate, not a revert.

---

## 9. Sequence — three PRs, each independently green

| PR | Content | Risk | Tests |
|---|---|---|---|
| **A** | `mediaPlan.js` + `mediaPlan.test.js`. No UI, no imports from it yet | none — dead code until B | +12 |
| **B** | `mediaStore`, `useMediaObjectUrl`, renderer indirection, schema v2, `setup.js` stubs | moderate — storage shape changes once | +8 |
| **C** | Capture UI, recorder, composer estimate from measured bytes, alt-text rule, copy changes, QA run | the interesting one | +10, −0, **2 amended** |

PR A is deliberately inert: it lets the arithmetic and the budget loop be agreed
before anything can break. PR B changes the data model while the composer still
produces samples, so a regression there cannot be confused with a capture bug.
PR C is the only one that changes what a user sees, and the only one allowed to
touch §7a's two assertions.

---

## 10. Risks and open questions

1. **The Arena preview iframe may block camera and microphone.** Permission
   policy is set by the embedding page; `getUserMedia` will likely reject with
   `NotAllowedError`, and `MediaRecorder` has nothing to record. Expected, not
   confirmed — it gets checked in the first hour of PR C. The fallback exists so
   the preview still demonstrates the product honestly, saying the device is
   unavailable rather than failing a tap.
2. **iOS `MediaRecorder` is 14.3+ and produces AAC.** Accepted, labelled, bigger.
   No attempt to transcode AAC → Opus in the browser (there is no encoder).
3. **EXIF orientation on the `<img>` fallback** differs by browser; the QA
   fixture covers it.
4. **IndexedDB eviction.** Browsers may clear it under pressure. A photo can
   therefore vanish from a post that still exists — the card must degrade to
   "this photo is no longer on this device", not to a broken image icon.
5. **Alt text adds friction at the moment of posting.** Mitigation is tone, not
   a default string: the app asks for a description the same way it asks for
   eight characters of post.
6. **Schema v2 discards existing local posts** (`storage.js:39`). Documented
   in the release note; acceptable because the seed is deterministic.

---

## 11. Definition of done

- [ ] A 12 MP photo reaches the feed at ≤120 KB, upright, GPS-free, with alt text.
- [ ] A 60-second voice note stops at 60 s and stores ≤180 000 bytes (176 KB as
      printed), with a working player.
- [ ] The composer's estimate is the measured size, not a constant, and it matches
      the card and `/measure` for the same post.
- [ ] Data saver withholds photos **and** voice, printing real bytes.
- [ ] Reload, offline reload, quota exhaustion and permission denial each have a
      sentence and no silent loss.
- [ ] The full suite is green and larger than 104; exactly two assertions differ,
      both listed in §7a, both because the product changed.
- [ ] `npm run build` ✓, no new runtime dependency, `vercel.json` untouched.
