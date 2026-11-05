const { existsSync, readdirSync } = require("fs");
const { homedir } = require("os");
const { join } = require("path");
const { chromium } = require("playwright");
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
(async () => {
  const b = await chromium.launch({ executablePath: findChromium() });
  const p = await b.newPage({ viewport: { width: 620, height: 580 } });
  await p.goto("file:///C:/Users/D/mavis-fantasy-grinder/docs/brand/mavis-logo-v2-preview.html");
  await p.waitForTimeout(600);
  await p.screenshot({ path: "C:/Users/D/mavis-fantasy-grinder/docs/brand/mavis-outlier-field-preview.png" });
  await b.close();
  console.log("rendered");
})().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
