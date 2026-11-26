#!/usr/bin/env node
/**
 * LINT WHAT CHANGED — and say what that was.
 *
 * The repository has pre-existing ESLint errors in legacy files, so `eslint .`
 * cannot be the gate for a pull request: it fails for reasons the author did
 * not cause, and the usual response is to ignore it. Linting only the files a
 * branch touches is the right rule, but the naive version of it has a silent
 * failure mode — when the diff is empty, `xargs` runs nothing, the command exits
 * 0, and "nothing to check" is indistinguishable from "everything is clean".
 *
 * This prints the count it checked and refuses to look green over an empty set
 * unless an empty set is genuinely what it found (a docs-only change).
 *
 * Usage:  node scripts/lint-changed.mjs [base]     (default: origin/main)
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const base = process.argv[2] || "origin/main";
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const git = (args) => execFileSync("git", args, { cwd: frontend, encoding: "utf8" });

// Two sources, because a branch is not always committed:
//
//   origin/main...HEAD   what the pull request will contain
//   HEAD                 what is on disk right now, committed or not
//
// Without the second, the command reports "nothing to lint" mid-edit — exactly
// when a person runs it — and that reads as a pass.
const diffFiles = (args) =>
  git(args)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && /\.(jsx?|mjs)$/.test(line))
    .map((line) => line.replace(/^frontend\//, ""));

let files;
try {
  files = [
    ...new Set([
      // `--diff-filter=ACMR` skips deletions: there is nothing to lint in a file
      // that no longer exists, and passing it to eslint is an error.
      // `.` rather than `frontend/src`: git is run with cwd `frontend/`, and a
      // pathspec that does not match from there silently yields nothing — the
      // failure mode this script exists to prevent.
      ...diffFiles(["--no-pager", "diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`, "--", "."]),
      ...diffFiles(["--no-pager", "diff", "--name-only", "--diff-filter=ACMR", "HEAD", "--", "."]),
    ]),
  ];
} catch (error) {
  console.error(`lint:changed — could not diff against "${base}".`);
  console.error(error.stderr?.toString?.() || error.message);
  process.exit(2);
}

if (files.length === 0) {
  // Not a pass with a shrug: state the fact, so a green run is never ambiguous.
  console.log(`lint:changed — no JavaScript or JSX changed against ${base}; nothing to lint.`);
  process.exit(0);
}

console.log(`lint:changed — ${files.length} changed file(s) against ${base}:`);
for (const file of files) console.log(`  ${file}`);

try {
  execFileSync("npx", ["eslint", ...files], { cwd: frontend, stdio: "inherit" });
  // eslint exits 0 with warnings, so "clean" would be a stronger claim than the
  // run supports. Say what was checked, not what was hoped.
  console.log(
    `lint:changed — ${files.length} file(s) checked; no errors. ` +
      "Any warnings printed above are pre-existing unless the diff introduced them.",
  );
} catch {
  console.error(`lint:changed — eslint failed on the changed files above.`);
  process.exit(1);
}
