import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { createRunEnvelope, registerOwnedProcess } from "../regression/ownership.mjs";
import { launchElectronFixture } from "../regression/electron-runtime.mjs";
import { createDefaultConfig } from "../src/defaults.mjs";
import { readProcessIdentity } from "../src/desktop-processes.mjs";
import { PROJECT_ROOT } from "../src/paths.mjs";
import { newLiveIdentity } from "../src/live-protocol.mjs";
import { liveCodeRevision } from "../src/live-code.mjs";
import { liveBootstrapFile, readLiveBootstrap, writeLiveBootstrap } from "../src/live-bootstrap.mjs";
import { inspectLiveSession, liveHostSocketPath, liveSocketPath } from "../src/live-session.mjs";
import { spawnCompanion, terminateCompanion, validateWorkerEvent } from "../src/live-worker.mjs";
import { callLiveSession } from "../src/live-client.mjs";
import { withRendererSessions } from "../src/renderer-injection.mjs";

const execFileAsync = promisify(execFile);

export async function waitForLiveCondition(probe, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("isolated live reload condition timed out");
}

export async function liveReloadFixture() {
  const envelope = await createRunEnvelope();
  const project = path.join(envelope.root, "project");
  const home = path.join(envelope.root, "state");
  let desktop = null;
  let worker = null;
  let paths = null;
  const bootstrap = { ...newLiveIdentity() };
  async function records() {
    const names = await fs.readdir(paths.liveSessionsDir).catch(() => []);
    return Promise.all(names.filter((name) => name.endsWith(".json"))
      .map((name) => inspectLiveSession(paths, name.slice(0, -5))));
  }
  const current = async () => {
    const rows = (await records()).filter((row) => row.live);
    if (rows.length !== 1) throw new Error(`expected one isolated Live session, got ${rows.length}`);
    const session = rows[0].session;
    const companion = await readProcessIdentity(session.companion.pid);
    if (companion) registerOwnedProcess(envelope, companion);
    return session;
  };
  async function call(operation, params = {}) {
    const session = await current();
    return callLiveSession({
      authToken: session.authToken, sessionId: session.sessionId,
      socketPath: session.socketPath, operation, params, timeoutMs: 30_000,
    });
  }
  async function close() {
    if (paths) for (const { session } of await records()) {
      await callLiveSession({
        authToken: session.authToken, sessionId: session.sessionId,
        socketPath: session.socketPath, operation: "shutdown", timeoutMs: 1000,
      }).catch(() => {});
    }
    if (worker) await terminateCompanion(worker.child);
    for (const [pid, expected] of envelope.processes) {
      if (pid === desktop?.ready.pid || pid === desktop?.ready.appServerPid) continue;
      await waitForLiveCondition(async () => !await readProcessIdentity(pid), 5000).catch(async () => {
        const actual = await readProcessIdentity(pid);
        if (actual?.startedAt === expected.startedAt && actual.command === expected.command) {
          process.kill(pid, "SIGTERM");
          await waitForLiveCondition(async () => !await readProcessIdentity(pid), 3000);
        }
      });
    }
    const cleanup = await desktop?.close();
    if (cleanup) assert.equal(cleanup.status, "pass", JSON.stringify(cleanup));
    await envelope.cleanup();
  }
  try {
    await fs.mkdir(project);
    await fs.mkdir(home, { mode: 0o700 });
    await Promise.all(["src", "vendor", "assets", "bin"].map((name) => (
      fs.cp(path.join(PROJECT_ROOT, name), path.join(project, name), { recursive: true })
    )));
    const { resolvePaths } = await import(pathToFileURL(path.join(project, "src", "paths.mjs")));
    paths = resolvePaths({ ...process.env, CODEXCTL_HOME: home });
    const config = createDefaultConfig();
    config.modules.wallpaper = true;
    await fs.writeFile(paths.configFile, JSON.stringify(config), { mode: 0o600 });
    desktop = await launchElectronFixture({ envelope, deadlineMs: 240_000 });
    const app = await readProcessIdentity(desktop.ready.pid);
    Object.assign(bootstrap, {
      cliSocketPath: liveSocketPath(paths, bootstrap.sessionId),
      companionLogFile: paths.liveCompanionLogFile, controllerHome: home,
      createdAt: new Date().toISOString(), debugPort: envelope.port,
      desktop: { bundle: null, executable: app.executable, identity: `fixture:${envelope.runId}` },
      hostRevision: await liveCodeRevision(paths),
      hostSocketPath: liveHostSocketPath(paths, bootstrap.sessionId),
      schema: "codexctl-live-bootstrap/1", transport: "cdp",
    });
    await writeLiveBootstrap(paths, bootstrap);
    worker = await spawnCompanion(paths, liveBootstrapFile(paths, bootstrap.sessionId), process.env);
    assert.equal(validateWorkerEvent(await worker.next(), bootstrap.sessionId).phase, "ready");
    worker.launch({ appPid: app.pid, debugPort: envelope.port, sessionId: bootstrap.sessionId });
    assert.equal(validateWorkerEvent(await worker.next(), bootstrap.sessionId).phase, "paired");
    await current();
    return {
      app, call, close, current, envelope, home, paths, project,
      async bootstrap() {
        return readLiveBootstrap(liveBootstrapFile(paths, (await current()).sessionId));
      },
      async cli(...args) {
        return execFileAsync(process.execPath, [path.join(project, "bin", "codexctl.mjs"), ...args], {
          env: { ...process.env, CODEXCTL_HOME: home }, timeout: 40_000,
        });
      },
      async evaluate(expression) {
        const results = await withRendererSessions(envelope.port, (session) => session.evaluate(expression));
        assert.equal(results.length, 1);
        return results[0].value;
      },
      async assertSameApp() {
        assert.deepEqual(await readProcessIdentity(app.pid), app);
        assert.equal((await current()).app.pid, app.pid);
      },
    };
  } catch (error) {
    const log = paths ? await fs.readFile(paths.liveCompanionLogFile, "utf8").catch(() => "") : "";
    await close();
    throw new Error(`${error.message}\n${log.slice(-4000)}`);
  }
}
