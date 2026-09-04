export const LIVE_PLUGIN_IDS = Object.freeze([
  "prompt", "context", "provider", "wallpaper",
]);

const NAMES = Object.freeze({
  context: "Context", prompt: "Prompt", provider: "Provider", wallpaper: "Wallpaper",
});

export const liveSlotFor = (id) => id === "wallpaper" ? "wallpaper" : "controls";

function publicTransaction(value) {
  return value ? { id: value.id, kind: value.kind, status: value.status } : null;
}

export function livePluginSnapshot({ debug, errors, lastError, physical, plugins, stable }) {
  const state = physical.snapshot();
  const projected = {};
  for (const id of LIVE_PLUGIN_IDS) {
    const slotId = liveSlotFor(id);
    const slot = state.slots[slotId];
    const activeDebug = debug.get(slotId);
    projected[id] = {
      actual: slot.actual?.kind === "debug" || plugins[id] ? slot.actual : null,
      available: Boolean(stable[slotId]),
      debug: activeDebug?.pluginId === id ? {
        recoveryEnabled: activeDebug.recoveryEnabled,
        revision: slot.debug?.artifact?.revision ?? null,
        sequence: slot.debug?.sequence ?? activeDebug.sequence,
        source: activeDebug.source,
        watch: activeDebug.watch,
      } : null,
      enabled: plugins[id],
      error: errors.get(id) ?? slot.error,
      phase: slot.phase,
      stable: stable[slotId] ? { revision: stable[slotId].revision } : null,
    };
  }
  return {
    lastError,
    lastTransaction: state.lastTransaction,
    masterEnabled: state.masterEnabled,
    plugins: projected,
    slots: state.slots,
  };
}

export function liveUiStatus(state, identity) {
  return {
    appPid: identity.appPid,
    companionPid: identity.companionPid,
    connected: true,
    hostRevision: identity.hostRevision,
    lastError: state.lastError,
    lastTransaction: publicTransaction(state.lastTransaction),
    masterEnabled: state.masterEnabled,
    plugins: LIVE_PLUGIN_IDS.map((id) => {
      const plugin = state.plugins[id];
      const activeDebug = plugin.debug;
      return {
        available: plugin.available,
        debugRevision: activeDebug?.revision ?? null,
        displayName: NAMES[id],
        effectiveKind: plugin.actual?.kind ?? null,
        effectiveRevision: plugin.actual?.artifact?.revision ?? null,
        enabled: plugin.enabled,
        error: plugin.error ?? null,
        id,
        phase: plugin.phase,
        recoveryEnabled: activeDebug
          ? activeDebug.recoveryEnabled : plugin.enabled,
        stableRevision: plugin.stable?.revision ?? null,
        watch: activeDebug?.watch === true,
      };
    }),
    schema: "codexctl-live-ui-status/1",
    sessionId: identity.sessionId,
  };
}
