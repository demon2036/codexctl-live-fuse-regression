import fs from "node:fs/promises";
import fsSync from "node:fs";
import { discoverDesktop } from "./platform.mjs";
import { listDetachedDesktopHelpers } from "./desktop-processes.mjs";
import { loadConfig } from "./config.mjs";
import { materializeRuntime } from "./runtime.mjs";
import { autoInjectStatus } from "./auto-inject.mjs";
import { readManagedLaunches, selectPrimaryManagedLaunch } from "./launches.mjs";
import { listOwnedWorkers } from "./owned-processes.mjs";

async function probeCdp(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return { reachable: false, detail: `HTTP ${response.status}` };
    const targets = await response.json();
    const appTargets = Array.isArray(targets)
      ? targets.filter((target) => target?.type === "page" && target?.url?.startsWith("app://"))
      : [];
    return { reachable: true, targets: appTargets.length };
  } catch (error) {
    return { reachable: false, detail: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runDoctor(paths, env = process.env, platform = process.platform) {
  const checks = [];
  const major = Number(process.versions.node.split(".")[0]);
  const websocketMode = typeof WebSocket === "function"
    ? "WebSocket built-in"
    : "缺少内置 WebSocket；请使用 Node.js 22/24 LTS 并检查禁用 WebSocket 的启动参数";
  checks.push({
    id: "node",
    level: major >= 22 && typeof WebSocket === "function" ? "ok" : "fail",
    message: `Node.js ${process.versions.node}（${websocketMode}）`,
  });
  checks.push({
    id: "platform",
    level: ["darwin", "linux"].includes(platform) ? "ok" : "fail",
    message: `${platform}/${process.arch}`,
  });

  let config;
  try {
    config = await loadConfig(paths);
    checks.push({ id: "config", level: "ok", message: paths.configFile });
  } catch (error) {
    checks.push({ id: "config", level: "fail", message: error.message });
    return { ok: false, checks };
  }

  let desktop = null;
  try {
    desktop = await discoverDesktop(config, env, platform);
    checks.push({ id: "desktop", level: "ok", message: desktop.bundle ?? desktop.executable });
    checks.push({
      id: "embedded-cli",
      level: desktop.officialCli ? "ok" : "warn",
      message: desktop.officialCli ?? "未静态定位；官方模式仍可由 App 使用内嵌默认，relay 需要运行时发现",
    });
  } catch (error) {
    checks.push({ id: "desktop", level: "fail", message: error.message });
  }

  if (desktop?.bundle) {
    try {
      const detachedHelpers = await listDetachedDesktopHelpers(desktop);
      checks.push({
        id: "desktop-helpers",
        level: detachedHelpers.length ? "warn" : "ok",
        message: detachedHelpers.length
          ? `发现 ${detachedHelpers.length} 个无主 Codex/ChatGPT helper；运行 codexctl clean 可回收`
          : "没有无主 Codex/ChatGPT helper",
      });
    } catch (error) {
      checks.push({ id: "desktop-helpers", level: "warn", message: `检查失败：${error.message}` });
    }
  }

  try {
    const runtime = await materializeRuntime(config, paths);
    checks.push({
      id: "runtime",
      level: "ok",
      message: `Prompt profiles ${runtime.promptContext.profiles}；Wallpaper ${runtime.wallpaper.enabled ? "ready" : "off"}`,
    });
  } catch (error) {
    checks.push({ id: "runtime", level: "fail", message: error.message });
  }

  checks.push({
    id: "safe-defaults",
    level: "ok",
    message: config.modules.prompt || config.modules.context || config.modules.wallpaper
      ? `显式开关：Prompt=${config.modules.prompt}, Context=${config.modules.context}, Wallpaper=${config.modules.wallpaper}`
      : "三项私有 Desktop 注入均为 off；官方启动不会携带 CDP",
  });

  checks.push({
    id: "wallpaper-engine",
    level: paths.wallpaperInjector.includes("wallpaper-lite") ? "ok" : "fail",
    message: paths.wallpaperInjector.includes("wallpaper-lite")
      ? "一次性静态 CSS + 零 observer/timer + 分片 Blob 传输（macOS/Linux 共用）"
      : `仍指向旧壁纸引擎：${paths.wallpaperInjector}`,
  });

  try {
    await fs.access(paths.bridgeExecutable, fsSync.constants.X_OK);
    checks.push({ id: "bridge-wrapper", level: "ok", message: paths.bridgeExecutable });
  } catch {
    checks.push({ id: "bridge-wrapper", level: "fail", message: "bridge wrapper 不可执行" });
  }

  const ownedWorkers = await listOwnedWorkers(paths);
  checks.push({
    id: "background-injection",
    level: ownedWorkers.length ? "warn" : "ok",
    message: ownedWorkers.length
      ? `发现旧常驻进程：${ownedWorkers.map((worker) => `${worker.kind}:${worker.pid}`).join(", ")}；运行 codexctl clean`
      : "无 watcher、supervisor 或注入 worker",
  });

  const automatic = await autoInjectStatus(paths, platform);
  checks.push({
    id: "legacy-autostart",
    level: automatic.conflict || automatic.installed || automatic.running ? "warn" : "ok",
    message: automatic.conflict
      ? `全局自动启动项属于另一个 CODEXCTL_HOME，当前控制器不会覆盖：${automatic.file}`
      : automatic.running
      ? `发现旧自动注入进程 PID ${automatic.state.pid}；运行 codexctl clean`
      : automatic.installed ? "发现当前控制器的旧自动启动项；运行 codexctl clean"
        : "没有自动启动项；使用 codexctl app 做一次性注入",
  });

  let managedPort = 0;
  let managedPrimary = null;
  if (desktop) {
    const records = await readManagedLaunches(paths, desktop, { prune: true }).catch(() => []);
    managedPrimary = selectPrimaryManagedLaunch(records);
    managedPort = managedPrimary?.injection?.enabled
      ? managedPrimary.injection.port ?? 0 : 0;
  }
  if (!managedPort && config.app.debugPort) managedPort = config.app.debugPort;
  if (managedPort) {
    const cdp = await probeCdp(managedPort);
    checks.push({
      id: "cdp",
      level: cdp.reachable ? "ok" : "warn",
      message: cdp.reachable
        ? `127.0.0.1:${managedPort}，Codex renderer ${cdp.targets}`
        : `managed 端口 127.0.0.1:${managedPort} 未监听`,
    });
  } else if (managedPrimary?.injection?.enabled) {
    checks.push({
      id: "cdp",
      level: "ok",
      message: `主实例 PID ${managedPrimary.pid} 已通过 ${managedPrimary.injection.transport} 一次性注入；无需 CDP`,
    });
  } else {
    checks.push({
      id: "cdp",
      level: "ok",
      message: "当前没有 managed 注入会话；动态端口不会探测或占用 0 端口",
    });
  }

  const inherited = [
    "CODEX_CLI_PATH", "CODEX_APP_BASE_URL", "CODEX_APP_API_KEY",
  ].filter((name) => env[name]);
  checks.push({
    id: "connection-environment",
    level: inherited.length ? "warn" : "ok",
    message: inherited.length
      ? `当前 shell 含旧连接变量 ${inherited.join(", ")}；官方模式会清除 provider 并显式锁定 App 内置 CLI`
      : "当前 shell 无旧 bridge/provider 变量；官方模式仍锁定 App 内置 CLI",
  });

  if (platform === "linux") {
    const pathEntries = String(env.PATH ?? "").split(":");
    const picker = ["zenity", "kdialog"].find((name) => pathEntries.some((directory) => {
      try { return fsSync.statSync(`${directory}/${name}`).isFile(); } catch { return false; }
    }));
    checks.push({
      id: "file-picker",
      level: picker ? "ok" : "warn",
      message: picker ?? "没有 zenity/kdialog；仍可用 codexctl prompt add 添加文件",
    });
    const sessionType = String(env.XDG_SESSION_TYPE ?? "").toLowerCase();
    const displayReady = sessionType === "wayland"
      ? Boolean(env.WAYLAND_DISPLAY) : Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
    checks.push({
      id: "linux-display",
      level: displayReady ? "ok" : "warn",
      message: `${sessionType || "unknown"}；DISPLAY=${env.DISPLAY ? "set" : "unset"}；WAYLAND_DISPLAY=${env.WAYLAND_DISPLAY ? "set" : "unset"}`,
    });
    const glibc = process.report?.getReport?.().header?.glibcVersionRuntime ?? null;
    checks.push({
      id: "linux-runtime",
      level: glibc ? "ok" : "warn",
      message: glibc ? `glibc ${glibc}` : "无法从 Node report 读取 glibc（musl/非标准运行时需实机验证）",
    });
  }

  return { ok: !checks.some((check) => check.level === "fail"), checks };
}

export function formatDoctor(report) {
  const icon = { ok: "✓", warn: "!", fail: "✗" };
  return report.checks.map((check) => `${icon[check.level]} ${check.id}: ${check.message}`).join("\n");
}
