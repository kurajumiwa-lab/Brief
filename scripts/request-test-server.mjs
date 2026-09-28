// Disposable real server for browser tests. Never touches the production store.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.NODE_ENV = "test";
process.env.BRIEF_DEV_AUTH = "0";
// Test-only reviewer handles; never set in the live app or production preview.
process.env.BRIEF_REVIEWERS = "supply_review_desktop,supply_review_mobile,product_review_desktop,product_review_mobile";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brief-request-browser-"));
process.env.BRIEF_DATA_DIR = dir;
const { default: app } = await import("../server/src/index.js");
const server = app.listen(8788, "0.0.0.0", () =>
  console.log("Request test server on 8788"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    server.close(() => {
      fs.rmSync(dir, { recursive: true, force: true });
      process.exit(0);
    });
  });
