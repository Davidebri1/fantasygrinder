/**
 * Proves the honesty surfaces actually appear on screen.
 *
 * The sample-data banner is the single most important safety feature in the
 * app: if the live ESPN feed cannot be reached, the customer must not be able
 * to mistake a bundled sample slate for a live one. This script forces the
 * ESPN feed to fail, then asserts that the banner and the "these numbers are
 * estimates" notice are both on the page — and screenshots the result.
 *
 * Usage:
 *   node scripts/mavis-verify-disclosure.mjs [url] [outPng]
 *
 * Defaults: http://localhost:4174/#/nfl  mavis-sample-data-banner.png
 *
 * The app uses a HashRouter, so the optimizer screen lives at `/#/nfl`.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] ?? "http://localhost:4174/#/nfl";
const out = resolve(
  scriptDir,
  process.argv[3] ?? "../../../docs/mavis-sample-data-banner.png",
);

function findInstalledChromium() {
  const root = join(homedir(), "AppData", "Local", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    if (!dir.toLowerCase().startsWith("chromium")) continue;
    const base = join(root, dir);
    for (const rel of [
      join("chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      join("chrome-win64", "chrome.exe"),
      join("chrome-win", "chrome.exe"),
    ]) {
      const exe = join(base, rel);
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

async function launch() {
  try {
    return await chromium.launch();
  } catch (err) {
    const exe = findInstalledChromium();
    if (!exe) {
      throw new Error(
        "No Chromium available for Playwright. Run: npx playwright install chromium",
      );
    }
    console.error(`Using installed browser: ${exe}`);
    return await chromium.launch({ executablePath: exe });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Cut ESPN off at the network layer, exactly as an outage would.
await page.route(/espn\.com/i, (route) => route.abort("failed"));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const body = await page.innerText("body");

const bannerPresent = /Sample roster/i.test(body);
const estimateNoticePresent = /modelled from live ESPN data/i.test(body);
const statusSaysSample = /sample roster/i.test(body);
const claimsLive = /Live from ESPN/i.test(body);

console.log("sample-data banner visible:", bannerPresent);
console.log("estimate notice visible:", estimateNoticePresent);
console.log("status line names the sample:", statusSaysSample);
console.log("status line falsely claims live:", claimsLive);

await page.screenshot({ path: out, fullPage: false });
await browser.close();

const ok = bannerPresent && estimateNoticePresent && statusSaysSample && !claimsLive;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
