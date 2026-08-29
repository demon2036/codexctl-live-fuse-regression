import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConfigError } from "./errors.mjs";

const execFileAsync = promisify(execFile);

function parseOutput(stdout, moduleName) {
  try { return JSON.parse(stdout); }
  catch { throw new ConfigError(`${moduleName} 一次性注入没有返回有效结果。`); }
}

async function runInjector(moduleName, script, args) {
  const websocketFlag = typeof WebSocket === "function" ? [] : ["--experimental-websocket"];
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      ...websocketFlag,
      script,
      "--install",
      ...args,
    ], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });
    return parseOutput(stdout, moduleName);
  } catch (error) {
    const detail = String(error.stderr ?? error.message).trim().slice(-1200);
    throw new ConfigError(`${moduleName} 一次性注入失败：${detail}`);
  }
}

export async function installOnce(paths, config, runtime, port) {
  if (!runtime?.paths) throw new ConfigError("一次性注入缺少已提交的 runtime。");
  const tasks = [];
  if (config.modules.prompt || config.modules.context) {
    tasks.push(runInjector("Prompt/Context", paths.promptInjector, [
      "--port", String(port),
      "--profiles", runtime.paths.promptProfilesFile,
      "--timeout-ms", "15000",
    ]).then((result) => ["promptContext", result]));
  }
  if (config.modules.wallpaper) {
    tasks.push(runInjector("Wallpaper", paths.wallpaperInjector, [
      "--port", String(port),
      "--theme-dir", runtime.paths.themeDir,
      "--timeout-ms", "15000",
      "--allow-hidden",
    ]).then((result) => ["wallpaper", result]));
  }
  return Object.fromEntries(await Promise.all(tasks));
}
