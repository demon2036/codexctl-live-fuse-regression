#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Script } from "node:vm";
import { PERFORMANCE_BUDGETS } from "../regression/budgets.mjs";
import { regressionCases } from "../regression/catalog/index.mjs";
import { renderCatalogSummary } from "../regression/catalog/report.mjs";
import { validateCatalog } from "../regression/catalog/validate.mjs";
import { REGRESSION_EXECUTORS, REGRESSION_EXECUTOR_IDS } from "../regression/executors.mjs";
import {
  discoverRegisteredIds,
  executorBindingIssues,
  inspectSourcePolicies,
  moduleCycles,
} from "../regression/static-quality.mjs";
import { PROJECT_ROOT } from "../src/paths.mjs";

async function collect(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", "regression-results"].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(filename));
    else if ((entry.name.endsWith(".mjs") || entry.name.endsWith(".js"))
      && !entry.name.endsWith(".part.js")) files.push(filename);
  }
  return files;
}

async function collectSecurityText(directory) {
  const files = [];
  const extensions = new Set([
    ".c", ".css", ".js", ".json", ".md", ".mjs", ".sh", ".swift", ".txt", ".yaml", ".yml",
  ]);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", "regression-results"].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectSecurityText(filename));
    else if (extensions.has(path.extname(entry.name)) || !path.extname(entry.name)) files.push(filename);
  }
  return files;
}

const files = await collect(PROJECT_ROOT);
for (const filename of files) {
  const result = spawnSync(process.execPath, ["--check", filename], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
}

const securityFiles = await collectSecurityText(PROJECT_ROOT);
const records = await Promise.all(securityFiles.map(async (filename) => ({
  filename,
  relative: path.relative(PROJECT_ROOT, filename).replaceAll(path.sep, "/"),
  source: await fs.readFile(filename, "utf8"),
})));
const policyIssues = inspectSourcePolicies(records, { machineHome: process.env.HOME });
const policyErrors = policyIssues.filter(({ severity }) => severity !== "warning");
const policyWarnings = policyIssues.filter(({ severity }) => severity === "warning");
if (policyErrors.length) {
  throw new Error(`static policy violated:\n${JSON.stringify(policyErrors, null, 2)}`);
}
if (policyWarnings.length) {
  console.warn(`320-line refactor warning:\n${JSON.stringify(policyWarnings, null, 2)}`);
}

const registrationRecords = records.filter(({ relative }) => (
  relative.startsWith("scripts/") || relative.startsWith("test/")
));
const registeredTestIds = discoverRegisteredIds(
  registrationRecords, new Set(regressionCases.map(({ id }) => id)),
);
const catalogIssues = validateCatalog({
  budgetKeys: new Set(Object.keys(PERFORMANCE_BUDGETS)),
  cases: regressionCases,
  executorIds: REGRESSION_EXECUTOR_IDS,
  registeredTestIds,
});
if (catalogIssues.length) {
  throw new Error(`regression catalog violated:\n${catalogIssues.map(({ message }) => message).join("\n")}`);
}
const catalogDocument = path.join(PROJECT_ROOT, "docs", "REGRESSION_CATALOG.md");
const expectedCatalog = renderCatalogSummary(regressionCases);
const actualCatalog = await fs.readFile(catalogDocument, "utf8").catch(() => "");
if (actualCatalog !== expectedCatalog) {
  throw new Error("generated catalog is stale; run npm run catalog");
}

const pkg = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"));
const executorIssues = executorBindingIssues(REGRESSION_EXECUTORS, pkg.scripts ?? {});
if (executorIssues.length) throw new Error(`executor binding violated: ${JSON.stringify(executorIssues)}`);

const graphRecords = records.filter(({ relative }) => (
  /^(?:regression|scripts|src)\/.+\.(?:js|mjs)$/.test(relative)
));
const cycles = moduleCycles(graphRecords);
if (cycles.length) {
  throw new Error(`module cycle detected:\n${cycles.map((cycle) => cycle.map(
    (filename) => path.relative(PROJECT_ROOT, filename),
  ).join(" -> ")).join("\n")}`);
}

const rendererDirectory = path.join(PROJECT_ROOT, "vendor", "prompt-context", "renderer");
const rendererFragments = (await fs.readdir(rendererDirectory))
  .filter((name) => name.endsWith(".part.js"))
  .sort();
const rendererSource = (await Promise.all(rendererFragments.map((name) => (
  fs.readFile(path.join(rendererDirectory, name), "utf8")
)))).join("").replace("__CODEX_BASE_PROMPT_CONFIG_JSON__", "{}");
new Script(rendererSource, { filename: "prompt-context-renderer.js" });

console.log(`check passed: ${files.length} JavaScript files, ${securityFiles.length} text files, ${regressionCases.length} regression cases, 320-line warning, 400-line/cycle/catalog/privacy gates, and renderer assembly`);
