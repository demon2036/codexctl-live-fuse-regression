import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLinuxPlatformContract } from "../regression/linux-platform-contract.mjs";

const port = 19472;

function input(overrides = {}) {
  return {
    endpointHost: "127.0.0.1",
    executable: "/usr/lib/chatgpt/ChatGPT",
    launcherName: "chatgpt",
    persistentStateChanged: false,
    port,
    socketClosed: true,
    target: {
      id: "main-renderer",
      type: "page",
      url: "app://-/index.html",
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/main-renderer`,
    },
    ...overrides,
  };
}

test("Linux package contract accepts ChatGPT and Codex distribution identities", () => {
  for (const [launcherName, executable] of [
    ["chatgpt", "/usr/lib/chatgpt/ChatGPT"],
    ["codex-desktop", "/opt/codex/Codex"],
  ]) {
    assert.deepEqual(evaluateLinuxPlatformContract(input({ executable, launcherName })), {
      failures: [], status: "pass",
    });
  }
});

test("Linux CDP rejects non-loopback endpoints and foreign targets", () => {
  const remote = evaluateLinuxPlatformContract(input({ endpointHost: "192.168.1.20" }));
  assert.ok(remote.failures.includes("non-loopback-endpoint"));
  const wrongUrl = evaluateLinuxPlatformContract(input({
    target: { ...input().target, url: "https://example.test/" },
  }));
  assert.ok(wrongUrl.failures.includes("wrong-renderer-target"));
  const wrongSocket = evaluateLinuxPlatformContract(input({
    target: {
      ...input().target,
      webSocketDebuggerUrl: `ws://example.test:${port}/devtools/page/main-renderer`,
    },
  }));
  assert.ok(wrongSocket.failures.includes("wrong-renderer-target"));
});

test("Linux one-shot contract requires connection close and zero persistent state", () => {
  assert.deepEqual(
    evaluateLinuxPlatformContract(input({ socketClosed: false })).failures,
    ["cdp-not-closed"],
  );
  assert.deepEqual(
    evaluateLinuxPlatformContract(input({ persistentStateChanged: true })).failures,
    ["persistent-state-changed"],
  );
});
