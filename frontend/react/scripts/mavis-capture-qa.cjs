/**
 * mavis-capture-qa.cjs
 *
 * Captures the QA record for the honest-fields fix round.
 *
 * Usage:
 *   node scripts/mavis-capture-qa.cjs <url> <outDir> <label>
 *
 * It opens the app on the NFL slate and captures two states:
 *
 *   1. as it opens  — the DraftKings slate, real published prices
 *   2. after Refresh — an ESPN pool, which has no published prices at all
 *
 * It then asserts the state the fix round promised, and writes the
 * assertions next to the images so the record cannot drift from the app.
 */
const { existsSync, mkdirSync, readdirSync, writeFileSync } = require("fs");
const { homedir } = require("os");
const { join } = require("path");
const { chromium } = require("playwright");

function findChromium() {
  const root = join(homedir(), "AppData", "Local", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    if (!dir.toLowerCase().startsWith("chromium")) continue;
    for (const rel of [
      join(dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      join(dir, "chrome-win64", "chrome.exe"),
      join(dir, "chrome-win", "chrome.exe"),
    ]) {
      const exe = join(root, rel);
      if (existsSync(exe)) return exe;
    }
  }
}

const url = process.argv[2] ?? "http://127.0.0.1:4174/";
const outDir = process.argv[3] ?? "C:/Users/D/mavis-fantasy-grinder/docs/shots";
const label = process.argv[4] ?? "shot";

(async () => {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: findChromium() });
  // A fresh profile: no localStorage, so the app opens on the seeded slate.
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const result = { url, label, checks: {}, shots: [] };

  await page.goto(url + "#/nfl", { waitUntil: "networkidle" });
  await page.waitForTimeout(9000);

  const openText = await page.innerText("body");
  result.checks.opensOnDkSlate = /DraftKings slate loaded|JAX @ BAL/i.test(openText);
  result.checks.showsRealPrices = /\$\s?\d\d,\d\d\d/.test(openText);
  result.checks.hasOwnPctColumn = openText.includes("Own % (est.)");
  result.checks.hasEstSalaryColumn = openText.includes("Est. salary");
  result.checks.hasPendingSalary = openText.includes("Pending");
  result.checks.noPrebuiltLineups = openText.includes("No lineups yet");
  result.checks.showsLineupCards = /Lineup #\d/.test(openText);

  const openShot = join(outDir, label + "-1-open.png");
  await page.screenshot({ path: openShot, fullPage: false });
  result.shots.push(openShot);

  // The player pool tab, where the columns live.
  const poolTab = page.getByText("Player pool", { exact: true }).first();
  if (await poolTab.count()) {
    await poolTab.click();
    await page.waitForTimeout(1200);
    const poolShot = join(outDir, label + "-2-pool.png");
    await page.screenshot({ path: poolShot, fullPage: false });
    result.shots.push(poolShot);
    const poolText = await page.innerText("body");
    result.checks.poolHasOwnPct = poolText.includes("Own % (est.)");
    result.checks.poolHasEstSalary = poolText.includes("Est. salary");
  }

  // Refresh pulls ESPN live: that pool has no published prices, which is
  // the state the fix is really about.
  const refresh = page.getByRole("button", { name: /refresh/i }).first();
  if (await refresh.count()) {
    await refresh.click();
    await page.waitForTimeout(14000);
    const espnShot = join(outDir, label + "-3-espn-pool.png");
    await page.screenshot({ path: espnShot, fullPage: false });
    result.shots.push(espnShot);
    const espnText = await page.innerText("body");
    result.checks.espnShowsPending = espnText.includes("Pending");
    result.checks.espnHasPricesMissingBanner = /No DraftKings prices/i.test(espnText);
    result.checks.espnStillHasOwnPct = espnText.includes("Own % (est.)");
    result.checks.espnShowsEstimateColumn = espnText.includes("Est. salary");
  }

  writeFileSync(
    join(outDir, label + "-checks.json"),
    JSON.stringify(result, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(String(e).slice(0, 600));
  process.exit(1);
});
