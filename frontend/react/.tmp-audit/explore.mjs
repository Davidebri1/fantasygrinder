import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

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

const browser = await chromium.launch({ executablePath: findInstalledChromium() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
const failedReqs = [];
const espnReqs = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
page.on("requestfailed", (r) => failedReqs.push(r.url().slice(0, 140) + " :: " + (r.failure()?.errorText ?? "")));
page.on("request", (r) => { if (r.url().includes("espn.com")) espnReqs.push(r.url()); });

await page.goto("http://localhost:4181/#/nfl", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(20000);

const bodyText = await page.evaluate(() => document.body.innerText);
const buttons = await page.evaluate(() =>
  Array.from(document.querySelectorAll("button")).map((b, i) => ({
    i, text: (b.innerText || b.getAttribute("aria-label") || "").trim().slice(0, 60)
  })).filter(x => x.text)
);

console.log("=== TITLE ===", await page.title());
console.log("=== BODY TEXT (first 7000) ===");
console.log(bodyText.slice(0, 7000));
console.log("=== BUTTONS ===");
console.log(JSON.stringify(buttons));
console.log("=== CONSOLE ERRORS ===", JSON.stringify(consoleErrors.slice(0, 12)));
console.log("=== FAILED REQUESTS ===", JSON.stringify(failedReqs.slice(0, 12)));
console.log("=== ESPN REQ COUNT ===", espnReqs.length);
console.log(JSON.stringify(espnReqs.slice(0, 20), null, 1));

await page.screenshot({ path: "C:/Users/D/fantasygrinder/frontend/react/.tmp-audit/explore-nfl.png" });
await browser.close();

