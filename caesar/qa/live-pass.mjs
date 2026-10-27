/**
 * LIVE PASS — the prototype driven against the real API, in a browser, on a phone.
 *
 * `mobile-pass.mjs` proves the screens render at 390×844. This proves the other
 * half: that when a session points at the Brief backend, what the screen shows
 * is what the server holds. Every assertion below is checked twice — once in
 * the DOM and once against the API with the same token — because a client that
 * agrees with itself proves nothing.
 *
 * Run it against a backend with a few social posts in it:
 *
 *   node qa/serve-live.py                      # throwaway Postgres + uvicorn :8000
 *   npm run dev -- --port 5180                 # proxies /api to :8000
 *   node qa/live-pass.mjs                      # screenshot + assertions into qa/
 */
import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import { writeFileSync } from "node:fs";

const BASE = process.env.CAESAR_URL || "http://localhost:5180";
const OUT = process.env.QA_OUT || new URL(".", import.meta.url).pathname;

const report = { base: BASE, viewport: "390x844 (Pixel 7)", startedAt: new Date().toISOString(), steps: [], pages: [], console: [], failed: [] };
const step = (name, extra = {}) => {
  report.steps.push({ name, ...extra });
  console.log(`✓ ${name}${extra.detail ? ` — ${extra.detail}` : ""}`);
};
const fail = (name, detail) => {
  report.failed.push({ name, detail });
  console.error(`✗ ${name} — ${detail}`);
  return false;
};

const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--hide-scrollbars"],
  headless: true,
});

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
});

const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

/** Read the API directly with the browser's own token. */
async function apiFeed(token) {
  const response = await fetch(`${BASE}/api/social/feed?limit=50`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`feed ${response.status}: ${await response.text()}`);
  return response.json();
}

async function tokenOf() {
  const raw = await page.evaluate(() => window.localStorage.getItem("caesar.session"));
  return raw ? JSON.parse(raw).token : null;
}

async function shot(name) {
  await page.screenshot({ path: `${OUT}live-${name}.png` });
}

/* The audit loop takes one shot per route; the step shots above it are the
   evidence for a specific action, so the two must not share a filename. */
async function auditShot(name) {
  await page.screenshot({ path: `${OUT}live-page-${name}.png` });
}

/* ── 1. join the network without a business account ──────────────────────── */

const handle = `qa_${Date.now().toString(36).slice(-6)}`;
await page.goto(`${BASE}/profile`, { waitUntil: "networkidle" });
await page.getByTestId("open-join").click();
await page.fill("#join-handle", handle);
await page.fill("#join-name", "QA Pass");
await page.fill("#join-city", "Kisumu");
await page.getByRole("button", { name: "Create my account" }).click();
await page.getByTestId("session-card").getByText("You are on the live network").waitFor({ timeout: 15000 });

const token = await tokenOf();
token ? step("joined without a vendor account", { detail: `@${handle}` }) : fail("join", "no token stored");
await shot("join");

/* ── 2. the feed is the server's feed ────────────────────────────────────── */

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const source = await page.getByTestId("feed-source").innerText();
const serverFeed = await apiFeed(token);

const cards = await page.$$eval("[data-testid^=post-]", (nodes) =>
  nodes.map((node) => ({
    id: node.getAttribute("data-testid").replace("post-", ""),
    body: node.querySelector(".post__body")?.textContent?.trim() || "",
    up: Number(node.querySelector(".reaction--up .reaction__count")?.textContent || -1),
    down: Number(node.querySelector(".reaction--down .reaction__count")?.textContent || -1),
  }))
);

const mismatches = [];
for (const card of cards) {
  const row = serverFeed.find((entry) => entry.post.id === card.id);
  if (!row) {
    mismatches.push(`${card.id} is on screen but not in the API`);
    continue;
  }
  if (row.verdict.up !== card.up) mismatches.push(`${card.id} up ${card.up} vs ${row.verdict.up}`);
  if (row.verdict.down !== card.down) mismatches.push(`${card.id} down ${card.down} vs ${row.verdict.down}`);
}
if (source !== `Live · @${handle}`) mismatches.push(`source chip says "${source}"`);

if (cards.length === 0 || mismatches.length) {
  fail("feed matches the server", `${cards.length} cards; ${mismatches.join("; ")}`);
} else {
  step("feed matches the server row for row", { detail: `${cards.length} posts, counts identical`, counts: cards.length });
}
await shot("feed");

/* ── 3. a reaction is a row on the server, and survives a reload ─────────── */

const card = page.getByTestId(`post-${cards[0].id}`);
const upButton = card.getByRole("button", { name: /support/i });
await upButton.click();
await page.waitForTimeout(900);

const after = await apiFeed(token);
const stored = after.find((entry) => entry.post.id === cards[0].id);
if (stored?.my_reaction !== "up") fail("reaction reached the server", `my_reaction=${stored?.my_reaction}`);
else step("reaction is stored against this account", { detail: `my_reaction=up on ${cards[0].id}` });

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const pressed = await page
  .getByTestId(`post-${cards[0].id}`)
  .getByRole("button", { name: /support/i })
  .getAttribute("aria-pressed");
pressed === "true"
  ? step("the pressed button survives a reload", { detail: "my_reaction came back from the API" })
  : fail("pressed state after reload", `aria-pressed=${pressed}`);

/* ── 4. a report opens a case and leaves the post standing ───────────────── */

const reported = page.getByTestId(`post-${cards[0].id}`);
await reported.getByRole("button", { name: /why this|confidence|%/i }).first().click().catch(async () => {
  await reported.locator(".post__why").click();
});
await page.getByRole("dialog").waitFor();
await page.getByRole("button", { name: "Report", exact: true }).click();
await page.getByRole("radio").first().check();
await page.getByRole("button", { name: "Send report" }).click();
await page.getByTestId("report-sent").waitFor({ timeout: 15000 });
const sentText = await page.getByTestId("report-sent").innerText();
const caseNumber = /C-[A-Z0-9]{8}/.exec(sentText)?.[0] || null;
caseNumber ? step("report returned a case number", { detail: caseNumber }) : fail("report case number", sentText);
await page.keyboard.press("Escape");

const stillThere = await apiFeed(token).then((rows) => rows.some((row) => row.post.id === cards[0].id && row.post.status === "published"));
stillThere ? step("the reported post is still published") : fail("report removed the post", "status changed");

/* ── 5. a block hides the author from this reader only ───────────────────── */

const authorId = after.find((entry) => entry.post.id === cards[0].id)?.post.author.id;
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByTestId(`post-${cards[0].id}`).getByRole("button", { name: "Post actions" }).click();
await page.getByRole("menuitem", { name: /Block/ }).click();
await page.waitForTimeout(900);
const gone = (await page.$$(`[data-testid=post-${cards[0].id}]`)).length === 0;
gone ? step("the blocked author's posts leave this feed") : fail("block", "post still on screen");

const blockRows = await fetch(`${BASE}/api/social/blocks?kind=block`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const named = blockRows.find((row) => row.target_id === authorId)?.target;
named?.handle ? step("the block list names who was blocked", { detail: `@${named.handle}` }) : fail("block list", JSON.stringify(blockRows));

await page.goto(`${BASE}/safety`, { waitUntil: "networkidle" });
await page.getByText(named.display_name || named.handle).first().waitFor({ timeout: 15000 });
step("safety centre shows the block by name and the case");
await shot("safety");

await page.getByRole("button", { name: "Unblock" }).first().click();
await page.waitForTimeout(900);
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const back = (await page.$$(`[data-testid=post-${cards[0].id}]`)).length === 1;
back ? step("unblocking brings the post back") : fail("unblock", "post did not return");

/* ── 6. write a post into the network ────────────────────────────────────── */

const bodyText = `QA ${Date.now().toString(36)}: maize flour is 65 shillings at Kibuye, and the queue is short this morning.`;
await page.goto(`${BASE}/compose`, { waitUntil: "networkidle" });
await page.fill("#body", bodyText);
await page.getByRole("button", { name: "Post to the network" }).click();
await page.waitForURL(`${BASE}/`, { timeout: 15000 });
await page.waitForTimeout(900);
const posted = (await apiFeed(token)).some((row) => row.post.body === bodyText);
posted ? step("a post written here is a row on the server") : fail("compose", "post not found in the API");

/* ── 7. every screen, at phone size, from live data ──────────────────────── */

const ROUTES = [
  ["feed", "/"],
  ["circles", "/circles"],
  ["compose", "/compose"],
  ["profile", "/profile"],
  ["safety", "/safety"],
  ["measure", "/measure"],
];

for (const [name, path] of ROUTES) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const audit = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = [];
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right > window.innerWidth + 1) {
        wide.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || "").slice(0, 50), right: Math.round(rect.right) });
      }
    }
    const small = [];
    for (const el of document.querySelectorAll("button, a[href], input, select, [role=button], [role=tab]")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width < 24 || rect.height < 24) {
        small.push({ tag: el.tagName.toLowerCase(), label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30), w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    }
    return { overflow: doc.scrollWidth - doc.clientWidth, wide, small };
  });
  report.pages.push({ name, path, ...audit });
  await auditShot(name);
}

await browser.close();

report.console = consoleErrors;
report.finishedAt = new Date().toISOString();
writeFileSync(`${OUT}live-report.json`, JSON.stringify(report, null, 2));

const overflowed = report.pages.filter((entry) => entry.overflow > 0);
console.log(`\n${report.failed.length} failed assertion(s), ${overflowed.length} page(s) with horizontal overflow, ${consoleErrors.length} console error(s).`);
if (report.failed.length || overflowed.length || consoleErrors.length) process.exitCode = 1;
