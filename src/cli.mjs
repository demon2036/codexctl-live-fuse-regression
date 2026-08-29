import { loadConfig } from "./config.mjs";
import { runDoctor, formatDoctor } from "./doctor.mjs";
import { UsageError } from "./errors.mjs";
import { planAppLaunch, describeLaunchPlan, discoverDesktop } from "./platform.mjs";
import { launchManagedApp } from "./app-transaction.mjs";
import { cleanController } from "./clean.mjs";
import { readManagedLaunches, selectPrimaryManagedLaunch } from "./launches.mjs";
import { parseRelayOverrides, describeRelay } from "./relay.mjs";
import { resolvePaths } from "./paths.mjs";
import { loadProjectPolicy } from "./project-policy.mjs";
import { materializeRuntime } from "./runtime.mjs";
import { normalizeProviderId, OFFICIAL_PROVIDER_ID } from "./provider.mjs";
import { commandPrompt, commandContext } from "./commands/prompt-context.mjs";
import { commandWallpaper } from "./commands/wallpaper.mjs";
import { assertNoArgs, extractFlag, extractOption, printJson } from "./cli-utils.mjs";

const HELP = `codexctl — Codex Desktop 一次性启动控制器（macOS / Linux）

  codexctl app
      默认使用与点击图标相同的官方 Remote-safe 启动；无 CDP、无注入、无额外参数。

  codexctl app --inject
      显式一次性加载已开启的 Prompt / Context / Wallpaper。
      macOS 与点击图标同为 LaunchServices，兼容 Remote；没有 DevTools 或常驻监控。

  codexctl app --inject --proxy-server=http://127.0.0.1:10808
      OAuth 官方连接保持不变；本次 App 的 HTTPS 与 WebSocket 一起走指定代理。

  codexctl app --inject --provider polo
      让本次 App 生命周期中新 session 默认使用已在 config.toml 配置的 polo。
      不传时显示 OpenAI，且保留 App 自己的官方默认请求路径。

  codexctl app -c 'url=https://example.com/v1;key_env=MY_KEY;proxy=http://127.0.0.1:10808'
      仅对本次完整启动启用 relay；不写入持久环境、配置或 Git。不带 -c 永远使用官方连接。

  codexctl prompt add|remove|use|on|off|list|status ...
  codexctl context set|use|on|off|list|status ...
  codexctl wallpaper list|use|set|create|import|export|remove ...
  codexctl wallpaper appearance|tune|reset-tuning|on|off|status ...

  codexctl status [--json]
  codexctl doctor [--json]
  codexctl clean [--json]
  codexctl config path|show
  codexctl init

配置修改不会热注入当前 renderer；请运行 codexctl app 做一次干净重启。
`;

async function commandInit(paths, args) {
  assertNoArgs(args, "用法：codexctl init");
  await loadProjectPolicy(paths);
  const config = await loadConfig(paths);
  await materializeRuntime(config, paths);
  console.log(`已初始化：${paths.configFile}`);
}

async function commandConfig(paths, args) {
  const subcommand = args.shift();
  if (subcommand === "path") {
    assertNoArgs(args, "用法：codexctl config path");
    console.log(paths.configFile);
    return;
  }
  if (subcommand === "show") {
    assertNoArgs(args, "用法：codexctl config show");
    printJson(await loadConfig(paths));
    return;
  }
  throw new UsageError("用法：codexctl config path|show");
}

async function commandApp(paths, args) {
  const relayPairs = extractOption(args, "-c", { multiple: true });
  const dryRun = extractFlag(args, "--dry-run");
  const explicitInject = extractFlag(args, "--inject");
  const noInject = extractFlag(args, "--no-inject");
  const hidden = extractFlag(args, "--hidden");
  const isolatedProfile = extractOption(args, "--isolated");
  const proxyServers = extractOption(args, "--proxy-server", { multiple: true, inline: true });
  if (proxyServers.length > 1) throw new UsageError("重复的选项：--proxy-server");
  const proxyServer = proxyServers[0] ?? null;
  const providerOption = extractOption(args, "--provider");
  const providerId = providerOption == null ? null : normalizeProviderId(providerOption);
  if (providerOption != null && !providerId) {
    throw new UsageError("--provider 必须是合法 Provider ID（字母、数字、点、下划线或连字符，最长 120 字符）。");
  }
  if (explicitInject && noInject) throw new UsageError("--inject 与 --no-inject 不能同时使用。");
  if (proxyServer && !explicitInject) throw new UsageError("--proxy-server 需要与 --inject 一起使用。");
  if (providerId && !explicitInject) throw new UsageError("--provider 需要与 --inject 一起使用。");
  assertNoArgs(args, "用法：codexctl app [--inject] [--proxy-server=URL] [--provider ID] [-c 'url=...;key_env=...'] [--dry-run]");
  const policy = await loadProjectPolicy(paths);
  const inject = explicitInject && !noInject;
  const relay = parseRelayOverrides(relayPairs, process.env, policy.relay);
  const config = await loadConfig(paths);
  if (proxyServer && relay.enabled) {
    throw new UsageError("--proxy-server 用于 OAuth 官方连接；-c relay 的代理请继续使用 proxy=...。");
  }
  if (providerId && relay.enabled) {
    throw new UsageError("--provider 与 -c relay 是两种不同路由方式，不能在同一次启动中同时使用。");
  }
  if (providerId && !config.modules.prompt && !config.modules.context) {
    throw new UsageError("--provider 需要先开启 Prompt 或 Context 模块，以加载 App 内 Provider 控件。");
  }
  if (dryRun) {
    const plan = await planAppLaunch(config, paths, relay, {
      inject,
      hidden,
      isolatedProfile,
      proxyServer,
      officialCliSource: policy.launch.officialCli,
      dryRun: true,
    });
    printJson({
      connection: describeRelay(relay),
      provider: {
        defaultId: providerId ?? OFFICIAL_PROVIDER_ID,
        explicit: Boolean(providerId),
      },
      launch: describeLaunchPlan(plan),
    });
    return;
  }
  const result = await launchManagedApp({
    paths,
    config,
    relay,
    options: {
      inject,
      hidden,
      isolatedProfile,
      proxyServer,
      providerId,
      officialCliSource: policy.launch.officialCli,
    },
  });
  const connection = relay.enabled ? "临时 relay" : "官方";
  if (result.action === "reused") {
    console.log(`当前 ${connection} Codex 已是干净目标状态（PID ${result.processInfo.pid}）。`);
  } else {
    console.log(`已${result.action === "replaced" ? "完整重启" : "启动"} ${connection} Codex Desktop（PID ${result.processInfo.pid}）。`);
  }
  if (result.injection) {
    console.log(`一次性注入完成，注入器已退出：Prompt=${config.modules.prompt ? "on" : "off"}，Context=${config.modules.context ? "on" : "off"}，Wallpaper=${config.modules.wallpaper ? "on" : "off"}，Provider=${providerId ?? "OpenAI"}。`);
  } else if (config.modules.prompt || config.modules.context || config.modules.wallpaper) {
    console.log("Remote-safe 官方模式：已配置模块未注入；需要时显式运行 codexctl app --inject。");
  }
}

async function activeManagedInjection(paths, config) {
  const desktop = await discoverDesktop(config);
  const records = await readManagedLaunches(paths, desktop, { prune: true });
  const primary = selectPrimaryManagedLaunch(records);
  return {
    active: primary?.injection?.enabled === true,
    pid: primary?.pid ?? null,
    transport: primary?.injection?.transport ?? null,
    port: primary?.injection?.port ?? 0,
    modules: primary?.injection?.enabled ? primary.injection.modules ?? null : null,
  };
}

async function currentStatus(paths) {
  const policy = await loadProjectPolicy(paths);
  const config = await loadConfig(paths);
  const activeInjection = await activeManagedInjection(paths, config);
  return {
    config: paths.configFile,
    platform: process.platform,
    port: activeInjection.port,
    activeInjection,
    connectionDefault: "official",
    launchPolicy: policy.launch,
    injectionMode: "explicit-one-shot",
    backgroundProcesses: false,
    modules: config.modules,
    prompt: { defaultProfileId: config.prompt.defaultProfileId, profiles: config.prompt.profiles.length },
    context: { defaultPresetId: config.context.defaultPresetId, presets: config.context.presets.length },
    wallpaper: { themeId: config.wallpaper.themeId, image: config.wallpaper.image,
      enabled: config.modules.wallpaper },
  };
}

async function commandStatus(paths, args) {
  const json = extractFlag(args, "--json");
  assertNoArgs(args, "用法：codexctl status [--json]");
  const status = await currentStatus(paths);
  if (json) return printJson(status);
  console.log("默认连接：official（relay 仅由 app -c 临时启用）");
  console.log(`Prompt=${status.modules.prompt ? "on" : "off"} (${status.prompt.defaultProfileId})  Context=${status.modules.context ? "on" : "off"} (${status.context.defaultPresetId})  Wallpaper=${status.modules.wallpaper ? "on" : "off"}`);
  console.log(`启动：Remote-safe official；注入：${status.activeInjection.active
    ? `active (${status.activeInjection.transport}, PID ${status.activeInjection.pid})`
    : "未加载（explicit one-shot）"}；后台 watcher/supervisor：无；CDP：${status.port
    ? `127.0.0.1:${status.port}` : "未分配（macOS preload 不需要）"}`);
  console.log(`项目策略：${paths.projectPolicyFile}`);
  console.log(`配置：${status.config}`);
}

async function commandDoctor(paths, args) {
  const json = extractFlag(args, "--json");
  assertNoArgs(args, "用法：codexctl doctor [--json]");
  const report = await runDoctor(paths);
  if (json) printJson(report);
  else console.log(formatDoctor(report));
  if (!report.ok) process.exitCode = 1;
}

async function commandClean(paths, args) {
  const json = extractFlag(args, "--json");
  assertNoArgs(args, "用法：codexctl clean [--json]");
  const result = await cleanController(paths);
  if (json) return printJson(result);
  console.log("已关闭三个模块、移除旧自动启动项/残留进程，并通过完整 App 重启恢复官方状态。");
  if (result.app.pid) console.log(`干净官方 Codex：PID ${result.app.pid}`);
  if (result.unknownDebugProcesses.length) {
    console.log(`发现 ${result.unknownDebugProcesses.length} 个非本控制器调试实例，保持不动。`);
  }
}

export async function main(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!command || ["help", "--help", "-h"].includes(command)) {
    process.stdout.write(HELP);
    return;
  }
  const paths = resolvePaths();
  if (command === "init") return commandInit(paths, args);
  if (command === "config") return commandConfig(paths, args);
  if (command === "app") return commandApp(paths, args);
  if (command === "prompt") return commandPrompt(paths, args);
  if (command === "context") return commandContext(paths, args);
  if (command === "wallpaper") return commandWallpaper(paths, args);
  if (command === "status") return commandStatus(paths, args);
  if (command === "doctor") return commandDoctor(paths, args);
  if (command === "clean") return commandClean(paths, args);
  if (command === "auto" || command === "inject") {
    throw new UsageError(`${command} 常驻模式已移除；请运行 codexctl app 做一次性注入。`);
  }
  throw new UsageError(`未知命令：${command}`);
}
