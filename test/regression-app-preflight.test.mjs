import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAppPreflight, runPreflightedApp } from "../regression/app-preflight.mjs";

function validInput(overrides = {}) {
  const root = "/private/tmp/codexctl-run-111";
  return {
    app: {
      appVersion: "1.2026.224",
      bundle: "/Applications/ChatGPT.app",
      cliPath: "/Applications/ChatGPT.app/Contents/Resources/codex",
      cliVersion: "0.224.0",
      executable: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    },
    operation: "probe",
    permissions: { accessibility: true, screenRecording: true },
    process: { ownedPids: [7123], protectedPrimaryPids: [55654], targetPid: 7123 },
    profile: {
      path: `${root}/profile`,
      productionPaths: ["/Users/test/Library/Application Support/ChatGPT"],
      runRoot: root,
    },
    viewport: { height: 700, width: 1000 },
    ...overrides,
  };
}

test("valid isolated App preflight binds app, embedded CLI, profile, PID, and viewport", () => {
  assert.deepEqual(evaluateAppPreflight(validInput()), { reasonCodes: [], status: "pass" });
});

test("missing native permissions are explicit unverified and never launch", async () => {
  let launches = 0;
  const input = validInput({
    permissions: { accessibility: false, screenRecording: false },
  });
  const result = await runPreflightedApp({
    input,
    launch: async () => { launches += 1; },
  });
  assert.equal(result.status, "unverified");
  assert.deepEqual(result.reasonCodes, ["permission-accessibility", "permission-screen-recording"]);
  assert.equal(launches, 0);
});

test("production or escaped profile fails before launch", async () => {
  for (const profilePath of [
    "/Users/test/Library/Application Support/ChatGPT",
    "/private/tmp/codexctl-run-111/../outside",
  ]) {
    let launches = 0;
    const base = validInput();
    const input = { ...base, profile: { ...base.profile, path: profilePath } };
    const result = await runPreflightedApp({
      input,
      launch: async () => { launches += 1; },
    });
    assert.equal(result.status, "fail");
    assert.ok(result.reasonCodes.includes("unsafe-profile"));
    assert.equal(launches, 0);
  }
});

test("unknown or protected target PID fails without touching the main App", async () => {
  for (const targetPid of [9999, 55654]) {
    let launches = 0;
    const base = validInput();
    const input = { ...base, process: { ...base.process, targetPid } };
    const result = await runPreflightedApp({
      input,
      launch: async () => { launches += 1; },
    });
    assert.equal(result.status, "fail");
    assert.ok(result.reasonCodes.includes(targetPid === 55654 ? "protected-primary" : "unknown-pid"));
    assert.equal(launches, 0);
  }
});

test("non-embedded CLI, incomplete versions, and undersized viewport fail closed", () => {
  const base = validInput();
  const wrongCli = evaluateAppPreflight({
    ...base,
    app: { ...base.app, cliPath: "/usr/local/bin/codex" },
  });
  assert.ok(wrongCli.reasonCodes.includes("cli-not-embedded"));
  const noVersion = evaluateAppPreflight({
    ...base,
    app: { ...base.app, appVersion: "" },
  });
  assert.ok(noVersion.reasonCodes.includes("missing-version"));
  const tiny = evaluateAppPreflight({ ...base, viewport: { height: 480, width: 640 } });
  assert.ok(tiny.reasonCodes.includes("viewport-too-small"));
});
