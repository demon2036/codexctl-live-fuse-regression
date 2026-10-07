import { liveCodeRevision } from "./live-code.mjs";
import { readProcessIdentity } from "./desktop-processes.mjs";
import { liveBootstrapFile, writeLiveBootstrap, removeLiveBootstrap } from "./live-bootstrap.mjs";
import { newLiveIdentity } from "./live-protocol.mjs";
import { liveHostSocketPath, liveSocketPath, removeLiveSession } from "./live-session.mjs";
import { spawnCompanion, terminateCompanion, validateWorkerEvent } from "./live-worker.mjs";

async function assertSameApp(app) {
  const current = await readProcessIdentity(app.pid);
  if (!current || current.startedAt !== app.startedAt || current.command !== app.command
    || current.executable !== app.executable) throw new Error("live reload App identity changed");
}

export async function replaceLiveCompanion({
  app, bootstrap, checkpoint, detach, paths, resume, env = process.env,
  hasPendingChanges = () => false,
}) {
  const identity = newLiveIdentity();
  const next = {
    ...bootstrap, ...identity,
    cliSocketPath: liveSocketPath(paths, identity.sessionId),
    hostSocketPath: liveHostSocketPath(paths, identity.sessionId),
    createdAt: new Date().toISOString(),
  };
  const filename = liveBootstrapFile(paths, identity.sessionId);
  let worker = null;
  let detached = false;
  const assertFresh = async () => {
    const revision = await liveCodeRevision(paths);
    if (hasPendingChanges() || revision !== next.hostRevision) {
      throw new Error("live source changed during reload; previous companion will resume");
    }
  };
  try {
    next.hostRevision = await liveCodeRevision(paths);
    await assertSameApp(app);
    await writeLiveBootstrap(paths, next);
    worker = await spawnCompanion(paths, filename, env, { ...checkpoint, app });
    const ready = validateWorkerEvent(await worker.next(), next.sessionId);
    if (ready.phase !== "ready" || ready.hostRevision !== next.hostRevision) {
      throw new Error("live code changed before reload; previous companion remains active");
    }
    await assertSameApp(app);
    await assertFresh();
    detached = true;
    await detach();
    worker.launch({ appPid: app.pid, debugPort: next.debugPort, sessionId: next.sessionId });
    const paired = validateWorkerEvent(await worker.next(), next.sessionId);
    if (paired.phase !== "paired" || paired.appPid !== app.pid
      || paired.companionPid !== worker.child.pid || paired.hostRevision !== next.hostRevision) {
      throw new Error("live reload pairing did not match the existing App");
    }
    await assertSameApp(app);
    await assertFresh();
    return {
      appPid: app.pid, companionPid: paired.companionPid,
      hostRevision: next.hostRevision, sessionId: next.sessionId,
      transaction: { kind: "runtime-reload", status: "committed" },
    };
  } catch (error) {
    await terminateCompanion(worker?.child);
    if (worker?.child.pid) await removeLiveSession(paths, next.sessionId, {
      authToken: next.authToken, companionPid: worker.child.pid,
    });
    await removeLiveBootstrap(paths, next.sessionId, next.authToken);
    try { await resume(detached); }
    catch (rollbackError) {
      throw new Error(`${error.message}; live rollback failed: ${rollbackError.message}; Codex App remains running`);
    }
    throw error;
  }
}
