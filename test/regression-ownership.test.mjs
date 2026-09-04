import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  assertSafeProfile,
  captureOwnedProcess,
  cleanupRunEnvelope,
  createRunEnvelope,
  registerOwnedProcess,
  releaseExitedProcess,
  verifyOwnedProcess,
} from "../regression/ownership.mjs";

function waitForExit(child, timeoutMs = 500) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return Promise.race([
    once(child, "exit"),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`PID ${child.pid} did not exit`)),
      timeoutMs,
    )),
  ]);
}

test("[TDD-OWNERSHIP-CONCURRENT-015] concurrent runs own distinct roots, profiles, runtimes, and ports", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-envelope-test-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const [left, right] = await Promise.all([
    createRunEnvelope({ base }),
    createRunEnvelope({ base }),
  ]);
  t.after(() => Promise.all([left.cleanup(), right.cleanup()]));
  assert.notEqual(left.root, right.root);
  assert.notEqual(left.profile, right.profile);
  assert.notEqual(left.runtime, right.runtime);
  assert.ok(left.port >= 1024 && right.port >= 1024);
  assert.notEqual(left.port, right.port);
});

test("run envelope paths are canonical before they bind an Electron profile", async (t) => {
  const envelope = await createRunEnvelope();
  t.after(() => envelope.cleanup());
  assert.equal(envelope.root, await fs.realpath(envelope.root));
  assert.equal(path.dirname(envelope.profile), envelope.root);
  assert.equal(path.dirname(envelope.runtime), envelope.root);
});

test("[TDD-PROTECT-MAIN-APP-016] production user-data directories are rejected", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-envelope-profile-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const envelope = await createRunEnvelope({ base });
  t.after(() => envelope.cleanup());
  const home = path.join(base, "home");
  assert.throws(
    () => assertSafeProfile(path.join(home, "Library/Application Support/ChatGPT"), {
      envelope,
      home,
    }),
    /生产 user-data-dir/,
  );
});

test("[RECOVERY-OWNED-CLEANUP-003] fault cleanup removes only this run's process and resources", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-envelope-cleanup-"));
  const owned = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "owned-fixture"], {
    stdio: "ignore",
  });
  const unknown = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "unknown-fixture"], {
    stdio: "ignore",
  });
  const stop = (child) => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  t.after(() => stop(owned));
  t.after(() => stop(unknown));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const envelope = await createRunEnvelope({ base });
  await fs.writeFile(path.join(envelope.runtime, "owned.txt"), "fixture");
  await captureOwnedProcess(envelope, owned.pid);

  const cleanup = await cleanupRunEnvelope(envelope);
  await waitForExit(owned);
  assert.deepEqual(cleanup.refused, []);
  assert.deepEqual(cleanup.terminated, [owned.pid]);
  await assert.rejects(fs.access(envelope.root), /ENOENT/);
  assert.doesNotThrow(() => process.kill(unknown.pid, 0));
});

test("owned process verification reports PID, start time, command, and unknown mismatches", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-envelope-process-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const envelope = await createRunEnvelope({ base });
  t.after(() => envelope.cleanup());
  registerOwnedProcess(envelope, { command: "/fixture/app --test", pid: 4321, startedAt: "start-a" });
  assert.throws(
    () => verifyOwnedProcess(
      envelope,
      { command: "/fixture/app --test", pid: 9876, startedAt: "start-a" },
      4321,
    ),
    /PID 不匹配.*4321.*9876/,
  );
  assert.throws(
    () => verifyOwnedProcess(envelope, { command: "/fixture/app --test", pid: 9876, startedAt: "start-a" }),
    /未知进程.*9876/,
  );
  assert.throws(
    () => verifyOwnedProcess(envelope, { command: "/fixture/app --test", pid: 4321, startedAt: "start-b" }),
    /start time 不匹配.*4321/,
  );
  assert.throws(
    () => verifyOwnedProcess(envelope, { command: "/fixture/other", pid: 4321, startedAt: "start-a" }),
    /command 不匹配.*4321/,
  );
  assert.doesNotThrow(
    () => verifyOwnedProcess(envelope, { command: "/fixture/app --test", pid: 4321, startedAt: "start-a" }),
  );
});

test("an ownership slot is reusable only after the exact process has exited", async (t) => {
  const envelope = await createRunEnvelope();
  t.after(() => envelope.cleanup());
  const record = { command: "/fixture/app", pid: 4321, startedAt: "start-a" };
  registerOwnedProcess(envelope, record);
  await assert.rejects(
    releaseExitedProcess(envelope, 4321, { readProcess: async () => record }),
    /尚未退出/,
  );
  await releaseExitedProcess(envelope, 4321, { readProcess: async () => null });
  assert.equal(envelope.processes.has(4321), false);
});
