import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { createCleanupStack, runBounded, waitForEvent } from "../regression/lifecycle.mjs";

test("bounded event wait resolves once and releases every listener", async () => {
  const source = new EventEmitter();
  const waiting = waitForEvent(source, "ready", { timeoutMs: 100 });
  source.emit("ready", { ok: true });
  assert.deepEqual(await waiting, { ok: true });
  assert.equal(source.listenerCount("ready"), 0);
  assert.equal(source.listenerCount("error"), 0);
});

test("bounded event wait rejects on deadline and abort without residual listeners", async () => {
  const source = new EventEmitter();
  await assert.rejects(waitForEvent(source, "ready", { timeoutMs: 5 }), (error) => (
    error.code === "DEADLINE_EXCEEDED"
  ));
  assert.equal(source.listenerCount("ready"), 0);
  assert.equal(source.listenerCount("error"), 0);

  const controller = new AbortController();
  const aborted = waitForEvent(source, "ready", { signal: controller.signal, timeoutMs: 100 });
  controller.abort("fixture");
  await assert.rejects(aborted, (error) => error.code === "RUN_ABORTED");
  assert.equal(source.listenerCount("ready"), 0);
});

test("cleanup stack is LIFO, idempotent, and reports every cleanup failure", async () => {
  const order = [];
  const cleanup = createCleanupStack();
  cleanup.defer(async () => order.push("first"));
  cleanup.defer(async () => { order.push("second"); throw new Error("fixture cleanup"); });
  cleanup.defer(async () => order.push("third"));
  await assert.rejects(cleanup.run(), (error) => {
    assert.equal(error.code, "CLEANUP_FAILED");
    assert.equal(error.failures.length, 1);
    return true;
  });
  assert.deepEqual(order, ["third", "second", "first"]);
  await cleanup.run();
  assert.deepEqual(order, ["third", "second", "first"]);
});

for (const signalName of ["SIGINT", "SIGTERM"]) {
  test(`${signalName} aborts work and invokes cleanup exactly once`, async () => {
    const signals = new EventEmitter();
    let cleanupCount = 0;
    const running = runBounded(async ({ signal }) => (
      new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
    ), {
      cleanup: async () => { cleanupCount += 1; },
      signals,
      timeoutMs: 100,
    });
    signals.emit(signalName);
    await assert.rejects(running, (error) => error.code === "RUN_SIGNALLED");
    assert.equal(cleanupCount, 1);
    assert.equal(signals.listenerCount("SIGINT"), 0);
    assert.equal(signals.listenerCount("SIGTERM"), 0);
  });
}

test("child error aborts the run and releases child listeners", async () => {
  const child = new EventEmitter();
  let cleanupCount = 0;
  const running = runBounded(async ({ signal, watchChild }) => {
    watchChild(child);
    return new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
  }, {
    cleanup: async () => { cleanupCount += 1; },
    signals: new EventEmitter(),
    timeoutMs: 100,
  });
  child.emit("error", new Error("fixture child"));
  await assert.rejects(running, (error) => error.code === "CHILD_FAILED");
  assert.equal(cleanupCount, 1);
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("exit"), 0);
});

test("[TDD-BOUNDED-DEADLINE-018] deadline is finite, aborts work, and rejects invalid timeout contracts", async () => {
  let cleanupCount = 0;
  await assert.rejects(runBounded(async ({ signal }) => (
    new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
  ), {
    cleanup: async () => { cleanupCount += 1; },
    signals: new EventEmitter(),
    timeoutMs: 5,
  }), (error) => error.code === "DEADLINE_EXCEEDED");
  assert.equal(cleanupCount, 1);
  await assert.rejects(runBounded(async () => {}, { timeoutMs: Infinity }), /有限正整数/);
});

test("[TDD-CLEANUP-ON-FAILURE-017] fault cleanup removes this run profile, socket, and worker without polling", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-lifecycle-"));
  const profile = path.join(root, "profile");
  await fs.mkdir(profile);
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const worker = new Worker("setInterval(() => {}, 1000)", { eval: true });
  const cleanup = createCleanupStack();
  cleanup.defer(() => fs.rm(root, { force: true, recursive: true }));
  cleanup.defer(() => worker.terminate());
  cleanup.defer(() => new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  ))));

  await assert.rejects(runBounded(async () => {
    throw new Error("fixture action failed");
  }, {
    cleanup: () => cleanup.run(),
    signals: new EventEmitter(),
    timeoutMs: 100,
  }), /fixture action failed/);

  await assert.rejects(fs.access(profile), (error) => error.code === "ENOENT");
  assert.equal(server.listening, false);
  assert.equal(worker.threadId, -1);
});
