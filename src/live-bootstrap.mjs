import fs from "node:fs/promises";
import path from "node:path";
import { assertLivePrivateFile, ensureLivePrivateDirectory } from "./live-private-files.mjs";
import { liveRevision } from "./live-diagnostics.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value, keys) {
  return record(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function absolute(value, label, maximum = 4096) {
  const filename = String(value ?? "");
  if (!path.isAbsolute(filename) || filename.length > maximum || filename.includes("\0")) {
    throw new Error(`${label} must be a bounded absolute path`);
  }
  return path.normalize(filename);
}

export function validateLiveBootstrap(value) {
  if (!exact(value, [
    "authToken", "cliSocketPath", "companionLogFile", "controllerHome", "createdAt",
    "desktop", "hostRevision", "hostSocketPath", "schema", "sessionId",
  ]) || value.schema !== "codexctl-live-bootstrap/1"
    || !TOKEN.test(String(value.authToken ?? "")) || !UUID.test(String(value.sessionId ?? ""))
    || Number.isNaN(Date.parse(value.createdAt))
    || !exact(value.desktop, ["bundle", "executable", "identity"])) {
    throw new Error("live bootstrap is invalid");
  }
  const desktop = {
    bundle: value.desktop.bundle === null ? null : absolute(value.desktop.bundle, "desktop bundle"),
    executable: absolute(value.desktop.executable, "desktop executable"),
    identity: String(value.desktop.identity ?? ""),
  };
  if (!desktop.identity || desktop.identity.length > 4096) {
    throw new Error("desktop identity is invalid");
  }
  const bootstrap = {
    ...value,
    cliSocketPath: absolute(value.cliSocketPath, "CLI socket", 96),
    companionLogFile: absolute(value.companionLogFile, "companion log"),
    controllerHome: absolute(value.controllerHome, "controller home"),
    desktop,
    hostRevision: liveRevision(value.hostRevision, "host revision"),
    hostSocketPath: absolute(value.hostSocketPath, "host socket", 96),
  };
  if (bootstrap.cliSocketPath === bootstrap.hostSocketPath) {
    throw new Error("live sockets must be distinct");
  }
  return bootstrap;
}

export function liveBootstrapFile(paths, sessionId) {
  if (!UUID.test(String(sessionId ?? ""))) throw new Error("live session id is invalid");
  return path.join(paths.liveBootstrapsDir, `${sessionId}.json`);
}

export async function writeLiveBootstrap(paths, value) {
  const bootstrap = validateLiveBootstrap(value);
  await ensureLivePrivateDirectory(paths.liveBootstrapsDir);
  const filename = liveBootstrapFile(paths, bootstrap.sessionId);
  const handle = await fs.open(filename, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(bootstrap)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertLivePrivateFile(filename);
  return { ...bootstrap, filename };
}

export async function readLiveBootstrap(filename) {
  const handle = await fs.open(absolute(filename, "bootstrap file"),
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 2 || before.size > 64 * 1024) {
      throw new Error("live bootstrap file is invalid");
    }
    const expectedUid = typeof process.getuid === "function" ? process.getuid() : before.uid;
    if (before.uid !== expectedUid
      || (process.platform !== "win32" && (before.mode & 0o777) !== 0o600)) {
      throw new Error("live bootstrap file is not private");
    }
    const text = await handle.readFile("utf8");
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || Buffer.byteLength(text) !== after.size) {
      throw new Error("live bootstrap changed while being read");
    }
    return validateLiveBootstrap(JSON.parse(text));
  } finally {
    await handle.close();
  }
}

export async function removeLiveBootstrap(paths, sessionId, authToken) {
  const filename = liveBootstrapFile(paths, sessionId);
  let current;
  try { current = await readLiveBootstrap(filename); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (current.authToken !== authToken) throw new Error("live bootstrap identity changed");
  await fs.unlink(filename);
  return true;
}
