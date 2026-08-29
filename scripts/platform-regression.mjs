#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { regressionCaseById } from "../regression/catalog/index.mjs";
import { evaluatePlatformMatrix } from "../regression/platform-matrix.mjs";
import { evaluateMacPlatformSequence } from "../regression/macos-platform-sequence.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const help = args.includes("--help");
const json = args.includes("--json");
const requireAll = args.includes("--require-all");
const caseIndex = args.indexOf("--case");
const caseId = caseIndex >= 0 ? args[caseIndex + 1] : null;
const evidenceIndex = args.indexOf("--evidence-dir");
const evidenceDirectory = evidenceIndex >= 0 ? path.resolve(args[evidenceIndex + 1] ?? "") : null;
const valued = new Set(caseIndex >= 0 ? [caseId] : []);
if (evidenceIndex >= 0) valued.add(args[evidenceIndex + 1]);
const known = new Set(["--help", "--json", "--require-all", "--case", "--evidence-dir", ...valued]);
const unknown = args.filter((arg) => !known.has(arg));
if (help) {
  console.log("Usage: platform-regression.mjs [--case CASE-ID] [--evidence-dir DIR] [--require-all] [--json]");
  console.log("Runs the current real platform and merges revision-bound macOS/Linux evidence.");
  process.exit(0);
}
if (unknown.length || (caseIndex >= 0 && !caseId) || (evidenceIndex >= 0 && !evidenceDirectory)) {
  throw new Error("Invalid platform regression arguments");
}
if (caseId) {
  const entry = regressionCaseById.get(caseId);
  if (!entry) throw new Error(`Unknown regression case: ${caseId}`);
  if (!entry.layers.includes("L5")) throw new Error(`Case ${caseId} has no platform layer`);
}

async function gitState() {
  const [{ stdout: revision }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectRoot }),
    execFileAsync("git", ["status", "--porcelain"], { cwd: projectRoot }),
  ]);
  return { dirty: status.trim().length > 0, revision: revision.trim() };
}

function jsonLine(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch {}
  }
  throw new Error("platform child returned no JSON result");
}

async function runChild(script, childArgs) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [script, ...childArgs, "--json"], {
      cwd: projectRoot, timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024,
    });
    return jsonLine(stdout);
  } catch (error) {
    const parsed = error.stdout ? (() => { try { return jsonLine(error.stdout); } catch { return null; } })() : null;
    return parsed ?? { actual: true, reasonCodes: ["platform-child-failed"], status: "fail" };
  }
}

const source = await gitState();
const platform = process.platform === "darwin" ? "macos"
  : process.platform === "linux" ? "linux" : null;
let current;
if (platform === "macos") {
  const official = await runChild("scripts/macos-platform-regression.mjs", ["--official"]);
  const injected = await runChild("scripts/macos-platform-regression.mjs", ["--injected"]);
  const recovery = await runChild("scripts/macos-platform-regression.mjs", ["--official"]);
  const sequence = evaluateMacPlatformSequence({ official, injected, recovery });
  current = {
    actual: true, dirty: source.dirty, revision: source.revision,
    status: sequence.status, reasonCodes: sequence.reasonCodes,
    modes: { official, injected, recovery },
    performance: sequence.performance,
    processBoundary: sequence.failures.includes("recovery-process-boundary") === false,
  };
} else if (platform === "linux") {
  const result = await runChild("scripts/linux-platform-regression.mjs", []);
  current = { ...result, actual: true, dirty: source.dirty, revision: source.revision };
} else {
  current = {
    actual: false, dirty: source.dirty, revision: source.revision,
    reasonCodes: ["unsupported-host-platform"], status: "unverified",
  };
}

const results = {};
if (platform) results[platform] = current;
if (evidenceDirectory) {
  for (const name of ["macos", "linux"]) {
    if (name === platform) continue;
    const filename = path.join(evidenceDirectory, `${name}.json`);
    const value = await fs.readFile(filename, "utf8").then(JSON.parse).catch(() => null);
    if (value) results[name] = value;
  }
}
const matrix = evaluatePlatformMatrix({ results, revision: source.revision });
const outputDirectory = path.join(
  projectRoot, "regression-results", "platform-evidence", source.revision,
);
await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
if (platform) await fs.writeFile(
  path.join(outputDirectory, `${platform}.json`), `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 },
);
const report = {
  schema: "codexctl-platform-regression/1",
  currentPlatform: platform,
  current,
  matrix,
  status: current.status,
};
if (json) console.log(JSON.stringify(report));
else console.log(`Platform regression ${report.status}; all platforms: ${matrix.status}`);
if (current.status !== "pass") process.exitCode = current.status === "unverified" ? 2 : 1;
else if (requireAll && !matrix.allPlatformsPass) process.exitCode = 2;
