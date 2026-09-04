import test from "node:test";
import assert from "node:assert/strict";
import {
  buildThreadConfig,
  recommendedCompactLimit,
  transformThreadStart,
  validateContextPreset,
} from "../src/policy.mjs";

test("recommended compact threshold follows the legacy 90% policy", () => {
  assert.equal(recommendedCompactLimit(400_000), 360_000);
  assert.equal(recommendedCompactLimit(32_000), 16_000);
});

test("thread transform composes prompt and context without dropping unrelated config", () => {
  const context = validateContextPreset({
    id: "lab",
    label: "Lab",
    contextWindow: 384_000,
    autoCompactTokenLimit: 340_000,
    scope: "body_after_prefix",
  });
  const transformed = transformThreadStart({
    threadSource: "user",
    baseInstructions: "official",
    config: { preserve: true },
  }, {
    promptPath: "/tmp/prompt.md",
    context,
  });
  assert.equal(transformed.baseInstructions, null);
  assert.deepEqual(transformed.config, {
    preserve: true,
    model_instructions_file: "/tmp/prompt.md",
    model_context_window: 384_000,
    model_auto_compact_token_limit: 340_000,
    model_auto_compact_token_limit_scope: "body_after_prefix",
  });
});

test("prompt-only and context-only policies stay independent", () => {
  const promptOnly = buildThreadConfig({
    baseConfig: { keep: "yes" },
    promptPath: "/tmp/prompt.md",
  });
  assert.deepEqual(promptOnly, {
    keep: "yes",
    model_instructions_file: "/tmp/prompt.md",
  });
  const contextOnly = buildThreadConfig({
    baseConfig: { keep: "yes" },
    context: {
      id: "small",
      label: "Small",
      contextWindow: 200_000,
      autoCompactTokenLimit: 180_000,
      scope: "total",
    },
  });
  assert.equal(contextOnly.model_instructions_file, undefined);
  assert.equal(contextOnly.model_context_window, 200_000);
});

test("Native Context leaves all official model/provider defaults untouched", () => {
  const native = validateContextPreset({
    id: "native",
    label: "Native / Official",
    contextWindow: null,
    autoCompactTokenLimit: null,
    scope: null,
    native: true,
  });
  assert.deepEqual(buildThreadConfig({
    baseConfig: { keep: "yes" },
    context: native,
  }), { keep: "yes" });
});

test("invalid compact thresholds are rejected", () => {
  assert.throws(() => validateContextPreset({
    id: "bad",
    label: "Bad",
    contextWindow: 200_000,
    autoCompactTokenLimit: 195_000,
    scope: "total",
  }), /保留至少 16K/);
});
