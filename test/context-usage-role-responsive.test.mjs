import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTEXT_USAGE_THREAD_ID as THREAD_ID,
  setupContextUsageConversation as setupConversation,
} from "../test-support/context-usage-harness.mjs";

test("reports every identifiable message role separately without collapsing user and assistant", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: { inputTokens: 190_000, cachedInputTokens: 180_000, totalTokens: 200_000 },
      total: { inputTokens: 1_000_000, cachedInputTokens: 900_000 },
      modelContextWindow: 258_400,
      contextBreakdown: {
        tool_calls: 62_000, developer: 46_000, messages: 42_000,
        tools: 26_000, reasoning: 16_000, system_prompt: 8_000,
      },
    },
    tools: [{ name: "shell", description: "Run a local shell command" }],
    turns: [{ items: [
      { type: "systemMessage", role: "system", content: "System rules" },
      { type: "developerMessage", role: "developer", content: "Developer rules" },
      { type: "userMessage", role: "user", content: "Inspect the repository" },
      { type: "agentMessage", role: "assistant", content: "I will inspect it now." },
      { type: "functionCall", role: "assistant", name: "shell", arguments: { cmd: "rg --files" } },
      { type: "functionCallOutput", role: "tool", output: "README.md" },
      { type: "reasoning", role: "assistant", summary: "I should inspect files first." },
    ] }],
  });
  const metrics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.usageMetricsForThread(THREAD_ID);

  assert.equal(metrics.roles.mode, "estimated");
  assert.deepEqual(JSON.parse(JSON.stringify(metrics.roles.categories.map(({ id }) => id))), [
    "system", "developer", "user", "assistant", "tool", "reasoning",
    "tool_definitions", "unclassified",
  ]);
  assert.equal(metrics.roles.categories.reduce((sum, category) => sum + category.tokens, 0), 200_000);
  for (const id of ["user", "assistant", "tool"]) {
    assert.ok(metrics.roles.categories.find((category) => category.id === id).tokens > 0);
  }
});

test("classifies a generic message with role tool as Tool rather than Assistant", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: { inputTokens: 90, cachedInputTokens: 80, totalTokens: 100 },
      modelContextWindow: 258_400,
    },
    turns: [{ items: [{ type: "message", role: "tool", content: "tool output" }] }],
  });
  const roles = harness.window.__CODEX_BASE_PROMPT_SWITCHER__
    .usageMetricsForThread(THREAD_ID).roles.categories;

  assert.ok(roles.find(({ id }) => id === "tool").tokens > 0);
  assert.equal(roles.find(({ id }) => id === "assistant").tokens, 0);
});

test("reads role items from the official App canonical turn history", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: { inputTokens: 26_514, cachedInputTokens: 16_128, totalTokens: 26_732 },
      modelContextWindow: 258_400,
    },
    turns: [],
    turnHistory: {
      kind: "canonical",
      history: {
        entitiesByKey: {
          "tail:0:local:test": {
            status: "completed",
            items: [
              { type: "userMessage", content: [{ type: "text", text: "acceptance test" }] },
              { type: "reasoning", summary: ["respond briefly"] },
              { type: "agentMessage", text: "OK" },
            ],
          },
        },
      },
    },
  });
  const roles = harness.window.__CODEX_BASE_PROMPT_SWITCHER__
    .usageMetricsForThread(THREAD_ID).roles.categories;

  for (const id of ["user", "assistant", "reasoning"]) {
    assert.ok(roles.find((category) => category.id === id).tokens > 0, `${id} must be classified`);
  }
  assert.ok(
    roles.find((category) => category.id === "unclassified").tokens < 26_732,
    "visible canonical items must not all fall into Unclassified",
  );
});

test("keeps Usage available when the active task id is nested in React thread props", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: { inputTokens: 190_000, cachedInputTokens: 180_000, totalTokens: 200_000 },
      modelContextWindow: 258_400,
    },
    turns: [],
  }, { composerProps: { thread: { id: THREAD_ID }, hasConversation: true } });

  const trigger = harness.document.querySelector('[data-codex-context-usage-trigger="true"]');
  assert.ok(trigger, "nested task ids must not make Usage disappear");
  assert.match(trigger.textContent, /Usage.*94\.7%/);
  assert.equal(trigger.getAttribute("data-thread-id"), THREAD_ID);
});

test("tight density exposes readable Usage and More controls instead of shrinking four controls", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: { inputTokens: 190_000, cachedInputTokens: 180_000, totalTokens: 200_000 },
      modelContextWindow: 258_400,
    },
    turns: [],
  });
  const footer = harness.document.querySelector('[data-composer-footer-responsive="true"]');
  footer.setBoundingClientRect({ left: 260, top: 620, width: 493, height: 36 });
  harness.dispatchWindow("resize");
  await harness.flush();

  const host = harness.document.getElementById("codex-prompt-context-control-host");
  assert.equal(host.getAttribute("data-cbps-density"), "tight");
  assert.equal(host.getAttribute("data-cbps-presentation"), "overflow");
  const usage = host.querySelector('[data-codex-context-usage-trigger="true"]');
  const more = host.querySelector('[data-codex-control-overflow-trigger="true"]');
  assert.match(usage.textContent, /^Usage.*94\.7%$/);
  assert.equal(more.textContent.trim(), "More");

  more.click();
  const overflow = harness.document.querySelector('[data-codex-control-overflow-menu="true"]');
  assert.ok(overflow);
  assert.match(overflow.textContent, /Base Prompt.*Context window.*Provider/);
  overflow.querySelector('[data-codex-overflow-target="base-prompt"]').click();
  assert.match(harness.document.querySelector(".cbps-menu").textContent, /Developer Prompt/);
});

test("an extreme owner width keeps every capability behind a single More trigger", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: { totalTokens: 200_000 },
      modelContextWindow: 258_400,
    },
    turns: [],
  });
  const footer = harness.document.querySelector('[data-composer-footer-responsive="true"]');
  footer.setBoundingClientRect({ left: 260, top: 620, width: 373, height: 36 });
  harness.dispatchWindow("resize");
  await harness.flush();

  const host = harness.document.getElementById("codex-prompt-context-control-host");
  assert.equal(host.getAttribute("data-cbps-presentation"), "more-only");
  const more = host.querySelector('[data-codex-control-overflow-trigger="true"]');
  more.click();
  const targets = harness.document.querySelectorAll("[data-codex-overflow-target]")
    .map((item) => item.getAttribute("data-codex-overflow-target"));
  assert.deepEqual(targets, ["context-usage", "base-prompt", "context-window", "provider"]);
});
