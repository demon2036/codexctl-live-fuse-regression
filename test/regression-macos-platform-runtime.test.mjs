import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  macLaunchServicesContract,
  ownedEnvelopeProcessRows,
} from "../regression/macos-platform-runtime.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function input(overrides = {}) {
  const bundle = "/Applications/ChatGPT.app";
  return {
    bundle,
    environment: { CODEX_ELECTRON_USER_DATA_PATH: "/private/tmp/run/profile" },
    executable: `${bundle}/Contents/MacOS/ChatGPT`,
    mode: "official",
    openArgs: [
      "-n", "--env",
      "CODEX_ELECTRON_USER_DATA_PATH=/private/tmp/run/profile", bundle,
      "--args", "--user-data-dir=/private/tmp/run/profile",
    ],
    profile: "/private/tmp/run/profile",
    ...overrides,
  };
}

test("[PLATFORM-MACOS-IDENTITY-001] [PLATFORM-MACOS-INTERACTIVE-ACTIVATION-006] isolated macOS App uses foreground force-new LaunchServices", () => {
  assert.deepEqual(macLaunchServicesContract(input()), { failures: [], status: "pass" });
  assert.deepEqual(macLaunchServicesContract(input({
    openArgs: ["-g", ...input().openArgs],
  })).failures, ["launch-services-arguments"]);
  assert.deepEqual(macLaunchServicesContract(input({
    openArgs: ["-W", ...input().openArgs],
  })).failures, ["launch-services-arguments"]);
});

test("macOS official launch rejects preload and debugging environment", () => {
  const result = macLaunchServicesContract(input({
    environment: {
      CODEX_ELECTRON_USER_DATA_PATH: "/private/tmp/run/profile",
      NODE_OPTIONS: "--require=hook",
      CODEXCTL_PRELOAD_SPEC: "/private/tmp/spec",
      CODEXCTL_PRELOAD_RESULT: "/private/tmp/result",
      REMOTE_DEBUGGING_PORT: "9222",
    },
  }));
  assert.deepEqual(result.failures, ["debug-environment", "official-preload-environment"]);
});

test("macOS injected launch requires complete preload environment without DevTools", () => {
  const partial = macLaunchServicesContract(input({ mode: "injected" }));
  assert.deepEqual(partial.failures, ["injected-preload-environment"]);
  const complete = macLaunchServicesContract(input({
    mode: "injected",
    environment: {
      CODEX_ELECTRON_USER_DATA_PATH: "/private/tmp/run/profile",
      CODEXCTL_PRELOAD_RESULT: "/private/tmp/result",
      CODEXCTL_PRELOAD_SPEC: "/private/tmp/spec",
      NODE_OPTIONS: "--require=hook",
    },
  }));
  assert.deepEqual(complete, { failures: [], status: "pass" });
});

test("macOS contract rejects direct execution or arguments forwarded to the App", () => {
  const result = macLaunchServicesContract(input({
    openArgs: ["-g", "-n", "-W", "/Applications/ChatGPT.app", "--args", "--remote-debugging-port=9222"],
  }));
  assert.deepEqual(result.failures, ["launch-services-arguments"]);
});

test("[RECOVERY-OWNED-CLEANUP-003] late adopted helpers remain owned by the exact envelope path", () => {
  const root = "/private/tmp/codexctl-regression-run";
  const rows = [
    { command: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT", pid: 11 },
    { command: `/usr/bin/git -C ${root}/codex-home fetch`, pid: 12 },
    { command: `${root}-foreign/codex-home/helper`, pid: 13 },
  ];
  assert.deepEqual(ownedEnvelopeProcessRows(rows, root).map(({ pid }) => pid), [12]);
});

test("[TDD-PROTECT-MAIN-APP-016] macOS L5 cannot seed itself from user credentials or Sessions", async () => {
  const source = await fs.readFile(path.join(ROOT, "scripts", "macos-platform-regression.mjs"), "utf8");
  assert.doesNotMatch(source, /seed-profile|auth\.json|session_index|state_5|Application Support/);
});
