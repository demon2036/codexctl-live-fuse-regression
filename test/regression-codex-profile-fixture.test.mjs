import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_THREAD_COUNT,
  seedThreadCatalog,
} from "../regression/codex-profile-fixture.mjs";

test("[PLATFORM-LINUX-RENDERER-SURFACE-005] actual L5 profile forces an overflowing Sessions list", () => {
  assert.equal(DEFAULT_THREAD_COUNT, 36);
});

test("isolated L5 profile persists interrupted offline turns for a scrollable catalog", async () => {
  const calls = [];
  let threadSequence = 0;
  let turnSequence = 0;
  const threadIds = [];
  const eventWaits = [];
  const ids = await seedThreadCatalog({
    cwd: "/tmp/codexctl-owned-workspace",
    threadCount: 3,
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/start") {
        const id = `thread-id-${++threadSequence}`;
        threadIds.push(id);
        return { thread: { id } };
      }
      if (method === "turn/start") return { turn: { id: `turn-id-${++turnSequence}` } };
      if (method === "thread/list") {
        return { data: threadIds.map((id) => ({ id, status: { type: "idle" } })) };
      }
      return {};
    },
    async waitForEvent(method) { eventWaits.push(method); },
  });
  assert.deepEqual(ids, ["thread-id-1", "thread-id-2", "thread-id-3"]);
  assert.deepEqual(Object.fromEntries([
    "thread/start", "turn/start", "turn/interrupt", "thread/list",
  ].map((method) => [method, calls.filter((call) => call.method === method).length])), {
    "thread/list": 1, "thread/start": 3, "turn/interrupt": 3, "turn/start": 3,
  });
  assert.equal(calls.at(-1).method, "thread/list");
  for (const call of calls.filter(({ method }) => method === "thread/start")) {
    assert.deepEqual(call.params, {
      cwd: "/tmp/codexctl-owned-workspace", ephemeral: false, threadSource: "user",
    });
    assert.equal(Object.hasOwn(call.params, "input"), false);
  }
  assert.deepEqual(calls.filter(({ method }) => method === "turn/start")
    .map(({ params }) => params.input[0].text), [
    "Regression session 01", "Regression session 02", "Regression session 03",
  ]);
  for (const call of calls.filter(({ method }) => method === "turn/start")) {
    assert.equal(call.params.approvalPolicy, "never");
  }
  assert.deepEqual(eventWaits, ["item/completed", "item/completed", "item/completed"]);
});

test("isolated profile thread seed rejects missing IDs and unsafe counts", async () => {
  await assert.rejects(seedThreadCatalog({
    cwd: "/tmp/codexctl-owned-workspace", threadCount: 2,
    request: async () => ({}),
    waitForEvent: async () => {},
  }), /no thread id/);
  await assert.rejects(seedThreadCatalog({
    cwd: "/tmp/codexctl-owned-workspace", threadCount: 101,
    request: async () => ({}),
    waitForEvent: async () => {},
  }), /between 2 and 100/);
});

test("isolated profile rejects a catalog that was not durably listed", async () => {
  let sequence = 0;
  await assert.rejects(seedThreadCatalog({
    cwd: "/tmp/codexctl-owned-workspace", threadCount: 2,
    async request(method) {
      if (method === "thread/start") return { thread: { id: `thread-id-${++sequence}` } };
      if (method === "turn/start") return { turn: { id: `turn-id-${sequence}` } };
      if (method === "thread/list") return { data: [] };
      return {};
    },
    waitForEvent: async () => {},
  }), /not persisted/);
});
