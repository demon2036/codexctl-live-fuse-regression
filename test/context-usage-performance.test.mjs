import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTEXT_USAGE_THREAD_ID,
  setupContextUsageConversation,
} from "../test-support/context-usage-harness.mjs";

test("token-usage refresh reuses cached long-thread analysis until content changes", async (t) => {
  let itemReads = 0;
  const items = Array.from({ length: 25_000 }, (_value, index) => {
    const item = { content: `message-${index}`, role: index % 2 ? "assistant" : "user" };
    Object.defineProperty(item, "type", {
      configurable: true,
      get() { itemReads += 1; return "message"; },
    });
    return item;
  });
  const conversation = {
    latestTokenUsageInfo: {
      last: { inputTokens: 100_000, cachedInputTokens: 90_000, totalTokens: 120_000 },
      modelContextWindow: 258_400,
    },
    turns: [{ items }],
  };
  const { harness, manager } = await setupContextUsageConversation(t, conversation);
  harness.document.querySelector('[data-codex-context-usage-trigger="true"]').click();
  const readsAfterOpen = itemReads;
  assert.ok(readsAfterOpen > 0);

  conversation.latestTokenUsageInfo.last.totalTokens = 121_000;
  manager.emitNotification({
    method: "thread/tokenUsage/updated",
    params: { threadId: CONTEXT_USAGE_THREAD_ID },
  });
  await harness.flush();
  assert.equal(itemReads, readsAfterOpen, "usage-only updates must not rescan all visible turns");

  manager.emitNotification({
    method: "turn/completed",
    params: { threadId: CONTEXT_USAGE_THREAD_ID },
  });
  await harness.flush();
  assert.ok(itemReads > readsAfterOpen, "content completion invalidates the cached breakdown");
});
