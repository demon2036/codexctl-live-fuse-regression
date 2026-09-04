import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import {
  buildLiveControlsArtifact,
  buildLiveStableArtifacts,
  buildLiveWallpaperArtifact,
  compileLiveControlsArtifact,
} from "./live-artifacts.mjs";
import { LiveDebugWatcher } from "./live-debug-watch.mjs";
import {
  LIVE_PLUGIN_IDS as IDS,
  livePluginSnapshot,
  liveSlotFor as slotFor,
  liveUiStatus,
} from "./live-plugin-view.mjs";

function asError(error) {
  return {
    code: String(error?.code ?? "operation-failed").slice(0, 80),
    message: String(error?.message ?? error).slice(0, 500),
  };
}

export class LivePluginService {
  #adapter;
  #closed = false;
  #controlsRuntime;
  #controlsSource;
  #debug = new Map();
  #errors = new Map();
  #lastError = null;
  #liveControl;
  #paths;
  #physical;
  #plugins;
  #publisher = null;
  #stable;
  #tail = Promise.resolve();

  constructor({ adapter, paths, physical, prepared, plugins = prepared.plugins }) {
    this.#adapter = adapter;
    this.#paths = paths;
    this.#physical = physical;
    this.#controlsRuntime = prepared.runtime;
    this.#controlsSource = prepared.controlsSource;
    this.#plugins = { ...plugins };
    this.#stable = { ...prepared.slots };
    this.#liveControl = prepared.liveControl;
  }

  #queue(operation) {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.catch(() => {});
    return result;
  }

  async #notify() {
    if (this.#publisher) await this.#publisher().catch(() => {});
  }

  async #run(pluginId, operation) {
    return this.#queue(async () => {
      if (this.#closed) throw new Error("live plugin service is closed");
      try {
        const result = await operation();
        if (pluginId) this.#errors.delete(pluginId);
        this.#lastError = null;
        await this.#notify();
        return result;
      } catch (error) {
        const failure = asError(error);
        if (pluginId) this.#errors.set(pluginId, failure.message);
        this.#lastError = failure;
        await this.#notify();
        throw error;
      }
    });
  }

  setPublisher(publisher) {
    this.#publisher = typeof publisher === "function" ? publisher : null;
  }

  publish() {
    return this.#notify();
  }

  snapshot() {
    return livePluginSnapshot({
      debug: this.#debug,
      errors: this.#errors,
      lastError: this.#lastError,
      physical: this.#physical,
      plugins: this.#plugins,
      stable: this.#stable,
    });
  }

  uiStatus(identity) {
    return liveUiStatus(this.snapshot(), identity);
  }

  initialize() {
    return this.#run(null, () => this.#physical.initialize());
  }

  setPluginEnabled(id, enabled) {
    if (!IDS.includes(id)) return Promise.reject(new Error(`unknown live plugin: ${id}`));
    return this.#run(id, async () => {
      const nextEnabled = Boolean(enabled);
      if (this.#plugins[id] === nextEnabled) return null;
      const slotId = slotFor(id);
      if (this.#debug.has(slotId)) throw new Error(`${slotId} is debug locked`);
      let transaction;
      if (slotId === "wallpaper") {
        transaction = await this.#physical.setPluginEnabled(slotId, nextEnabled);
      } else {
        const features = { ...this.#plugins, [id]: nextEnabled };
        const candidate = compileLiveControlsArtifact(
          this.#controlsSource, features, this.#liveControl,
        );
        transaction = await this.#physical.reloadStable("controls", candidate);
        this.#stable.controls = candidate;
      }
      this.#plugins[id] = nextEnabled;
      return transaction;
    });
  }

  setMaster(enabled) {
    const next = Boolean(enabled);
    const records = next ? [] : [...this.#debug.values()];
    const watchersClosed = Promise.all(records.map((record) => record.watcher?.close()));
    return this.#run(null, async () => {
      const current = this.#physical.snapshot().masterEnabled;
      if (next === current) return null;
      if (next) return this.#physical.setMaster(true);
      await watchersClosed;
      for (const record of records) await this.#adapter.setRecovery(record.slotId, null);
      try {
        const transaction = await this.#physical.setMaster(false);
        for (const record of records) await this.#adapter.clearRecovery(record.slotId);
        this.#debug.clear();
        return transaction;
      } catch (error) {
        for (const record of records) {
          await this.#adapter.setRecovery(record.slotId,
            record.recoveryEnabled ? this.#stable[record.slotId] : null).catch(() => {});
          if (record.watch) record.watcher = this.#createWatcher(record);
        }
        throw error;
      }
    });
  }

  reload(id) {
    if (id !== "all" && !IDS.includes(id)) return Promise.reject(new Error(`unknown live plugin: ${id}`));
    return this.#run(id === "all" ? null : id, async () => {
      const slots = id === "all" ? ["controls", "wallpaper"] : [slotFor(id)];
      if (slots.some((slotId) => this.#debug.has(slotId))) throw new Error("debug slot must stop before reload");
      const next = await buildLiveStableArtifacts(
        this.#paths, await loadConfig(this.#paths), this.#liveControl,
      );
      next.slots.controls = compileLiveControlsArtifact(
        next.controlsSource, this.#plugins, this.#liveControl,
      );
      const artifacts = Object.fromEntries(slots.map((slotId) => [slotId, next.slots[slotId]]));
      const transaction = await this.#physical.reloadStableMany(artifacts);
      for (const slotId of slots) this.#stable[slotId] = next.slots[slotId];
      if (slots.includes("controls")) {
        this.#controlsRuntime = next.runtime;
        this.#controlsSource = next.controlsSource;
      }
      return transaction;
    });
  }

  async #canonicalSource(id, source) {
    const entry = await fs.lstat(source);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("debug source must be a real directory");
    const canonical = await fs.realpath(source);
    if (slotFor(id) === "controls") {
      const builtin = await fs.realpath(path.join(this.#paths.projectRoot, "vendor", "prompt-context"));
      if (canonical !== builtin) throw new Error("controls debug only accepts the trusted built-in source root");
    }
    return canonical;
  }

  #compileDebug(id, source) {
    return slotFor(id) === "wallpaper"
      ? buildLiveWallpaperArtifact(source)
      : buildLiveControlsArtifact(this.#controlsRuntime, this.#plugins, this.#liveControl);
  }

  #createWatcher(record) {
    const watcher = new LiveDebugWatcher({
      apply: (artifact, sequence) => this.#replaceDebug(record.slotId, artifact, sequence),
      build: () => this.#compileDebug(record.pluginId, record.source),
      error: (error) => this.#watchError(record.pluginId, error),
      sequence: record.sequence,
      source: record.source,
    });
    watcher.arm();
    return watcher;
  }

  #replaceDebug(slotId, artifact, sequence) {
    const record = this.#debug.get(slotId);
    if (!record) return Promise.resolve();
    return this.#run(record.pluginId, async () => {
      const transaction = await this.#physical.replaceDebug(slotId, artifact, { sequence });
      record.sequence = sequence;
      return transaction;
    });
  }

  #watchError(pluginId, error) {
    return this.#queue(async () => {
      const failure = asError(error);
      this.#errors.set(pluginId, `debug build kept previous B: ${failure.message}`);
      this.#lastError = failure;
      await this.#notify();
    });
  }

  startDebug(id, source, watch) {
    if (!IDS.includes(id)) return Promise.reject(new Error(`unknown live plugin: ${id}`));
    return this.#run(id, async () => {
      const slotId = slotFor(id);
      if (this.#debug.has(slotId)) throw new Error(`${slotId} already has debug mounted`);
      const canonical = await this.#canonicalSource(id, source);
      const record = {
        pluginId: id, recoveryEnabled: slotId === "controls" || this.#plugins.wallpaper,
        sequence: 1, slotId, source: canonical, watch: Boolean(watch), watcher: null,
      };
      if (record.watch) record.watcher = new LiveDebugWatcher({
        apply: (artifact, sequence) => this.#replaceDebug(slotId, artifact, sequence),
        build: () => this.#compileDebug(id, canonical),
        error: (error) => this.#watchError(id, error),
        sequence: record.sequence,
        source: canonical,
      });
      try {
        const candidate = await this.#compileDebug(id, canonical);
        await this.#adapter.setRecovery(slotId,
          record.recoveryEnabled ? this.#stable[slotId] : null);
        const transaction = await this.#physical.startDebug(slotId, candidate, {
          sequence: record.sequence, source: canonical, watch: record.watch,
        });
        this.#debug.set(slotId, record);
        record.watcher?.arm();
        return transaction;
      } catch (error) {
        await record.watcher?.close();
        await this.#adapter.clearRecovery(slotId).catch(() => {});
        throw error;
      }
    });
  }

  stopDebug(id) {
    if (!IDS.includes(id)) return Promise.reject(new Error(`unknown live plugin: ${id}`));
    const current = this.#debug.get(slotFor(id));
    const watcherClosed = current?.pluginId === id
      ? current.watcher?.close() ?? Promise.resolve() : Promise.resolve();
    return this.#run(id, async () => {
      const slotId = slotFor(id);
      const record = this.#debug.get(slotId);
      if (!record || record.pluginId !== id) throw new Error(`${id} has no active debug slot`);
      await watcherClosed;
      try {
        const transaction = await this.#physical.stopDebug(slotId);
        await this.#adapter.clearRecovery(slotId);
        this.#debug.delete(slotId);
        return transaction;
      } catch (error) {
        if (record.watch) record.watcher = this.#createWatcher(record);
        throw error;
      }
    });
  }

  dispatchAction(action) {
    if (action.operation === "master.set") return this.setMaster(action.params.enabled);
    if (action.operation === "plugin.set") {
      return this.setPluginEnabled(action.params.pluginId, action.params.enabled);
    }
    if (action.operation === "plugin.reload") return this.reload(action.params.pluginId);
    if (action.operation === "debug.stop") return this.stopDebug(action.params.pluginId);
    return Promise.reject(new Error("live UI action is unavailable"));
  }

  close({ restore = true } = {}) {
    const records = [...this.#debug.values()];
    const watchersClosed = Promise.all(records.map((record) => record.watcher?.close()));
    return this.#queue(async () => {
      if (this.#closed) return;
      this.#closed = true;
      await watchersClosed;
      if (restore) for (const record of records) {
        await this.#physical.stopDebug(record.slotId).catch(() => {});
        await this.#adapter.clearRecovery(record.slotId).catch(() => {});
      }
      this.#debug.clear();
      if (restore) await this.#notify();
    });
  }
}
