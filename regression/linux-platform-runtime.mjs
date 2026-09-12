import fs from "node:fs/promises";
import path from "node:path";
import {
  descendantProcessRows,
  listProcessRows,
  terminateDesktopProcess,
  terminateProfileCrashHandlers,
} from "../src/desktop-processes.mjs";
import { launchManagedApp } from "../src/app-transaction.mjs";
import { removeManagedLaunch } from "../src/launches.mjs";
import { allocateLoopbackPort, loopbackPortOpen } from "../src/ports.mjs";
import { waitForCodexCdp } from "../src/cdp.mjs";
import { rendererTargets } from "../src/renderer-injection.mjs";
import { runRendererBenchmark } from "./renderer-benchmark.mjs";
import { evaluateLinuxPlatformContract } from "./linux-platform-contract.mjs";
import { collectPlatformCpu } from "./platform-performance.mjs";
import {
  collectPlatformRendererEvidence,
  evaluatePlatformRendererEvidence,
} from "./platform-renderer-probe.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const REMOTE_ERROR = /websocket.{0,40}reset|server already online|protocol.{0,40}mismatch|duplicate presence/i;

export function linuxRendererReady(value, mode) {
  const controlsReady = mode === "official"
    || (value?.diagnostics?.managerStatus === "ready"
      && value?.controls?.prompt?.count === 1 && value?.controls?.context?.count === 1);
  return Boolean(value?.interactive && controlsReady
    && value?.sidebarScroll?.found === true && value.sidebarScroll.overflowing === true);
}

export function classifyLinuxModeFailure(error, requestedStage) {
  const stages = new Set(["benchmark", "cdp", "contract", "cpu", "launch", "process", "renderer", "target"]);
  const failureStage = stages.has(requestedStage) ? requestedStage : "unknown";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const patterns = [
    [/Scroll benchmark captured only/i, "scroll-events"],
    [/Input benchmark captured/i, "input-events"],
    [/Benchmark failed to restore/i, "state-restore"],
    [/Benchmark setup failed/i, "setup"],
    [/CDP unavailable/i, "unavailable"],
    [/renderer target/i, "target-unavailable"],
    [/deadline|timed?\s*out|timeout/i, "deadline"],
  ];
  const kind = patterns.find(([pattern]) => pattern.test(message))?.[1]
    ?? ({ EACCES: "access", ECONNREFUSED: "connection", ENOENT: "not-found",
      ETIMEDOUT: "deadline" })[error?.code]
    ?? "unknown";
  return { errorCode: `${failureStage}-${kind}`, failureStage };
}

export function linuxPlatformLaunchArguments({ mode, port, workspace } = {}) {
  if (!new Set(["official", "injected"]).has(mode) || !path.isAbsolute(workspace ?? "")) {
    throw new Error("Linux platform launch requires a mode and absolute workspace");
  }
  if (mode === "injected") return ["--open-project", workspace];
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("Linux official platform launch requires a loopback port");
  }
  return [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    "--open-project",
    workspace,
  ];
}

async function waitForRenderer(port, mode, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await collectPlatformRendererEvidence(port, { captureScreenshot: false });
      if (linuxRendererReady(last, mode)) {
        return collectPlatformRendererEvidence(port, { captureScreenshot: true });
      }
    } catch {}
    await delay(100);
  }
  if (last) return { ...last, reasonCodes: ["interactive-shell-unavailable"], status: "unverified" };
  return { reasonCodes: ["renderer-target-missing"], status: "unverified" };
}

async function logHasRemoteError(filename, offset) {
  const data = await fs.readFile(filename).catch(() => Buffer.alloc(0));
  return REMOTE_ERROR.test(data.subarray(Math.min(offset, data.length)).toString("utf8"));
}

async function cleanupManaged({ envelope, managed, paths, port }) {
  if (managed?.processInfo) {
    await terminateDesktopProcess(managed.processInfo, managed.desktop, 10_000).catch(() => false);
    await terminateProfileCrashHandlers(envelope.profile, managed.desktop).catch(() => []);
    await removeManagedLaunch(paths, managed.processInfo.pid).catch(() => {});
  }
  const deadline = Date.now() + 10_000;
  let remaining = [];
  let emptyScans = 0;
  while (Date.now() < deadline && emptyScans < 2) {
    remaining = (await listProcessRows()).filter(({ command }) => command.includes(envelope.root));
    emptyScans = remaining.length ? 0 : emptyScans + 1;
    if (emptyScans < 2) await delay(80);
  }
  const portClosed = !port || !(await loopbackPortOpen(port, 200));
  return {
    orphans: remaining.map(({ pid }) => ({ kind: "linux-isolated", pid })),
    portClosed,
    status: remaining.length === 0 && portClosed ? "pass" : "fail",
  };
}

export async function runLinuxPlatformMode({
  config,
  envelope,
  env,
  mode,
  paths,
} = {}) {
  if (!new Set(["official", "injected"]).has(mode)) throw new Error(`Invalid Linux mode: ${mode}`);
  const injected = mode === "injected";
  const officialPort = injected ? null : await allocateLoopbackPort();
  const extraArgs = linuxPlatformLaunchArguments({
    mode, port: officialPort, workspace: envelope.root,
  });
  const logOffset = await fs.stat(paths.appLogFile).then(({ size }) => size).catch(() => 0);
  let managed = null;
  let port = officialPort;
  let cleanup = { orphans: [], portClosed: true, status: "pass" };
  let result;
  let renderer = null;
  let failureStage = "launch";
  try {
    const startedAt = performance.now();
    managed = await launchManagedApp({
      config,
      env,
      options: { extraArgs, inject: injected, isolatedProfile: envelope.profile },
      paths,
      platform: "linux",
      relay: { enabled: false, values: {} },
    });
    const launchMs = performance.now() - startedAt;
    port = injected ? managed.debugPort : officialPort;
    failureStage = "cdp";
    const cdp = await waitForCodexCdp(port, 15_000);
    if (!cdp.reachable) throw new Error(`Linux App CDP unavailable: ${cdp.detail}`);
    failureStage = "target";
    const targets = await rendererTargets(port);
    const target = targets.find(({ url }) => url === "app://-/index.html") ?? targets[0] ?? null;
    failureStage = "renderer";
    renderer = await waitForRenderer(port, mode);
    const visual = evaluatePlatformRendererEvidence({ mode, value: renderer });
    let benchmark = null;
    let cpu = null;
    if (visual.status === "pass") {
      failureStage = "benchmark";
      benchmark = await runRendererBenchmark({
        label: `linux-${mode}`, port, scrollSteps: 50, typingIntervalMs: 25,
      });
      failureStage = "cpu";
      cpu = await collectPlatformCpu({ pid: managed.processInfo.pid, port });
    }
    failureStage = "process";
    const rows = await listProcessRows();
    const family = descendantProcessRows(rows, managed.processInfo.pid);
    const appServerCount = family.filter(({ command }) => (
      command.startsWith(`${managed.desktop.officialCli} `)
      && /(?:^|\s)app-server(?:\s|$)/.test(command)
    )).length;
    const controllerCount = rows.filter(({ command }) => command.includes(envelope.root)
      && /(?:prompt-context|wallpaper-lite)[\/]injector\.mjs/.test(command)).length;
    failureStage = "contract";
    const contract = evaluateLinuxPlatformContract({
      endpointHost: "127.0.0.1",
      executable: managed.desktop.executable,
      launcherName: path.basename(managed.desktop.executable),
      persistentStateChanged: false,
      port,
      socketClosed: controllerCount === 0,
      target,
    });
    const remoteError = await logHasRemoteError(paths.appLogFile, logOffset);
    result = {
      schema: "codexctl-linux-platform-mode/1",
      status: visual.status,
      reasonCodes: [...visual.reasonCodes],
      mode,
      processId: managed.processInfo.pid,
      packageExecutable: path.basename(managed.desktop.executable),
      cliExecutable: path.basename(managed.desktop.officialCli ?? ""),
      appServerCount,
      controllerCount,
      remote: appServerCount === 1 && !remoteError ? "connected" : "disconnected",
      launchMs,
      visibleMs: injected ? managed.injection?.durationMs ?? Number.NaN : 0,
      renderer,
      benchmark,
      cpu,
      contract,
      injectionTransport: managed.injection ? "cdp" : null,
    };
    const failures = [...contract.failures];
    if (appServerCount !== 1) failures.push("app-server-count");
    if (controllerCount !== 0) failures.push("controller-still-running");
    if (remoteError) failures.push("remote-log-error");
    if (failures.length) {
      result.status = "fail";
      result.reasonCodes = [...new Set([...result.reasonCodes, ...failures])].sort();
    }
  } catch (error) {
    const failure = classifyLinuxModeFailure(error, failureStage);
    result = {
      schema: "codexctl-linux-platform-mode/1",
      status: "fail",
      reasonCodes: ["mode-execution-failed"],
      mode,
      renderer,
      ...failure,
    };
  } finally {
    cleanup = await cleanupManaged({ envelope, managed, paths, port });
  }
  result.cleanup = cleanup;
  if (cleanup.status !== "pass") {
    result.status = "fail";
    result.reasonCodes = [...new Set([...result.reasonCodes, "cleanup"])].sort();
  }
  return result;
}
