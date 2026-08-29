#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { createDefaultConfig } from "../src/defaults.mjs";
import { descendantProcessRows, listProcessRows, readProcessRow } from "../src/desktop-processes.mjs";
import { waitForMacPreloadResult } from "../src/macos-preload-runtime.mjs";
import { resolvePaths } from "../src/paths.mjs";
import { materializeRuntime } from "../src/runtime.mjs";
import { launchIsolatedMacApp } from "../regression/macos-platform-runtime.mjs";
import {
  collectMacNativeEvidence,
  compileMacNativeProbe,
  evaluateMacPlatformEvidence,
  redactMacAppArguments,
} from "../regression/macos-platform-evidence.mjs";
import { collectMacNativeCpu } from "../regression/macos-native-performance.mjs";
import { createRunEnvelope } from "../regression/ownership.mjs";

const execFileAsync = promisify(execFile);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const args = process.argv.slice(2);
const help = args.includes("--help");
const json = args.includes("--json");
const mode = args.includes("--injected") ? "injected" : "official";
const unknown = args.filter((arg) => ![
  "--help", "--injected", "--json", "--official",
].includes(arg));
if (unknown.length) throw new Error("Usage: macos-platform-regression.mjs [--official|--injected] [--json]");
if (help) {
  console.log("Usage: macos-platform-regression.mjs [--official|--injected] [--json]");
  console.log("Runs a foreground, force-new, isolated real ChatGPT App LaunchServices smoke check.");
  process.exit(0);
}
if (process.platform !== "darwin") {
  console.log(JSON.stringify({ reasonCodes: ["platform-not-macos"], status: "unverified" }));
  process.exitCode = 2;
} else {
  const bundle = process.env.CODEXCTL_TEST_MAC_APP ?? "/Applications/ChatGPT.app";
  const executable = path.join(bundle, "Contents", "MacOS", "ChatGPT");
  const embeddedCli = path.join(bundle, "Contents", "Resources", "codex");
  const missing = [];
  for (const [label, filename] of [["app-bundle", bundle], ["app-executable", executable], ["embedded-cli", embeddedCli]]) {
    if (!await fs.access(filename).then(() => true).catch(() => false)) missing.push(label);
  }
  if (missing.length) {
    console.log(JSON.stringify({ actual: false, reasonCodes: missing, status: "unverified" }));
    process.exitCode = 2;
  } else {
  const envelope = await createRunEnvelope();
  let launched;
  let preload = null;
  let runtime = null;
  try {
    if (mode === "injected") {
      const prompt = path.join(envelope.runtime, "developer-prompt.md");
      await fs.writeFile(prompt, "isolated macOS regression prompt\n", { mode: 0o600 });
      const config = createDefaultConfig();
      config.modules = { context: true, prompt: true, wallpaper: true };
      config.prompt.profiles = [{ id: "work", label: "Work", path: prompt }];
      const paths = resolvePaths({
        HOME: envelope.root,
        CODEXCTL_HOME: path.join(envelope.runtime, "controller"),
      });
      runtime = await materializeRuntime(config, paths);
      preload = {
        hook: paths.macPreloadHook,
        result: path.join(runtime.directory, `preload-result-${randomUUID()}.json`),
        spec: runtime.paths.macPreloadSpecFile,
      };
    }
    const launchStarted = performance.now();
    launched = await launchIsolatedMacApp({
      bundle, embeddedCli, envelope, executable, mode, preload,
    });
    const processLaunchMs = performance.now() - launchStarted;
    const injection = mode === "injected"
      ? await waitForMacPreloadResult(preload.result, launched.main.pid, runtime)
      : null;
    const nativeExecutable = await compileMacNativeProbe(envelope);
    const native = await collectMacNativeEvidence({
      envelope, executable: nativeExecutable, pid: launched.main.pid, readProcess: readProcessRow,
    });
    const cpu = native.status === "pass" && nativeExecutable
      ? await collectMacNativeCpu({ executable: nativeExecutable, pid: launched.main.pid }) : null;
    const launchMs = performance.now() - launchStarted;
    const { stdout: cliVersion } = await execFileAsync(embeddedCli, ["--version"], {
      timeout: 5000, maxBuffer: 64 * 1024,
    });
    const appServerDeadline = Date.now() + 15_000;
    let appServerCount = 0;
    while (Date.now() < appServerDeadline) {
      const rows = await listProcessRows();
      const family = descendantProcessRows(rows, launched.main.pid);
      appServerCount = family.filter(({ command }) => (
        command.startsWith(`${embeddedCli} `) && /(?:^|\s)app-server(?:\s|$)/.test(command)
      )).length;
      if (appServerCount === 1) break;
      await delay(50);
    }
    const launchServices = launched.contract.status;
    const rawAppArguments = launched.evidence.appArguments;
    const appArguments = redactMacAppArguments(rawAppArguments);
    const processId = launched.main.pid;
    const cleanup = await launched.close();
    launched = null;
    const failures = [];
    if (appServerCount !== 1) failures.push("app-server-count");
    if (cleanup.status !== "pass") failures.push("cleanup");
    if (mode === "injected" && injection?.transport !== "electron-preload") {
      failures.push("preload-receipt");
    }
    const platformEvidence = evaluateMacPlatformEvidence({ injection, mode, native });
    failures.push(...platformEvidence.failures);
    const status = failures.length ? "fail"
      : platformEvidence.status === "unverified" ? "unverified" : "pass";
    const result = {
      schema: "codexctl-macos-platform-smoke/1",
      status,
      reasonCodes: [...new Set([...failures, ...platformEvidence.reasonCodes])].sort(),
      mode,
      appVersion: await execFileAsync("/usr/bin/plutil", [
        "-extract", "CFBundleShortVersionString", "raw", "-o", "-",
        path.join(bundle, "Contents", "Info.plist"),
      ]).then(({ stdout }) => stdout.trim()),
      cliVersion: cliVersion.trim(),
      launchServices,
      appArguments,
      functionalArguments: rawAppArguments.filter((value) => !value.startsWith("--user-data-dir=")),
      launchMs,
      processLaunchMs,
      visibleMs: mode === "injected" ? injection?.durationMs ?? Number.NaN : 0,
      profileBound: true,
      processId,
      remoteDebugging: false,
      appServerCount,
      profileSeeded: false,
      remote: appServerCount === 1 ? "connected" : "disconnected",
      injection: injection ? {
        contextButtonCount: injection.promptContext?.contextButtonCount ?? null,
        controlContextAvailable: injection.promptContext?.controlContextAvailable ?? null,
        durationMs: injection.durationMs,
        promptButtonCount: injection.promptContext?.buttonCount ?? null,
        promptRevision: injection.promptContext?.revision ?? null,
        transport: injection.transport,
        wallpaperRevision: injection.wallpaper?.revision ?? null,
      } : null,
      native,
      cpu,
      cleanup,
    };
    if (json) console.log(JSON.stringify(result));
    else console.log(`macOS ${mode} platform smoke ${result.status}`);
    if (result.status !== "pass") process.exitCode = result.status === "unverified" ? 2 : 1;
  } finally {
    if (launched) await launched.close().catch(() => {});
    await envelope.cleanup();
  }
  }
}
