import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, "..");

function userHome(env) {
  if (env.HOME && path.isAbsolute(env.HOME)) return env.HOME;
  return os.homedir();
}

export function resolvePaths(env = process.env) {
  const userHomeDirectory = userHome(env);
  const configBase = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME
    : path.join(userHomeDirectory, ".config");
  const controllerHome = env.CODEXCTL_HOME
    ? path.resolve(env.CODEXCTL_HOME)
    : path.join(configBase, "codexctl");
  const runtimeDir = path.join(controllerHome, "runtime");
  const runtimeGenerationsDir = path.join(runtimeDir, "generations");
  return {
    projectRoot: PROJECT_ROOT,
    projectPolicyFile: path.join(PROJECT_ROOT, "codexctl.yaml"),
    userHome: userHomeDirectory,
    home: controllerHome,
    configFile: path.join(controllerHome, "config.json"),
    configLockFile: path.join(controllerHome, "config.lock"),
    runtimeDir,
    runtimeGenerationsDir,
    runtimeCurrentFile: path.join(runtimeDir, "current.json"),
    runtimeLockFile: path.join(runtimeDir, "runtime.lock"),
    promptProfilesFile: path.join(runtimeDir, "prompt-context.json"),
    themeDir: path.join(runtimeDir, "theme"),
    logsDir: path.join(controllerHome, "logs"),
    supervisorPidFile: path.join(runtimeDir, "supervisor.json"),
    supervisorLogFile: path.join(controllerHome, "logs", "supervisor.log"),
    appLogFile: path.join(controllerHome, "logs", "app.log"),
    promptLogFile: path.join(controllerHome, "logs", "prompt-context.log"),
    wallpaperLogFile: path.join(controllerHome, "logs", "wallpaper.log"),
    promptHealthFile: path.join(runtimeDir, "prompt-context-health.json"),
    wallpaperHealthFile: path.join(runtimeDir, "wallpaper-health.json"),
    autoInjectLogFile: path.join(controllerHome, "logs", "auto-inject.log"),
    autoInjectStateFile: path.join(runtimeDir, "auto-inject.json"),
    autoInjectLockFile: path.join(runtimeDir, "auto-inject.lock"),
    launchesDir: path.join(runtimeDir, "launches"),
    userThemesDir: path.join(controllerHome, "themes"),
    themesLockFile: path.join(controllerHome, "themes.lock"),
    promptInjector: path.join(PROJECT_ROOT, "vendor", "prompt-context", "injector.mjs"),
    promptCleanup: path.join(PROJECT_ROOT, "vendor", "prompt-context", "cleanup-live.mjs"),
    wallpaperInjector: path.join(PROJECT_ROOT, "vendor", "wallpaper-lite", "injector.mjs"),
    macPreloadHook: path.join(PROJECT_ROOT, "src", "macos-preload.cjs"),
    bridgeExecutable: path.join(PROJECT_ROOT, "bin", "codexctl-bridge"),
    supervisorWorker: path.join(PROJECT_ROOT, "src", "supervisor-worker.mjs"),
    autoInjectWorker: path.join(PROJECT_ROOT, "src", "auto-inject-worker.mjs"),
    autoInjectLauncher: path.join(PROJECT_ROOT, "bin", "codexctl-auto-inject"),
    wallpaperLibraryDir: path.join(PROJECT_ROOT, "assets", "wallpapers"),
    macLaunchAgentFile: path.join(
      userHomeDirectory,
      "Library",
      "LaunchAgents",
      "com.user.codexctl-auto-inject.plist",
    ),
    linuxAutostartFile: path.join(configBase, "autostart", "codexctl-auto-inject.desktop"),
  };
}
