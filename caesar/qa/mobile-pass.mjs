import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:5180";
const OUT = new URL(".", import.meta.url).pathname;

const ROUTES = [
  ["feed", "/"],
  ["circles", "/circles"],
  ["compose", "/compose"],
  ["profile", "/profile"],
  ["safety", "/safety"],
  ["measure", "/measure"],
];

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

const report = { viewport: "390x844 (Pixel 7)", pages: [], console: [], failed: [] };

for (const [name, path] of ROUTES) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));

  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const audit = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth - doc.clientWidth;

    // Anything sticking out past the right edge of the viewport.
    const wide = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > window.innerWidth + 1) {
        wide.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 60),
          right: Math.round(r.right),
          text: (el.textContent || "").trim().slice(0, 40),
        });
      }
    }

    // Tap targets smaller than 44px in either direction (WCAG 2.5.5 / Apple HIG).
    const small = [];
    for (const el of document.querySelectorAll("button, a[href], select, input, textarea, [role=menuitem]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 44) {
        small.push({
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 32),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }

    // Type smaller than 12px is hard to read in sunlight.
    const tiny = [];
    for (const el of document.querySelectorAll("p, span, div, a, button, li, dd, dt")) {
      if (!el.textContent || !el.textContent.trim()) continue;
      if (el.children.length > 0) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size && size < 12) tiny.push({ text: el.textContent.trim().slice(0, 36), size });
    }

    return {
      title: document.title,
      overflowX,
      wideCount: wide.length,
      wide: wide.slice(0, 6),
      smallCount: small.length,
      small: small.slice(0, 10),
      tinyCount: tiny.length,
      tiny: tiny.slice(0, 6),
      docHeight: doc.scrollHeight,
    };
  });

  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  report.pages.push({ name, path, ...audit, consoleErrors: errors });
  if (errors.length) report.console.push({ name, errors });

  await page.close();
}

// One interaction pass: open the verdict panel from the feed.
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.locator(".post__why").first().click();
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/verdict.png` });
const verdictBox = await page.evaluate(() => {
  const sheet = document.querySelector('[role="dialog"]') || document.querySelector(".sheet");
  if (!sheet) return null;
  const r = sheet.getBoundingClientRect();
  return { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top) };
});
report.verdictSheet = verdictBox;
await page.close();

await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

for (const p of report.pages) {
  console.log(
    `${p.name.padEnd(9)} overflow=${String(p.overflowX).padEnd(3)} wide=${String(p.wideCount).padEnd(2)} ` +
    `smallTargets=${String(p.smallCount).padEnd(3)} tinyText=${String(p.tinyCount).padEnd(3)} ` +
    `errors=${p.consoleErrors.length} height=${p.docHeight}`
  );
}
console.log("verdict sheet:", JSON.stringify(report.verdictSheet));
