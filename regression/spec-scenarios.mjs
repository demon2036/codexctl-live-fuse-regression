import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPECS = Object.freeze([
  ["app-experience-regression", path.join(
    ROOT,
    "openspec/changes/codify-regression-tdd/specs/app-experience-regression/spec.md",
  )],
  ["tdd-quality-gate", path.join(
    ROOT,
    "openspec/changes/codify-regression-tdd/specs/tdd-quality-gate/spec.md",
  )],
]);

export function parseSpecScenarios(capability, text) {
  let requirement = null;
  const scenarios = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("### Requirement: ")) requirement = line.slice(17);
    if (!line.startsWith("#### Scenario: ")) continue;
    if (!requirement) throw new Error(`${capability}: Scenario 缺少 Requirement`);
    scenarios.push(Object.freeze({
      capability,
      requirement,
      scenario: line.slice(15),
    }));
  }
  return scenarios;
}

export async function readSpecScenarios() {
  const groups = await Promise.all(SPECS.map(async ([capability, filename]) => (
    parseSpecScenarios(capability, await fs.readFile(filename, "utf8"))
  )));
  return groups.flat();
}
