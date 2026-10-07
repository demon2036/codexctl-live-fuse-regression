import { compileLiveControlsArtifact } from "./live-artifacts.mjs";
import { startLiveCompanionCore } from "./live-companion-core.mjs";
import { desktopCommandMatches, readProcessIdentity } from "./desktop-processes.mjs";
import { LiveHostAdapter } from "./live-host-adapter.mjs";
import { connectLiveCdpHost } from "./live-cdp-host.mjs";
import { LiveSlotManager } from "./live-state.mjs";
import { LivePluginService } from "./live-plugin-service.mjs";
import { inspectLiveSession, removeLiveSession } from "./live-session.mjs";
import { removeLiveBootstrap } from "./live-bootstrap.mjs";
import { replaceLiveCompanion } from "./live-reload.mjs";

export { prepareLiveCompanion } from "./live-prepare.mjs";

function companionHandlers(manager, reload) {
  const result = (transaction) => ({ state: manager.snapshot(), transaction });
  return {
    "debug.start": (request) => reload(request.pluginId, true, request),
    "debug.stop": ({ pluginId }) => manager.stopDebug(pluginId).then(result),
    "plugin.reload": ({ pluginId }) => reload(pluginId, true),
    "plugin.set": ({ enabled, pluginId }) => manager.setPluginEnabled(pluginId, enabled).then(result),
  };
}

export async function pairLiveCompanion({
  appPid, bootstrap, paths, prepared, readProcess = readProcessIdentity,
}) {
  const connect = () => connectLiveCdpHost({ appPid, port: bootstrap.debugPort });
  let connection = await connect();
  const adapter = new LiveHostAdapter(connection);
  let core = null;
  let service = null;
  let releaseEvents = () => {};
  let detached = false;
  let replaced = false;
  let reloading = false;
  let closing = null;
  let closedResolve;
  const closed = new Promise((resolve) => { closedResolve = resolve; });
  const close = ({ restore = true } = {}) => {
    if (closing) return closing;
    closing = (async () => {
      releaseEvents();
      await service?.close({ restore });
      await core?.close();
      await connection.close();
      if (replaced) await removeLiveBootstrap(paths, bootstrap.sessionId, bootstrap.authToken);
      closedResolve();
    })();
    return closing;
  };
  const listen = () => {
    const current = connection;
    releaseEvents = current.onEvent(({ action }) => {
      void service.dispatchAction(action).catch(() => {});
    });
    void current.closed.then(() => {
      if (!detached && connection === current) return close({ restore: false });
    }).catch(() => {});
  };
  try {
    const [app, companion] = await Promise.all([
      readProcess(connection.host.pid), readProcess(process.pid),
    ]);
    const expected = prepared.expectedApp;
    if (!app || !companion || !desktopCommandMatches(app.command, bootstrap.desktop.executable)
      || app.executable !== bootstrap.desktop.executable
      || expected && (app.pid !== expected.pid || app.startedAt !== expected.startedAt
        || app.command !== expected.command || app.executable !== expected.executable)) {
      throw new Error("live process identity did not match the bootstrap");
    }
    app.desktopIdentity = bootstrap.desktop.identity;
    try {
      const previous = await inspectLiveSession(paths, bootstrap.sessionId);
      if (previous.live || !previous.processes.app || previous.session.authToken !== bootstrap.authToken) {
        throw new Error("existing live session cannot be reclaimed");
      }
      await removeLiveSession(paths, bootstrap.sessionId, {
        authToken: bootstrap.authToken, companionPid: previous.session.companion.pid,
      });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    prepared.slots.controls = compileLiveControlsArtifact(
      prepared.controlsSource, prepared.plugins, prepared.liveControl,
    );
    const physical = new LiveSlotManager({
      adapter, masterEnabled: prepared.masterEnabled ?? true,
      slots: ["controls", "wallpaper"].map((id, order) => ({
        id, order, stableArtifact: prepared.slots[id],
        stableEnabled: id === "controls" ? Boolean(prepared.slots[id]) : prepared.plugins.wallpaper,
        actual: prepared.previous?.slots[id]?.actual,
        debug: prepared.debug?.[id],
      })),
    });
    const reload = async (id, reply = false, debugStart = null) => {
      if (reloading || replaced || closing) throw new Error("live reload is already in progress");
      reloading = true;
      let suspended = false;
      let replacing = false;
      try {
        await service.suspend();
        suspended = true;
        const checkpoint = await service.checkpoint(id, debugStart);
        replacing = true;
        const result = await replaceLiveCompanion({
          app, bootstrap, checkpoint, paths,
          hasPendingChanges: () => service.hasPendingChanges(),
          detach: async () => {
            detached = true;
            releaseEvents();
            await connection.close();
            await core.setAvailable(false);
          },
          resume: async (wasDetached) => {
            if (wasDetached) {
              connection = await connect();
              adapter.connection = connection;
              await core.setAvailable(true);
              detached = false;
              listen();
            }
            await service.resume(wasDetached);
          },
        });
        replaced = true;
        if (!reply) await close({ restore: false });
        return result;
      } catch (error) {
        if (suspended && !replacing) await service.resume();
        await service.reloadFailed(error);
        throw error;
      } finally { reloading = false; }
    };
    service = new LivePluginService({ adapter, paths, physical, prepared, reload });
    const uiIdentity = {
      appPid: app.pid, companionPid: companion.pid,
      hostRevision: bootstrap.hostRevision, sessionId: bootstrap.sessionId,
    };
    service.setPublisher(() => adapter.setUiStatus(service.uiStatus(uiIdentity)));
    listen();
    await service.initialize();
    core = await startLiveCompanionCore({
      app, authToken: bootstrap.authToken, companion,
      handlers: companionHandlers(service, reload), hostRevision: bootstrap.hostRevision,
      manager: service, onShutdown: () => close({ restore: !replaced }), paths,
      sessionId: bootstrap.sessionId, socketPath: bootstrap.cliSocketPath,
      buildCatalog: async () => prepared.catalog,
      afterResponse: (request, result) => ["plugin.reload", "debug.start"].includes(request.operation)
        && result?.transaction?.kind === "runtime-reload"
        ? close({ restore: false }).catch(() => {}) : undefined,
    });
    return { app, close, closed, connection, core, manager: service, session: core.session };
  } catch (error) {
    await close({ restore: false }).catch(() => {});
    throw error;
  }
}
