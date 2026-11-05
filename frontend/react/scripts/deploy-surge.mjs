#!/usr/bin/env node
// Publishes the already-built frontend/react/dist to the Surge site.
//
// Surge authenticates with a token that lives in the environment instead of
// in the repo, so CI and a developer machine can share this one script
// without any credential ever being written to disk by the script itself.

import { spawn, spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const distDir = path.join(projectDir, "dist");
const domain = "fantasygrinder.surge.sh";

const dryRun = process.argv.slice(2).includes("--dry-run");

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function describeBuild() {
  const files = await collectFiles(distDir);
  let bytes = 0;
  for (const file of files) {
    bytes += (await stat(file)).size;
  }
  return { count: files.length, bytes };
}

// The token is passed to the child process through the environment rather than
// on the command line, so it never shows up in a process listing.
async function publish(token) {
  const cli = resolveSurgeCli();
  const args = [...cli.args, "dist", domain];

  return new Promise((resolve) => {
    const child = spawn(cli.command, args, {
      cwd: projectDir,
      env: { ...process.env, SURGE_TOKEN: token },
      // Windows resolves surge through a .cmd shim, which cannot be started
      // directly by child_process without a shell.
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", (error) => {
      process.stderr.write(`Surge CLI could not be started: ${error.message}\n`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// Prefer an already-installed surge binary over npx so publishing does not
// depend on the registry being reachable at deploy time.
function resolveSurgeCli() {
  if (process.env.SURGE_CLI) {
    return { command: process.env.SURGE_CLI, args: [] };
  }
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["surge"], {
    encoding: "utf8",
  });
  if (probe.status === 0) {
    return {
      command: process.platform === "win32" ? "surge.cmd" : "surge",
      args: [],
    };
  }
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["--yes", "surge"],
  };
}

if (dryRun) {
  const { count, bytes } = await describeBuild();
  console.log(`Dry run: would publish ${count} files (${bytes} bytes) from ${distDir}`);
  console.log(`Dry run: destination would be https://${domain}/`);
  process.exit(0);
}

if (!(await stat(distDir).catch(() => null))) {
  process.stderr.write(`No build found at ${distDir}. Run "npm run build" in frontend/react first.\n`);
  process.exit(1);
}

const token = process.env.SURGE_TOKEN;
if (!token) {
  process.stderr.write(
    [
      "SURGE_TOKEN is not set, so Surge cannot be authenticated.",
      "",
      "Do this on the machine that publishes:",
      '  1. run "surge login --browser" and sign in,',
      "  2. make the token available as the SURGE_TOKEN environment variable",
      "     (a CI secret named SURGE_TOKEN works the same way),",
      "  3. re-run this script.",
      "",
      "This script never reads the token from a file and never prints it.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const { count, bytes } = await describeBuild();
console.log(`Publishing ${count} files (${bytes} bytes) from ${distDir} to https://${domain}/`);

const code = await publish(token);
if (code !== 0) {
  process.stderr.write(`Surge publish failed with exit code ${code}. The live site was not updated.\n`);
  process.exit(code);
}

console.log(`Published to https://${domain}/`);
