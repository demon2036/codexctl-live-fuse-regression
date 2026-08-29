import test from "node:test";
import assert from "node:assert/strict";
import { validateCatalog } from "../regression/catalog/validate.mjs";

function fixture(overrides = {}) {
  const entry = {
    budgetKey: null,
    capability: "fixture",
    evidence: ["L1"],
    executors: [{ id: "fixture-unit", layer: "L1" }],
    id: "FIXTURE-CASE-001",
    kind: "scenario",
    layers: ["L1"],
    platforms: ["all"],
    required: true,
    requirement: "fixture requirement",
    scenario: "fixture scenario",
    ...overrides,
  };
  return {
    budgetKeys: new Set(["fixture-budget"]),
    cases: [entry],
    executorIds: new Set(["fixture-unit"]),
    registeredTestIds: new Set([entry.id]),
  };
}

function messages(input) {
  return validateCatalog(input).map((error) => error.message).join("\n");
}

test("[TDD-CATALOG-NEW-CASE-012] catalog rejects duplicate IDs", () => {
  const input = fixture();
  input.cases.push({ ...input.cases[0] });
  assert.match(messages(input), /重复 case ID.*FIXTURE-CASE-001/);
});

test("catalog rejects illegal levels and platforms with exact reasons", () => {
  assert.match(messages(fixture({ layers: ["L0"] })), /非法层级.*L0/);
  assert.match(messages(fixture({ platforms: ["windows"] })), /非法平台.*windows/);
});

test("[TDD-CATALOG-MISSING-TEST-013] catalog rejects absent and unknown executors", () => {
  assert.match(messages(fixture({ executors: [] })), /缺少执行入口/);
  assert.match(
    messages(fixture({ executors: [{ id: "missing", layer: "L1" }] })),
    /执行入口不存在.*missing/,
  );
});

test("catalog rejects unknown performance budgets", () => {
  assert.match(messages(fixture({ budgetKey: "unknown" })), /未知预算.*unknown/);
});

test("[TDD-CATALOG-MISSING-TEST-013] required cases must have registered tests", () => {
  const input = fixture();
  input.registeredTestIds.clear();
  assert.match(messages(input), /必选 case 没有测试.*FIXTURE-CASE-001/);
});

test("catalog rejects orphan core tests", () => {
  const input = fixture();
  input.registeredTestIds.add("ORPHAN-CORE-999");
  assert.match(messages(input), /孤立核心测试.*ORPHAN-CORE-999/);
});
