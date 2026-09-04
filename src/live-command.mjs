import fs from "node:fs/promises";
import path from "node:path";
import { UsageError } from "./errors.mjs";
import { loadConfig } from "./config.mjs";
import { callLiveSession } from "./live-client.mjs";
import { ensureLivePrivateDirectory } from "./live-private-files.mjs";
import { inspectLiveSession } from "./live-session.mjs";
import { startLiveApp } from "./live-launch.mjs";
import { loadProjectPolicy } from "./project-policy.mjs";
import { assertNoArgs, extractFlag, extractOption, printJson } from "./cli-utils.mjs";

const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f-]{27})\.json$/i;

async function sessions(paths) {
  await ensureLivePrivateDirectory(paths.liveSessionsDir);
  const rows = [];
  for (const entry of await fs.readdir(paths.liveSessionsDir, { withFileTypes: true })) {
    const match = entry.isFile() && entry.name.match(SESSION_FILE);
    if (!match) continue;
    try { rows.push(await inspectLiveSession(paths, match[1])); }
    catch (error) { rows.push({ error: error.message, live: false, sessionId: match[1] }); }
  }
  return rows;
}

async function activeSession(paths) {
  const active = (await sessions(paths)).filter((row) => row.live);
  if (active.length > 1) throw new UsageError("发现多个 live 会话；拒绝猜测目标 App。");
  if (!active.length) throw new UsageError("当前 App 未由 live start 加载宿主；保持该 PID 不动。");
  return active[0];
}

async function callActive(paths, operation, params = {}) {
  const inspected = await activeSession(paths);
  const startedAt = performance.now();
  const result = await callLiveSession({
    authToken: inspected.session.authToken,
    operation,
    params,
    sessionId: inspected.session.sessionId,
    socketPath: inspected.session.socketPath,
    timeoutMs: 30_000,
  });
  return {
    appPid: inspected.session.app.pid,
    durationMs: performance.now() - startedAt,
    result,
    sessionId: inspected.session.sessionId,
  };
}

export async function readLiveStatus(paths) {
  try {
    const inspected = await activeSession(paths);
    const status = await callLiveSession({
      authToken: inspected.session.authToken,
      operation: "status",
      sessionId: inspected.session.sessionId,
      socketPath: inspected.session.socketPath,
    });
    return { managed: true, ...status };
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    return { managed: false, reason: error.message, status: "unmanaged" };
  }
}

function printMutation(value) {
  const transaction = value.result?.transaction;
  console.log(`PID ${value.appPid} · ${transaction?.kind ?? "no-change"} · ${transaction?.status ?? "unchanged"} · ${value.durationMs.toFixed(1)} ms`);
}

async function commandStart(paths, args) {
  const isolatedProfile = extractOption(args, "--isolated");
  const hidden = extractFlag(args, "--hidden");
  const proxyServers = extractOption(args, "--proxy-server", { multiple: true, inline: true });
  if (proxyServers.length > 1) throw new UsageError("重复的选项：--proxy-server");
  assertNoArgs(args, "用法：codexctl live start [--isolated PATH] [--proxy-server=URL]");
  const [config, policy] = await Promise.all([loadConfig(paths), loadProjectPolicy(paths)]);
  const result = await startLiveApp({
    paths,
    config,
    options: {
      hidden,
      isolatedProfile,
      officialCliSource: policy.launch.officialCli,
      proxyServer: proxyServers[0] ?? null,
    },
  });
  const action = result.action === "reconnected" ? "已重连" : result.action === "reused"
    ? "已在运行" : "已启动";
  console.log(`${action} live Codex Desktop：App PID ${result.processInfo.pid}，伴随程序 PID ${result.companionPid}。`);
  console.log(`session ${result.sessionId} · host ${result.hostRevision} · loopback CDP · 官方 bundle 未修改。`);
}

async function commandStatus(paths, args) {
  const json = extractFlag(args, "--json");
  assertNoArgs(args, "用法：codexctl live status [--json]");
  const value = await readLiveStatus(paths);
  if (json) return printJson(value);
  if (!value.managed) return console.log(`live: unmanaged — ${value.reason}`);
  console.log(`live: ${value.status} · App PID ${value.app.pid} · companion PID ${value.companion.pid}`);
  console.log(`master=${value.manager.masterEnabled ? "on" : "off"} · session=${value.sessionId} · host=${value.hostRevision}`);
  for (const [id, plugin] of Object.entries(value.manager.plugins)) {
    const debug = plugin.debug ? ` · debug=${plugin.debug.revision}${plugin.debug.watch ? " (watch)" : ""}` : "";
    console.log(`${id}: ${plugin.enabled ? "on" : "off"} · stable=${plugin.stable?.revision ?? "none"} · effective=${plugin.actual?.artifact?.revision ?? "off"}${debug} · phase=${plugin.phase}`);
  }
}

async function commandReload(paths, args) {
  const all = extractFlag(args, "--all");
  const pluginId = args.shift();
  if (all && pluginId) throw new UsageError("--all 不能和 plugin-id 同时使用。");
  assertNoArgs(args, "用法：codexctl live reload <plugin-id>|--all");
  if (!all && !pluginId) throw new UsageError("用法：codexctl live reload <plugin-id>|--all");
  printMutation(await callActive(paths, "plugin.reload", { pluginId: all ? "all" : pluginId }));
}

async function commandDev(paths, args) {
  if (args[0] === "stop") {
    args.shift();
    const pluginId = args.shift();
    assertNoArgs(args, "用法：codexctl live dev stop <plugin-id>");
    if (!pluginId) throw new UsageError("用法：codexctl live dev stop <plugin-id>");
    return printMutation(await callActive(paths, "debug.stop", { pluginId }));
  }
  const source = extractOption(args, "--source", { inline: true });
  const watch = extractFlag(args, "--watch");
  const pluginId = args.shift();
  assertNoArgs(args, "用法：codexctl live dev <plugin-id> --source PATH [--watch]");
  if (!pluginId || !source) {
    throw new UsageError("用法：codexctl live dev <plugin-id> --source PATH [--watch]");
  }
  printMutation(await callActive(paths, "debug.start", {
    pluginId,
    source: path.resolve(source),
    watch,
  }));
}

async function commandPlugin(paths, args) {
  const action = args.shift();
  if (action === "list") {
    assertNoArgs(args, "用法：codexctl live plugin list");
    return commandStatus(paths, []);
  }
  if (!["on", "off"].includes(action)) {
    throw new UsageError("用法：codexctl live plugin list|on|off [plugin-id]");
  }
  const pluginId = args.shift();
  assertNoArgs(args, `用法：codexctl live plugin ${action} <plugin-id>`);
  const value = await callActive(paths, "plugin.set", { enabled: action === "on", pluginId });
  printMutation(value);
}

export async function commandLive(paths, args) {
  const subcommand = args.shift();
  if (subcommand === "start") return commandStart(paths, args);
  if (subcommand === "status") return commandStatus(paths, args);
  if (subcommand === "on" || subcommand === "off") {
    assertNoArgs(args, `用法：codexctl live ${subcommand}`);
    return printMutation(await callActive(paths, "master.set", { enabled: subcommand === "on" }));
  }
  if (subcommand === "plugin") return commandPlugin(paths, args);
  if (subcommand === "reload") return commandReload(paths, args);
  if (subcommand === "dev") return commandDev(paths, args);
  throw new UsageError("用法：codexctl live start|status|on|off|plugin|reload|dev ...");
}
