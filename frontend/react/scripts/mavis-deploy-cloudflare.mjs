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
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DIST = join(ROOT, "dist");

const PROJECT = process.env.CLOUDFLARE_PAGES_PROJECT ?? "mavis-fantasy-grinder";
const BRANCH = process.env.CLOUDFLARE_PAGES_BRANCH ?? "main";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "2699adb1984283a8486bc169c8376a21";

/**
 * Wrangler version that is allowed to run here.
 *
 * 4.158+ refuses an OAuth login in a non-interactive shell and demands a
 * long-lived API token instead. 4.157 refreshes the stored OAuth session on
 * its own, so it needs nothing from anyone at deploy time. That is the
 * whole reason this is pinned.
 */
const WRANGLER_VERSION = "4.157.0";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const checkOnly = args.includes("--check");
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

// On Windows a `.cmd` shim (npx.cmd) cannot be spawned directly — it needs
// a shell. Without this the auth check below fails with ENOENT and the script
// wrongly reports "not authenticated".
const NEEDS_SHELL = process.platform === "win32";

/** Quote an argument for a Windows shell invocation. */
function shellArg(a) {
  return NEEDS_SHELL && /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

/**
 * Pick the wrangler to run.
 *
 * A global wrangler is only used when we can PROVE it is old enough to
 * accept an OAuth login without a token. A global wrangler that is too new
 * is passed over in favour of the pinned version, because "newer" here means
 * "refuses to deploy without a human".
 */
function wranglerCommand() {
  const probe = spawnSync(
    process.platform === "win32" ? "where" : "which",
    ["wrangler"],
    { stdio: "ignore", shell: true },
  );
  if (probe.status === 0) {
    const ver = spawnSync("wrangler", ["--version"], { encoding: "utf8", shell: true });
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(ver.stdout ?? "");
    if (m) {
      const major = Number(m[1]);
      const minor = Number(m[2]);
      if (major < 4 || (major === 4 && minor < 158)) return { cmd: "wrangler", args: [] };
    }
  }
  return {
    cmd: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["--yes", `wrangler@${WRANGLER_VERSION}`],
  };
}

const { cmd, args: prefix } = wranglerCommand();

/**
 * Confirm we can publish, and say where to. This is a read-only check on
 * the stored session — it never prompts.
 */
// The stored wrangler login lives in one of two config roots depending on
// which wrangler wrote it (XDG_CONFIG_HOME or ~/.wrangler). Unify them here
// so "not authenticated" can never be a config-root mixup again.
function unifyWranglerConfig() {
  const candidates = [
    join(process.env.APPDATA ?? homedir(), "xdg.config", ".wrangler"),
    join(homedir(), ".wrangler"),
  ];
  const dirs = candidates.filter(existsSync);
  if (dirs.length < 2) return;
  for (const file of ["default.toml"]) {
    let best = null;
    for (const d of dirs) {
      const p = join(d, "config", file);
      if (!existsSync(p)) continue;
      const st = statSync(p);
      if (!best || st.mtimeMs > best.mtimeMs) best = { p, mtime: st.mtimeMs };
    }
    if (!best) continue;
    for (const d of dirs) {
      const p = join(d, "config", file);
      if (p !== best.p) {
        try {
          const src = readFileSync(best.p);
          if (!existsSync(p) || statSync(p).mtimeMs < best.mtimeMs) {
            writeFileSync(p, src);
          }
        } catch { /* read-only root: skip */ }
      }
    }
  }
}
unifyWranglerConfig();

const whoami = spawnSync(
  cmd,
  [...prefix, "whoami"].map(shellArg),
  { encoding: "utf8", shell: NEEDS_SHELL },
);

if (whoami.status !== 0) {
  console.error(
    "\nDeploy authentication is missing on this machine.\n" +
      "This is ONE-TIME setup, not a per-deploy step: the OAuth session\n" +
      "refreshes itself from then on, and nothing in the publish path ever\n" +
      "needs a human again.\n\n" +
      `  npx wrangler@${WRANGLER_VERSION} login\n\n` +
      "Run that once. Then deploys are a command, not a conversation.\n" +
      `(${whoami.stderr ?? whoami.error?.message ?? "whoami failed"})`,
  );
  process.exit(1);
}

const authLines = (whoami.stdout ?? "")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);
const authLine = authLines.find((l) => l.includes("logged in with"));
const accountLine = authLines.find((l) => l.includes("Account Name"));

console.log(`Auth    : ${authLine ?? "OAuth session active"}`);
console.log(`Project : ${PROJECT} (account ${ACCOUNT})`);
console.log(`Branch  : ${branch}`);

if (checkOnly) {
  console.log("\nDeploy auth is good. Nothing was uploaded.");
  process.exit(0);
}

if (!existsSync(DIST)) {
  console.error("No dist/ found. Run `npm run build` first.");
  process.exit(1);
}

const files = walk(DIST);
const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
console.log(`Source  : ${DIST}`);
console.log(`Files   : ${files.length} (${(bytes / 1024).toFixed(1)} KB)`);

if (dryRun) {
  console.log("Dry run — nothing was uploaded.");
  process.exit(0);
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
  {
    stdio: "inherit",
    shell: NEEDS_SHELL,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
  },
);

child.on("exit", (code) => {
  if (code === 0) {
    console.log(`\nDeployed. Production URL: https://${PROJECT}.pages.dev`);
    console.log("Prove it matches this build: node scripts/mavis-verify-deploy.mjs");
  }
  process.exit(code ?? 1);
});
