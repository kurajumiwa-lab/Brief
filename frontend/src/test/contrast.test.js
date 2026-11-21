import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * CONTRAST IS A TEST, NOT A TASTE.
 *
 * A design review found text that was unreadable on dark cards. The finding was
 * correct and it was also the third time the same class of defect had shipped,
 * because nothing measured it: colours live in one token file and every screen
 * picks from it, so a single unreadable token is unreadable everywhere at once.
 *
 * These tests read the real values out of styles/tokens.css — not a copy, and
 * not a hardcoded palette — and assert the pairs that components actually use.
 * Change a token badly and this fails with the ratio, the two colours, and the
 * foreground that broke.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "../styles/tokens.css"), "utf8");

// ".dark" appears in a comment above the rule, so anchor on the rule itself.
const darkAt = css.indexOf("\n.dark {");
const readTokens = (block) => {
  const tokens = {};
  const re = /--([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g;
  let m;
  while ((m = re.exec(block))) tokens[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return tokens;
};
const light = readTokens(css.slice(css.indexOf(":root"), darkAt));
const dark = { ...light, ...readTokens(css.slice(darkAt)) };
const WHITE = [255, 255, 255];

const luminance = ([r, g, b]) => {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** White at `alpha` composited over `bg` — how the dark cards actually render. */
const whiteOn = (bg, alpha) => bg.map((c) => Math.round(255 * alpha + c * (1 - alpha)));

const AA = 4.5;
const themes = { light, dark };

describe("every text token is readable on every surface it sits on", () => {
  const surfaces = ["surface-0", "surface-1", "surface-2", "brand-50"];
  for (const [name, t] of Object.entries(themes)) {
    for (const ink of ["ink-1", "ink-2", "ink-3", "ink-4"]) {
      for (const surface of surfaces) {
        it(`${name}: text-${ink} on bg-${surface}`, () => {
          expect(t[ink], `${ink} missing from ${name}`).toBeDefined();
          expect(t[surface], `${surface} missing from ${name}`).toBeDefined();
          const r = ratio(t[ink], t[surface]);
          expect(
            r,
            `${name}: text-${ink} on bg-${surface} is ${r.toFixed(2)}:1, needs ${AA}:1`,
          ).toBeGreaterThanOrEqual(AA);
        });
      }
    }
  }
});

describe("white text on a filled brand surface", () => {
  // brand-600 is the primary Button; brand-700/800 are its hover and active.
  for (const [name, t] of Object.entries(themes)) {
    for (const fill of ["brand-600", "brand-700", "brand-800", "brand-900"]) {
      it(`${name}: white on bg-${fill}`, () => {
        const r = ratio(t[fill], WHITE);
        expect(
          r,
          `${name}: white on bg-${fill} is ${r.toFixed(2)}:1, needs ${AA}:1. ` +
            "A filled action must be dark enough to carry white text.",
        ).toBeGreaterThanOrEqual(AA);
      });
    }
  }
});

describe("the dark cards (Home next step, The counter)", () => {
  // These keep a dark fill in both themes, and carry white at reduced opacity.
  const darkFills = {
    "brand-800": [[9, 35, 31], [17, 82, 67]],
    "brand-900": [[6, 25, 22], [6, 25, 22]],
  };
  for (const [fill, values] of Object.entries(darkFills)) {
    for (const bg of values) {
      for (const alpha of [0.75, 0.85, 0.9]) {
        it(`white/${alpha * 100} on ${fill} ${bg.join(",")}`, () => {
          const r = ratio(bg, whiteOn(bg, alpha));
          expect(
            r,
            `white at ${alpha} on rgb(${bg.join(" ")}) is ${r.toFixed(2)}:1 — ` +
              "the supporting text on a dark card must still pass.",
          ).toBeGreaterThanOrEqual(AA);
        });
      }
    }
  }
});

describe("the counter shelf's own text", () => {
  // The slab runs brand-800 → brand-900 → ink-900; test the lightest end,
  // which is the worst case for white text.
  const lightest = [17, 82, 67];
  const darkest = [11, 16, 14];
  for (const [label, bg] of [["lightest", lightest], ["darkest", darkest]]) {
    it(`white/70 on the ${label} end of the slab`, () => {
      const r = ratio(bg, whiteOn(bg, 0.7));
      expect(r).toBeGreaterThanOrEqual(AA);
    });
  }
});

describe("the avatar palette", () => {
  // Every initials chip carries white, so every fill is a background in both
  // themes. Approximated fills are read from the tokens they name.
  it("uses no hue outside the green family", () => {
    const src = readFileSync(resolve(here, "../components/ui/Avatar.jsx"), "utf8");
    const palette = src.slice(src.indexOf("const palette = ["), src.indexOf("];", src.indexOf("const palette = [")));
    for (const banned of ["orchid", "indigo", "rose", "blue", "orange", "violet"]) {
      expect(palette, `avatar palette still contains ${banned}`).not.toContain(`-${banned}-`);
    }
  });
});
