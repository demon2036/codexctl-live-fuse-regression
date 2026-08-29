#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { regressionCases, regressionCaseById } from "../regression/catalog/index.mjs";
import { aggregateRun } from "../regression/orchestrator.mjs";
import { writeRegressionResults } from "../regression/results.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const help = args.includes("--help");
const json = args.includes("--json");
const quick = args.includes("--quick");
const caseIndex = args.indexOf("--case");
const caseId = caseIndex >= 0 ? args[caseIndex + 1] : null;
const evidenceIndex = args.indexOf("--evidence-dir");
const evidenceDirectory = evidenceIndex >= 0 ? args[evidenceIndex + 1] : null;
const values = [caseId, evidenceDirectory].filter(Boolean);
const consumed = new Set(["--help", "--json", "--quick", "--case", "--evidence-dir", ...values]);
const unknown = args.filter((arg) => !consumed.has(arg));
if (help) {
  console.log("Usage: regression.mjs [--case CASE-ID] [--evidence-dir DIR] [--quick] [--json]");
  console.log("Runs every required layer once, maps the results to all selected OpenSpec cases, and writes audited output.");
  process.exit(0);
}
if (unknown.length || (caseIndex >= 0 && !caseId) || (evidenceIndex >= 0 && !evidenceDirectory)) {
  throw new Error("Invalid regression arguments");
}
if (caseId && !regressionCaseById.has(caseId)) throw new Error(`Unknown regression case: ${caseId}`);

const selected = caseId ? [regressionCaseById.get(caseId)] : regressionCases;
const startedAt = new Date().toISOString();
const runId = randomUUID();
const outputId = `regression-${runId}`;
const output = path.join(projectRoot, "regression-results", outputId);
const suiteDirectory = path.join(output, "suites");
await fs.mkdir(suiteDirectory, { recursive: true, mode: 0o700 });

async function sourceState() {
  const [{ stdout: revision }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectRoot }),
    execFileAsync("git", ["status", "--porcelain"], { cwd: projectRoot }),
  ]);
  return { dirty: status.trim().length > 0, revision: revision.trim() };
}

function parseLastJson(text) {
  const lines = String(text).trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch {}
  }
  return null;
}

const suitePromises = new Map();
function suiteCommand(name) {
  if (name === "fast") return [process.execPath, ["scripts/fast-regression.mjs"]];
  if (name === "browser") return [process.execPath, ["scripts/browser-regression.mjs", "--json"]];
  if (name === "app") return [process.execPath, ["scripts/app-regression.mjs", "--json"]];
  if (name === "performance") return [process.execPath, [
    "scripts/performance-regression.mjs", "--json", ...(quick ? ["--quick"] : []),
  ]];
  if (name === "platform") return [process.execPath, [
    "scripts/platform-regression.mjs", "--json", "--require-all",
    ...(evidenceDirectory ? ["--evidence-dir", evidenceDirectory] : []),
  ]];
  throw new Error(`Unknown suite: ${name}`);
}

async function runSuite(name) {
  if (suitePromises.has(name)) return suitePromises.get(name);
  const promise = (async () => {
    const [command, commandArgs] = suiteCommand(name);
    const started = performance.now();
    let status = "pass";
    let exitCode = 0;
    let stdout = "";
    try {
      ({ stdout } = await execFileAsync(command, commandArgs, {
        cwd: projectRoot, timeout: 20 * 60_000, maxBuffer: 8 * 1024 * 1024,
      }));
    } catch (error) {
      exitCode = Number.isInteger(error.code) ? error.code : 1;
      stdout = String(error.stdout ?? "");
      status = exitCode === 2 ? "unverified" : "fail";
    }
    const durationMs = Math.round(performance.now() - started);
    const data = parseLastJson(stdout);
    const record = { command: [command, ...commandArgs].join(" "), durationMs, exitCode, status };
    await fs.writeFile(
      path.join(suiteDirectory, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 },
    );
    return { ...record, data };
  })();
  suitePromises.set(name, promise);
  return promise;
}

function suiteFor(entry, layer) {
  if (layer === "L1" || layer === "L2") return "fast";
  if (layer === "L3") return "browser";
  if (layer === "L5") return "platform";
  if (layer === "L4" && entry.id.startsWith("PERFORMANCE-")) return "performance";
  return "app";
}

function platformLayerStatus(entry, suite) {
  const matrix = suite.data?.matrix;
  if (!matrix) return { reasonCode: "platform-result-missing", status: suite.status };
  const targets = entry.platforms.includes("all") ? ["macos", "linux"] : entry.platforms;
  const failed = targets.find((name) => matrix.platforms?.[name]?.status !== "pass");
  return failed
    ? { reasonCode: `${failed}-unverified`, status: "unverified" }
    : { reasonCode: null, status: "pass" };
}

const severity = ["pass", "blocked", "unverified", "invalid", "fail"];
const source = await sourceState();
const cases = [];
for (const entry of selected) {
  const layers = [];
  for (const layer of entry.layers) {
    const suiteName = suiteFor(entry, layer);
    const suite = await runSuite(suiteName);
    const outcome = layer === "L5" ? platformLayerStatus(entry, suite) : {
      reasonCode: suite.status === "pass" ? null : `${suiteName}-${suite.status}`,
      status: suite.status,
    };
    layers.push({ ...outcome, durationMs: suite.durationMs, layer, suiteName });
  }
  const worst = layers.reduce((left, right) => (
    severity.indexOf(right.status) > severity.indexOf(left.status) ? right : left
  ));
  const dirtyFailure = entry.id === "TDD-REVISION-CONSISTENCY-024" && source.dirty;
  cases.push({
    durationMs: layers.reduce((sum, layer) => sum + layer.durationMs, 0),
    evidence: [...new Set(layers.map(({ suiteName }) => `suites/${suiteName}.json`))],
    id: entry.id,
    layer: entry.layers.at(-1),
    metrics: {},
    platform: entry.platforms.length === 1 ? entry.platforms[0] : "all",
    reasonCode: dirtyFailure ? "dirty-worktree" : worst.reasonCode,
    status: dirtyFailure ? "fail" : worst.status,
  });
}
const aggregated = aggregateRun({ caseResults: cases, cleanup: { status: "pass" } });
const appVersion = process.platform === "darwin"
  ? await execFileAsync("/usr/bin/plutil", [
    "-extract", "CFBundleShortVersionString", "raw", "-o", "-",
    "/Applications/ChatGPT.app/Contents/Info.plist",
  ]).then(({ stdout }) => stdout.trim()).catch(() => "unavailable")
  : "platform-package";
const summary = {
  schema: "codexctl-regression-summary/1",
  runId,
  revision: source.revision,
  dirty: source.dirty,
  status: aggregated.status,
  startedAt,
  completedAt: new Date().toISOString(),
  environment: {
    appVersion,
    arch: process.arch,
    chromiumVersion: process.versions.chrome ?? "platform-app",
    cliVersion: "embedded",
    nodeVersion: process.versions.node,
    os: `${os.platform()}-${os.release()}`,
  },
  ownership: { appPids: [], ports: [], profileId: outputId.slice(0, 80) },
  counts: aggregated.counts,
  cases,
  cleanup: { orphans: [], status: "pass" },
};
await writeRegressionResults({
  directory: output,
  metrics: { samples: [] },
  screenshots: [],
  summary,
});
if (json) console.log(JSON.stringify({ ...summary, outputId }));
else console.log(`Regression ${summary.status}: ${outputId} (${cases.length} cases)`);
process.exitCode = aggregated.exitCode;
