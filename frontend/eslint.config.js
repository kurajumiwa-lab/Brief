/**
 * ESLINT — flat config for the Ogallo frontend (v3.1).
 *
 * `npm run lint` had never actually run in this repository: the script invoked
 * `eslint`, but ESLint was not declared in `package.json` and no config file
 * existed, so every report honestly said "lint cannot run". This file is the
 * config, and the toolchain is now a devDependency.
 *
 * The toolchain is pinned to ESLint 9 on purpose: `eslint-plugin-react`, the
 * only plugin ecosystem for JSX rules, declares `eslint: ^9.7` as its peer. ESLint
 * 10 is the newer major, but adopting it here would fail `npm ci` with a peer
 * conflict. Move all three packages together when the plugin catches up.
 *
 * The rules below are the ones this codebase can actually hold itself to. Three
 * deliberate exclusions are documented with their reasons rather than left as
 * silent gaps — a lint config is a policy, and a policy nobody can read is a
 * policy nobody follows.
 *
 *   · react/prop-types — no component in this repository uses PropTypes, by
 *     convention: props are validated by the API layer and the components are
 *     plain JS. Turning the rule on would print 2,433 findings about a decision
 *     already made.
 *   · react/no-unescaped-entities — the copy is written in a human voice and
 *     uses real apostrophes ("People you haven't traded with yet"). Escaping
 *     them (`&apos;`) would make the source harder to read than the screen.
 *   · the React Compiler readiness rules that ship in eslint-plugin-react-hooks
 *     v7 (`set-state-in-effect`, `purity`, `static-components`,
 *     `preserve-manual-memoization`) — see the note at the bottom.
 *
 * Everything else in `js.configs.recommended`, `react/recommended` and
 * `react-hooks` is an error (a real defect) or a warning (a smell worth seeing),
 * and `npm run lint` exits 0 on this tree.
 */
import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    // Build output and dependencies are not source. `public/` is assets only.
    ignores: ["dist/**", "coverage/**", "node_modules/**", "public/**"],
  },

  js.configs.recommended,

  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      // JSX syntax; the app is React 18 with the automatic runtime, so no file
      // needs `import React`.
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      // ── React ───────────────────────────────────────────────────────────────
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
      // A component rendered as `const Icon = ICONS[key]` is a lookup, not a
      // component created during render — but that is exactly what this rule
      // reports, and the pattern is all over this UI. It stays off.
      "react/jsx-key": "error",
      "react/jsx-no-target-blank": "error",
      "react/self-closing-comp": "warn",
      "react/jsx-no-useless-fragment": "warn",
      "react/no-unknown-property": "error",

      // ── hooks ───────────────────────────────────────────────────────────────
      // The two rules that catch real hook bugs. `exhaustive-deps` is a warning:
      // the ten it reports are dependency-array smells that need a read (adding
      // `searchParams` to an effect that already reacts to the URL can loop), so
      // they are surfaced for review rather than auto-failed in CI.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // ── plain JavaScript ────────────────────────────────────────────────────
      // Unused code is dead weight, but `_`-prefixed names say "deliberate".
      "no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Debug logging is how a bug reaches production unnoticed; warn/error are
      // the two a shipped app is allowed to keep (see ErrorBoundary and ws.js).
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
      "no-throw-literal": "error",
    },
  },

  {
    // Config and tooling files run in Node, not the browser.
    files: ["*.config.js", "vite.config.js", "postcss.config.js", "tailwind.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    // Tests: vitest globals (the suite uses `describe`/`it`/`expect` without
    // importing them), plus the DOM.
    files: ["src/test/**/*.{js,jsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
    rules: {
      // A test may keep a fixture or helper it does not use yet.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },

  /* ───────────────────────────────────────────────────────────────────────────
   * NOT ENABLED YET, ON PURPOSE: the React Compiler readiness suite.
   *
   * eslint-plugin-react-hooks v7 ships rules that check code as the React
   * Compiler would compile it. On this tree they report 62 ×
   * `set-state-in-effect`, 8 × `purity` (`Date.now()` read during render), 2 ×
   * `static-components` and 1 × `preserve-manual-memoization` — all of them in
   * the fetch-then-setState pattern that 43 existing screens are built on.
   *
   * They are not wrong, and they are the right destination: each is a real
   * migration (move the sync into an event, hydrate through a store, or adopt
   * the compiler). Turning them on today would fail the build on code this
   * change did not touch, which is how a lint step gets deleted instead of
   * fixed. When the compiler migration starts, opt in with one line:
   *
   *   ...reactHooks.configs["recommended-latest"].rules,
   * ─────────────────────────────────────────────────────────────────────────── */
];
