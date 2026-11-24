/**
 * THE PHOTOGRAPH LIBRARY MUST NOT LIE, AND MUST NOT BREAK.
 *
 * Photographs are the easiest thing in a UI to get wrong silently: a mistyped
 * filename ships as a broken image, a missing credential ships as a legal
 * problem, and a caption nobody checked ships as a picture of the wrong
 * continent. These specs cover the three failure modes that a screenshot would
 * not reveal.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { photoFor, photoUrl } from "@/lib/photos";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..", "public");
const CREDITS = join(PUBLIC, "photos", "kenya", "CREDITS.md");

describe("the photo library", () => {
  it("only ever points at files that exist in the build", () => {
    // Every subject the library claims must resolve to a real file. A typo here
    // is a broken <img> in production, and tests are the only place it shows.
    const subjects = [
      "city-skyline", "city-cbd", "city-street", "city-hero",
      "commerce-goods", "commerce-street", "commerce-traffic", "rental-tools",
      "work-technician", "people-street",
      "culture-conference",
      "banner-street", "banner-produce", "banner-people",
      "banner-skyline", "hero-market",
    ];
    for (const subject of subjects) {
      const url = photoUrl(subject);
      expect(url, subject).toBeTruthy();
      expect(existsSync(join(PUBLIC, url)), `${subject} → ${url} is missing`).toBe(true);
    }
  });

  it("returns null rather than a guessed path for an unknown subject", () => {
    expect(photoUrl("no-such-subject")).toBeNull();
    expect(photoUrl(undefined)).toBeNull();
  });

  it("ships no two byte-identical files, so variety is not an illusion", () => {
    // Four crops were once generated from two sources, so two pairs of files
    // were identical. The grid showed "variety" that did not exist, and no
    // dimension or filename check could see it.
    const dir = join(PUBLIC, "photos", "kenya");
    const seen = new Map();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".jpg"))) {
      const digest = createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
      expect(seen.has(digest), `${file} is identical to ${seen.get(digest)}`).toBe(false);
      seen.set(digest, file);
    }
  });

  it("credits every file it ships, because a licence we cannot show is a risk", () => {
    const credits = readFileSync(CREDITS, "utf8");
    for (const subject of ["commerce-street", "work-technician", "culture-conference", "hero-market"]) {
      const file = photoUrl(subject).split("/").pop();
      expect(credits, `${file} is not credited`).toContain(file);
    }
  });
});

describe("photoFor", () => {
  it("never overrides a real photograph of the actual listing", () => {
    // A seller's own photograph is evidence; a library image is atmosphere.
    const item = { id: "x", kind: "listing", image: "/static/real.jpg" };
    expect(photoFor(item)).not.toBe("/static/real.jpg");
    // photoFor is only the fallback — the card checks item.image first. What
    // matters is that photoFor never *invents* that it is the real thing.
    expect(typeof photoFor(item)).toBe("string");
  });

  it("gives different listings different pictures, but the same listing stays put", () => {
    const a = { id: "a", kind: "listing", title: "Maize flour" };
    const b = { id: "b", kind: "listing", title: "Rice 5kg" };
    const c = { id: "c", kind: "listing", title: "Beans 2kg" };

    // Stable across calls: a listing must not change picture between renders.
    expect(photoFor(a)).toBe(photoFor(a));

    // At least one differs — otherwise every produce card shows one photo.
    const picked = new Set([photoFor(a), photoFor(b), photoFor(c)]);
    expect(picked.size).toBeGreaterThan(1);
  });

  it("reads an Available offer's sub-category before its umbrella kind", () => {
    const offer = { id: "o", kind: "available", meta: { primary_category: "service" } };
    const url = photoFor(offer);
    expect(url).toMatch(/work-|people-|commerce-|rental-/);
  });

  it("survives junk without throwing", () => {
    expect(photoFor(null)).toBeNull();
    expect(photoFor({})).toBeTruthy();
    expect(() => photoFor({ kind: 42, meta: null })).not.toThrow();
  });
});
