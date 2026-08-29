import fs from "node:fs/promises";
import path from "node:path";
import { ConfigError } from "./errors.mjs";
import { writeTextAtomic } from "./util.mjs";
import preloadBudget from "./macos-preload-budget.cjs";

export const MAC_PRELOAD_TRANSACTION_TIMEOUT_MS = preloadBudget.TRANSACTION_TIMEOUT_MS;

const RESULT_KEYS = [
  "completedAt", "durationMs", "error", "ok", "pid",
  "promptContext", "schema", "url", "wallpaper",
].sort().join(",");

function relativeThemeImage(wallpaperPayload) {
  const image = wallpaperPayload?.source?.theme?.image;
  if (typeof image !== "string" || path.basename(image) !== image
    || !/^[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i.test(image)) {
    throw new ConfigError("macOS preload 的 Wallpaper 图片名无效。");
  }
  return `theme/${image}`;
}

export async function writeMacPreloadSpec(
  runtimePaths,
  config,
  promptPayload,
  wallpaperPayload,
) {
  const promptContext = config.modules.prompt || config.modules.context ? {
    payload: promptPayload.payload,
    revision: promptPayload.revision,
  } : null;
  const wallpaper = config.modules.wallpaper ? {
    payload: wallpaperPayload.payload,
    revision: wallpaperPayload.revision,
    themeId: wallpaperPayload.theme.id,
    mime: wallpaperPayload.mime,
    image: relativeThemeImage(wallpaperPayload),
    bytes: wallpaperPayload.art.length,
  } : null;
  const spec = {
    schema: "codexctl-macos-preload/1",
    promptContext,
    wallpaper,
  };
  await writeTextAtomic(
    runtimePaths.macPreloadSpecFile,
    `${JSON.stringify(spec)}\n`,
    0o600,
  );
  return {
    bytes: Buffer.byteLength(JSON.stringify(spec)),
    promptRevision: promptContext?.revision ?? null,
    wallpaperRevision: wallpaper?.revision ?? null,
  };
}

function validateResult(record, expectedPid, runtime) {
  if (!record || typeof record !== "object" || Array.isArray(record)
    || Object.keys(record).sort().join(",") !== RESULT_KEYS
    || record.schema !== "codexctl-macos-preload-result/1"
    || record.pid !== expectedPid) {
    throw new Error("macOS preload 回执身份不匹配");
  }
  if (!record.ok) throw new Error(`macOS preload 失败：${String(record.error).slice(0, 600)}`);
  const expectedPrompt = runtime.promptContext?.revision ?? null;
  const expectedWallpaper = runtime.wallpaper?.revision ?? null;
  if (expectedPrompt && record.promptContext?.revision !== expectedPrompt) {
    throw new Error("macOS preload 未确认 Prompt/Context revision");
  }
  const expectedModules = runtime.modules ?? {};
  const controlsDormant = record.promptContext?.controlContextAvailable === false
    && record.promptContext?.buttonCount === 0
    && record.promptContext?.contextButtonCount === 0
    && record.promptContext?.providerIndicatorCount === 0;
  if (expectedPrompt && record.promptContext?.appRoutesReady !== true && !controlsDormant) {
    throw new Error("macOS preload 未确认 Codex 最终页面挂载契约");
  }
  if (expectedPrompt && expectedModules.prompt === true
    && (record.promptContext?.features?.prompt !== true
      || (!controlsDormant && (record.promptContext?.buttonCount !== 1
        || record.promptContext?.promptButtons?.[0]?.visible !== true)))) {
    throw new Error("macOS preload 未确认 Prompt 控件契约");
  }
  if (expectedPrompt && expectedModules.context === true
    && (record.promptContext?.features?.context !== true
      || (!controlsDormant && (record.promptContext?.contextButtonCount !== 1
        || record.promptContext?.contextButtons?.[0]?.visible !== true)))) {
    throw new Error("macOS preload 未确认 Context 控件契约");
  }
  if (expectedPrompt && !controlsDormant
    && (record.promptContext?.providerIndicatorCount !== 1
      || record.promptContext?.providerIndicators?.[0]?.visible !== true)) {
    throw new Error("macOS preload 未确认 Provider 指示器契约");
  }
  const promptTimers = record.promptContext?.activeTimers;
  const promptUi = record.promptContext?.uiMetrics;
  if (expectedPrompt && (!Number.isInteger(promptTimers?.managerProbe)
    || promptTimers.managerProbe < 0 || promptTimers.managerProbe > 1
    || ![promptTimers?.navigation, promptTimers?.toast, promptTimers?.bridge]
      .every((value) => Number.isInteger(value) && value === 0)
    || ![promptUi?.mutationBatches, promptUi?.mutationRecords]
      .every((value) => Number.isInteger(value) && value === 0))) {
    throw new Error("macOS preload 未确认 Prompt/Context 性能契约");
  }
  if (expectedWallpaper && (record.wallpaper?.revision !== expectedWallpaper
    || record.wallpaper?.installed !== true || record.wallpaper?.artReady !== true
    || record.wallpaper?.stylePresent !== true || record.wallpaper?.rootAttribute !== "on"
    || record.wallpaper?.observers !== 0 || record.wallpaper?.timers !== 0)) {
    throw new Error("macOS preload 未确认 Wallpaper 性能契约");
  }
  return {
    transport: "electron-preload",
    durationMs: record.durationMs,
    url: record.url,
    promptContext: record.promptContext,
    wallpaper: record.wallpaper,
  };
}

export async function waitForMacPreloadResult(
  resultFile,
  expectedPid,
  runtime,
  timeoutMs = MAC_PRELOAD_TRANSACTION_TIMEOUT_MS,
) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      try {
        const stat = await fs.stat(resultFile);
        if (!stat.isFile() || stat.size < 2 || stat.size > 128 * 1024) {
          throw new Error("macOS preload 回执大小无效");
        }
        return validateResult(JSON.parse(await fs.readFile(resultFile, "utf8")), expectedPid, runtime);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(50, remainingMs)));
      }
    }
    throw new Error(
      `macOS preload 未在 ${Math.round(timeoutMs / 1000)} 秒内返回; `
      + `stage=awaiting-result; navigations=unknown; elapsedMs=${Date.now() - startedAt}`,
    );
  } finally {
    await fs.rm(resultFile, { force: true }).catch(() => {});
  }
}
