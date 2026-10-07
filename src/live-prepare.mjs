import fs from "node:fs/promises";
import path from "node:path";
import {
  buildLiveStableArtifacts, buildLiveControlsArtifact, buildLiveWallpaperArtifact,
  compileLiveControlsArtifact,
} from "./live-artifacts.mjs";
import { LIVE_PLUGIN_IDS, liveSlotFor } from "./live-plugin-view.mjs";

export async function liveDebugSource(paths, id, source) {
  const entry = await fs.lstat(source);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("debug source must be a real directory");
  const canonical = await fs.realpath(source);
  if (liveSlotFor(id) === "controls") {
    const builtin = await fs.realpath(path.join(paths.projectRoot, "vendor", "prompt-context"));
    if (canonical !== builtin) throw new Error("controls debug only accepts the trusted built-in source root");
  }
  return canonical;
}

export function compileLiveDebug(prepared, id, source) {
  return liveSlotFor(id) === "wallpaper"
    ? buildLiveWallpaperArtifact(source)
    : buildLiveControlsArtifact(prepared.runtime, prepared.plugins, prepared.liveControl);
}

export async function prepareLiveCompanion(paths, config, bootstrap, checkpoint = null) {
  const prepared = await buildLiveStableArtifacts(paths, config, {
    enabled: true, sessionId: bootstrap.sessionId,
  });
  prepared.debug = {};
  if (!checkpoint) return prepared;
  if (checkpoint.schema !== "codexctl-live-checkpoint/1"
    || !LIVE_PLUGIN_IDS.every((id) => typeof checkpoint.plugins?.[id] === "boolean")
    || typeof checkpoint.physical?.masterEnabled !== "boolean"
    || !Array.isArray(checkpoint.debug)
    || ![...LIVE_PLUGIN_IDS, "all"].includes(checkpoint.reload)) {
    throw new Error("live reload checkpoint is invalid");
  }
  prepared.plugins = { ...checkpoint.plugins };
  prepared.expectedApp = checkpoint.app;
  prepared.previous = checkpoint.physical;
  prepared.masterEnabled = checkpoint.physical.masterEnabled;
  const selected = checkpoint.reload === "all" ? ["controls", "wallpaper"]
    : [liveSlotFor(checkpoint.reload)];
  for (const slotId of ["controls", "wallpaper"]) {
    const debug = checkpoint.debug.find((record) => record.slotId === slotId);
    const previous = checkpoint.physical.slots[slotId];
    if (!previous) throw new Error(`live reload checkpoint is missing ${slotId}`);
    if (!selected.includes(slotId) || debug) {
      if (slotId === "controls") prepared.controlsSource = checkpoint.controlsSource;
      else prepared.slots.wallpaper = previous.stable.artifact;
    }
    if (debug) {
      if (!LIVE_PLUGIN_IDS.includes(debug.pluginId) || liveSlotFor(debug.pluginId) !== slotId) {
        throw new Error("live debug checkpoint is invalid");
      }
      const source = await liveDebugSource(paths, debug.pluginId, debug.source);
      prepared.debug[slotId] = {
        ...debug, source, sequence: debug.sequence + 1,
        artifact: await compileLiveDebug(prepared, debug.pluginId, source),
      };
    }
  }
  prepared.slots.controls = compileLiveControlsArtifact(
    prepared.controlsSource, prepared.plugins, prepared.liveControl,
  );
  return prepared;
}
