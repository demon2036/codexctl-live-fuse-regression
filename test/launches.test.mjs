import test from "node:test";
import assert from "node:assert/strict";

test("managed launch status ignores isolated test receipts", async () => {
  const launches = await import("../src/launches.mjs");
  assert.equal(typeof launches.selectPrimaryManagedLaunch, "function");
  const isolated = {
    pid: 22,
    isolatedProfile: "/tmp/codexctl-test-profile",
    injection: { enabled: true, transport: "cdp", port: 45678 },
  };
  const primary = {
    pid: 11,
    isolatedProfile: null,
    injection: { enabled: false, transport: null, port: null },
  };
  assert.equal(launches.selectPrimaryManagedLaunch([isolated, primary]), primary);
  assert.equal(launches.selectPrimaryManagedLaunch([isolated]), null);
});
