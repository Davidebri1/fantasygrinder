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
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  // Fresh profile: no localStorage -> store v5 seeds the DK slate.
  await p.goto("http://127.0.0.1:4174/#/nfl", { waitUntil: "networkidle" });
  await p.waitForTimeout(9000);
  const body = await p.innerText("body");
  console.log("DK slate status:", body.includes("DraftKings slate loaded") || body.includes("JAX @ BAL"));
  console.log("players visible:", /T. Lawrence|Lamar Jackson|Z. Flowers|Derrick Henry|Mark Andrews/i.test(body));
  console.log("salary column:", body.includes("Salary"));
  console.log("build button:", body.includes("Build portfolio"));
  await p.screenshot({ path: "C:/Users/D/mavis-fantasy-grinder/docs/brand/mavis-app-dk-seed.png" });
  await b.close();
  console.log("done");
})().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
