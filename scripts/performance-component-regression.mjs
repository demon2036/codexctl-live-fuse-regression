#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runAppCpuAB } from "../regression/app-cpu-performance.mjs";
import {
  buildPerformanceComponentSummary,
  resolvePerformanceComponent,
} from "../regression/performance-components.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const help = args.includes("--help");
const json = args.includes("--json");
const componentIndex = args.indexOf("--component");
const component = componentIndex >= 0 ? args[componentIndex + 1] : null;
const consumed = new Set(["--help", "--json"]);
if (componentIndex >= 0) {
  consumed.add("--component");
  consumed.add(component);
}
if (help) {
  console.log("Usage: performance-component-regression.mjs --component controls|wallpaper [--json]");
  process.exit(0);
}
if (!component || args.some((arg) => !consumed.has(arg))) {
  throw new Error("Usage: performance-component-regression.mjs --component controls|wallpaper [--json]");
}
const definition = resolvePerformanceComponent(component);
const [{ stdout: revision }, { stdout: status }] = await Promise.all([
  execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectRoot }),
  execFileAsync("git", ["status", "--porcelain"], { cwd: projectRoot }),
]);
const cpu = await runAppCpuAB({
  idleDurationMs: 2000,
  maxAttempts: 2,
  modules: definition.modules,
  phases: definition.phases,
});
const summary = buildPerformanceComponentSummary({
  component,
  cpu,
  source: { dirty: status.trim().length > 0, revision: revision.trim() },
});
const output = path.join(
  projectRoot, "regression-results", `performance-component-${component}-${randomUUID()}`,
);
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const temporary = path.join(output, "summary.json.tmp");
await fs.writeFile(temporary, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
await fs.rename(temporary, path.join(output, "summary.json"));
if (json) console.log(JSON.stringify(summary));
else console.log(`Performance component ${component}: ${summary.status}`);
if (summary.status !== "pass") process.exitCode = summary.status === "invalid" ? 2 : 1;
