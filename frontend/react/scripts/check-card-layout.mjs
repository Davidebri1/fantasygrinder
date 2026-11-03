import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4174/";
const out = process.argv[3] ?? "home-cards-desktop.png";

const browser = await chromium.launch({
  executablePath:
    "C:/Users/D/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const cards = await page.$$eval("a.rounded-3", (els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      href: el.getAttribute("href"),
      label: el.innerText.split("\n").filter(Boolean).slice(1, 2)[0] ?? "",
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      transform: cs.transform,
      zIndex: cs.zIndex,
    };
  }),
);

console.log(JSON.stringify(cards, null, 2));

const tops = new Set(cards.map((c) => c.y));
const heights = new Set(cards.map((c) => c.h));
const lefts = new Set(cards.map((c) => c.x));
console.log("unique tops:", [...tops]);
console.log("unique heights:", [...heights]);
console.log("unique left edges:", [...lefts]);
console.log(
  "aligned row:",
  tops.size === 1 && heights.size === 1 && lefts.size === 1 && cards.length === 4,
);

await page.screenshot({ path: out });
await browser.close();
