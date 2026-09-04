import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ConfigError } from "./errors.mjs";
import { waitForCodexCdp } from "./cdp.mjs";
import {
  listDesktopProcesses,
  listDetachedDesktopHelpers,
  processHasRelayOverride,
  remoteDebuggingPort,
  terminateDetachedDesktopHelpers,
  terminateDesktopProcess,
  terminateProfileCrashHandlers,
} from "./desktop-processes.mjs";
import {
  connectionFingerprint,
  managedRecordForProcess,
  recordManagedLaunch,
  removeManagedLaunch,
  waitForDesktopProcess,
} from "./launches.mjs";
import { discoverDesktop, launchApp, planAppLaunch } from "./platform.mjs";
import { materializeRuntime } from "./runtime.mjs";
import { installOnce } from "./one-shot-injection.mjs";
import {
  MAC_PRELOAD_TRANSACTION_TIMEOUT_MS,
  waitForMacPreloadResult,
} from "./macos-preload-runtime.mjs";
import { stopSupervisor } from "./supervisor.mjs";
import { normalizeProviderId } from "./provider.mjs";

function sameModules(left, right) {
  return ["prompt", "context", "wallpaper"].every(
    (key) => Boolean(left?.[key]) === Boolean(right?.[key]),
  );
}

function hasIsolatedProfile(command) {
  return /(?:^|\s)--user-data-dir(?:=|\s+)/.test(String(command));
}

function isRemoteSafeOfficialProcess(desktop, processInfo, relay, desiredInjection) {
  if (desktop.platform !== "darwin" || !desktop.bundle || relay.enabled || desiredInjection) return true;
  return processInfo.command === desktop.executable;
}

async function existingCanBeReused(
  paths,
  desktop,
  processInfo,
  relay,
  config,
  platform,
  desiredInjection,
) {
  const record = await managedRecordForProcess(paths, desktop, processInfo);
  if (!isRemoteSafeOfficialProcess(desktop, processInfo, relay, desiredInjection)) {
    return { reusable: false, record };
  }
  if (record) {
    if (record.live?.enabled) return { reusable: false, record };
    // A renderer that has ever hosted private injection is never reused as a
    // transaction target. Even a correct DOM cleanup cannot reset Chromium's
    // JS heap, style/compositor caches, patched client objects, or detached
    // listeners. A complete App process boundary is the recovery contract.
    if (desiredInjection || record.injection?.enabled) return { reusable: false, record };
    const actualPort = remoteDebuggingPort(processInfo.command);
    const matches = record.connection?.fingerprint === connectionFingerprint(relay)
      && Boolean(record.injection?.enabled) === desiredInjection
      && sameModules(record.injection?.modules, config.modules)
      && (!desiredInjection || actualPort === record.injection.port);
    return { reusable: matches, record };
  }

  // Unknown, uninstrumented official instances are reusable only for the
  // pristine official target.  Any ambiguous environment fails closed.
  if (!relay.enabled && !desiredInjection && !remoteDebuggingPort(processInfo.command)) {
    const hasRelay = await processHasRelayOverride(processInfo.pid, platform);
    return { reusable: hasRelay === false, record: null, ambiguous: hasRelay === null };
  }
  return { reusable: false, record: null };
}

async function terminateLaunched(paths, desktop, processInfo, isolatedProfile = null) {
  if (!processInfo) return;
  await terminateDesktopProcess(processInfo, desktop, 5000).catch(() => false);
  if (isolatedProfile) {
    await terminateProfileCrashHandlers(isolatedProfile, desktop).catch(() => []);
  }
  await removeManagedLaunch(paths, processInfo.pid).catch(() => {});
}

async function waitForRelayHandshake(plan, relay, timeoutMs = 15_000) {
  if (!relay.enabled || !plan.relayHandshakeFile) return false;
  const expectedHash = createHash("sha256").update(relay.values.url).digest("hex");
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  try {
    while (Date.now() < deadline) {
      try {
        const text = await fs.readFile(plan.relayHandshakeFile, "utf8");
        const record = JSON.parse(text);
        const keys = Object.keys(record ?? {}).sort();
        if (keys.join(",") !== [
          "baseUrlHash", "bridgePid", "createdAt", "parentPid", "provider", "schema",
        ].sort().join(",")) throw new Error("handshake contained unexpected fields");
        if (record?.schema !== "codexctl-relay-handshake/1"
          || record.provider !== "openai-custom" || record.baseUrlHash !== expectedHash
          || !Number.isSafeInteger(record.bridgePid) || record.bridgePid < 2) {
          throw new Error("handshake identity did not match this relay launch");
        }
        return true;
      } catch (error) {
        if (error.code !== "ENOENT") lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`bridge 未在 ${Math.round(timeoutMs / 1000)} 秒内确认使用临时 relay${lastError ? `：${lastError.message}` : ""}`);
  } finally {
    await fs.rm(plan.relayHandshakeFile, { force: true }).catch(() => {});
  }
}

async function waitForLaunchedDesktop(desktop, launched, timeoutMs = 8000) {
  if (launched.pid) return waitForDesktopProcess(desktop, launched.pid, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const primary = (await listDesktopProcesses(desktop))
      .filter((entry) => !hasIsolatedProfile(entry.command));
    if (primary.length === 1) return primary[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function rollbackOfficial(paths, config, desktop, options, env, platform) {
  const rollbackPlan = await planAppLaunch(
    config,
    paths,
    { enabled: false, values: {} },
    {
      inject: false,
      hidden: options.hidden,
      extraArgs: options.extraArgs,
      officialCliSource: options.officialCliSource,
    },
    env,
    platform,
  );
  const launched = await launchApp(rollbackPlan);
  const processInfo = await waitForLaunchedDesktop(desktop, launched, 8000);
  if (!processInfo) throw new Error("官方回退进程未保持运行");
  const record = await recordManagedLaunch(
    paths,
    rollbackPlan,
    processInfo,
    { enabled: false, values: {} },
    { ...config, modules: { prompt: false, context: false, wallpaper: false } },
  );
  return { launched, processInfo, record };
}

export async function launchManagedApp({
  paths,
  config,
  relay,
  options = {},
  env = process.env,
  platform = process.platform,
}) {
  const requestedProviderId = options.providerId;
  const providerId = requestedProviderId == null ? null : normalizeProviderId(requestedProviderId);
  if (requestedProviderId != null && !providerId) {
    throw new ConfigError("启动 Provider ID 必须由字母、数字、点、下划线或连字符组成（最长 120 字符）。");
  }
  if (providerId && relay.enabled) {
    throw new ConfigError("Provider 与 relay 是两种不同路由方式，不能在同一次启动中同时使用。");
  }
  const desktop = await discoverDesktop(config, env, platform);
  const isolatedProfile = options.isolatedProfile
    ? path.resolve(options.isolatedProfile)
    : null;
  if (providerId && options.inject !== true) {
    throw new ConfigError("启动 Provider 需要启用一次性注入。");
  }
  if (providerId && !config.modules.prompt && !config.modules.context) {
    throw new ConfigError("启动 Provider 需要 Prompt 或 Context 模块来安装 Provider 请求控制器。");
  }
  const desiredInjection = options.inject === true
    && (config.modules.prompt || config.modules.context || config.modules.wallpaper);
  if (isolatedProfile) await fs.mkdir(isolatedProfile, { recursive: true, mode: 0o700 });

  let existing = null;
  let existingRecord = null;
  if (!isolatedProfile) {
    const primary = (await listDesktopProcesses(desktop))
      .filter((entry) => !hasIsolatedProfile(entry.command));
    if (primary.length > 1) {
      throw new ConfigError(`发现 ${primary.length} 个非隔离 Codex 主进程；为避免误伤，拒绝自动切换。`);
    }
    existing = primary[0] ?? null;
    if (existing) {
      const reuse = await existingCanBeReused(
        paths,
        desktop,
        existing,
        relay,
        config,
        platform,
        desiredInjection,
      );
      existingRecord = reuse.record;
      if (reuse.reusable) {
        const debugPort = remoteDebuggingPort(existing.command) || null;
        return {
          action: "reused",
          desktop,
          processInfo: existing,
          record: existingRecord,
          debugPort,
          runtime: null,
          injection: null,
        };
      }
      if (reuse.ambiguous) {
        throw new ConfigError(`无法确认 Codex PID ${existing.pid} 的连接模式；保持当前 App 不动。`);
      }
      if (remoteDebuggingPort(existing.command) && !existingRecord) {
        throw new ConfigError(`Codex PID ${existing.pid} 使用未知调试端口；它不属于当前 codexctl，拒绝替换。`);
      }
    }
  }

  // Complete all non-destructive preparation before the replacement boundary.
  const runtime = desiredInjection
    ? await materializeRuntime(config, paths, { launchProviderId: providerId })
    : null;
  const plan = await planAppLaunch(config, paths, relay, {
    inject: desiredInjection,
    hidden: options.hidden,
    isolatedProfile,
    extraArgs: options.extraArgs,
    proxyServer: options.proxyServer,
    officialCliSource: options.officialCliSource,
    preloadSpecFile: runtime?.paths?.macPreloadSpecFile,
  }, env, platform);

  let replacementBoundaryCrossed = false;
  let launchedInfo = null;
  try {
    if (existing) {
      if (existingRecord?.injection?.enabled) await stopSupervisor(paths);
      if (!await terminateDesktopProcess(existing, desktop)) {
        throw new ConfigError(`Codex PID ${existing.pid} 未在安全期限内退出；没有强制终止。`);
      }
      await terminateDetachedDesktopHelpers(desktop, 2000);
      const staleHelpers = await listDetachedDesktopHelpers(desktop);
      if (staleHelpers.length > 0) {
        throw new ConfigError(`旧 Codex 仍有 ${staleHelpers.length} 个 app-server/modifier helper；拒绝启动新实例。`);
      }
      await removeManagedLaunch(paths, existing.pid).catch(() => {});
      replacementBoundaryCrossed = true;
    }

    const launched = await launchApp(plan);
    const processInfo = await waitForLaunchedDesktop(desktop, launched, 8000);
    if (!processInfo) throw new Error("启动进程未保持运行");
    launchedInfo = processInfo;

    if (plan.injectionTransport === "cdp") {
      const cdp = await waitForCodexCdp(plan.debugPort, options.cdpTimeoutMs ?? 15_000);
      if (!cdp.reachable) {
        throw new Error(`CDP 127.0.0.1:${plan.debugPort} 未出现 Codex app:// target（${cdp.detail}）`);
      }
    }

    const relayVerified = await waitForRelayHandshake(
      plan,
      relay,
      options.relayTimeoutMs ?? 15_000,
    );

    // A relay App can expose CDP before its embedded CLI has accepted the
    // provider configuration. Inject only after the authenticated bridge
    // handshake, then let every installer process exit. No supervisor or
    // renderer watcher is part of steady state.
    let injection = null;
    if (plan.injectionTransport === "electron-preload") {
      injection = await waitForMacPreloadResult(
        plan.preloadResultFile,
        processInfo.pid,
        runtime,
        options.preloadTimeoutMs ?? MAC_PRELOAD_TRANSACTION_TIMEOUT_MS,
      );
    } else if (plan.injectionTransport === "cdp") {
      const injectionStartedAt = performance.now();
      const installed = await installOnce(paths, config, runtime, plan.debugPort);
      injection = { ...installed, durationMs: performance.now() - injectionStartedAt };
    }

    const record = await recordManagedLaunch(paths, plan, processInfo, relay, config, {
      isolatedProfile,
      relayVerified,
    });
    return {
      action: existing ? "replaced" : "launched",
      desktop,
      processInfo,
      record,
      runtime,
      injection,
      debugPort: plan.debugPort || null,
      plan,
      relayVerified,
    };
  } catch (error) {
    if (plan.relayHandshakeFile) await fs.rm(plan.relayHandshakeFile, { force: true }).catch(() => {});
    if (plan.preloadResultFile) await fs.rm(plan.preloadResultFile, { force: true }).catch(() => {});
    await stopSupervisor(paths).catch(() => {});
    await terminateLaunched(paths, desktop, launchedInfo, isolatedProfile);
    if (!isolatedProfile && replacementBoundaryCrossed) {
      try {
        const rollback = await rollbackOfficial(paths, config, desktop, options, env, platform);
        throw new ConfigError(`${error.message}；已恢复干净官方 Codex PID ${rollback.processInfo.pid}。`);
      } catch (rollbackError) {
        if (rollbackError instanceof ConfigError && rollbackError.message.includes("已恢复干净官方")) {
          throw rollbackError;
        }
        throw new ConfigError(`${error.message}；官方回退也失败：${rollbackError.message}`);
      }
    }
    throw error;
  }
}
