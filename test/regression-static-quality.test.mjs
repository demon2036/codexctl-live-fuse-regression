import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverRegisteredIds,
  executorBindingIssues,
  inspectSourcePolicies,
  moduleCycles,
} from "../regression/static-quality.mjs";

const record = (relative, source) => ({ filename: `/repo/${relative}`, relative, source });

test("static registration finds runner mappings and exposes bracketed orphan IDs", () => {
  const orphan = ["[", "ORPHAN-CASE-999", "]"].join("");
  const ids = discoverRegisteredIds([
    record("scripts/runner.mjs", 'const id = "KNOWN-CASE-001";'),
    record("test/orphan.test.mjs", `test("${orphan} fails", () => {});`),
  ], new Set(["KNOWN-CASE-001"]));
  assert.deepEqual([...ids].sort(), ["KNOWN-CASE-001", "ORPHAN-CASE-999"]);
});

test("source policy distinguishes the 320-line warning from the 400-line hard limit", () => {
  const home = "/private/machine/home";
  const issues = inspectSourcePolicies([
    record("src/warning.mjs", "x\n".repeat(320)),
    record("src/large.mjs", "x\n".repeat(401)),
    record("test/skip.test.mjs", ["test.", "skip('x', () => {})"].join("")),
    record("test/only.test.mjs", ["test.", "only('x', () => {})"].join("")),
    record("src/token.mjs", `const value = "sk-${"a".repeat(24)}"`),
    record("src/path.mjs", `const value = "${home}/private"`),
  ], { machineHome: home });
  assert.deepEqual(new Set(issues.map(({ code }) => code)), new Set([
    "credential-like-token", "line-limit", "line-warning", "machine-absolute-path",
    "test-escape-hatch",
  ]));
  assert.deepEqual(issues.find(({ code }) => code === "line-warning")?.severity, "warning");
  assert.deepEqual(issues.find(({ code }) => code === "line-limit")?.severity, "error");
});

test("executor binding fails closed when a package command is absent", () => {
  assert.deepEqual(executorBindingIssues([
    { command: "npm run test:fast", id: "fast" },
    { command: "node hidden.mjs", id: "hidden" },
  ], { "test:fast": "node scripts/fast.mjs" }), [
    { code: "executor-command", executor: "hidden" },
  ]);
});

test("module graph detects a real relative import cycle", () => {
  const cyclic = [
    record("src/a.mjs", 'import "./b.mjs";'),
    record("src/b.mjs", 'export { value } from "./a.mjs";'),
  ];
  assert.equal(moduleCycles(cyclic).length, 1);
  assert.deepEqual(moduleCycles([record("src/a.mjs", 'import "./b.mjs";'),
    record("src/b.mjs", "export const value = 1;")]), []);
});
