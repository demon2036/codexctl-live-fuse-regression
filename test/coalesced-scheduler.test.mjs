import test from "node:test";
import assert from "node:assert/strict";
import { createCoalescedScheduler } from "../src/coalesced-scheduler.mjs";

test("event bursts coalesce into one run plus one in-flight follow-up", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const scheduler = createCoalescedScheduler(async () => {
    calls += 1;
    if (calls === 1) await gate;
  });

  for (let index = 0; index < 100; index += 1) scheduler.schedule();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);

  for (let index = 0; index < 100; index += 1) scheduler.schedule();
  release();
  await scheduler.idle();
  assert.equal(calls, 2);
});

test("task errors are contained and later work still runs", async () => {
  const errors = [];
  let calls = 0;
  const scheduler = createCoalescedScheduler(async () => {
    calls += 1;
    if (calls === 1) throw new Error("expected failure");
  }, (error) => errors.push(error.message));

  await scheduler.schedule();
  await scheduler.schedule();
  assert.deepEqual(errors, ["expected failure"]);
  assert.equal(calls, 2);
});
