import { compileLiveWallpaperCatalog } from "./live-wallpaper-catalog.mjs";
import { startLiveServer } from "./live-server.mjs";
import { removeLiveSession, writeLiveSession } from "./live-session.mjs";

function catalogSummary(catalog) {
  return {
    available: catalog.entries.filter((entry) => entry.status === "available").length,
    entries: catalog.entries.map((entry) => ({
      error: entry.error ?? null,
      id: entry.id,
      name: entry.name ?? entry.id,
      revision: entry.revision ?? null,
      source: entry.source,
      status: entry.status,
    })),
    revision: catalog.revision,
    reused: catalog.reused,
    unavailable: catalog.entries.filter((entry) => entry.status !== "available").length,
  };
}

export async function startLiveCompanionCore({
  app,
  authToken,
  companion,
  handlers = {},
  hostRevision,
  manager,
  onShutdown = null,
  paths,
  sessionId,
  socketPath,
  buildCatalog = compileLiveWallpaperCatalog,
}) {
  if (!manager || typeof manager.snapshot !== "function") {
    throw new TypeError("live companion core requires a slot manager");
  }
  const catalog = await buildCatalog(paths);
  let closing = false;
  let closePromise = null;
  let server;
  let session;
  const close = () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      closing = true;
      await server?.close();
      if (session) await removeLiveSession(paths, sessionId, {
        authToken,
        companionPid: companion.pid,
      });
    })();
    return closePromise;
  };
  const status = () => ({
    app: { pid: app.pid, startedAt: app.startedAt },
    catalog: catalogSummary(catalog),
    companion: { pid: companion.pid, startedAt: companion.startedAt },
    hostRevision,
    manager: manager.snapshot(),
    sessionId,
    status: closing ? "closing" : "ready",
  });
  const dispatch = async (request) => {
    if (request.operation === "status") return status();
    if (request.operation === "shutdown") {
      setImmediate(() => { void (onShutdown ? onShutdown() : close()); });
      return { accepted: true };
    }
    if (request.operation === "master.set") {
      const transaction = await manager.setMaster(request.params.enabled);
      return { state: manager.snapshot(), transaction };
    }
    const handler = handlers[request.operation];
    if (typeof handler !== "function") {
      const error = new Error(`live operation is not available: ${request.operation}`);
      error.code = "operation-unavailable";
      throw error;
    }
    return handler(request.params, { catalog, manager, status });
  };
  try {
    server = await startLiveServer({ authToken, dispatch, sessionId, socketPath });
    session = await writeLiveSession(paths, {
      app: {
        command: app.command,
        executable: app.executable,
        pid: app.pid,
        startedAt: app.startedAt,
      },
      authToken,
      companion,
      createdAt: new Date().toISOString(),
      desktopIdentity: app.desktopIdentity,
      hostRevision,
      schema: "codexctl-live-session/2",
      sessionId,
      socketPath,
      uid: typeof process.getuid === "function" ? process.getuid() : 0,
    });
  } catch (error) {
    await server?.close().catch(() => {});
    throw error;
  }
  return { catalog, close, server, session, status };
}
