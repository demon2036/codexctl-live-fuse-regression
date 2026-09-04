import {
  assertLiveMounted,
  assertLiveUnmounted,
} from "./live-diagnostics.mjs";
import {
  failedLiveRollback,
  liveArtifact as artifact,
  liveTarget as target,
  liveTransactionRecord as transactionRecord,
  LiveStateError,
  publicLiveArtifact as publicArtifact,
  sameLiveTarget as sameTarget,
} from "./live-state-model.mjs";

export { LiveStateError } from "./live-state-model.mjs";

export class LiveSlotManager {
  #adapter;
  #masterEnabled;
  #slots;
  #tail = Promise.resolve();
  #transactions = [];

  constructor({ adapter, slots, masterEnabled = true }) {
    if (!adapter || typeof adapter.mount !== "function"
      || typeof adapter.unmount !== "function"
      || typeof adapter.diagnostics !== "function") {
      throw new TypeError("live slot manager requires a mount adapter");
    }
    if (!Array.isArray(slots) || slots.length === 0) {
      throw new TypeError("live slot manager requires slots");
    }
    this.#adapter = adapter;
    this.#masterEnabled = Boolean(masterEnabled);
    this.#slots = new Map();
    for (const definition of slots) {
      const id = String(definition?.id ?? "");
      if (!/^[a-z][a-z0-9-]{1,79}$/.test(id) || this.#slots.has(id)) {
        throw new Error(`invalid or duplicate live slot: ${id || "<missing>"}`);
      }
      const stableArtifact = definition.stableArtifact
        ? artifact(definition.stableArtifact, `${id} stable artifact`) : null;
      const stableEnabled = Boolean(definition.stableEnabled && stableArtifact);
      this.#slots.set(id, {
        actual: null,
        debug: null,
        error: null,
        id,
        order: Number.isSafeInteger(definition.order) ? definition.order : 0,
        phase: "ready",
        stable: { artifact: stableArtifact, enabled: stableEnabled },
      });
    }
  }
  #slot(id) {
    const slot = this.#slots.get(String(id));
    if (!slot) throw new LiveStateError("unknown-slot", `unknown live slot: ${String(id)}`);
    return slot;
  }
  #ordered(ids, reverse = false) {
    const rows = [...new Set(ids)].map((id) => this.#slot(id))
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    return reverse ? rows.reverse() : rows;
  }
  #queue(operation) {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.catch(() => {});
    return result;
  }
  #effectiveStable(slot) {
    return this.#masterEnabled && slot.stable.enabled
      ? target("stable", slot.stable.artifact) : null;
  }
  #snapshotSlot(slot) {
    return {
      actual: slot.actual ? {
        kind: slot.actual.kind,
        artifact: publicArtifact(slot.actual.artifact),
      } : null,
      debug: slot.debug ? {
        artifact: publicArtifact(slot.debug.artifact),
        sequence: slot.debug.sequence,
        source: slot.debug.source,
        watch: slot.debug.watch,
      } : null,
      error: slot.error,
      phase: slot.phase,
      stable: {
        artifact: publicArtifact(slot.stable.artifact),
        enabled: slot.stable.enabled,
      },
    };
  }
  snapshot() {
    return {
      masterEnabled: this.#masterEnabled,
      slots: Object.fromEntries([...this.#slots].map(([id, slot]) => [id, this.#snapshotSlot(slot)])),
      lastTransaction: this.#transactions.at(-1) ?? null,
    };
  }

  async #diagnostics(slot) {
    return this.#adapter.diagnostics(slot.id);
  }

  async #ensureUnmounted(slot) {
    await this.#adapter.unmount(slot.id, slot.actual?.artifact?.revision ?? null);
    assertLiveUnmounted(await this.#diagnostics(slot));
  }

  async #ensureMounted(slot, next) {
    await this.#adapter.mount(slot.id, next.artifact);
    assertLiveMounted(await this.#diagnostics(slot), next.artifact.revision);
  }

  async #restore(slot, before) {
    const diagnostics = await this.#diagnostics(slot);
    if (before) {
      try {
        assertLiveMounted(diagnostics, before.artifact.revision);
        return;
      } catch {}
    } else {
      try {
        assertLiveUnmounted(diagnostics);
        return;
      } catch {}
    }
    await this.#adapter.unmount(slot.id, diagnostics?.revision ?? null);
    assertLiveUnmounted(await this.#diagnostics(slot));
    if (before) await this.#ensureMounted(slot, before);
  }

  async #switch(kind, targets) {
    const ids = Object.keys(targets);
    const changed = this.#ordered(ids).filter((slot) => !sameTarget(slot.actual, targets[slot.id]));
    if (changed.length === 0) return null;
    const before = Object.fromEntries(changed.map((slot) => [slot.id, slot.actual]));
    const after = Object.fromEntries(changed.map((slot) => [slot.id, targets[slot.id]]));
    const tx = transactionRecord(kind, changed.map((slot) => slot.id),
      Object.fromEntries(changed.map((slot) => [slot.id, publicArtifact(slot.actual?.artifact)])),
      Object.fromEntries(changed.map((slot) => [slot.id, publicArtifact(targets[slot.id]?.artifact)])));
    this.#transactions.push(tx);
    for (const slot of changed) {
      slot.phase = "transition";
      slot.error = null;
    }
    try {
      for (const slot of [...changed].reverse()) {
        if (slot.actual) await this.#ensureUnmounted(slot);
      }
      for (const slot of changed) {
        const next = targets[slot.id];
        if (next) await this.#ensureMounted(slot, next);
      }
      for (const slot of changed) {
        slot.actual = targets[slot.id];
        slot.phase = "ready";
      }
      tx.status = "committed";
      tx.completedAt = new Date().toISOString();
      return tx;
    } catch (error) {
      tx.error = String(error?.message ?? error).slice(0, 500);
      const failures = [];
      for (const slot of [...changed].reverse()) {
        try { await this.#restore(slot, before[slot.id]); }
        catch (rollbackError) { failures.push(`${slot.id}: ${rollbackError.message}`); }
      }
      const cleanupFailures = [];
      if (failures.length) {
        for (const slot of [...changed].reverse()) {
          try {
            const diagnostics = await this.#diagnostics(slot);
            await this.#adapter.unmount(slot.id, diagnostics?.revision ?? null);
            assertLiveUnmounted(await this.#diagnostics(slot));
          } catch (cleanupError) {
            cleanupFailures.push(`${slot.id}: ${cleanupError.message}`);
          }
        }
      }
      const failure = failedLiveRollback(tx.error, failures, cleanupFailures);
      tx.rollback = failure.rollback;
      tx.status = failure.status;
      tx.completedAt = new Date().toISOString();
      for (const slot of changed) {
        slot.actual = failures.length ? null : before[slot.id];
        slot.error = tx.error;
        slot.phase = failures.length ? tx.rollback.status : "ready";
      }
      throw new LiveStateError(failure.code, failure.message, tx);
    }
  }

  initialize() {
    return this.#queue(async () => {
      const targets = Object.fromEntries([...this.#slots].map(([id, slot]) => [
        id, this.#effectiveStable(slot),
      ]));
      return this.#switch("initialize", targets);
    });
  }

  setPluginEnabled(id, enabled) {
    return this.#queue(async () => {
      const slot = this.#slot(id);
      if (slot.debug) throw new LiveStateError("debug-locked", `${id} is debug locked`);
      if (enabled && !slot.stable.artifact) {
        throw new LiveStateError("missing-stable", `${id} has no stable artifact`);
      }
      const before = slot.stable.enabled;
      const nextEnabled = Boolean(enabled);
      const next = this.#masterEnabled && nextEnabled ? target("stable", slot.stable.artifact) : null;
      try {
        const tx = await this.#switch("plugin-set", { [slot.id]: next });
        slot.stable.enabled = nextEnabled;
        return tx;
      } catch (error) {
        slot.stable.enabled = before;
        throw error;
      }
    });
  }

  reloadStable(id, nextArtifact) {
    return this.reloadStableMany({ [id]: nextArtifact });
  }
  reloadStableMany(nextArtifacts) {
    return this.#queue(async () => {
      const entries = Object.entries(nextArtifacts ?? {}).map(([id, value]) => {
        const slot = this.#slot(id);
        if (slot.debug) throw new LiveStateError("debug-locked", `${id} is debug locked`);
        return [slot, artifact(value, `${id} stable candidate`)];
      });
      if (!entries.length) return null;
      const before = new Map(entries.map(([slot]) => [slot.id, slot.stable.artifact]));
      const targets = Object.fromEntries(entries.map(([slot, candidate]) => [slot.id,
        this.#masterEnabled && slot.stable.enabled ? target("stable", candidate) : null]));
      try {
        const tx = await this.#switch("stable-reload", targets);
        for (const [slot, candidate] of entries) slot.stable.artifact = candidate;
        return tx;
      } catch (error) {
        for (const [slot] of entries) slot.stable.artifact = before.get(slot.id);
        throw error;
      }
    });
  }
  startDebug(id, nextArtifact, options = {}) {
    return this.#queue(async () => {
      const slot = this.#slot(id);
      if (!this.#masterEnabled) {
        throw new LiveStateError("master-off", "live enhancements are globally disabled");
      }
      if (slot.debug) throw new LiveStateError("debug-active", `${id} already has debug mounted`);
      const candidate = artifact(nextArtifact, `${id} debug candidate`);
      const sequence = Number.isSafeInteger(options.sequence) ? options.sequence : 0;
      const recovery = this.#effectiveStable(slot);
      const tx = await this.#switch("debug-start", { [slot.id]: target("debug", candidate) });
      slot.debug = {
        artifact: candidate,
        recovery,
        sequence,
        source: options.source ?? null,
        watch: options.watch === true,
      };
      return tx;
    });
  }

  replaceDebug(id, nextArtifact, options = {}) {
    return this.#queue(async () => {
      const slot = this.#slot(id);
      if (!slot.debug) throw new LiveStateError("debug-inactive", `${id} has no debug mounted`);
      const sequence = Number.isSafeInteger(options.sequence) ? options.sequence : slot.debug.sequence + 1;
      if (sequence <= slot.debug.sequence) {
        throw new LiveStateError("stale-candidate", `${id} debug candidate is stale`);
      }
      const candidate = artifact(nextArtifact, `${id} debug candidate`);
      const tx = await this.#switch("debug-replace", { [slot.id]: target("debug", candidate) });
      slot.debug.artifact = candidate;
      slot.debug.sequence = sequence;
      return tx;
    });
  }

  stopDebug(id) {
    return this.#queue(async () => {
      const slot = this.#slot(id);
      if (!slot.debug) throw new LiveStateError("debug-inactive", `${id} has no debug mounted`);
      const recovery = slot.debug.recovery;
      const tx = await this.#switch("debug-stop", { [slot.id]: recovery });
      slot.debug = null;
      return tx;
    });
  }

  setMaster(enabled) {
    return this.#queue(async () => {
      const nextEnabled = Boolean(enabled);
      if (nextEnabled === this.#masterEnabled) return null;
      const beforeMaster = this.#masterEnabled;
      const debugBefore = new Map([...this.#slots].map(([id, slot]) => [id, slot.debug]));
      const targets = Object.fromEntries([...this.#slots].map(([id, slot]) => [
        id, nextEnabled && slot.stable.enabled ? target("stable", slot.stable.artifact) : null,
      ]));
      try {
        const tx = await this.#switch(nextEnabled ? "master-on" : "master-off", targets);
        this.#masterEnabled = nextEnabled;
        if (!nextEnabled) for (const slot of this.#slots.values()) slot.debug = null;
        return tx;
      } catch (error) {
        this.#masterEnabled = beforeMaster;
        for (const [id, debug] of debugBefore) this.#slot(id).debug = debug;
        throw error;
      }
    });
  }
}
