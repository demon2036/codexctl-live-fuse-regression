import { compileLiveControlsArtifact, buildLiveStableArtifacts } from "./live-artifacts.mjs";
import { startLiveCompanionCore } from "./live-companion-core.mjs";
import { desktopCommandMatches, readProcessIdentity } from "./desktop-processes.mjs";
import { LiveHostAdapter } from "./live-host-adapter.mjs";
import { connectLiveHost } from "./live-host-client.mjs";
import { LiveSlotManager } from "./live-state.mjs";
import { LivePluginService } from "./live-plugin-service.mjs";
import { inspectLiveSession, removeLiveSession } from "./live-session.mjs";

export async function prepareLiveCompanion(paths, config, bootstrap) {
  return buildLiveStableArtifacts(paths, config, {
    enabled: true,
    sessionId: bootstrap.sessionId,
  });
}

function companionHandlers(manager) {
  const result = (transaction) => ({ state: manager.snapshot(), transaction });
  return {
    "debug.start": ({ pluginId, source, watch }) => manager.startDebug(
      pluginId, source, watch,
    ).then(result),
    "debug.stop": ({ pluginId }) => manager.stopDebug(pluginId).then(result),
    "plugin.reload": ({ pluginId }) => manager.reload(pluginId).then(result),
    "plugin.set": ({ enabled, pluginId }) => manager.setPluginEnabled(
      pluginId, enabled,
    ).then(result),
  };
}

function retainedState(hostStatus, prepared, sessionId) {
  const status = hostStatus?.uiStatus;
  if (!status || status.sessionId !== sessionId || typeof status.masterEnabled !== "boolean"
    || !Array.isArray(status.plugins)) {
    return { masterEnabled: true, plugins: { ...prepared.plugins } };
  }
  const plugins = { ...prepared.plugins };
  for (const entry of status.plugins) {
    if (Object.hasOwn(plugins, entry?.id) && typeof entry.enabled === "boolean") {
      plugins[entry.id] = entry.enabled;
    }
  }
  return { masterEnabled: status.masterEnabled, plugins };
}

export async function pairLiveCompanion({
  bootstrap,
  paths,
  prepared,
  readProcess = readProcessIdentity,
}) {
  const connection = await connectLiveHost({
    authToken: bootstrap.authToken,
    hostRevision: bootstrap.hostRevision,
    sessionId: bootstrap.sessionId,
    socketPath: bootstrap.hostSocketPath,
  });
  let core = null;
  let service = null;
  let releaseEvents = () => {};
  try {
    const [app, companion] = await Promise.all([
      readProcess(connection.host.pid),
      readProcess(process.pid),
    ]);
    if (!app || !companion || !desktopCommandMatches(app.command, bootstrap.desktop.executable)
      || app.executable !== bootstrap.desktop.executable) {
      throw new Error("live process identity did not match the bootstrap");
    }
    app.desktopIdentity = bootstrap.desktop.identity;
    try {
      const previous = await inspectLiveSession(paths, bootstrap.sessionId);
      if (previous.live || !previous.processes.app
        || previous.session.authToken !== bootstrap.authToken) {
        throw new Error("existing live session cannot be reclaimed");
      }
      await removeLiveSession(paths, bootstrap.sessionId, {
        authToken: bootstrap.authToken,
        companionPid: previous.session.companion.pid,
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const adapter = new LiveHostAdapter(connection);
    const retained = retainedState(
      await connection.call("status"), prepared, bootstrap.sessionId,
    );
    prepared.slots.controls = compileLiveControlsArtifact(
      prepared.controlsSource, retained.plugins, prepared.liveControl,
    );
    const physical = new LiveSlotManager({
      adapter,
      masterEnabled: retained.masterEnabled,
      slots: [
        {
          id: "controls",
          order: 0,
          stableArtifact: prepared.slots.controls,
          stableEnabled: Boolean(prepared.slots.controls),
        },
        {
          id: "wallpaper",
          order: 1,
          stableArtifact: prepared.slots.wallpaper,
          stableEnabled: retained.plugins.wallpaper,
        },
      ],
    });
    service = new LivePluginService({
      adapter, paths, physical, plugins: retained.plugins, prepared,
    });
    const uiIdentity = {
      appPid: app.pid,
      companionPid: companion.pid,
      hostRevision: bootstrap.hostRevision,
      sessionId: bootstrap.sessionId,
    };
    service.setPublisher(() => adapter.setUiStatus(service.uiStatus(uiIdentity)));
    releaseEvents = connection.onEvent(({ action }) => {
      void service.dispatchAction(action).catch(() => {});
    });
    await service.initialize();
    let requestClose = () => Promise.resolve();
    core = await startLiveCompanionCore({
      app,
      authToken: bootstrap.authToken,
      companion,
      handlers: companionHandlers(service),
      hostRevision: bootstrap.hostRevision,
      manager: service,
      onShutdown: () => requestClose(),
      paths,
      sessionId: bootstrap.sessionId,
      socketPath: bootstrap.cliSocketPath,
      buildCatalog: async () => prepared.catalog,
    });
    let closedResolve;
    const closed = new Promise((resolve) => { closedResolve = resolve; });
    let closing = null;
    const close = ({ restore = true } = {}) => {
      if (closing) return closing;
      closing = (async () => {
        releaseEvents();
        await service.close({ restore });
        await core.close();
        connection.close();
        closedResolve();
      })();
      return closing;
    };
    requestClose = () => close();
    void connection.closed.then(() => close({ restore: false }).catch(() => {}));
    return {
      app,
      close,
      closed,
      connection,
      core,
      manager: service,
      session: core.session,
    };
  } catch (error) {
    releaseEvents();
    await service?.close({ restore: false }).catch(() => {});
    await core?.close().catch(() => {});
    connection.close();
    throw error;
  }
}
