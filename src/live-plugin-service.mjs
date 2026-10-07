import path from "node:path";
import { compileLiveControlsArtifact } from "./live-artifacts.mjs";
import { LiveDebugWatcher } from "./live-debug-watch.mjs";
import { isLiveSource } from "./live-code.mjs";
import { liveDebugSource } from "./live-prepare.mjs";
import {
  LIVE_PLUGIN_IDS as IDS, livePluginSnapshot, liveSlotFor as slotFor, liveUiStatus,
} from "./live-plugin-view.mjs";

function asError(error) {
  return {
    code: String(error?.code ?? "operation-failed").slice(0, 80),
    message: String(error?.message ?? error).slice(0, 500),
  };
}

function contains(directory, filename) {
  const relative = path.relative(directory, filename);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

export class LivePluginService {
  #adapter;
  #closed = false;
  #controlsSource;
  #debug = new Map();
  #errors = new Map();
  #lastError = null;
  #liveControl;
  #paths;
  #paused = false;
  #physical;
  #plugins;
  #publisher = null;
  #reload;
  #stable;
  #tail = Promise.resolve();
  #watcher = null;
  #watchKey = null;

  constructor({ adapter, paths, physical, prepared, plugins = prepared.plugins, reload }) {
    this.#adapter = adapter;
    this.#paths = paths;
    this.#physical = physical;
    this.#controlsSource = prepared.controlsSource;
    this.#plugins = { ...plugins };
    this.#stable = { ...prepared.slots };
    this.#liveControl = prepared.liveControl;
    this.#reload = reload;
    for (const [id, { artifact: _artifact, ...record }] of Object.entries(prepared.debug ?? {})) {
      this.#debug.set(id, record);
    }
  }

  #queue(operation) {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.catch(() => {});
    return result;
  }

  async #notify() {
    if (this.#publisher) await this.#publisher().catch(() => {});
  }

  #run(pluginId, operation) {
    return this.#queue(async () => {
      if (this.#closed || this.#paused) throw new Error("live service is closed or reloading");
      try {
        const result = await operation();
        if (pluginId) this.#errors.delete(pluginId);
        this.#lastError = null;
        await this.#notify();
        return result;
      } catch (error) {
        this.#lastError = asError(error);
        if (pluginId) this.#errors.set(pluginId, this.#lastError.message);
        await this.#notify();
        throw error;
      }
    });
  }

  setPublisher(publisher) { this.#publisher = publisher; }
  publish() { return this.#notify(); }
  uiStatus(identity) { return liveUiStatus(this.snapshot(), identity); }

  snapshot() {
    return livePluginSnapshot({
      debug: this.#debug, errors: this.#errors, lastError: this.#lastError,
      physical: this.#physical, plugins: this.#plugins, stable: this.#stable,
    });
  }

  async checkpoint(reload, debugStart = null) {
    const debug = [...this.#debug.values()];
    if (debugStart) {
      const { pluginId, source, watch } = debugStart;
      if (!IDS.includes(pluginId)) throw new Error(`unknown live plugin: ${pluginId}`);
      const slotId = slotFor(pluginId);
      if (this.#debug.has(slotId)) throw new Error(`${slotId} already has debug mounted`);
      if (!this.#physical.snapshot().masterEnabled) throw new Error("live enhancements are globally disabled");
      debug.push({
        pluginId, slotId, source: await liveDebugSource(this.#paths, pluginId, source),
        recoveryEnabled: slotId === "controls" || this.#plugins.wallpaper,
        sequence: 0, watch: Boolean(watch),
      });
    }
    return {
      controlsSource: this.#controlsSource, debug,
      physical: this.#physical.checkpoint(), plugins: { ...this.#plugins },
      reload, schema: "codexctl-live-checkpoint/1",
    };
  }

  initialize() {
    return this.#run(null, async () => {
      for (const record of this.#debug.values()) {
        await this.#adapter.setRecovery(record.slotId,
          record.recoveryEnabled ? this.#stable[record.slotId] : null);
      }
      const result = await this.#physical.initialize();
      this.#syncWatcher();
      return result;
    });
  }

  #syncWatcher() {
    const records = [...this.#debug.values()].filter((record) => record.watch);
    const key = JSON.stringify(records.map((record) => record.source).sort());
    if (this.#watcher && this.#watchKey === key && !this.#closed) {
      if (!this.#paused) this.#watcher.arm();
      return;
    }
    this.#watcher?.close();
    this.#watcher = null;
    this.#watchKey = key;
    if (this.#closed || this.#paused) return;
    if (!records.length) return;
    const root = this.#paths.projectRoot;
    const sources = [{
      directory: root,
      accept: (name) => {
        if (name == null) return true;
        const filename = path.resolve(root, String(name));
        if (contains(this.#paths.home, filename)) return false;
        return isLiveSource(name) || records.some((record) => contains(record.source, filename));
      },
    }];
    for (const { source } of records) {
      if (!sources.some(({ directory }) => contains(directory, source))) {
        sources.push({ directory: source });
      }
    }
    this.#watcher = new LiveDebugWatcher({
      sources, reload: () => this.reload("all"), error: (error) => this.reloadFailed(error),
    });
  }

  async suspend() {
    if (this.#closed || this.#paused) throw new Error("live reload is already in progress");
    this.#paused = true;
    this.#watcher?.pause();
    await this.#tail;
  }

  hasPendingChanges() { return Boolean(this.#watcher?.dirty); }

  resume(reconcile = false) {
    return this.#queue(async () => {
      if (this.#closed) throw new Error("live service is closed");
      if (reconcile) await this.#physical.reconcile();
      this.#paused = false;
      this.#syncWatcher();
      await this.#notify();
    });
  }

  reloadFailed(error) {
    return this.#queue(async () => {
      this.#lastError = asError(error);
      await this.#notify();
    });
  }

  reload(id) {
    if (id !== "all" && !IDS.includes(id)) return Promise.reject(new Error(`unknown live plugin: ${id}`));
    if (this.#closed || typeof this.#reload !== "function") {
      return Promise.reject(new Error("live runtime reload is unavailable"));
    }
    return this.#reload(id);
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
        const candidate = compileLiveControlsArtifact(
          this.#controlsSource, { ...this.#plugins, [id]: nextEnabled }, this.#liveControl,
        );
        transaction = await this.#physical.reloadStable("controls", candidate);
        this.#stable.controls = candidate;
      }
      this.#plugins[id] = nextEnabled;
      return transaction;
    });
  }

  setMaster(enabled) {
    return this.#run(null, async () => {
      const next = Boolean(enabled);
      if (next === this.#physical.snapshot().masterEnabled) return null;
      const result = await this.#physical.setMaster(next);
      if (!next) {
        for (const record of this.#debug.values()) await this.#adapter.clearRecovery(record.slotId);
        this.#debug.clear();
      }
      this.#syncWatcher();
      return result;
    });
  }

  stopDebug(id) {
    if (!IDS.includes(id)) return Promise.reject(new Error(`unknown live plugin: ${id}`));
    return this.#run(id, async () => {
      const slotId = slotFor(id);
      const record = this.#debug.get(slotId);
      if (!record || record.pluginId !== id) throw new Error(`${id} has no active debug slot`);
      const transaction = await this.#physical.stopDebug(slotId);
      await this.#adapter.clearRecovery(slotId);
      this.#debug.delete(slotId);
      this.#syncWatcher();
      return transaction;
    });
  }

  dispatchAction(action) {
    if (action.operation === "master.set") return this.setMaster(action.params.enabled);
    if (action.operation === "plugin.set") return this.setPluginEnabled(action.params.pluginId, action.params.enabled);
    if (action.operation === "plugin.reload") return this.reload(action.params.pluginId);
    if (action.operation === "debug.stop") return this.stopDebug(action.params.pluginId);
    return Promise.reject(new Error("live UI action is unavailable"));
  }

  close({ restore = true } = {}) {
    this.#watcher?.close();
    this.#watcher = null;
    return this.#queue(async () => {
      if (this.#closed) return;
      this.#closed = true;
      if (restore) for (const record of this.#debug.values()) {
        await this.#physical.stopDebug(record.slotId).catch(() => {});
        await this.#adapter.clearRecovery(record.slotId).catch(() => {});
      }
      this.#debug.clear();
      if (restore) await this.#notify();
    });
  }
}
