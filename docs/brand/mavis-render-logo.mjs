
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
function findChromium() {
  const root = join(homedir(), "AppData", "Local", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    if (!dir.toLowerCase().startsWith("chromium")) continue;
    for (const rel of [join(dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe"), join(dir, "chrome-win64", "chrome.exe"), join(dir, "chrome-win", "chrome.exe")]) {
      const exe = join(root, rel);
      if (existsSync(exe)) return exe;
    }
  }
}
const browser = await chromium.launch({ executablePath: findChromium() ?? undefined });
const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
await page.goto("file:///C:/Users/D/mavis-fantasy-grinder/docs/brand/mavis-logo-preview.html");
await page.waitForTimeout(800);
await page.screenshot({ path: "C:/Users/D/mavis-fantasy-grinder/docs/brand/mavis-outlier-logo-preview.png" });
await browser.close();
console.log("done");
