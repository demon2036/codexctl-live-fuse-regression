#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runElectronAppSequence } from "../regression/app-sequence.mjs";
import { evaluateAppVisualPair } from "../regression/app-visual-gate.mjs";
import { evaluateAppInteractions } from "../regression/app-interactions.mjs";
import { runAppFaultChecks } from "../regression/app-faults.mjs";
import { regressionCaseById } from "../regression/catalog/index.mjs";
import { buildScriptFailureEvidence } from "../regression/script-evidence.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultsRoot = path.join(projectRoot, "regression-results");
const args = process.argv.slice(2);
const json = args.includes("--json");
const help = args.includes("--help");
const caseIndex = args.indexOf("--case");
const selectedCase = caseIndex >= 0 ? args[caseIndex + 1] : null;
const consumed = new Set(["--json", "--help", "--case", selectedCase].filter(Boolean));
const unknown = args.filter((arg) => !consumed.has(arg));
if (unknown.length) throw new Error("Usage: app-regression.mjs [--case CASE-ID] [--json] [--help]");
if (help) {
  console.log("Usage: app-regression.mjs [--case CASE-ID] [--json]\nRuns isolated L4 Electron App A/B, interaction, recovery, and fault gates.");
  process.exit(0);
}
if (selectedCase) {
  const entry = regressionCaseById.get(selectedCase);
  if (!entry) throw new Error(`Unknown regression case: ${selectedCase}`);
  if (!entry.layers.includes("L4")) throw new Error(`Case ${selectedCase} has no App layer`);
}

async function revisionInfo() {
  const [{ stdout: revision }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectRoot }),
    execFileAsync("git", ["status", "--porcelain"], { cwd: projectRoot }),
  ]);
  return { dirty: status.trim().length > 0, revision: revision.trim() };
}

const runId = randomUUID();
const outputId = `app-${runId}`;
const output = path.join(resultsRoot, outputId);
const screenshots = path.join(output, "screenshots");
await fs.mkdir(screenshots, { recursive: true, mode: 0o700 });
const revision = await revisionInfo();
let stage = "app-sequence";
let summary;
try {
  const sequence = await runElectronAppSequence({
    artifactDir: screenshots,
    exerciseInteractions: true,
  });
  stage = "app-gates";
  const official = sequence.runs.find(({ label }) => label === "official");
  const injected = sequence.runs.find(({ label }) => label === "injected-1");
  const interactionRun = sequence.runs.find(({ label }) => label === "injected-2");
  const visual = evaluateAppVisualPair({
    official: official.result,
    injected: injected.result,
    screenshots: { official: official.screenshot, injected: injected.screenshot },
  });
  const interactions = evaluateAppInteractions(interactionRun.interactions);
  stage = "app-fault-gates";
  const faults = await runAppFaultChecks();
  const status = [sequence.status, visual.status, interactions.status, faults.status]
    .every((value) => value === "pass") ? "pass" : "fail";
  summary = {
    schema: "codexctl-app-regression/1", runId, ...revision, status,
    gates: {
      faults: { failures: faults.failures, status: faults.status }, interactions,
      sequence: { failures: sequence.failures, status: sequence.status }, visual,
    },
    runs: sequence.runs.map(({ label, result, screenshot }) => ({
      appVersion: result.identity.appVersion,
      appServerCount: result.processTree.appServerCount,
      cleanup: result.cleanup.status,
      controllerCount: result.processTree.controllerCount,
      label, mode: result.mode, remote: result.remote.status,
      screenshot: screenshot ? { bytes: screenshot.bytes, name: screenshot.name } : null,
      status: result.status,
    })),
    nativeRecovery: {
      appServerCount: sequence.nativeRecovery.appServerCount,
      cdp: sequence.nativeRecovery.snapshot.cdp,
      cleanup: sequence.nativeRecovery.cleanup.status,
      globals: sequence.nativeRecovery.snapshot.renderer.globals,
      preloadEnvironment: sequence.nativeRecovery.snapshot.preloadEnvironment,
      remote: sequence.nativeRecovery.snapshot.renderer.remote.status,
      workerCount: sequence.nativeRecovery.snapshot.renderer.workerCount,
    },
    faultChecks: faults.results,
    selectedCase,
  };
} catch {
  summary = buildScriptFailureEvidence({
    ...revision, reasonCode: `${stage}-failed`, runId,
    schema: "codexctl-app-regression/1", selectedCase, stage,
  });
}
await fs.writeFile(
  path.join(output, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  { mode: 0o600 },
);

if (json) console.log(JSON.stringify({ ...summary, outputId }));
else console.log(`App regression ${summary.status}: ${outputId}`);
if (summary.status !== "pass") process.exitCode = 1;
