import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { makePayload } from "../test-support/prompt-renderer-harness.mjs";
import {
  CONTEXT_USAGE_THREAD_ID as THREAD_ID,
  setupContextUsageConversation as setupConversation,
} from "../test-support/context-usage-harness.mjs";

test("normalizes authoritative context and prompt-cache metrics from rollout-shaped usage", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      total_token_usage: {
        input_tokens: 4_233_166,
        cached_input_tokens: 4_024_832,
        output_tokens: 20_944,
        reasoning_output_tokens: 9_129,
        total_tokens: 4_254_110,
      },
      last_token_usage: {
        input_tokens: 204_944,
        cached_input_tokens: 200_192,
        output_tokens: 1_298,
        reasoning_output_tokens: 719,
        total_tokens: 206_242,
      },
      model_context_window: 258_400,
    },
    turns: [],
    resumeState: "resumed",
    threadRuntimeStatus: { type: "idle" },
  });

  const metrics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__
    .usageMetricsForThread(THREAD_ID);

  assert.deepEqual(JSON.parse(JSON.stringify(metrics.current)), {
    usedTokens: 206_242,
    contextWindow: 258_400,
    remainingTokens: 52_158,
    percent: 79.81501547987617,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(metrics.cache.last)), {
    inputTokens: 204_944,
    cachedInputTokens: 200_192,
    uncachedInputTokens: 4_752,
    percent: 97.68131782340542,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(metrics.cache.conversation)), {
    inputTokens: 4_233_166,
    cachedInputTokens: 4_024_832,
    uncachedInputTokens: 208_334,
    percent: 95.07852987574785,
  });
  assert.equal(metrics.exact.context, true);
  assert.equal(metrics.exact.cache, true);
});

test("preserves authoritative anomaly values while bounding derived remaining context", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: {
        inputTokens: 10,
        cachedInputTokens: 12,
        outputTokens: 500,
        totalTokens: 400_000,
      },
      modelContextWindow: 258_400,
    },
    turns: [],
  });

  const metrics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__
    .usageMetricsForThread(THREAD_ID);

  assert.equal(metrics.current.usedTokens, 400_000, "reported usage must remain inspectable");
  assert.equal(metrics.current.remainingTokens, 0);
  assert.equal(metrics.current.percent, (400_000 / 258_400) * 100);
  assert.equal(metrics.cache.last.cachedInputTokens, 12, "reported cache must remain inspectable");
  assert.equal(metrics.cache.last.percent, 120);
  assert.equal(metrics.cache.last.uncachedInputTokens, 0);
  assert.equal(metrics.cache.conversation.percent, null);
  assert.equal(metrics.exact.cache, false);
  assert.equal(
    metrics.sources.categories.reduce((sum, category) => sum + category.tokens, 0),
    400_000,
    "estimated source totals must reconcile to the same authoritative current usage",
  );
  const trigger = harness.document.querySelector('[data-codex-context-usage-trigger="true"]');
  assert.match(trigger.textContent, /100%\+/);
  trigger.click();
  assert.match(harness.document.querySelector(".cbps-usage-menu").textContent, /Cached input 12 \/ 10/);
  assert.match(trigger.getAttribute("title"), /120\.00%/);
});

test("uses a runtime-provided context source breakdown as exact data", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: { inputTokens: 190_000, cachedInputTokens: 180_000, totalTokens: 200_000 },
      total: { inputTokens: 1_000_000, cachedInputTokens: 900_000 },
      modelContextWindow: 258_400,
      contextBreakdown: {
        tool_calls: 62_000,
        developer: 46_000,
        messages: 42_000,
        tools: 26_000,
        reasoning: 16_000,
        system_prompt: 8_000,
      },
    },
    turns: [],
  });

  const metrics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__
    .usageMetricsForThread(THREAD_ID);

  assert.equal(metrics.sources.mode, "exact");
  assert.deepEqual(
    JSON.parse(JSON.stringify(metrics.sources.categories.map(({ id, tokens, percent }) => (
      { id, tokens, percent }
    )))),
    [
      { id: "tool_calls", tokens: 62_000, percent: 31 },
      { id: "developer", tokens: 46_000, percent: 23 },
      { id: "messages", tokens: 42_000, percent: 21 },
      { id: "tools", tokens: 26_000, percent: 13 },
      { id: "reasoning", tokens: 16_000, percent: 8 },
      { id: "system_prompt", tokens: 8_000, percent: 4 },
    ],
  );
});

test("does not label an incomplete runtime source breakdown as exact", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: { inputTokens: 90_000, cachedInputTokens: 80_000, totalTokens: 100_000 },
      modelContextWindow: 258_400,
      contextBreakdown: { messages: 42_000 },
    },
    turns: [{ items: [{ type: "userMessage", role: "user", content: "hello" }] }],
  });

  const metrics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__
    .usageMetricsForThread(THREAD_ID);
  assert.equal(metrics.sources.mode, "estimated");
});

test("estimates visible context sources honestly and reports compaction history", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: { inputTokens: 190_000, cachedInputTokens: 180_000, totalTokens: 200_000 },
      total: { inputTokens: 1_000_000, cachedInputTokens: 900_000 },
      modelContextWindow: 258_400,
    },
    tools: [{ name: "shell", description: "Run a local shell command" }],
    turns: [
      {
        items: [
          { type: "userMessage", role: "user", content: "Inspect the repository" },
          { type: "reasoning", summary: "I should inspect files before editing." },
          { type: "functionCall", name: "shell", arguments: { cmd: "rg --files" } },
          { type: "functionCallOutput", output: "README.md\nsrc/index.mjs" },
        ],
      },
      { items: [{ type: "contextCompaction", status: "completed" }] },
      { items: [{ type: "agentMessage", role: "assistant", content: "I found the entry point." }] },
      { items: [{ type: "developerMessage", role: "developer", content: "Keep edits portable." }] },
    ],
  });

  const metrics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__
    .usageMetricsForThread(THREAD_ID);

  assert.equal(metrics.sources.mode, "estimated");
  assert.ok(metrics.sources.categories.some((category) => category.id === "tool_calls"));
  assert.ok(metrics.sources.categories.some((category) => category.id === "messages"));
  assert.ok(metrics.sources.categories.some((category) => category.id === "reasoning"));
  assert.ok(metrics.sources.categories.some((category) => category.id === "developer"));
  assert.ok(metrics.sources.categories.some((category) => category.id === "tools"));
  assert.ok(metrics.sources.categories.some((category) => category.id === "unclassified"));
  assert.equal(
    metrics.sources.categories.reduce((sum, category) => sum + category.tokens, 0),
    200_000,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(metrics.compaction)), {
    count: 1,
    turnsAgo: 2,
  });
});

test("mounts a compact cache-rate trigger and a read-only Usage panel", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: {
        inputTokens: 204_944,
        cachedInputTokens: 200_192,
        totalTokens: 206_242,
      },
      total: {
        inputTokens: 4_233_166,
        cachedInputTokens: 4_024_832,
        totalTokens: 4_254_110,
      },
      modelContextWindow: 258_400,
      contextSources: {
        toolCalls: 62_000,
        developerContext: 46_000,
        messages: 42_000,
        toolDefinitions: 26_000,
        reasoning: 16_000,
        systemPrompt: 8_000,
      },
    },
    turns: [
      { items: [{ type: "context-compaction" }] },
      { items: [{ type: "agentMessage", content: "after compact" }] },
    ],
  });

  const trigger = harness.document.querySelector('[data-codex-context-usage-trigger="true"]');
  assert.ok(trigger, "the active task should get a Usage trigger");
  assert.match(trigger.textContent, /Usage.*97\.7%/);
  const timerCount = harness.timers.size;
  const observerCount = harness.mutationObservers.length;

  trigger.click();
  await harness.flush();

  const panel = harness.document.querySelector('[data-codex-context-usage-panel="true"]');
  assert.ok(panel);
  assert.equal(panel.getAttribute("data-usage-mode"), "cache");
  assert.match(panel.textContent, /Latest model call Exact.*200,192 \/ 204,944.*97\.68%/);
  assert.match(panel.textContent, /Current task Exact.*4,024,832 \/ 4,233,166.*95\.08%/);
  assert.match(panel.textContent, /Uncached input 4,752 \/ 204,944.*2\.32%/);
  assert.match(panel.textContent, /Local history Persistent.*History index is not connected yet/);
  assert.doesNotMatch(panel.textContent, /Current context|Role breakdown|Compactions/);
  assert.equal(trigger.getAttribute("aria-controls"), panel.id);
  assert.equal(panel.getAttribute("aria-labelledby"), `${panel.id}-title`);
  assert.equal(
    panel.querySelector(".cbps-usage-progress-context").getAttribute("aria-label"),
    "Latest model call cached input",
  );
  assert.equal(harness.timers.size, timerCount, "opening Usage must not start polling");
  assert.equal(harness.mutationObservers.length, observerCount);
});

test("closes an open Usage panel at a task navigation boundary", async (t) => {
  const { harness, manager, composer } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: { inputTokens: 100_000, cachedInputTokens: 90_000, totalTokens: 120_000 },
      modelContextWindow: 258_400,
    },
    turns: [],
  });
  harness.document.querySelector('[data-codex-context-usage-trigger="true"]').click();
  assert.ok(harness.document.querySelector('[data-codex-context-usage-panel="true"]'));

  const nextThreadId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  manager.conversations.set(nextThreadId, {
    latestTokenUsageInfo: {
      last: { inputTokens: 10_000, cachedInputTokens: 8_000, totalTokens: 12_000 },
      modelContextWindow: 258_400,
    },
    turns: [],
  });
  composer.__reactFiber$codexctl.memoizedProps = {
    conversationId: nextThreadId,
    hasConversation: true,
  };
  harness.dispatchWindow("popstate");
  await harness.flush();

  assert.equal(
    harness.document.querySelector('[data-codex-context-usage-panel="true"]'),
    null,
    "a panel belonging to the previous task must not survive navigation",
  );
});

test("closes an open Usage panel when the Sessions sidebar starts task navigation", async (t) => {
  const { harness } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: { inputTokens: 100_000, cachedInputTokens: 90_000, totalTokens: 120_000 },
      modelContextWindow: 258_400,
    },
    turns: [],
  });
  harness.document.querySelector('[data-codex-context-usage-trigger="true"]').click();
  const sidebar = harness.document.createElement("aside");
  sidebar.className = "app-shell-left-panel";
  harness.document.body.appendChild(sidebar);
  harness.dispatchDocument("pointerdown", { target: sidebar });

  assert.equal(harness.document.querySelector('[data-codex-context-usage-panel="true"]'), null);
});

test("keeps the Usage panel reachable in a compact viewport", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));

  assert.match(
    fixture.loaded.payload,
    /\.cbps-usage-menu\s*\{[^}]*max-height:\s*calc\(100vh\s*-\s*24px\)[^}]*overflow-y:\s*auto/s,
  );
  assert.match(
    fixture.loaded.payload,
    /data-cbps-density="tight"[^}]*\.cbps-usage-trigger\s*\{[^}]*flex:\s*0\s+0\s+auto[^}]*min-width:/s,
  );
  assert.match(fixture.loaded.payload, /measureControlPresentations\(host, baseline\)/);
  assert.doesNotMatch(fixture.loaded.payload, /availableWidth < (?:300|460)/);
});

test("exposes unavailable progress as unavailable instead of zero", async (t) => {
  const { harness } = await setupConversation(t, { turns: [] });
  harness.document.querySelector('[data-codex-context-usage-trigger="true"]').click();
  const panel = harness.document.querySelector(".cbps-usage-menu");
  assert.match(panel.textContent, /Latest model call.*Cache data Not available yet/);
  assert.equal(panel.querySelectorAll('[role="progressbar"]').length, 0);
  assert.doesNotMatch(panel.textContent, /0\.00%/);
});

test("renderer payload keeps the portable non-intrusion contract", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));

  assert.doesNotMatch(
    fixture.loaded.payload,
    /app\.asar|\/Applications\/Codex\.app|codesign|asar\.(?:pack|extract)|writeFileSync|renameSync/,
  );
  assert.doesNotMatch(fixture.loaded.payload, /observe\(document\.(?:body|documentElement)/);
  assert.doesNotMatch(fixture.loaded.payload, /setInterval\s*\(/);
});

test("refreshes an open Usage panel from bounded token-usage notifications", async (t) => {
  const { harness, manager, conversation } = await setupConversation(t, {
    latestTokenUsageInfo: {
      last: { inputTokens: 100_000, cachedInputTokens: 90_000, totalTokens: 120_000 },
      total: { inputTokens: 500_000, cachedInputTokens: 450_000 },
      modelContextWindow: 258_400,
    },
    turns: [],
  });
  harness.document.querySelector('[data-codex-context-usage-trigger="true"]').click();
  assert.match(
    harness.document.querySelector('[data-codex-context-usage-panel="true"]').textContent,
    /90,000 \/ 100,000.*90\.00%/,
  );

  conversation.latestTokenUsageInfo = {
    last: { inputTokens: 200_000, cachedInputTokens: 195_000, totalTokens: 220_000 },
    total: { inputTokens: 700_000, cachedInputTokens: 645_000 },
    modelContextWindow: 258_400,
  };
  manager.emitNotification({
    method: "thread/tokenUsage/updated",
    params: { threadId: THREAD_ID },
  });
  await harness.flush();

  assert.match(
    harness.document.querySelector('[data-codex-context-usage-panel="true"]').textContent,
    /195,000 \/ 200,000.*97\.50%/,
  );
});

test("the compact Usage trigger stays on the lightweight usage path until the panel opens", async (t) => {
  let turnsReads = 0;
  const conversation = {
    latestTokenUsageInfo: {
      last: { inputTokens: 100_000, cachedInputTokens: 90_000, totalTokens: 120_000 },
      total: { inputTokens: 500_000, cachedInputTokens: 450_000 },
      modelContextWindow: 258_400,
    },
  };
  Object.defineProperty(conversation, "turns", {
    configurable: true,
    get() { turnsReads += 1; return []; },
  });
  const { harness } = await setupConversation(t, conversation);

  assert.equal(turnsReads, 0, "mounting and positioning the chip must not scan conversation turns");
  harness.document.querySelector('[data-codex-context-usage-trigger="true"]').click();
  assert.ok(turnsReads > 0, "the detailed panel may analyze turns on explicit user action");
});
