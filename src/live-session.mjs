import fs from "node:fs/promises";
import path from "node:path";
import { readProcessIdentity } from "./desktop-processes.mjs";
import { assertLivePrivateFile, ensureLivePrivateDirectory } from "./live-private-files.mjs";
import { writeTextAtomic } from "./util.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{24}$/;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value, keys) {
  return record(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function processIdentity(value, label) {
  if (!exact(value, ["command", "executable", "pid", "startedAt"])
    || !Number.isSafeInteger(value.pid) || value.pid < 2
    || !path.isAbsolute(value.executable)
    || typeof value.command !== "string" || value.command.length < 1 || value.command.length > 8192
    || typeof value.startedAt !== "string" || value.startedAt.length < 1) {
    throw new Error(`${label} process identity is invalid`);
  }
  return { ...value };
}

export function validateLiveSession(value) {
  if (!exact(value, [
    "app", "authToken", "companion", "createdAt", "desktopIdentity", "hostRevision",
    "schema", "sessionId", "socketPath", "uid",
  ]) || value.schema !== "codexctl-live-session/2"
    || !UUID.test(String(value.sessionId ?? "")) || !TOKEN.test(String(value.authToken ?? ""))
    || !REVISION.test(String(value.hostRevision ?? ""))
    || !path.isAbsolute(String(value.socketPath ?? ""))
    || Number.isNaN(Date.parse(value.createdAt))
    || !Number.isSafeInteger(value.uid) || value.uid < 0
    || (typeof process.getuid === "function" && value.uid !== process.getuid())
    || typeof value.desktopIdentity !== "string" || value.desktopIdentity.length < 1
    || value.desktopIdentity.length > 4096) {
    throw new Error("live session record is invalid");
  }
  return {
    ...value,
    app: processIdentity(value.app, "app"),
    companion: processIdentity(value.companion, "companion"),
  };
}

export function liveSessionFile(paths, sessionId) {
  if (!UUID.test(String(sessionId ?? ""))) throw new Error("live session id is invalid");
  return path.join(paths.liveSessionsDir, `${sessionId}.json`);
}

export function liveSocketPath(paths, sessionId) {
  if (!UUID.test(String(sessionId ?? ""))) throw new Error("live session id is invalid");
  return path.join(paths.liveSocketDir, `${sessionId}.sock`);
}

export function liveHostSocketPath(paths, sessionId) {
  if (!UUID.test(String(sessionId ?? ""))) throw new Error("live session id is invalid");
  return path.join(paths.liveSocketDir, `${sessionId}.host.sock`);
}

export async function writeLiveSession(paths, value) {
  const session = validateLiveSession(value);
  await ensureLivePrivateDirectory(paths.liveSessionsDir);
  const filename = liveSessionFile(paths, session.sessionId);
  try {
    await fs.lstat(filename);
    throw new Error(`live session already exists: ${session.sessionId}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeTextAtomic(filename, `${JSON.stringify(session)}\n`, 0o600);
  await assertLivePrivateFile(filename);
  return { ...session, filename };
}

async function stableSessionFile(filename) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const handle = await fs.open(filename, flags);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 2 || before.size > 64 * 1024) {
      throw new Error("live session file is invalid");
    }
    const expectedUid = typeof process.getuid === "function" ? process.getuid() : before.uid;
    if (before.uid !== expectedUid
      || (process.platform !== "win32" && (before.mode & 0o777) !== 0o600)) {
      throw new Error("live session file is not private");
    }
    const text = await handle.readFile("utf8");
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || Buffer.byteLength(text) !== after.size) {
      throw new Error("live session changed while being read");
    }
    return validateLiveSession(JSON.parse(text));
  } finally {
    await handle.close();
  }
}

function sameProcess(current, expected) {
  return current?.pid === expected.pid && current.startedAt === expected.startedAt
    && current.command === expected.command && current.executable === expected.executable;
}

export async function inspectLiveSession(paths, sessionId, { readProcess = readProcessIdentity } = {}) {
  const filename = liveSessionFile(paths, sessionId);
  const session = await stableSessionFile(filename);
  const [app, companion] = await Promise.all([
    readProcess(session.app.pid),
    readProcess(session.companion.pid),
  ]);
  return {
    filename,
    live: session.uid === (typeof process.getuid === "function" ? process.getuid() : session.uid)
      && sameProcess(app, session.app) && sameProcess(companion, session.companion),
    processes: {
      app: sameProcess(app, session.app),
      companion: sameProcess(companion, session.companion),
    },
    session,
  };
}

export async function removeLiveSession(paths, sessionId, expected = {}) {
  const filename = liveSessionFile(paths, sessionId);
  let session;
  try { session = await stableSessionFile(filename); }
  catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (expected.authToken && session.authToken !== expected.authToken) {
    throw new Error("live session auth identity changed");
  }
  if (expected.companionPid && session.companion.pid !== expected.companionPid) {
    throw new Error("live session companion identity changed");
  }
  const before = await fs.lstat(filename);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("live session path is foreign");
  const current = await fs.lstat(filename);
  if (current.dev !== before.dev || current.ino !== before.ino) {
    throw new Error("live session path changed before cleanup");
  }
  await fs.unlink(filename);
  return true;
}
