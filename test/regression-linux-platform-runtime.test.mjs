import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyLinuxModeFailure,
  linuxPlatformLaunchArguments,
  linuxRendererReady,
} from "../regression/linux-platform-runtime.mjs";

test("[PLATFORM-LINUX-RENDERER-SURFACE-005] readiness waits for the real Sessions overflow", () => {
  const shell = {
    controls: { context: { count: 1 }, prompt: { count: 1 } },
    diagnostics: { managerStatus: "ready" },
    interactive: true,
    ownerEvidence: [{ composer: true, visible: true, hitInside: true },
      { target: "permissions", visible: true, hitInside: true }],
    sidebarScroll: { found: true, overflowing: false },
  };
  assert.equal(linuxRendererReady(shell, "injected"), false);
  assert.equal(linuxRendererReady({
    ...shell, sidebarScroll: { found: true, overflowing: true, hit: { inside: true } },
  }, "injected"), true);
  assert.equal(linuxRendererReady({
    ...shell, controls: {}, diagnostics: {},
    sidebarScroll: { found: true, overflowing: true, hit: { inside: true } },
  }, "official"), true);
  for (const ownerEvidence of [[], [{ composer: true, visible: true, hitInside: true }],
    shell.ownerEvidence.map((entry) => ({ ...entry, hitInside: false }))]) {
    assert.equal(linuxRendererReady({ ...shell, ownerEvidence,
      sidebarScroll: { found: true, overflowing: true, hit: { inside: true } },
    }, "official"), false, "native toolbar and its hit regions must be ready before typing");
  }
});

test("[PLATFORM-LINUX-WORKSPACE-ROUTE-004] actual Linux package opens the owned synthetic workspace in both modes", () => {
  const workspace = "/tmp/codexctl-owned-workspace";
  assert.deepEqual(linuxPlatformLaunchArguments({
    mode: "official", port: 19421, workspace,
  }), [
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=19421",
    "--open-project",
    workspace,
  ]);
  assert.deepEqual(linuxPlatformLaunchArguments({ mode: "injected", workspace }), [
    "--open-project",
    workspace,
  ]);
});

test("actual Linux failure evidence preserves the failed stage without leaking paths", () => {
  const classified = classifyLinuxModeFailure(
    new Error("Scroll benchmark captured only 0 events in /home/private/session"),
    "benchmark",
  );
  assert.deepEqual(classified, {
    errorCode: "benchmark-scroll-events",
    failureStage: "benchmark",
  });
  assert.doesNotMatch(JSON.stringify(classified), /private|\/home/);
});

test("Linux package workspace selection rejects relative paths and invalid ports", () => {
  assert.throws(() => linuxPlatformLaunchArguments({
    mode: "official", port: 19421, workspace: "relative",
  }), /absolute workspace/);
  assert.throws(() => linuxPlatformLaunchArguments({
    mode: "official", port: 0, workspace: "/tmp/owned",
  }), /loopback port/);
});
