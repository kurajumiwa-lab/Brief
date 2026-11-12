import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * P2 guard: user-facing copy says "business" or "home", not "vendor".
 *
 * Scope: quoted strings and JSX text in application source. Code identifiers
 * (VendorCard, vendorAPI, vendor?.business_name, route paths) and logic values
 * (`kind === "vendors"`) are not copy and are not checked.
 *
 * Reviewed exceptions, each deliberate:
 *  - pages/governance/OurNetwork.jsx: governance and voting terms. Needs a
 *    reviewer before any wording change (it carries eligibility rules).
 *  - config/brand.js and the "Home Office" line in config/constants.js: a
 *    brand name. Renaming a brand is an owner decision.
 */

// Vitest runs from the frontend directory.
const SRC = join(process.cwd(), "src");
const EXCEPTIONS = [
  "pages/governance/OurNetwork.jsx",
  "config/brand.js",
];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : walk(path);
    return /\.(jsx?|js)$/.test(name) ? [path] : [];
  });

// A quoted string, or the text between JSX tags.
const QUOTED = /"([^"\n]*)"|'([^'\n]*)'/g;
const JSX_TEXT = />([^<>{}\n]*)</g;

const copyStrings = (line) => {
  const found = [];
  for (const m of line.matchAll(QUOTED)) found.push(m[1] ?? m[2]);
  for (const m of line.matchAll(JSX_TEXT)) found.push(m[1]);
  return found;
};

// Paths, identifiers, interpolations and bare logic values are not copy.
const isCopy = (text) =>
  /vendor/i.test(text) && !/[/_${}@]|\.\w/.test(text) && !/^[a-z_]+$/.test(text);

describe("P2 business copy", () => {
  it("has no user-facing 'vendor' copy outside the reviewed exceptions", () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (EXCEPTIONS.some((e) => rel === e || rel.endsWith(`/${e}`))) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/^\s*import\s/.test(line)) return;
        if (rel === "config/constants.js" && /Home Office/.test(line)) return;
        for (const text of copyStrings(line)) {
          if (text && isCopy(text)) offenders.push(`${rel}:${i + 1}: ${text.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
