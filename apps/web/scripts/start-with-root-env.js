#!/usr/bin/env node
/* eslint-disable */
// Загружает переменные из корневого .env репозитория и запускает `next start`.
// Нужно в монорепо, чтобы не дублировать .env в apps/web.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const appDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appDir, "..", "..");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) {
    return 0;
  }
  const raw = fs.readFileSync(file, "utf8");
  let count = 0;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
      count += 1;
    }
  }
  return count;
}

const candidates = [
  path.join(repoRoot, ".env"),
  path.join(repoRoot, ".env.local"),
  path.join(repoRoot, ".env.production"),
  path.join(repoRoot, ".env.production.local"),
];

let loaded = 0;
for (const p of candidates) {
  loaded += loadEnvFile(p);
}

if (loaded > 0) {
  console.log(`[start-with-root-env] loaded ${loaded} vars from repo root`);
}

const port = process.env.PORT || process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] || "3006";
const nextBin = require.resolve("next/dist/bin/next", { paths: [appDir, repoRoot] });

const child = spawn(process.execPath, [nextBin, "start", "-p", port], {
  stdio: "inherit",
  env: process.env,
  cwd: appDir,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    child.kill(sig);
  });
}
