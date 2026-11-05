#!/usr/bin/env node
// Proves that the live Surge site is byte-for-byte the same build that sits
// in frontend/react/dist.
//
// Comparing hashes is enough on its own, but the failure message has to name
// the specific files that drifted, otherwise a mismatch is not actionable.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(scriptDir, "..", "dist");

const urlIndex = process.argv.indexOf("--url");
const siteUrl =
  urlIndex !== -1 && process.argv[urlIndex + 1]
    ? process.argv[urlIndex + 1]
    : "https://fantasygrinder.surge.sh/";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// The built index.html is the only file that names the hashed asset bundle,
// so its references are the authoritative list of what the live site must serve.
async function referencedAssets() {
  const html = await readFile(path.join(distDir, "index.html"), "utf8");
  const matches = html.matchAll(/\.\/assets\/[A-Za-z0-9._-]+/g);
  return [...new Set([...matches].map((match) => match[0].replace(/^\.\//, "")))];
}

async function fetchBytes(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    return { ok: false, status: response.status, buffer: null };
  }
  return { ok: true, status: response.status, buffer: Buffer.from(await response.arrayBuffer()) };
}

const rows = [];
const failures = [];

const indexLocal = await readFile(path.join(distDir, "index.html"));
const indexLocalHash = sha256(indexLocal);
const indexLive = await fetchBytes(new URL("index.html", siteUrl).href);

if (!indexLive.ok) {
  rows.push({
    path: "index.html",
    local: indexLocalHash,
    live: `HTTP ${indexLive.status}`,
    match: false,
  });
  failures.push(`index.html could not be fetched from the live site (HTTP ${indexLive.status})`);
} else {
  const indexLiveHash = sha256(indexLive.buffer);
  const matches = indexLocalHash === indexLiveHash;
  rows.push({ path: "index.html", local: indexLocalHash, live: indexLiveHash, match: matches });
  if (!matches) {
    failures.push("index.html differs between the local build and the live site");
  }
}

for (const asset of await referencedAssets()) {
  const localFile = await readFile(path.join(distDir, asset));
  const localHash = sha256(localFile);
  const live = await fetchBytes(new URL(asset, siteUrl).href);

  if (!live.ok) {
    rows.push({ path: asset, local: localHash, live: `HTTP ${live.status}`, match: false });
    failures.push(`${asset} is missing from the live site (HTTP ${live.status})`);
    continue;
  }

  const liveHash = sha256(live.buffer);
  const matches = localHash === liveHash;
  rows.push({ path: asset, local: localHash, live: liveHash, match: matches });
  if (!matches) {
    failures.push(`${asset} differs between the local build and the live site`);
  }
}

const pathWidth = Math.max(...rows.map((row) => row.path.length));
const hashWidth = Math.max(...rows.map((row) => row.local.length), ...rows.map((row) => row.live.length));

console.log(`Live site: ${siteUrl}`);
console.log("Local build: " + distDir);
console.log("");
console.log(
  `${"path".padEnd(pathWidth)}  ${"local sha256".padEnd(hashWidth)}  ${"live sha256".padEnd(hashWidth)}  match`,
);
for (const row of rows) {
  console.log(
    `${row.path.padEnd(pathWidth)}  ${row.local.padEnd(hashWidth)}  ${row.live.padEnd(hashWidth)}  ${row.match ? "yes" : "NO"}`,
  );
}
console.log("");

if (failures.length > 0) {
  process.stderr.write("Live site does NOT match the local build:\n");
  for (const failure of failures) {
    process.stderr.write(`  - ${failure}\n`);
  }
  process.stderr.write(
    "\nThe local build has not been published (or the live site serves an older build).\n",
  );
  process.exit(1);
}

console.log("Live site matches the local build.");
