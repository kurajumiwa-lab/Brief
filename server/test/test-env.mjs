// Isolation preload for the server test suites.
//
// ESM hoists every static import above module-body code, so an assignment
// like `process.env.BRIEF_DATA_DIR = ...` placed after the imports runs too
// late: store.js has already bound itself to the DEFAULT data directory --
// the production store -- and every `store._reset()` in a suite then wipes
// it. Importing this module FIRST is the only static-import-order guarantee
// that the env is set before store.js is pulled in.
//
// The directory is pid-unique so parallel runs cannot share rows.
process.env.BRIEF_DATA_DIR = '/tmp/brief-test-data-' + process.pid;

// Set before any app import: tests own ephemeral listeners, not the preview port.
process.env.NODE_ENV = 'test';
// Broad legacy suite creates hundreds of localhost accounts; targeted
// productionSafety.mjs leaves this unset and checks the actual abuse policy.
process.env.BRIEF_TEST_SKIP_AUTH_LIMITS = '1';
