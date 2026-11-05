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
page.on("worker", (w) => workers.push(w.url()));

async function grab() {
  return await page.evaluate(() => {
    const arts = Array.from(document.querySelectorAll("article.panel"));
    const cards = arts.map(a => {
      const head = a.querySelector("header");
      const stats = head ? Array.from(head.querySelectorAll(".grid > div")).map(d => ({
        label: (d.querySelector(".label-quiet")?.textContent || "").trim(),
        value: (d.querySelector(".num")?.textContent || "").trim() })) : [];
      const rows = Array.from(a.querySelectorAll("tbody tr")).map(tr => {
        const tds = Array.from(tr.querySelectorAll("td"));
        const lines = (tds[0]?.innerText || "").trim().split("\n");
        return {
          player: lines[0] || "", slot: lines[1] || "",
          team: (tds[1]?.innerText || "").trim(), opp: (tds[2]?.innerText || "").trim(),
          salary: (tds[3]?.innerText || "").trim(), pts: (tds[4]?.innerText || "").trim(),
          exposure: (tds[6]?.innerText || "").trim() };
      });
      return { rank: (head?.querySelector(".font-condensed")?.textContent || "").trim(), stats, rows };
    });
    const body = document.body.innerText;
    const m = (re) => { const x = body.match(re); return x ? x[1] : null; };
    return {
      cards,
      stats: {
        built: m(/Lineups built\n(\d+)\nof (\d+) requested/),
        avgProj: m(/Average projection\n([\d.]+)/),
        avgSalary: m(/Average salary\n(\$[\d,]+)/),
        cap: m(/cap (\$[\d,]+)/),
      },
      warnings: Array.from(document.querySelectorAll("li")).map(e => (e.innerText||"").trim())
        .filter(t => t.length > 20 && (t.includes("Stack rule") || t.includes("Requested") || t.includes("exposure cap") || t.includes("could not") || t.includes("dropped"))),
      warningsAll: Array.from(document.querySelectorAll("li[class*='text-warn']")).map(e => (e.innerText||"").trim()),
      stackChip: Array.from(document.querySelectorAll("span[class*='chip-good']")).map(e=>(e.innerText||"").trim()),
    };
  });
}
async function tab(name) {
  await page.locator(`[role="tab"]`).filter({ hasText: name }).first().click();
  await page.waitForTimeout(1200);
}
async function waitBuild() {
  for (let i = 0; i < 60; i++) {
    const building = await page.locator('button:has-text("Building")').count();
    if (building === 0 && i > 2) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

await page.goto("http://localhost:4181/#/nfl", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(25000);
await waitBuild();

const before = await grab();
console.log("### BEFORE stats:", JSON.stringify(before.stats));
console.log("### BEFORE warnings:", JSON.stringify(before.warningsAll));
console.log("### BEFORE cards:", before.cards.length);
console.log("### BEFORE roster sizes:", JSON.stringify([...new Set(before.cards.map(c=>c.rows.length))]));
console.log("### BEFORE unique compositions:", new Set(before.cards.map(c=>c.rows.map(r=>r.player).sort().join("|"))).size);
console.log("### BEFORE salary values:", JSON.stringify([...new Set(before.cards.map(c=>c.stats.find(s=>s.label==="Salary")?.value))].slice(0,10)));
console.log("### BEFORE proj range:", before.cards[before.cards.length-1].stats.find(s=>s.label==="Projected")?.value, "->", before.cards[0].stats.find(s=>s.label==="Projected")?.value);
await page.screenshot({ path: OUT + "01-lineups-before.png" });

// Stacks tab
await tab("Stacks");
const stackRows = await page.evaluate(() =>
  Array.from(document.querySelectorAll("li")).map(li => li.innerText.trim()).filter(t => t.includes("Use stack")).slice(0,8));
console.log("### STACK OPTIONS:");
console.log(JSON.stringify(stackRows, null, 1));
await page.screenshot({ path: OUT + "02-stacks-panel.png" });

// Apply a TEAM stack if available, else the first game stack
const teamIdx = stackRows.findIndex(t => t.includes("man stack"));
const useIdx = teamIdx >= 0 ? teamIdx : 0;
console.log("### APPLYING STACK INDEX", useIdx, JSON.stringify(stackRows[useIdx]));
const stackText = stackRows[useIdx];
await page.locator('button:has-text("Use stack")').nth(useIdx).click();
await page.waitForTimeout(2000);
await waitBuild();
await page.waitForTimeout(3000);
await tab("Lineups");
const after = await grab();
console.log("### AFTER stats:", JSON.stringify(after.stats));
console.log("### AFTER warnings:", JSON.stringify(after.warningsAll));
console.log("### AFTER cards:", after.cards.length);
console.log("### AFTER roster sizes:", JSON.stringify([...new Set(after.cards.map(c=>c.rows.length))]));
console.log("### AFTER unique compositions:", new Set(after.cards.map(c=>c.rows.map(r=>r.player).sort().join("|"))).size);
console.log("### AFTER stack chip:", JSON.stringify(after.stackChip));
console.log("### AFTER proj range:", after.cards.length ? (after.cards[after.cards.length-1].stats.find(s=>s.label==="Projected")?.value + " -> " + after.cards[0].stats.find(s=>s.label==="Projected")?.value) : "n/a");
await page.screenshot({ path: OUT + "03-lineups-after-stack.png" });

// Verify the stack constraint: count players from the stacked scope per lineup
const applied = stackText;
const names = (applied.match(/(?:[A-Z][a-zA-Z.'\-]+(?: [A-Z][a-zA-Z.'\-]+)*) (?=\n[A-Z]{1,3}\n)/g) || []);
const teamsInStack = [...new Set(applied.match(/\b[A-Z]{2,3}\b/g) || [])];
console.log("### STACK NAMES DETECTED:", JSON.stringify(names.slice(0,8)));
console.log("### STACK TEAMS DETECTED:", JSON.stringify(teamsInStack));

const verify = await page.evaluate((teams) => {
  const arts = Array.from(document.querySelectorAll("article.panel"));
  const counts = arts.map(a => {
    const trs = Array.from(a.querySelectorAll("tbody tr"));
    let n = 0;
    for (const tr of trs) {
      const tds = Array.from(tr.querySelectorAll("td"));
      const team = (tds[1]?.innerText || "").trim();
      const opp = (tds[2]?.innerText || "").trim();
      if (teams.includes(team) || teams.includes(opp)) n++;
    }
    return n;
  });
  return { min: Math.min(...counts), max: Math.max(...counts), sample: counts.slice(0,10) };
}, teamsInStack.filter(t => t.length >= 2 && t.length <= 3));
console.log("### STACK MEMBERS PER LINEUP:", JSON.stringify(verify));

// Exposure tab + enter tab
await tab("Exposure");
const expTxt = await page.evaluate(() => document.body.innerText.slice(0, 1800));
console.log("### EXPOSURE TAB:", expTxt.slice(expTxt.indexOf("Exposure report")));
await page.screenshot({ path: OUT + "04-exposure.png" });
await tab("What to enter");
const enterTxt = await page.evaluate(() => document.body.innerText.slice(0, 1800));
console.log("### ENTER TAB:", enterTxt.slice(enterTxt.indexOf("Smart Recommendations")));
await page.screenshot({ path: OUT + "05-recommendations.png" });

console.log("### WORKERS:", JSON.stringify(workers));
await browser.close();