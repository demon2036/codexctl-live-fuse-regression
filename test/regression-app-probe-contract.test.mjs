import test from "node:test";
import assert from "node:assert/strict";
import { runAppProbe, validateAppProbeResult } from "../regression/app-probe-contract.mjs";

function bounds(x = 0) {
  return { height: 40, width: 100, x, y: 20 };
}

function fakeAdapter(platform, overrides = {}) {
  const calls = [];
  const adapter = {
    platform,
    calls,
    async preflight() { calls.push("preflight"); return { reasonCodes: [], status: "pass" }; },
    async launch() {
      calls.push("launch");
      return {
        appVersion: "1.0.0", cliVersion: "1.0.0", executableId: "ChatGPT",
        pid: 7123, profileId: "fixture-profile", startedAt: "start-7123",
      };
    },
    async remote() { calls.push("remote"); return { errors: [], status: "connected" }; },
    async processTree() {
      calls.push("processTree");
      return { appServerCount: 1, controllerCount: 0, duplicatePresence: false, processCount: 4 };
    },
    async visual() {
      calls.push("visual");
      return {
        regions: Object.fromEntries(["wallpaper", "bottom", "sidebar", "main", "composer"]
          .map((name, index) => [name, {
            background: name === "bottom" ? "transparent" : "theme",
            bounds: bounds(index * 100),
            visible: true,
          }])),
        sidebarDocked: true,
        sidebarMainGap: 0,
        wallpaperVisibleMs: 120,
      };
    },
    async controls() {
      calls.push("controls");
      return {
        context: { bounds: bounds(300), count: 1, reachable: true },
        prompt: { bounds: bounds(190), count: 1, reachable: true },
      };
    },
    async metrics() {
      calls.push("metrics");
      return {
        cpuMedian: 1, cpuP95: 2, inputMaxMs: 4, inputP95Ms: 2,
        layoutReads: 0, longTaskCount: 0, observerCount: 0, scopedObserverCount: 0,
        scrollMaxMs: 5, scrollP95Ms: 3, timerCount: 0, workerCount: 0,
      };
    },
    async diagnostics() {
      calls.push("diagnostics");
      return { contextRevision: "a".repeat(24), promptRevision: "a".repeat(24),
        wallpaperRevision: "b".repeat(24) };
    },
    async cleanup() { calls.push("cleanup"); return { orphans: [], status: "pass" }; },
    ...overrides,
  };
  return adapter;
}

for (const platform of ["macos", "linux"]) {
  test(`fake ${platform} adapter emits the platform-neutral App probe schema`, async () => {
    const adapter = fakeAdapter(platform);
    const result = await runAppProbe({ adapter, mode: "injected", request: {} });
    assert.deepEqual(validateAppProbeResult(result), []);
    assert.equal(result.platform, platform);
    assert.equal(result.status, "pass");
    assert.deepEqual(adapter.calls, [
      "preflight", "launch", "remote", "processTree", "visual", "controls",
      "metrics", "diagnostics", "cleanup",
    ]);
  });
}

test("Remote, process tree, visual, controls, and metrics are required", async () => {
  for (const method of ["remote", "processTree", "visual", "controls", "metrics"]) {
    const adapter = fakeAdapter("macos", { [method]: undefined });
    await assert.rejects(runAppProbe({ adapter, mode: "official", request: {} }),
      new RegExp(`adapter.*${method}`));
    assert.equal(adapter.calls.at(-1), "cleanup");
  }
});

test("cleanup failure and semantic probe failures can never produce pass", async () => {
  const cleanupFailure = fakeAdapter("macos", {
    async cleanup() { this.calls.push("cleanup"); return { orphans: [{ kind: "app", pid: 7123 }], status: "fail" }; },
  });
  assert.equal((await runAppProbe({
    adapter: cleanupFailure, mode: "injected", request: {},
  })).status, "fail");

  const remoteFailure = fakeAdapter("linux", {
    async remote() { this.calls.push("remote"); return { errors: ["websocket-reset"], status: "disconnected" }; },
  });
  const result = await runAppProbe({ adapter: remoteFailure, mode: "injected", request: {} });
  assert.equal(result.status, "fail");
  assert.ok(result.reasonCodes.includes("remote-disconnected"));
});

test("official baseline does not require injected wallpaper or controls", async () => {
  const adapter = fakeAdapter("macos", {
    async visual() {
      this.calls.push("visual");
      const value = await fakeAdapter("macos").visual();
      value.regions.bottom.background = "opaque-black";
      value.wallpaperVisibleMs = 0;
      return value;
    },
    async controls() {
      this.calls.push("controls");
      return {
        context: { bounds: bounds(), count: 0, reachable: false },
        prompt: { bounds: bounds(), count: 0, reachable: false },
      };
    },
  });
  const result = await runAppProbe({ adapter, mode: "official", request: {} });
  assert.equal(result.status, "pass");
});

test("module-isolated diagnostics require exactly the selected injected surfaces", async () => {
  const adapter = fakeAdapter("macos", {
    async controls() {
      this.calls.push("controls");
      return {
        context: { bounds: bounds(), count: 0, reachable: false },
        prompt: { bounds: bounds(), count: 0, reachable: false },
      };
    },
  });
  const result = await runAppProbe({
    adapter,
    mode: "injected",
    request: {
      expectedModules: { context: false, prompt: false, wallpaper: true },
    },
  });
  assert.equal(result.status, "pass");
});

test("probe result rejects private or unknown fields", async () => {
  const result = await runAppProbe({ adapter: fakeAdapter("macos"), mode: "official", request: {} });
  result.token = "secret";
  assert.match(validateAppProbeResult(result).map(({ message }) => message).join("\n"), /未知字段.*token/);
});

test("only the two verified native-control observers are accepted", async () => {
  const baseline = await fakeAdapter("linux").metrics();
  for (const [observerCount, scopedObserverCount, expected] of [
    [2, 2, "pass"], [1, 0, "fail"], [2, 1, "fail"], [3, 3, "fail"], [0.5, 0.5, "fail"],
  ]) {
    const adapter = fakeAdapter("linux", {
      async metrics() { return { ...baseline, observerCount, scopedObserverCount }; },
    });
    const result = await runAppProbe({ adapter, mode: "injected", request: {} });
    assert.equal(result.status, expected);
  }
});
