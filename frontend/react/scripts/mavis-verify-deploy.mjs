/**
 * mavis-verify-deploy.mjs
 *
 * Proves that what is live is the build you just made, instead of assuming it.
 *
 * Every file the local dist/ references is hashed with SHA256, the same file
 * is fetched from the live site and hashed, and the two are compared. A
 * mismatch means the live site is serving a different build.
 *
 * Usage:
 *   node scripts/mavis-verify-deploy.mjs [--url <url>]
 *
 * Default URL: https://mavis-fantasy-grinder.pages.dev
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "..", "dist");

const urlIndex = process.argv.indexOf("--url");
const BASE = (
  urlIndex >= 0 ? process.argv[urlIndex + 1] : "https://mavis-fantasy-grinder.pages.dev"
).replace(/\/+$/, "");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

if (!existsSync(join(DIST, "index.html"))) {
  console.error("No dist/index.html. Run `npm run build` first.");
  process.exit(1);
}

const indexLocal = readFileSync(join(DIST, "index.html"));
const referenced = [...indexLocal.toString().matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map(
  (m) => m[1],
);
const files = ["index.html", ...referenced];

console.log(`Live site : ${BASE}`);
console.log(`Local build: ${DIST}`);
console.log("");

const rows = [];
for (const rel of files) {
  const localBuf = readFileSync(join(DIST, rel));
  const localHash = sha256(localBuf);
  let liveHash = "FETCH FAILED";
  try {
    const res = await fetch(`${BASE}/${rel}`);
    if (!res.ok) liveHash = `HTTP ${res.status}`;
    else liveHash = sha256(Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    liveHash = `ERROR ${err.message}`;
  }
  rows.push({ path: rel, localHash, liveHash, match: localHash === liveHash });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("path", 34) + pad("local sha256", 20) + pad("live sha256", 20) + "match");
for (const r of rows) {
  console.log(
    pad(r.path, 34) + pad(r.localHash.slice(0, 16), 20) + pad(r.liveHash.slice(0, 16), 20) + (r.match ? "YES" : "NO"),
  );
}

const bad = rows.filter((r) => !r.match);
console.log("");
if (bad.length === 0) {
  console.log(`MATCH — the live site is serving this exact build (${rows.length} files).`);
  process.exit(0);
}
console.log(`MISMATCH — ${bad.length} of ${rows.length} files differ from the live site:`);
for (const r of bad) console.log(`  - ${r.path}: local ${r.localHash.slice(0, 12)} vs live ${r.liveHash}`);
console.log("  The live site is serving a different build.");
process.exit(1);
