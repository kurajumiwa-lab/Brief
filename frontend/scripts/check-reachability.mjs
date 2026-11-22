/**
 * REACHABILITY CHECK — which modules nothing can load.
 *
 * Run from `frontend/`:  node scripts/check-reachability.mjs
 *
 * This is a report, not a gate. It walks static and dynamic imports from
 * `main.jsx` and lists modules that no path reaches. It was written to find the
 * abandoned Home architecture (85 unreachable modules, including a component
 * that had been redesigned twice and rendered nowhere). It is deliberately not
 * wired into CI: a module can be legitimately held for a flagged feature, and a
 * build that fails on a judgement call is a build people learn to ignore.
 *
 * Known blind spot: modules reached only through a namespace import
 * (`import * as x`) or a computed specifier are reported as dead.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve, extname } from "path";

const root = resolve(process.argv[2] || "src");
const all = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if ([".js", ".jsx"].includes(extname(p))) all.push(p);
  }
})(root);

const resolveSpec = (from, spec) => {
  let base;
  if (spec.startsWith("@/")) base = join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const cand of [base, base + ".js", base + ".jsx", join(base, "index.js"), join(base, "index.jsx")]) {
    try { if (statSync(cand).isFile()) return cand; } catch {}
  }
  return null;
};

const deps = new Map();
for (const f of all) {
  const src = readFileSync(f, "utf8");
  const out = [];
  // static imports + lazy(() => import(...)) + dynamic import()
  for (const m of src.matchAll(/(?:from\s+|import\()\s*["']([^"']+)["']/g)) {
    const r = resolveSpec(f, m[1]);
    if (r) out.push(r);
  }
  deps.set(f, out);
}

// entry points: main.jsx (not counted as dead itself)
const entries = all.filter((f) => /src[\\/]main\.jsx?$/.test(f));
const seen = new Set();
const stack = [...entries];
while (stack.length) {
  const f = stack.pop();
  if (seen.has(f)) continue;
  seen.add(f);
  for (const d of deps.get(f) || []) stack.push(d);
}

const dead = all.filter((f) => !seen.has(f) && !/\.test\.(js|jsx)$/.test(f) && !/\/test\//.test(f));
console.log(`entry: ${entries.length}  total src modules: ${all.length}  reachable: ${seen.size}  DEAD: ${dead.length}`);
console.log("\n--- dead modules (not reachable from main.jsx) ---");
for (const d of dead.sort()) console.log("  " + d.replace(root + "/", ""));
