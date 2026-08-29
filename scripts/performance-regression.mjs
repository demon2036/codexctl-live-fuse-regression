#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  evaluatePerformanceRepeatability,
  runAppPerformanceAB,
} from "../regression/app-performance.mjs";
import { runAppCpuAB } from "../regression/app-cpu-performance.mjs";
import { regressionCaseById } from "../regression/catalog/index.mjs";
import {
  compactCpuEvidence,
  compactInteractionEvidence,
} from "../regression/performance-evidence.mjs";
import { buildScriptFailureEvidence } from "../regression/script-evidence.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const help = args.includes("--help");
const json = args.includes("--json");
const quick = args.includes("--quick");
const caseIndex = args.indexOf("--case");
const selectedCase = caseIndex >= 0 ? args[caseIndex + 1] : null;
const consumed = new Set(["--help", "--json", "--quick", "--case", selectedCase].filter(Boolean));
const unknown = args.filter((arg) => !consumed.has(arg));
if (unknown.length) throw new Error("Usage: performance-regression.mjs [--case CASE-ID] [--json] [--quick]");
if (help) {
  console.log("Usage: performance-regression.mjs [--case CASE-ID] [--json] [--quick]\n"
    + "Runs two interaction A/B rounds and balanced O-I-I-O / I-O-O-I CPU groups.");
  process.exit(0);
}
if (selectedCase) {
  const entry = regressionCaseById.get(selectedCase);
  if (!entry?.id.startsWith("PERFORMANCE-")) {
    throw new Error(`Case ${selectedCase} is not a performance case`);
  }
}

const runId = randomUUID();
const outputId = `performance-${runId}`;
const output = path.join(projectRoot, "regression-results", outputId);
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const [{ stdout: revision }, { stdout: gitStatus }] = await Promise.all([
  execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectRoot }),
  execFileAsync("git", ["status", "--porcelain"], { cwd: projectRoot }),
]);
const source = { dirty: gitStatus.trim().length > 0, revision: revision.trim() };
let stage = "interaction-ab";
let raw = null;
let summary;
try {
  const interactionRuns = [];
  for (let index = 0; index < 2; index += 1) {
    interactionRuns.push(await runAppPerformanceAB({
      groups: quick ? 1 : 2,
      maxGroupAttempts: quick ? 1 : 2,
      warmups: quick ? 0 : 1,
    }));
  }
  const repeatability = evaluatePerformanceRepeatability(interactionRuns);
  stage = "cpu-ab";
  const cpu = await runAppCpuAB({
    idleDurationMs: quick ? 2000 : 30_000,
    maxAttempts: quick ? 1 : 2,
  });
  const passed = repeatability.status === "pass" && cpu.status === "pass"
    && interactionRuns.every((run) => run.status === "pass");
  const invalid = cpu.status === "invalid"
    || interactionRuns.some((run) => run.status === "invalid" || run.sampler.status === "invalid");
  const status = passed ? "pass" : invalid ? "invalid" : "fail";
  summary = {
    schema: "codexctl-performance-regression/1", runId, ...source, status, quick, selectedCase,
    interactionRuns: interactionRuns.map(compactInteractionEvidence),
    repeatability,
    cpu: compactCpuEvidence(cpu),
  };
  raw = { cpu, interactionRuns };
} catch {
  summary = buildScriptFailureEvidence({
    ...source, reasonCode: `${stage}-failed`, runId,
    schema: "codexctl-performance-regression/1", selectedCase, stage,
  });
}
const writes = [
  fs.writeFile(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, {
    mode: 0o600,
  }),
];
if (raw) writes.push(fs.writeFile(
  path.join(output, "raw.json"), `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 },
));
await Promise.all(writes);
if (json) console.log(JSON.stringify({ ...summary, outputId }));
else console.log(`Performance regression ${summary.status}: ${outputId}`);
if (summary.status !== "pass") process.exitCode = 1;
