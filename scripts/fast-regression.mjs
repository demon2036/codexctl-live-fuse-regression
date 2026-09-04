#!/usr/bin/env node

import { spawn } from "node:child_process";
import { regressionCaseById } from "../regression/catalog/index.mjs";

const args = process.argv.slice(2);
const help = args.includes("--help");
const caseIndex = args.indexOf("--case");
const caseId = caseIndex >= 0 ? args[caseIndex + 1] : null;
const consumed = new Set(["--help"]);
if (caseIndex >= 0) {
  consumed.add("--case");
  consumed.add(caseId);
}
const unknown = args.filter((value) => !consumed.has(value));
if (help) {
  console.log("Usage: fast-regression.mjs [--case CASE-ID]\nRuns deterministic L1/L2 Node tests.");
  process.exit(0);
}
if (unknown.length || (caseIndex >= 0 && !caseId)) {
  throw new Error("Usage: fast-regression.mjs [--case CASE-ID]");
}
if (caseId) {
  const entry = regressionCaseById.get(caseId);
  if (!entry) throw new Error(`Unknown regression case: ${caseId}`);
  if (!entry.layers.some((layer) => layer === "L1" || layer === "L2")) {
    throw new Error(`Case ${caseId} has no fast layer`);
  }
}
const childArgs = ["--test"];
if (caseId) childArgs.push(`--test-name-pattern=${caseId}`);
const child = spawn(process.execPath, childArgs, { stdio: "inherit" });
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
