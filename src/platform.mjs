import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { ConfigError } from "./errors.mjs";
import { applyRelayEnvironment, sanitizedBaseEnvironment } from "./relay.mjs";
import { ensurePrivateDirectory, redactSecret } from "./util.mjs";
import { allocateLoopbackPort } from "./ports.mjs";
import { openPrivateLog } from "./logs.mjs";

const execFileAsync = promisify(execFile);
const LAUNCH_SERVICES_ENV_KEYS = Object.freeze([
  "CODEX_CLI_PATH",
  "CODEX_HOME",
  "CODEXCTL_HOME",
  "CODEXCTL_OFFICIAL_CLI",
  "CODEX_ELECTRON_USER_DATA_PATH",
  "CODEXCTL_PRELOAD_RESULT",
  "CODEXCTL_PRELOAD_SPEC",
  "CODEXCTL_LIVE_BOOTSTRAP",
  "NODE_OPTIONS",
]);
const PROXY_ENV_KEYS = Object.freeze([
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
  "http_proxy", "https_proxy", "all_proxy",
  "NO_PROXY", "no_proxy",
]);

function hasExplicitStartupRoute(argv) {
  return argv.some((value, index) => /^codex(?:-dev)?:\/\//.test(value)
    || (value.startsWith("--open-project=") && value.slice(15).trim().length > 0)
    || (value === "--open-project" && typeof argv[index + 1] === "string"
      && argv[index + 1].trim().length > 0));
}

export function launchServicesArguments(plan, options = []) {
  if (!Array.isArray(options) || options.some((value) => typeof value !== "string")) {
    throw new TypeError("LaunchServices options 必须是字符串数组");
  }
  const values = [...options];
  const environmentKeys = plan.proxyServer
    ? [...LAUNCH_SERVICES_ENV_KEYS, ...PROXY_ENV_KEYS]
    : LAUNCH_SERVICES_ENV_KEYS;
  for (const key of environmentKeys) {
    const value = plan.environment?.[key];
    if (typeof value !== "string" || value.length === 0) continue;
    if (value.includes("\0")) throw new ConfigError(`LaunchServices 环境包含 NUL：${key}`);
    values.push("--env", `${key}=${value}`);
  }
  values.push(plan.desktop.bundle);
  if (plan.argv.length > 0) values.push("--args", ...plan.argv);
  return values;
}

function normalizeProxyServer(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048
    || /[\u0000\r\n]/.test(value)) {
    throw new ConfigError("--proxy-server 必须是合法代理 URL。");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError("--proxy-server 必须是合法代理 URL。");
  }
  if (!["http:", "https:", "socks:", "socks5:"].includes(parsed.protocol)
    || parsed.username || parsed.password || parsed.pathname !== "/"
    || parsed.search || parsed.hash) {
    throw new ConfigError("--proxy-server 仅支持不含凭据和路径的 http、https、socks 或 socks5 URL。");
  }
  return parsed.href.replace(/\/$/, "");
}

function applyProxyEnvironment(environment, proxyServer) {
  if (!proxyServer) return;
  for (const key of PROXY_ENV_KEYS.slice(0, 6)) environment[key] = proxyServer;
  const noProxy = environment.NO_PROXY ?? environment.no_proxy ?? "localhost,127.0.0.1,::1";
  environment.NO_PROXY = noProxy;
  environment.no_proxy = noProxy;
}

async function isExecutable(filename) {
  if (!filename) return false;
  try {
    await fs.access(filename, fsSync.constants.X_OK);
    return (await fs.stat(filename)).isFile();
  } catch {
    return false;
  }
}

async function firstExecutable(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function findOnPath(name, env = process.env) {
  for (const directory of String(env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    if (await isExecutable(candidate)) return fs.realpath(candidate).catch(() => candidate);
  }
  return null;
}

async function firstOnPath(names, env) {
  for (const name of names) {
    const found = await findOnPath(name, env);
    if (found) return found;
  }
  return null;
}

async function discoverMacApp(config, env) {
  const home = env.HOME;
  const requested = config.app.path ?? env.CODEX_APP_PATH ?? null;
  const bundles = [
    requested,
    "/Applications/Codex.app",
    "/Applications/ChatGPT.app",
    home ? path.join(home, "Applications", "Codex.app") : null,
    home ? path.join(home, "Applications", "ChatGPT.app") : null,
  ].filter(Boolean);
  for (const bundle of bundles) {
    if (!bundle.endsWith(".app")) {
      if (await isExecutable(bundle)) {
        return { bundle: null, executable: bundle, officialCli: config.app.cliPath ?? null };
      }
      continue;
    }
    const executable = await firstExecutable([
      path.join(bundle, "Contents", "MacOS", "ChatGPT"),
      path.join(bundle, "Contents", "MacOS", "Codex"),
    ]);
    if (!executable) continue;
    const officialCli = config.app.cliPath ?? await firstExecutable([
      path.join(bundle, "Contents", "Resources", "codex"),
    ]);
    return { bundle, executable, officialCli };
  }
  throw new ConfigError("找不到 Codex/ChatGPT macOS App；可在 config.json 设置 app.path。" );
}

async function discoverLinuxApp(config, env) {
  const requested = config.app.path ?? env.CODEX_APP_PATH ?? null;
  const launcher = requested
    ? (await isExecutable(requested) ? requested : null)
    : await firstOnPath(["chatgpt", "codex-desktop", "ChatGPT", "Codex"], env);
  if (!launcher) {
    throw new ConfigError("找不到 Linux Codex/ChatGPT Desktop 可执行文件；请安装官方包或设置 app.path。" );
  }
  const resolvedLauncher = await fs.realpath(launcher).catch(() => launcher);
  // Official deb/rpm packages expose `chatgpt` as a launcher while the stable
  // Desktop process identity is /usr/lib/chatgpt/ChatGPT. Prefer that binary
  // for both spawning and PID/start-time verification. An explicit app.path
  // remains authoritative for custom packages and wrappers.
  const realExecutable = requested ? resolvedLauncher : await firstExecutable([
    path.join(path.dirname(resolvedLauncher), "ChatGPT"),
    path.join(path.dirname(resolvedLauncher), "Codex"),
    "/usr/lib/chatgpt/ChatGPT",
    "/usr/lib64/chatgpt/ChatGPT",
    "/opt/chatgpt/ChatGPT",
    "/usr/lib/codex/Codex",
    "/usr/lib64/codex/Codex",
    "/opt/codex/Codex",
    "/opt/Codex/Codex",
  ]) ?? resolvedLauncher;
  const executableDir = path.dirname(realExecutable);
  const resourcesFromEnv = env.CODEX_ELECTRON_RESOURCES_PATH;
  const officialCli = config.app.cliPath ?? await firstExecutable([
    resourcesFromEnv ? path.join(resourcesFromEnv, "codex") : null,
    path.join(executableDir, "resources", "codex"),
    path.resolve(executableDir, "..", "resources", "codex"),
    "/usr/lib/chatgpt/resources/codex",
    "/usr/lib/ChatGPT/resources/codex",
    "/opt/chatgpt/resources/codex",
    "/opt/ChatGPT/resources/codex",
    "/usr/lib/codex/resources/codex",
    "/usr/lib/Codex/resources/codex",
    "/opt/codex/resources/codex",
    "/opt/Codex/resources/codex",
  ]);
  return { bundle: null, executable: realExecutable, officialCli };
}

export async function discoverDesktop(config, env = process.env, platform = process.platform) {
  if (platform === "darwin") return { platform, ...(await discoverMacApp(config, env)) };
  if (platform === "linux") return { platform, ...(await discoverLinuxApp(config, env)) };
  throw new ConfigError(`当前只支持 macOS 和 Linux；检测到 ${platform}。`);
}

export async function planAppLaunch(config, paths, relay, options = {}, env = process.env, platform = process.platform) {
  let desktop = await discoverDesktop(config, env, platform);
  const officialCliSource = options.officialCliSource ?? "embedded";
  if (officialCliSource !== "embedded") {
    throw new ConfigError("Remote-safe 启动必须使用 App 内置 codex CLI。");
  }
  if (platform === "darwin") {
    const embeddedCli = desktop.bundle && await firstExecutable([
      path.join(desktop.bundle, "Contents", "Resources", "codex"),
    ]);
    if (!embeddedCli) throw new ConfigError("Remote-safe macOS 启动缺少 App 内置 codex CLI。");
    desktop = { ...desktop, officialCli: embeddedCli };
  }
  const proxyServer = options.proxyServer == null ? null : normalizeProxyServer(options.proxyServer);
  if (proxyServer && relay.enabled) {
    throw new ConfigError("OAuth --proxy-server 不能与 -c relay 同时使用；relay 请使用 -c proxy=...。");
  }
  const environment = applyRelayEnvironment(sanitizedBaseEnvironment(env), relay);
  applyProxyEnvironment(environment, proxyServer);
  environment.CODEXCTL_HOME = paths.home;
  environment.CODEXCTL_NODE = process.execPath;
  if (desktop.officialCli) environment.CODEXCTL_OFFICIAL_CLI = desktop.officialCli;
  if (relay.enabled) {
    environment.CODEX_CLI_PATH = paths.bridgeExecutable;
    environment.CODEXCTL_RELAY_HANDSHAKE = path.join(
      paths.runtimeDir,
      `relay-handshake-${randomUUID()}.json`,
    );
  } else if (desktop.officialCli) {
    // Explicitly pin the official embedded CLI on macOS. This defeats stale
    // LaunchServices/launchd CODEX_CLI_PATH values left by an older bridge.
    environment.CODEX_CLI_PATH = desktop.officialCli;
  }
  const injectionEnabled = options.inject === true
    && (config.modules.prompt || config.modules.context || config.modules.wallpaper);
  const argv = [...config.app.extraArgs, ...(options.extraArgs ?? [])];
  const launchServicesArgv = proxyServer ? [`--proxy-server=${proxyServer}`] : [];
  argv.push(...launchServicesArgv);
  if (argv.some((argument) => /^--(?:user-data-dir|profile-directory)(?:=|$)/.test(argument))) {
    throw new ConfigError("user-data-dir/profile-directory 只能由 --isolated 安全分配。");
  }
  if (platform === "linux" && !argv.some((argument) => argument.startsWith("--ozone-platform"))) {
    if (config.app.linuxDisplay === "wayland") argv.push("--ozone-platform=wayland");
    else if (config.app.linuxDisplay === "xwayland") argv.push("--ozone-platform=x11");
  }
  if (relay.enabled && relay.values.proxy
    && !argv.some((argument) => argument.startsWith("--proxy-server"))) {
    argv.push(`--proxy-server=${relay.values.proxy}`);
  }
  if (options.isolatedProfile) {
    const isolatedProfile = path.resolve(options.isolatedProfile);
    // Current ChatGPT/Codex builds decide whether to bypass their global
    // single-instance lock from this early environment value. Chromium's
    // --user-data-dir alone is applied too late and the test App exits after
    // roughly one second even though DevTools briefly became reachable.
    environment.CODEX_ELECTRON_USER_DATA_PATH = isolatedProfile;
    argv.push(`--user-data-dir=${isolatedProfile}`);
  }
  if (options.hidden) argv.push("--start-minimized");
  const launchServicesCompatible = argv.length === launchServicesArgv.length
    && argv.every((value, index) => value === launchServicesArgv[index]);
  const macPreload = platform === "darwin" && desktop.bundle && injectionEnabled
    && !relay.enabled && !options.isolatedProfile && !options.hidden && launchServicesCompatible;
  let debugPort = 0;
  let preloadSpecFile = null;
  let preloadResultFile = null;
  if (macPreload) {
    preloadSpecFile = options.preloadSpecFile ?? (options.dryRun
      ? path.join(paths.runtimeGenerationsDir, "<generation>", "macos-preload.json")
      : null);
    if (!preloadSpecFile) throw new ConfigError("macOS 一次性注入缺少已提交的 preload runtime。" );
    preloadResultFile = options.preloadResultFile ?? path.join(
      path.dirname(preloadSpecFile),
      `preload-result-${randomUUID()}.json`,
    );
    environment.NODE_OPTIONS = `--require=${JSON.stringify(paths.macPreloadHook)}`;
    environment.CODEXCTL_PRELOAD_SPEC = preloadSpecFile;
    environment.CODEXCTL_PRELOAD_RESULT = preloadResultFile;
  } else if (injectionEnabled) {
    debugPort = await allocateLoopbackPort(options.debugPort ?? config.app.debugPort);
    argv.push(
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${debugPort}`,
    );
  }
  const launchMethod = platform === "darwin" && desktop.bundle
    && (!injectionEnabled || macPreload) && !relay.enabled && !options.isolatedProfile
    && !options.hidden && launchServicesCompatible
    ? "launch-services"
    : "direct";
  // The macOS binary opens its primary window without a protocol argument.
  // Adding codex://launch creates a materially different Remote lifecycle and
  // has produced repeatable websocket resets. Linux package launchers need a
  // route, but their queue applies the last route, so never overwrite an
  // explicit --open-project or Codex deep link supplied by the caller.
  if (launchMethod === "direct" && platform !== "darwin" && !hasExplicitStartupRoute(argv)) {
    argv.push("codex://launch");
  }
  return {
    desktop,
    executable: desktop.executable,
    argv,
    environment,
    proxyServer,
    launchMethod,
    injectionEnabled,
    injectionTransport: injectionEnabled ? (macPreload ? "electron-preload" : "cdp") : null,
    debugPort,
    preloadSpecFile,
    preloadResultFile,
    relayHandshakeFile: relay.enabled ? environment.CODEXCTL_RELAY_HANDSHAKE : null,
    logFile: paths.appLogFile,
  };
}

export function describeLaunchPlan(plan) {
  const picked = {};
  if (plan.launchMethod === "direct" || plan.injectionTransport === "electron-preload") {
    for (const key of [
      "CODEX_CLI_PATH", "CODEXCTL_OFFICIAL_CLI", "CODEX_APP_BASE_URL",
      "CODEX_APP_API_KEY", "CODEX_APP_WEBSOCKETS", "CODEX_ELECTRON_USER_DATA_PATH",
      "HTTP_PROXY", "NO_PROXY",
    ]) {
      if (plan.environment[key] === undefined) continue;
      picked[key] = key === "CODEX_APP_API_KEY"
        ? redactSecret(plan.environment[key])
        : plan.environment[key];
    }
  }
  return {
    platform: plan.desktop.platform,
    app: plan.desktop.bundle ?? plan.desktop.executable,
    executable: plan.executable,
    officialCli: plan.desktop.officialCli,
    launchMethod: plan.launchMethod,
    argv: plan.argv,
    environmentScope: plan.launchMethod === "direct"
      ? "child-process-only"
      : plan.injectionTransport === "electron-preload" ? "launch-request-only" : "official-cli-only",
    environment: picked,
    injectionEnabled: plan.injectionEnabled,
    injectionTransport: plan.injectionTransport,
    debugPort: plan.debugPort,
    liveHost: plan.liveHost === true,
  };
}

export async function launchApp(plan) {
  if (plan.launchMethod === "launch-services") {
    await execFileAsync("/usr/bin/open", launchServicesArguments(plan), {
      timeout: 5000,
      maxBuffer: 64 * 1024,
      env: plan.environment,
    });
    return { pid: null, executable: plan.executable, launchMethod: plan.launchMethod };
  }
  await ensurePrivateDirectory(path.dirname(plan.logFile));
  const log = await openPrivateLog(plan.logFile);
  let child;
  try {
    child = spawn(plan.executable, plan.argv, {
      detached: true,
      env: plan.environment,
      stdio: ["ignore", log.fd, log.fd],
    });
    child.once("error", () => {});
    child.unref();
  } finally {
    await log.close();
  }
  return { pid: child.pid, executable: plan.executable, launchMethod: plan.launchMethod };
}
