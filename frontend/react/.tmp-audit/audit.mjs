import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

function findChromium() {
  const root = join(homedir(), "AppData", "Local", "ms-playwright");
  for (const dir of readdirSync(root)) {
    if (!dir.toLowerCase().startsWith("chromium")) continue;
    for (const rel of [join("chrome-headless-shell-win64","chrome-headless-shell.exe"), join("chrome-win64","chrome.exe")]) {
      const exe = join(root, dir, rel);
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const OUT = "C:/Users/D/fantasygrinder/frontend/react/.tmp-audit/";
const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });

const workers = [];
const espn = [];
const failed = [];
page.on("worker", (w) => workers.push(w.url()));
page.on("request", (r) => { if (r.url().includes("espn.com")) espn.push(r.url().replace("https://site.web.api.espn.com/apis/site/v2/sports","")); });
page.on("requestfailed", (r) => failed.push(r.url().slice(0,120)));

async function clickText(txt) {
  const el = page.locator(`text="${txt}"`).first();
  await el.click({ timeout: 15000 });
}

async function grab() {
  return await page.evaluate(() => {
    const arts = Array.from(document.querySelectorAll("article.panel"));
    const cards = arts.map(a => {
      const head = a.querySelector("header");
      const stats = head ? Array.from(head.querySelectorAll(".grid > div")).map(d => ({
        label: (d.querySelector(".label-quiet")?.textContent || "").trim(),
        value: (d.querySelector(".num")?.textContent || "").trim(),
      })) : [];
      const rows = Array.from(a.querySelectorAll("tbody tr")).map(tr => {
        const tds = Array.from(tr.querySelectorAll("td"));
        return {
          player: (tds[0]?.innerText || "").trim().split("\n")[0],
          slot: ((tds[0]?.innerText || "").trim().split("\n")[1] || ""),
          team: (tds[1]?.innerText || "").trim(),
          opp: (tds[2]?.innerText || "").trim(),
          salary: (tds[3]?.innerText || "").trim(),
          pts: (tds[4]?.innerText || "").trim(),
          exposure: (tds[6]?.innerText || "").trim(),
        };
      });
      return { rank: (head?.querySelector(".font-condensed")?.textContent || "").trim(), stats, rows };
    });
    const body = document.body.innerText;
    const m = (re) => { const x = body.match(re); return x ? x[1] : null; };
    return {
      cards,
      headline: {
        slateLine: m(/Live from ESPN[^\n]*/),
        lineupsBuilt: m(/Lineups built\n?([\d,]+ of [\d,]+ requested)/),
        avgProj: m(/Average projection\n?([\d.]+)/),
        avgSalary: m(/Average salary\n?(\$[\d,]+)/),
        avgRoto: m(/Average Roto Score\n?([\d.]+)/),
        cap: m(/cap (\$[\d,]+)/),
        elapsed: m(/(\d{2,5})ms/),
      },
      warnings: Array.from(document.querySelectorAll("li,div,p")).map(e => (e.innerText||"").trim())
        .filter(t => t.startsWith("Stack rule") || t.startsWith("Requested ") || t.startsWith("A ") && t.includes("exposure cap"))
        .slice(0, 10),
      bodySample: body.slice(0, 1200),
    };
  });
}

await page.goto("http://localhost:4181/#/nfl", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(30000);

const before = await grab();
console.log("### HEADLINE BEFORE ###");
console.log(JSON.stringify(before.headline, null, 1));
console.log("### CARD COUNT ###", before.cards.length);
console.log("### FIRST CARD ###");
console.log(JSON.stringify(before.cards[0], null, 1));
console.log("### LAST CARD ###");
console.log(JSON.stringify(before.cards[before.cards.length-1], null, 1));
console.log("### WARNINGS ###", JSON.stringify(before.warnings, null, 1));

await page.screenshot({ path: OUT + "01-lineups-before.png", fullPage: false });

// ---- Stack test ----
await clickText("Stacks");
await page.waitForTimeout(2500);
const stackInfo = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll("li")).map(li => li.innerText.trim()).filter(t => t.includes("stack") || t.includes("Stack"));
  const useButtons = Array.from(document.querySelectorAll("button")).filter(b => (b.innerText||"").trim() === "Use stack").length;
  return { firstItems: items.slice(0,4), useStackButtons: useButtons, bodyHead: document.body.innerText.slice(0, 1500) };
});
console.log("### STACK PANEL ###");
console.log(JSON.stringify(stackInfo, null, 1));
await page.screenshot({ path: OUT + "02-stacks-panel.png", fullPage: false });

const useBtn = page.locator('button:has-text("Use stack")').first();
await useBtn.click();
await page.waitForTimeout(25000);

await clickText("Lineups");
await page.waitForTimeout(2500);
const after = await grab();
console.log("### HEADLINE AFTER ###");
console.log(JSON.stringify(after.headline, null, 1));
console.log("### CARD COUNT AFTER ###", after.cards.length);
console.log("### FIRST CARD AFTER ###");
console.log(JSON.stringify(after.cards[0], null, 1));
console.log("### WARNINGS AFTER ###", JSON.stringify(after.warnings, null, 1));
await page.screenshot({ path: OUT + "03-lineups-after-stack.png", fullPage: false });

console.log("### WORKERS ###", JSON.stringify(workers));
console.log("### ESPN REQ COUNT ###", espn.length);
console.log("### ESPN REQ SAMPLE ###", JSON.stringify(espn.slice(0, 12), null, 1));
console.log("### FAILED ###", JSON.stringify(failed.slice(0,10)));

await browser.close();