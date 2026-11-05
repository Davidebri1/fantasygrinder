/**
 * mavis-deploy-cloudflare.mjs
 *
 * Publishes the built frontend to Cloudflare Pages.
 *
 * The project is the static output of `npm run build` — a Vite build whose
 * assets are referenced relatively, so the same folder works on any host.
 *
 * Usage:
 *   node scripts/mavis-deploy-cloudflare.mjs [--dry-run] [--branch <name>]
 *
 * Authentication is whatever wrangler has on this machine (wrangler login).
 * Nothing secret is stored in this repo.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DIST = join(ROOT, "dist");

const PROJECT = process.env.CLOUDFLARE_PAGES_PROJECT ?? "mavis-fantasy-grinder";
const BRANCH = process.env.CLOUDFLARE_PAGES_BRANCH ?? "main";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const branchIndex = args.indexOf("--branch");
const branch = branchIndex >= 0 ? args[branchIndex + 1] : BRANCH;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error("No dist/ found. Run `npm run build` first.");
  process.exit(1);
}

const files = walk(DIST);
const bytes = files.reduce((n, f) => n + statSync(f).size, 0);

console.log(`Project : ${PROJECT}`);
console.log(`Branch  : ${branch}`);
console.log(`Source  : ${DIST}`);
console.log(`Files   : ${files.length} (${(bytes / 1024).toFixed(1)} KB)`);

if (dryRun) {
  console.log("Dry run — nothing was uploaded.");
  process.exit(0);
}

// Wrangler ships with the Cloudflare toolchain. Prefer a global install so a
// publish does not depend on downloading a package first.
function wranglerCommand() {
  const probe = spawnSync(
    process.platform === "win32" ? "where" : "which",
    ["wrangler"],
    { stdio: "ignore", shell: true },
  );
  if (probe.status === 0) return { cmd: "wrangler", args: [] };
  return { cmd: process.platform === "win32" ? "npx.cmd" : "npx", args: ["--yes", "wrangler"] };
}

// On Windows a `.cmd` shim (npx.cmd) cannot be spawned directly — it needs a
// shell. Without this the auth check below fails with ENOENT and the script
// wrongly reports "not authenticated".
const NEEDS_SHELL = process.platform === "win32";

/** Quote an argument for a Windows shell invocation. */
function shellArg(a) {
  return NEEDS_SHELL && /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

const { cmd, args: prefix } = wranglerCommand();

const check = spawnSync(
  cmd,
  [...prefix, "whoami"].map(shellArg),
  { encoding: "utf8", shell: NEEDS_SHELL },
);
if (check.status !== 0) {
  console.error(
    "\nWrangler is not authenticated on this machine.\n" +
      "Run `npx wrangler login` and approve it in your browser, then run this again.\n" +
      `(${check.stderr ?? check.error?.message ?? "whoami failed"})`,
  );
  process.exit(1);
}

const child = spawn(
  cmd,
  [
    ...prefix,
    "pages",
    "deploy",
    DIST,
    "--project-name",
    PROJECT,
    "--branch",
    branch,
    "--commit-dirty=true",
  ].map(shellArg),
  { stdio: "inherit", env: process.env, shell: NEEDS_SHELL },
);

child.on("exit", (code) => {
  if (code === 0) {
    console.log(`\nDeployed. Production URL: https://${PROJECT}.pages.dev`);
    console.log("Prove it matches this build: node scripts/mavis-verify-deploy.mjs");
  }
  process.exit(code ?? 1);
});
