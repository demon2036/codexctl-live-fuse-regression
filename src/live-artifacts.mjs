import { compileLiveWallpaperCatalog } from "./live-wallpaper-catalog.mjs";
import { materializeRuntime } from "./runtime.mjs";
import {
  compileSource as compileControlsSource,
  loadSource as loadControlsSource,
} from "../vendor/prompt-context/injector.mjs";
import { loadPayload as loadWallpaperPayload } from "../vendor/wallpaper-lite/payload.mjs";

export { liveCodeRevision as liveHostRevision } from "./live-code.mjs";

function controlsArtifact(loaded) {
  return loaded ? Object.freeze({
    id: "controls",
    payload: loaded.payload,
    revision: loaded.revision,
  }) : null;
}

export function wallpaperArtifact(loaded) {
  if (!loaded) return null;
  return Object.freeze({
    id: loaded.theme.id,
    image: Object.freeze({
      bytes: loaded.imageBytes,
      hash: loaded.artHash,
      mime: loaded.mime,
      path: loaded.source.imagePath,
    }),
    payload: loaded.payload,
    revision: loaded.revision,
  });
}

export function initialLivePlugins(config) {
  return Object.freeze({
    context: config.modules.context === true,
    prompt: config.modules.prompt === true,
    provider: config.modules.prompt === true || config.modules.context === true,
    wallpaper: config.modules.wallpaper === true,
  });
}

export function compileLiveControlsArtifact(source, features, liveControl) {
  return controlsArtifact(compileControlsSource(source, {
    features,
    liveControl,
  }));
}

export async function buildLiveControlsArtifact(runtime, features, liveControl) {
  return compileLiveControlsArtifact(
    await loadControlsSource(runtime.paths.promptProfilesFile), features, liveControl,
  );
}

export async function buildLiveWallpaperArtifact(themeDirectory) {
  return wallpaperArtifact(await loadWallpaperPayload(themeDirectory));
}

export async function buildLiveStableArtifacts(paths, config, liveControl) {
  const catalog = await compileLiveWallpaperCatalog(paths);
  const runtime = await materializeRuntime(config, paths, { livePrepare: true });
  const plugins = initialLivePlugins(config);
  const [controlsSource, wallpaper] = await Promise.all([
    loadControlsSource(runtime.paths.promptProfilesFile),
    buildLiveWallpaperArtifact(runtime.paths.themeDir),
  ]);
  const controls = compileLiveControlsArtifact(controlsSource, plugins, liveControl);
  return {
    catalog,
    config,
    controlsSource,
    liveControl,
    plugins,
    runtime,
    slots: {
      controls,
      wallpaper,
    },
  };
}
