import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import BRAND, { pageTitle } from "@/config/brand";

/**
 * ONE PRODUCT, ONE NAME.
 *
 * The repository had four names in flight at once: "Byway" in nine root
 * documents and a rendered notice-board heading, "My Shop App" at the top of the
 * README, "Home Office" in `config/brand.js` and 24 rendered strings, and "Brief"
 * — with a stray underscore — in the rest of the interface. A user could read a
 * different product name on almost every screen.
 *
 * The name is Brief. This test is what stops a fifth from appearing: it checks
 * that the configuration, the page title and the rendered strings agree, and it
 * fails with the file and the line that disagreed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const RETIRED_NAMES = [
  { name: "Home Office", why: "renamed to Brief" },
  { name: "My Shop App", why: "never a product name; a repository title" },
  { name: "Byway", why: "a codename from an earlier implementation" },
  { name: "Brief_", why: "a stray underscore from an old mark" },
];

function sourceFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) {
        if (entry !== "test") walk(p);
      } else if (/\.(jsx?|html)$/.test(p)) {
        out.push(p);
      }
    }
  })(dir);
  return out;
}

describe("product identity", () => {
  it("is one name in configuration", () => {
    expect(BRAND.name).toBe("Brief");
    expect(BRAND.wordmark).toBe("Brief");
    expect(pageTitle()).toBe("Brief — the digital connection layer for everyday trade");
  });

  it("is the same name in the document title", () => {
    const html = readFileSync(resolve(root, "../index.html"), "utf8");
    const title = html.match(/<title>([^<]*)<\/title>/)[1];
    expect(title).toBe(pageTitle());
  });

  it("does not use a retired name in any rendered source file", () => {
    const offenders = [];
    for (const file of sourceFiles(root)) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        for (const { name } of RETIRED_NAMES) {
          // A comment may explain the history; rendered code may not repeat it.
          const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);
          if (line.includes(name) && !isComment) {
            offenders.push(`${file.replace(root + "/", "")}:${i + 1} → ${name}`);
          }
        }
      });
    }
    expect(
      offenders,
      `retired product names still reachable in the UI:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
