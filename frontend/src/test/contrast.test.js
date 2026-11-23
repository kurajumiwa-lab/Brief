import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

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

/**
 * Direction D (vibrant commerce) made orange a *second voice* — referrals,
 * rewards, scan actions. The risk is that it slowly becomes a third action
 * colour, so the rule is asserted rather than left in a comment: a filled
 * primary button carries white, and white on the orange fill must still be
 * legible if it is used that way. Green stays the action colour.
 */
describe("the orange accent", () => {
  for (const [name, t] of Object.entries(themes)) {
    it(`${name}: white on accent-600 is legible`, () => {
      const r = ratio(t["accent-600"], WHITE);
      expect(
        r,
        `${name}: white on accent-600 is ${r.toFixed(2)}:1 — orange may carry white only if it clears ${AA}:1`,
      ).toBeGreaterThanOrEqual(AA);
    });

    // Orange carries two jobs with two values: 600 is a *fill* (white on it),
    // 700 is *text* on the page. Asserting 600 here would demand one token be
    // both a light fill and dark-readable text, which no single colour can do.
    it(`${name}: accent-700 is readable as text on the page`, () => {
      const r = ratio(t["accent-700"], t["surface-1"]);
      expect(r, `${name}: accent-700 on surface-1 is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    });
  }
});

/**
 * THE 12px FLOOR. The audience reads this in market daylight, so no screen may
 * size text below 12px with an arbitrary value. Before direction D there were
 * 82 uses of `text-[11px]` and 142 of `text-[10px]`, which is why the product
 * read as faint. `text-2xs` (12px) and `text-micro` (11px, uppercase tags only)
 * are the two sizes allowed at the bottom.
 */
describe("the type floor", () => {
  it("no screen uses an arbitrary size below 12px", () => {
    const offenders = [];
    (function walk(d) {
      for (const entry of readdirSync(d)) {
        const p = join(d, entry);
        if (statSync(p).isDirectory()) {
          if (entry !== "test") walk(p);
        } else if (/\.jsx?$/.test(p)) {
          const src = readFileSync(p, "utf8");
          src.split("\n").forEach((line, i) => {
            const m = line.match(/text-\[(\d+)px\]/);
            if (m && Number(m[1]) < 12) offenders.push(`${p.replace(here + "/", "")}:${i + 1} → ${m[0]}`);
          });
        }
      }
    })(resolve(here, ".."));
    expect(offenders, `text below the 12px floor:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});

/**
 * THE REDESIGN BRIEF'S PALETTE, ASSERTED.
 *
 * The brief specified hexes, and three of them cannot be used literally if the
 * brief's own section 8 requirement ("ensure WCAG AA contrast") is to hold:
 *
 *   coral #F06443 with white text      3.18:1  → a filled control uses accent-600
 *   amber #E9AE55 with white text      1.97:1  → amber is a surface, never a fill
 *   slate #737B77 as body text on ivory 3.99:1 → body sits at ink-3/ink-4
 *
 * These assertions are the record of that: they fail if someone "restores" the
 * literal hex where it is unreadable, and they document where each value is
 * allowed to appear.
 */
describe("the brief's palette, where it can and cannot be used", () => {
  for (const [name, t] of Object.entries(themes)) {
    it(`${name}: teal brand-600 carries white (the identity fill)`, () => {
      expect(ratio(t["brand-600"], WHITE)).toBeGreaterThanOrEqual(AA);
    });

    // The brief's own category colours, as label text on their own tint.
    for (const cat of ["goods", "services", "rentals", "events"]) {
      it(`${name}: category ${cat} text on its soft tint`, () => {
        const r = ratio(t[`cat-${cat}-text`], t[`cat-${cat}-soft`]);
        expect(r, `${name}: cat-${cat}-text on cat-${cat}-soft is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  it("light: amber-400 is a surface, so it is never claimed to carry white", () => {
    // Deliberately asserting the FAILURE mode, so a future change that starts
    // using amber as a button fill is caught by a comment that says why not.
    const r = ratio(light["amber-400"], WHITE);
    expect(r, "amber-400 with white text must stay the reason it is surface-only").toBeLessThan(AA);
  });

  it("light: the brief's literal coral is not used as a fill under white", () => {
    const r = ratio(light["accent-400"], WHITE);
    expect(r, "accent-400 is #F06443; at 3.18:1 it may not carry white text").toBeLessThan(AA);
  });
});
