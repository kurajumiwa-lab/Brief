import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * THE FOUNDATION, CHECKED.
 *
 * The redesign's first ask was a design system with rules rather than a
 * palette. A rule that only exists in a comment is not a rule, so this file
 * checks three things about `src/styles/design-system.css`:
 *
 *   1. every primitive it declares actually ships — it is pinned in the
 *      Tailwind safelist, so a screen that adopts one next week finds it;
 *   2. it introduces no raw colour: every colour is a token, and every token
 *      it names is one the product already defines;
 *   3. the touch-target and focus rules are the ones the review asked for —
 *      44px, and a ring that is never removed.
 */

const ROOT = path.resolve("src");
const css = fs.readFileSync(path.join(ROOT, "styles/design-system.css"), "utf8");
const tokens = fs.readFileSync(path.join(ROOT, "styles/tokens.css"), "utf8");
const tailwind = fs.readFileSync(path.resolve("tailwind.config.js"), "utf8");

/** The class names declared in the components layer of the stylesheet. */
function declaredClasses(source) {
  const layer = source.slice(source.indexOf("@layer components"));
  const body = layer.slice(0, layer.indexOf("\n}"));
  return [...body.matchAll(/^\s{2}\.(ds-[a-z0-9-]+)\s*\{/gm)].map((m) => m[1]);
}

describe("The design system foundation", () => {
  const classes = declaredClasses(css);

  it("declares a kit, not a single rule", () => {
    expect(classes.length).toBeGreaterThanOrEqual(15);
    expect(classes).toEqual(
      expect.arrayContaining([
        "ds-display", "ds-title", "ds-lede", "ds-meta", "ds-eyebrow",
        "ds-card", "ds-card-interactive", "ds-panel",
        "ds-cta", "ds-cta-secondary", "ds-action",
        "ds-tap", "ds-tap-icon", "ds-tap-row",
        "ds-focus", "ds-stack", "ds-shelf",
      ]),
    );
  });

  it("pins every primitive in the Tailwind safelist, so each one ships", () => {
    const safelist = tailwind.slice(tailwind.indexOf("safelist:"));
    for (const name of classes) {
      expect(safelist, `${name} is not pinned in tailwind.config.js`).toContain(`"${name}"`);
    }
  });

  it("introduces no raw colour — only tokens the product already defines", () => {
    // No hex, no rgb(), no hsl() in the stylesheet.
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/hsla?\(/);

    // Every colour utility it uses names a ramp, and every ramp it names is
    // one tokens.css defines. `text-white` and friends are allowed: white on
    // a forest fill is the kit's own contrast pair.
    const ramps = [...css.matchAll(
      /(?:^|\s)(?:bg|text|border|ring|ring-offset|divide|from|via|to|fill|stroke)-((?:brand|surface|ink|edge|accent|amber|tech|cat|orchid)-\d{2,3})/g,
    )].map((m) => m[1]);
    expect(ramps.length).toBeGreaterThan(0);
    for (const ramp of new Set(ramps)) {
      expect(tokens, `--${ramp} is not defined in tokens.css`).toContain(`--${ramp}:`);
    }

    // And it names no custom property the product has not defined.
    for (const token of new Set([...css.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]))) {
      expect(tokens, `--${token} is not defined in tokens.css`).toContain(`--${token}:`);
    }
  });

  it("holds the touch-target rule the review asked for", () => {
    // 44px, from the token the product already measures.
    expect(tokens).toContain("--tap-target: 2.75rem");
    expect(css).toMatch(/\.ds-tap\b[^}]*min-h-11/);
    expect(css).toMatch(/\.ds-tap-icon\b[^}]*h-11 w-11/);
    expect(css).toMatch(/\.ds-tap-row\b[^}]*min-h-11/);
  });

  it("never removes the focus ring", () => {
    const focus = css.slice(css.indexOf(".ds-focus {"));
    const rule = focus.slice(0, focus.indexOf("}"));
    expect(rule).toMatch(/focus-visible:ring-2/);
    expect(rule).not.toMatch(/focus:outline-none/);
  });

  it("keeps exactly one filled action in the kit", () => {
    const filled = [...css.matchAll(/^\s{2}\.(ds-[a-z0-9-]+)\s*\{/gm)].map((m) => m[1]);
    const withBrandFill = filled.filter((name) => {
      const at = css.indexOf(`.${name} {`);
      const body = css.slice(at, css.indexOf("}", at));
      return /bg-brand-600/.test(body);
    });
    expect(withBrandFill).toEqual(["ds-cta"]);
  });
});
