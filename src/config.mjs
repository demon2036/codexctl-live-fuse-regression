import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_SCHEMA, createDefaultConfig } from "./defaults.mjs";
import { ConfigError } from "./errors.mjs";
import { validateContextPreset } from "./policy.mjs";
import { clone, ensurePrivateDirectory, withFileLock, writeTextAtomic } from "./util.mjs";

function mergeConfig(raw) {
  const defaults = createDefaultConfig();
  const wallpaper = {
    ...defaults.wallpaper,
    ...(raw.wallpaper ?? {}),
    overrides: {
      ...defaults.wallpaper.overrides,
      ...(raw.wallpaper?.overrides ?? {}),
    },
  };
  if (raw.wallpaper && !Object.hasOwn(raw.wallpaper, "themeId") && raw.wallpaper.image) {
    wallpaper.themeId = null;
  }
  if (!raw.wallpaper?.themeSource) wallpaper.themeSource = wallpaper.themeId ? "bundled" : null;
  return {
    ...defaults,
    ...raw,
    app: { ...defaults.app, ...(raw.app ?? {}) },
    modules: { ...defaults.modules, ...(raw.modules ?? {}) },
    prompt: { ...defaults.prompt, ...(raw.prompt ?? {}) },
    context: { ...defaults.context, ...(raw.context ?? {}) },
    wallpaper,
  };
}

function assertNullableAbsolute(value, name) {
  if (value !== null && (typeof value !== "string" || !path.isAbsolute(value))) {
    throw new ConfigError(`${name} 必须是绝对路径或 null。`);
  }
}

export function validateConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ConfigError("config.json 顶层必须是对象。" );
  }
  if (input.schema !== CONFIG_SCHEMA) {
    throw new ConfigError(`不支持的配置 schema：${input.schema ?? "<missing>"}`);
  }
  const config = mergeConfig(input);
  if (!Number.isInteger(config.app.debugPort)
    || (config.app.debugPort !== 0 && config.app.debugPort < 1024)
    || config.app.debugPort > 65535) {
    throw new ConfigError("app.debugPort 必须是 0（自动）或 1024–65535。" );
  }
  assertNullableAbsolute(config.app.path, "app.path");
  assertNullableAbsolute(config.app.cliPath, "app.cliPath");
  if (!Array.isArray(config.app.extraArgs)
    || config.app.extraArgs.some((value) => typeof value !== "string"
      || value.length < 1 || value.length > 500 || value.includes("\0"))) {
    throw new ConfigError("app.extraArgs 必须是非空字符串数组。" );
  }
  if (!new Set(["auto", "xwayland", "wayland"]).has(config.app.linuxDisplay)) {
    throw new ConfigError("app.linuxDisplay 必须是 auto、xwayland 或 wayland。" );
  }
  for (const key of ["prompt", "context", "wallpaper"]) {
    if (typeof config.modules[key] !== "boolean") {
      throw new ConfigError(`modules.${key} 必须是 boolean。`);
    }
  }
  if (!Array.isArray(config.prompt.profiles)) {
    throw new ConfigError("prompt.profiles 必须是数组。" );
  }
  for (const [name, value] of [
    ["prompt.selectionRevision", config.prompt.selectionRevision],
    ["context.selectionRevision", config.context.selectionRevision],
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ConfigError(`${name} 必须是非负整数。`);
    }
  }
  const promptIds = new Set(["default", "original"]);
  const promptPaths = new Set();
  config.prompt.profiles = config.prompt.profiles.map((profile) => {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      throw new ConfigError("prompt.profiles 中存在无效项目。" );
    }
    const id = String(profile.id ?? "");
    const label = String(profile.label ?? "");
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id) || !label || label.length > 80) {
      throw new ConfigError(`无效 Prompt profile：${id || "<missing>"}`);
    }
    if (!path.isAbsolute(profile.path ?? "")) {
      throw new ConfigError(`Prompt profile ${id} 的 path 必须是绝对路径。`);
    }
    if (promptIds.has(id) || promptPaths.has(profile.path)) {
      throw new ConfigError(`重复的 Prompt profile：${id}`);
    }
    promptIds.add(id);
    promptPaths.add(profile.path);
    return { id, label, path: profile.path };
  });
  if (config.prompt.defaultProfileId !== "default"
    && !promptIds.has(config.prompt.defaultProfileId)) {
    throw new ConfigError(`找不到默认 Prompt profile：${config.prompt.defaultProfileId}`);
  }
  if (!Array.isArray(config.context.presets) || config.context.presets.length === 0) {
    throw new ConfigError("context.presets 至少要有一个 preset。" );
  }
  if (!config.context.presets.some((preset) => preset?.id === "native")) {
    config.context.presets.unshift({
      id: "native",
      label: "Native / Official",
      contextWindow: null,
      autoCompactTokenLimit: null,
      scope: null,
      builtin: true,
      native: true,
    });
  }
  const contextIds = new Set();
  config.context.presets = config.context.presets.map((preset) => {
    const id = String(preset?.id ?? "");
    const label = String(preset?.label ?? "");
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id) || !label || label.length > 80 || contextIds.has(id)) {
      throw new ConfigError(`无效或重复的 Context preset：${id || "<missing>"}`);
    }
    contextIds.add(id);
    try {
      return validateContextPreset({ ...preset, id, label });
    } catch (error) {
      throw new ConfigError(`${id}: ${error.message}`);
    }
  });
  if (!contextIds.has(config.context.defaultPresetId)) {
    throw new ConfigError(`找不到默认 Context preset：${config.context.defaultPresetId}`);
  }
  if (config.wallpaper.themeId !== null
    && (typeof config.wallpaper.themeId !== "string"
      || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(config.wallpaper.themeId))) {
    throw new ConfigError("wallpaper.themeId 必须是内置壁纸 id 或 null。" );
  }
  if (config.wallpaper.themeId === null) config.wallpaper.themeSource = null;
  else if (!new Set(["bundled", "user"]).has(config.wallpaper.themeSource)) {
    throw new ConfigError("wallpaper.themeSource 必须是 bundled、user 或 null。" );
  }
  assertNullableAbsolute(config.wallpaper.image, "wallpaper.image");
  if (!["auto", "light", "dark"].includes(config.wallpaper.appearance)) {
    throw new ConfigError("wallpaper.appearance 必须是 auto、light 或 dark。" );
  }
  if (!["auto", "left", "right", "center", "none"].includes(config.wallpaper.safeArea)) {
    throw new ConfigError("wallpaper.safeArea 无效。" );
  }
  if (!["auto", "ambient", "banner", "full", "off"].includes(config.wallpaper.taskMode)) {
    throw new ConfigError("wallpaper.taskMode 无效。" );
  }
  for (const key of ["focusX", "focusY", "overlayOpacity", "sidebarOpacity", "composerOpacity"]) {
    const value = Number(config.wallpaper[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new ConfigError(`wallpaper.${key} 必须在 0–1 之间。`);
    }
    config.wallpaper[key] = value;
  }
  const gradientBias = Number(config.wallpaper.gradientBias);
  if (!Number.isFinite(gradientBias) || gradientBias < -1 || gradientBias > 1) {
    throw new ConfigError("wallpaper.gradientBias 必须在 -1–1 之间。" );
  }
  config.wallpaper.gradientBias = gradientBias;
  if (!config.wallpaper.overrides || typeof config.wallpaper.overrides !== "object"
    || Array.isArray(config.wallpaper.overrides)) {
    throw new ConfigError("wallpaper.overrides 必须是对象。" );
  }
  const overrideKeys = new Set([
    "appearance", "focusX", "focusY", "safeArea", "taskMode",
    "overlayOpacity", "gradientBias", "sidebarOpacity", "composerOpacity",
  ]);
  for (const key of Object.keys(config.wallpaper.overrides)) {
    if (!overrideKeys.has(key)) throw new ConfigError(`未知 wallpaper override：${key}`);
  }
  if (config.wallpaper.overrides.appearance !== undefined
    && !["auto", "light", "dark"].includes(config.wallpaper.overrides.appearance)) {
    throw new ConfigError("wallpaper.overrides.appearance 无效。" );
  }
  if (config.wallpaper.overrides.safeArea !== undefined
    && !["auto", "left", "right", "center", "none"].includes(config.wallpaper.overrides.safeArea)) {
    throw new ConfigError("wallpaper.overrides.safeArea 无效。" );
  }
  if (config.wallpaper.overrides.taskMode !== undefined
    && !["auto", "ambient", "banner", "full", "off"].includes(config.wallpaper.overrides.taskMode)) {
    throw new ConfigError("wallpaper.overrides.taskMode 无效。" );
  }
  for (const key of ["focusX", "focusY", "overlayOpacity", "sidebarOpacity", "composerOpacity"]) {
    if (config.wallpaper.overrides[key] === undefined) continue;
    const value = Number(config.wallpaper.overrides[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new ConfigError(`wallpaper.overrides.${key} 必须在 0–1 之间。`);
    }
    config.wallpaper.overrides[key] = value;
  }
  if (config.wallpaper.overrides.gradientBias !== undefined) {
    const value = Number(config.wallpaper.overrides.gradientBias);
    if (!Number.isFinite(value) || value < -1 || value > 1) {
      throw new ConfigError("wallpaper.overrides.gradientBias 必须在 -1–1 之间。" );
    }
    config.wallpaper.overrides.gradientBias = value;
  }
  if (config.modules.wallpaper && !config.wallpaper.themeId && !config.wallpaper.image) {
    throw new ConfigError("Wallpaper 已启用，但尚未选择内置主题或设置图片。" );
  }
  return config;
}

export async function ensureControllerDirectories(paths) {
  await Promise.all([
    ensurePrivateDirectory(paths.home),
    ensurePrivateDirectory(paths.runtimeDir),
    ensurePrivateDirectory(paths.runtimeGenerationsDir),
    ensurePrivateDirectory(paths.themeDir),
    ensurePrivateDirectory(paths.logsDir),
    ensurePrivateDirectory(paths.launchesDir),
    ensurePrivateDirectory(paths.userThemesDir),
  ]);
}

export async function loadConfig(paths, { create = true } = {}) {
  await ensureControllerDirectories(paths);
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(paths.configFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      if (error instanceof SyntaxError) throw new ConfigError(`config.json 不是合法 JSON：${error.message}`);
      throw error;
    }
    if (!create) throw error;
    const config = createDefaultConfig();
    await saveConfig(paths, config);
    return config;
  }
  return validateConfig(raw);
}

export async function saveConfig(paths, config) {
  const validated = validateConfig(clone(config));
  await ensureControllerDirectories(paths);
  await writeTextAtomic(paths.configFile, `${JSON.stringify(validated, null, 2)}\n`, 0o600);
  return validated;
}

export async function updateConfig(paths, mutator, transaction = {}) {
  return withFileLock(paths.configLockFile, async () => {
    const previous = await loadConfig(paths);
    const draft = clone(previous);
    const result = await mutator(draft);
    const validated = validateConfig(draft);
    let prepared = null;
    let configCommitted = false;
    try {
      prepared = transaction.prepare ? await transaction.prepare(validated, previous) : null;
      await saveConfig(paths, validated);
      configCommitted = true;
      if (transaction.commit) await transaction.commit(prepared, validated, previous);
      return { config: validated, result, prepared };
    } catch (error) {
      if (configCommitted) await saveConfig(paths, previous).catch(() => {});
      if (transaction.rollback) {
        await transaction.rollback(prepared, error, validated, previous).catch(() => {});
      }
      throw error;
    }
  });
}
