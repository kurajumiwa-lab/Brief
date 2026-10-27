/**
 * THE MEDIA ARITHMETIC, TESTED WITHOUT A BROWSER.
 *
 * Everything here is pure, so every question the plan argues about is settled
 * by an assertion rather than by a device in someone's hand:
 *
 *   · does the ladder keep resolution when it should?
 *   · does an impossible budget degrade or throw?
 *   · do the numbers the composer quotes equal the numbers the card prints?
 *
 * The last one is why `format.js` is imported here. A budget in bytes that a
 * reader never sees is a budget nobody is held to.
 */
import { describe, expect, it } from "vitest";
import {
  PLAN,
  chooseEncoding,
  pickAudioContainer,
  pickImageFormat,
  postKilobytes,
  scaledSize,
  voiceBudget,
} from "@/lib/mediaPlan.js";
import { dataSize } from "@/lib/format.js";

/** An encoder that returns whatever this function says, and counts its calls. */
function fakeEncoder(bytesFor) {
  const calls = [];
  const encode = async (target) => {
    calls.push(target);
    return { bytes: bytesFor(target), mime: "image/webp", blob: null };
  };
  return { encode, calls };
}

describe("scaledSize", () => {
  it("fits a landscape photo to the longest edge", () => {
    expect(scaledSize(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 });
  });

  it("fits a portrait photo without rotating it", () => {
    expect(scaledSize(3024, 4032, 1280)).toEqual({ width: 960, height: 1280 });
  });

  it("fits a square without stretching it", () => {
    expect(scaledSize(3000, 3000, 1024)).toEqual({ width: 1024, height: 1024 });
  });

  it("never upscales a photo smaller than the box", () => {
    expect(scaledSize(900, 600, 1280)).toEqual({ width: 900, height: 600 });
  });

  it("refuses a size that is not a pixel count", () => {
    expect(scaledSize(0, 600, 1280)).toBeNull();
    expect(scaledSize(-4, 600, 1280)).toBeNull();
    expect(scaledSize(Number.NaN, 600, 1280)).toBeNull();
    expect(scaledSize(400, 300, 0)).toBeNull();
  });

  it("never rounds a sliver of a photo down to zero pixels", () => {
    const size = scaledSize(8000, 3, 640);
    expect(size.width).toBe(640);
    expect(size.height).toBe(1);
  });
});

describe("chooseEncoding", () => {
  const source = { width: 4032, height: 3024 };

  it("stops at the first rung that fits", async () => {
    const { encode, calls } = fakeEncoder(() => 90 * 1024);
    const result = await chooseEncoding({ ...source, encode });

    expect(result.ok).toBe(true);
    expect(result.withinBudget).toBe(true);
    expect(result.attempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(result.width).toBe(1280);
    expect(result.quality).toBe(PLAN.image.qualities[0]);
  });

  it("spends quality before it spends resolution", async () => {
    // Over budget at the top quality, comfortable at the next one.
    const { encode } = fakeEncoder(({ quality }) => (quality > 0.7 ? 300 * 1024 : 118 * 1024));
    const result = await chooseEncoding({ ...source, encode });

    expect(result.width).toBe(1280);
    expect(result.height).toBe(960);
    expect(result.quality).toBe(0.62);
    expect(result.attempts).toBe(2);
  });

  it("steps down a rung only after the quality ladder is exhausted", async () => {
    // Nothing at 1280 fits; 1024 at the top quality does.
    const { encode } = fakeEncoder(({ width, quality }) =>
      width === 1280 ? 400 * 1024 : quality === 0.72 ? 100 * 1024 : 200 * 1024
    );
    const result = await chooseEncoding({ ...source, encode });

    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
    expect(result.attempts).toBe(PLAN.image.qualities.length + 1);
  });

  it("hands back the smallest encode instead of throwing when nothing fits", async () => {
    const { encode, calls } = fakeEncoder(() => 900 * 1024);
    const result = await chooseEncoding({ ...source, encode });

    expect(result.ok).toBe(true);
    expect(result.withinBudget).toBe(false);
    expect(result.width).toBe(PLAN.image.rungs.at(-1));
    expect(result.quality).toBe(PLAN.image.qualities.at(-1));
    expect(result.attempts).toBe(calls.length);
    expect(result.attempts).toBeLessThanOrEqual(PLAN.image.rungs.length * PLAN.image.qualities.length);
  });

  it("does not encode the same pixels twice when two rungs collapse", async () => {
    // 900x600 is under the 1280 and 1024 rungs, so both map to 900x600. It is
    // over the 800 and 640 rungs, so those are genuinely different encodes.
    const { encode, calls } = fakeEncoder(() => 200 * 1024);
    await chooseEncoding({ width: 900, height: 600, encode });

    const at900 = calls.filter((call) => call.width === 900 && call.height === 600);
    expect(at900).toHaveLength(PLAN.image.qualities.length);
    expect(new Set(calls.map((call) => `${call.width}x${call.height}`)).size).toBe(3);
  });

  it("collapses every rung when the source is smaller than all of them", async () => {
    const { encode, calls } = fakeEncoder(() => 200 * 1024);
    const result = await chooseEncoding({ width: 400, height: 300, encode });

    expect(new Set(calls.map((call) => `${call.width}x${call.height}`)).size).toBe(1);
    expect(calls).toHaveLength(PLAN.image.qualities.length);
    expect(result.attempts).toBe(PLAN.image.qualities.length);
  });

  it("reports an encoder that throws rather than swallowing it", async () => {
    const encode = async () => {
      throw new Error("codec exploded");
    };
    const result = await chooseEncoding({ ...source, encode });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("encode-failed");
    expect(result.error).toBeInstanceOf(Error);
  });

  it("treats a zero-byte encode as a failure, not as a very good one", async () => {
    const { encode } = fakeEncoder(() => 0);
    const result = await chooseEncoding({ ...source, encode });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("encoder-returned-nothing");
  });

  it("refuses to run without dimensions or without an encoder", async () => {
    const { encode } = fakeEncoder(() => 1024);
    expect(await chooseEncoding({ width: 0, height: 0, encode })).toMatchObject({
      ok: false,
      reason: "invalid-dimensions",
    });
    expect(await chooseEncoding({ ...source })).toMatchObject({ ok: false, reason: "no-encoder" });
  });

  it("honours a custom budget", async () => {
    const { encode } = fakeEncoder(() => 20 * 1024);
    const tight = await chooseEncoding({ ...source, encode, budget: 10 * 1024 });
    // 20 KB never fits 10 KB, so it walks the whole ladder and says so.
    expect(tight.withinBudget).toBe(false);

    const loose = await chooseEncoding({ ...source, encode, budget: 40 * 1024 });
    expect(loose.withinBudget).toBe(true);
    expect(loose.attempts).toBe(1);
  });
});

describe("voiceBudget", () => {
  it("prices a normal recording from the bitrate", () => {
    const budget = voiceBudget(42);
    expect(budget.bytes).toBe(126_000);
    expect(budget.capped).toBe(false);
    // The number a reader actually sees on the card. `format.dataSize()` takes
    // kilobytes — it is what `post.dataKb` is stored in — so bytes are divided
    // here at the display boundary and nowhere else.
    expect(dataSize(budget.bytes / 1024)).toBe("123 KB");
  });

  it("caps a long recording and says it was cut", () => {
    const budget = voiceBudget(95);
    expect(budget.seconds).toBe(PLAN.voice.maxSeconds);
    expect(budget.bytes).toBe(180_000);
    expect(budget.capped).toBe(true);
    expect(dataSize(budget.bytes / 1024)).toBe("176 KB");
  });

  it("treats a stopped-before-it-started recording as zero bytes", () => {
    expect(voiceBudget(0)).toMatchObject({ seconds: 0, bytes: 0, capped: false });
    expect(voiceBudget(-3)).toMatchObject({ seconds: 0, bytes: 0 });
    expect(voiceBudget(Number.NaN)).toMatchObject({ seconds: 0, bytes: 0 });
  });
});

describe("containers, chosen by capability", () => {
  it("prefers Opus, then MP4", () => {
    expect(pickAudioContainer((type) => type.includes("webm"))).toBe("audio/webm;codecs=opus");
    expect(pickAudioContainer((type) => type === "audio/mp4")).toBe("audio/mp4");
  });

  it("returns null when the browser supports neither, instead of guessing", () => {
    expect(pickAudioContainer(() => false)).toBeNull();
    expect(pickAudioContainer(() => {
      throw new Error("isTypeSupported is not a function");
    })).toBeNull();
  });

  it("prefers WebP, falls back to JPEG, and admits when there is neither", () => {
    expect(pickImageFormat((type) => type === "image/webp")).toBe("image/webp");
    expect(pickImageFormat((type) => type === "image/jpeg")).toBe("image/jpeg");
    expect(pickImageFormat(() => false)).toBeNull();
  });
});

describe("the composer's estimate", () => {
  it("adds text, photo and voice in the unit the card prints", () => {
    const kb = postKilobytes({ textKb: 1.2, photoBytes: 100 * 1024, voiceBytes: 126_000 });
    expect(kb).toBe(224.2);
    expect(dataSize(kb)).toBe("224 KB");
  });

  it("is the text baseline when nothing is attached", () => {
    expect(postKilobytes({})).toBe(PLAN.textBaselineKb);
  });

  it("keeps one decimal, the same rounding the store already uses", () => {
    expect(postKilobytes({ textKb: 1.2, photoBytes: 1234 })).toBe(2.4);
  });
});

describe("the plan itself", () => {
  it("has a descending ladder, so 'spend quality first' is actually what happens", () => {
    const { rungs, qualities } = PLAN.image;
    expect([...rungs].sort((a, b) => b - a)).toEqual(rungs);
    expect([...qualities].sort((a, b) => b - a)).toEqual(qualities);
  });

  it("prices a worst-case post below half a megabyte", () => {
    const worst = postKilobytes({
      textKb: PLAN.textBaselineKb,
      photoBytes: PLAN.image.budgetBytes,
      voiceBytes: voiceBudget(PLAN.voice.maxSeconds).bytes,
    });
    expect(worst).toBeLessThan(512);
  });
});
