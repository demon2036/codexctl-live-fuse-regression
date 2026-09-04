import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ConfigError } from "./errors.mjs";
import { ensureControllerDirectories, updateConfig } from "./config.mjs";
import {
  ensurePrivateDirectory,
  withFileLock,
  writeTextAtomic,
  writeTextIfChanged,
} from "./util.mjs";
import { loadPayload as loadPromptPayload } from "../vendor/prompt-context/injector.mjs";
import { loadPayload as loadWallpaperPayload } from "../vendor/wallpaper-lite/injector.mjs";
import { materializeWallpaper } from "./runtime-wallpaper.mjs";
import { writeMacPreloadSpec } from "./macos-preload-runtime.mjs";
import { normalizeProviderId, OFFICIAL_PROVIDER_ID } from "./provider.mjs";

export { materializeWallpaper } from "./runtime-wallpaper.mjs";

const MAX_PROMPT_BYTES = 4 * 1024 * 1024;

function normalizeRuntimeOptions(options = {}) {
  const requestedProvider = options.launchProviderId;
  const launchProviderId = requestedProvider == null
    ? null : normalizeProviderId(requestedProvider);
  if (requestedProvider != null && !launchProviderId) {
    throw new ConfigError("启动 Provider ID 必须由字母、数字、点、下划线或连字符组成（最长 120 字符）。");
  }
  return {
    defaultProviderId: launchProviderId ?? OFFICIAL_PROVIDER_ID,
    launchProviderId,
    livePrepare: options.livePrepare === true,
  };
}

function engineSourceFiles(config, paths, options = {}) {
  const controlsEnabled = options.livePrepare
    || config.modules.prompt || config.modules.context;
  const wallpaperEnabled = options.livePrepare || config.modules.wallpaper;
  return {
    promptContext: controlsEnabled ? [
      path.join(paths.projectRoot, "src", "renderer-injection.mjs"),
      path.join(paths.projectRoot, "src", "macos-preload-runtime.mjs"),
      paths.macPreloadHook,
      paths.promptInjector,
      ...["00-bootstrap", "02-storage", "05-prompt-policy", "10-thread-state",
        "12-provider-state", "15-request-client", "20-client-discovery", "22-client-probe",
        "25-context-policy", "27-usage-metrics", "30-context-switch", "35-custom-context-menu", "40-menus",
        "42-usage-menu", "45-control-style", "48-live-control", "49-provider-control", "49-overflow-control",
        "50-controls", "51-control-layout", "60-lifecycle"].map((name) => path.join(
        paths.projectRoot, "vendor", "prompt-context", "renderer", `${name}.part.js`,
      )),
      path.join(paths.projectRoot, "vendor", "prompt-context", "VERSION"),
    ] : [],
    wallpaper: wallpaperEnabled ? [
      path.join(paths.projectRoot, "src", "renderer-injection.mjs"),
      path.join(paths.projectRoot, "src", "macos-preload-runtime.mjs"),
      paths.macPreloadHook,
      paths.wallpaperInjector,
      path.join(paths.projectRoot, "vendor", "wallpaper-lite", "payload.mjs"),
      path.join(paths.projectRoot, "vendor", "wallpaper-lite", "wallpaper-css.mjs"),
      path.join(paths.projectRoot, "vendor", "wallpaper-lite", "renderer.js"),
      path.join(paths.projectRoot, "vendor", "wallpaper-lite", "theme-loader.mjs"),
      path.join(paths.projectRoot, "vendor", "wallpaper-lite", "VERSION"),
      path.join(paths.projectRoot, "vendor", "dream-skin", "assets", "theme-package-validator.mjs"),
      path.join(paths.projectRoot, "vendor", "dream-skin", "assets", "theme-package-shared.mjs"),
      path.join(paths.projectRoot, "vendor", "dream-skin", "assets", "safe-css-validator.mjs"),
      path.join(paths.projectRoot, "vendor", "dream-skin", "assets", "safe-css-contract.mjs"),
      path.join(paths.projectRoot, "vendor", "dream-skin", "assets", "safe-css-values.mjs"),
      path.join(paths.projectRoot, "vendor", "dream-skin", "assets", "safe-css-parser.mjs"),
      path.join(paths.projectRoot, "vendor", "dream-skin", "scripts", "image-metadata.mjs"),
    ] : [],
  };
}

async function engineRevisions(config, paths, options) {
  const revisions = {};
  for (const [moduleName, files] of Object.entries(engineSourceFiles(config, paths, options))) {
    if (!files.length) {
      revisions[moduleName] = null;
      continue;
    }
    const hash = createHash("sha256");
    for (const filename of files) {
      try {
        hash.update(`\0${path.relative(paths.projectRoot, filename)}\0`);
        hash.update(await fs.readFile(filename));
      } catch (error) {
        hash.update(`\0error:${filename}:${error.code ?? error.message}`);
      }
    }
    revisions[moduleName] = hash.digest("hex").slice(0, 24);
  }
  return revisions;
}

async function validateRegularFile(filename, maximumBytes, kind) {
  let canonical;
  try {
    canonical = await fs.realpath(filename);
  } catch (error) {
    if (error.code === "ENOENT") throw new ConfigError(`${kind} 文件不存在：${filename}`);
    throw error;
  }
  const stat = await fs.stat(canonical);
  if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) {
    throw new ConfigError(`${kind} 必须是 1–${maximumBytes} bytes 的普通文件：${canonical}`);
  }
  return { canonical, stat };
}

export async function materializePromptContext(config, paths, options = {}) {
  const provider = normalizeRuntimeOptions(options);
  const profiles = [];
  for (const profile of config.prompt.profiles) {
    const { canonical } = await validateRegularFile(profile.path, MAX_PROMPT_BYTES, "Prompt");
    profiles.push({ ...profile, path: canonical });
  }
  const payload = {
    schema: "codex-base-prompt-profiles/1",
    features: {
      prompt: config.modules.prompt,
      context: config.modules.context,
      provider: config.modules.prompt || config.modules.context,
      live: false,
    },
    liveControl: null,
    defaultProfileId: config.prompt.defaultProfileId,
    defaultContextId: config.context.defaultPresetId,
    defaultProviderId: provider.defaultProviderId,
    launchProviderId: provider.launchProviderId,
    promptSelectionRevision: config.prompt.selectionRevision,
    contextSelectionRevision: config.context.selectionRevision,
    providerSelectionRevision: provider.launchProviderId
      ? `launch:${provider.launchProviderId}` : "launch:implicit-openai",
    contexts: config.context.presets.map(({ id, label, contextWindow, autoCompactTokenLimit, scope, native }) => ({
      id,
      label,
      contextWindow,
      autoCompactTokenLimit,
      scope,
      native: native === true,
    })),
    profiles,
  };
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  await writeTextIfChanged(paths.promptProfilesFile, text, 0o600);
  return { profiles: profiles.length, bytes: Buffer.byteLength(text) };
}

function pathsForGeneration(paths, directory) {
  return {
    ...paths,
    runtimeDir: directory,
    promptProfilesFile: path.join(directory, "prompt-context.json"),
    themeDir: path.join(directory, "theme"),
    macPreloadSpecFile: path.join(directory, "macos-preload.json"),
  };
}

export function runtimeConfigRevision(config) {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 24);
}

async function sourceFingerprint(config, paths, runtimeOptions) {
  const configRevision = runtimeConfigRevision(config);
  const hash = createHash("sha256").update(configRevision);
  hash.update(`\0runtime-options:${JSON.stringify(runtimeOptions)}`);
  const engines = await engineRevisions(config, paths, runtimeOptions);
  hash.update(`\0engines:${JSON.stringify(engines)}`);
  const sources = [
    ...config.prompt.profiles.map((profile) => profile.path),
    config.wallpaper.themeId ? null : config.wallpaper.image,
  ].filter(Boolean);
  for (const filename of sources) {
    try {
      const [canonical, stat] = await Promise.all([fs.realpath(filename), fs.stat(filename)]);
      hash.update(`\0${canonical}\0${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`);
    } catch (error) {
      hash.update(`\0error:${filename}:${error.code ?? error.message}`);
    }
  }
  if (config.wallpaper.themeId) {
    const base = config.wallpaper.themeSource === "user"
      ? paths.userThemesDir : paths.wallpaperLibraryDir;
    const directory = path.join(base, config.wallpaper.themeId);
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isFile() || !/^(?:theme\.json|theme\.css|.+\.(?:png|jpe?g|webp))$/i.test(entry.name)) continue;
        const filename = path.join(directory, entry.name);
        const stat = await fs.stat(filename);
        hash.update(`\0theme:${filename}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`);
      }
    } catch (error) {
      hash.update(`\0theme-error:${directory}:${error.code ?? error.message}`);
    }
  }
  return { fingerprint: hash.digest("hex"), engines, configRevision };
}

export async function readCurrentRuntime(paths) {
  try {
    const current = JSON.parse(await fs.readFile(paths.runtimeCurrentFile, "utf8"));
    if (current?.schema !== "codexctl-runtime-current/1"
      || typeof current.generation !== "string"
      || typeof current.fingerprint !== "string") return null;
    const directory = path.join(paths.runtimeGenerationsDir, current.generation);
    const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
    if (manifest?.schema !== "codexctl-runtime-generation/1"
      || manifest.generation !== current.generation
      || manifest.fingerprint !== current.fingerprint) return null;
    return {
      ...manifest,
      committedAt: current.committedAt ?? null,
      committed: true,
      directory,
      paths: pathsForGeneration(paths, directory),
    };
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function stageRuntime(config, paths, options = {}) {
  await ensureControllerDirectories(paths);
  const runtimeOptions = normalizeRuntimeOptions(options);
  const { fingerprint, engines, configRevision } = await sourceFingerprint(
    config,
    paths,
    runtimeOptions,
  );
  const current = await readCurrentRuntime(paths);
  if (current?.fingerprint === fingerprint) {
    return { reused: true, committed: true, ...current };
  }

  const staging = await fs.mkdtemp(path.join(paths.runtimeGenerationsDir, ".stage-"));
  const generationPaths = pathsForGeneration(paths, staging);
  try {
    await ensurePrivateDirectory(generationPaths.themeDir);
    const promptContext = await materializePromptContext(config, generationPaths, runtimeOptions);
    const wallpaper = await materializeWallpaper(config, generationPaths, {
      prepareDisabled: runtimeOptions.livePrepare,
    });

    // Compilation belongs to the transaction.  A syntactically valid JSON
    // file that cannot produce an executable renderer must never become the
    // current generation.
    const promptPayload = await loadPromptPayload(generationPaths.promptProfilesFile);
    if (config.modules.prompt || config.modules.context || runtimeOptions.livePrepare) {
      // eslint-free syntax validation without executing private App code.
      new Function(promptPayload.payload);
    }
    let wallpaperPayload = null;
    if (config.modules.wallpaper || runtimeOptions.livePrepare) {
      wallpaperPayload = await loadWallpaperPayload(generationPaths.themeDir);
      new Function(wallpaperPayload.payload);
    }
    const macPreload = await writeMacPreloadSpec(
      generationPaths,
      config,
      promptPayload,
      wallpaperPayload,
    );

    const generation = `${Date.now()}-${randomUUID()}`;
    const finalDirectory = path.join(paths.runtimeGenerationsDir, generation);
    const manifest = {
      schema: "codexctl-runtime-generation/1",
      generation,
      fingerprint,
      configRevision,
      createdAt: new Date().toISOString(),
      modules: { ...config.modules },
      promptContext: {
        ...promptContext,
        defaultProviderId: runtimeOptions.defaultProviderId,
        launchProviderId: runtimeOptions.launchProviderId,
        revision: promptPayload.revision,
        engineRevision: engines.promptContext,
      },
      wallpaper: {
        ...wallpaper,
        themeDir: path.join(finalDirectory, "theme"),
        revision: wallpaperPayload?.revision ?? null,
        engineRevision: engines.wallpaper,
      },
      macPreload,
    };
    await writeTextAtomic(
      path.join(staging, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      0o600,
    );
    await fs.rename(staging, finalDirectory);
    return {
      reused: false,
      committed: false,
      ...manifest,
      directory: finalDirectory,
      paths: pathsForGeneration(paths, finalDirectory),
    };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function commitRuntime(paths, staged) {
  if (!staged) throw new ConfigError("缺少待提交的 runtime generation。");
  if (staged.committed) return staged;
  const current = {
    schema: "codexctl-runtime-current/1",
    generation: staged.generation,
    fingerprint: staged.fingerprint,
    committedAt: new Date().toISOString(),
  };
  await writeTextAtomic(paths.runtimeCurrentFile, `${JSON.stringify(current, null, 2)}\n`, 0o600);
  return { ...staged, committed: true };
}

export async function discardRuntime(staged) {
  if (!staged || staged.reused || staged.committed || !staged.directory) return;
  await fs.rm(staged.directory, { recursive: true, force: true });
}

export async function materializeRuntime(config, paths, options = {}) {
  return withFileLock(paths.runtimeLockFile, async () => {
    const staged = await stageRuntime(config, paths, options);
    return commitRuntime(paths, staged);
  });
}

export async function updateRuntimeConfig(paths, mutator) {
  return updateConfig(paths, mutator, {
    prepare: (nextConfig) => stageRuntime(nextConfig, paths),
    commit: (staged) => commitRuntime(paths, staged),
    rollback: (staged) => discardRuntime(staged),
  });
}
