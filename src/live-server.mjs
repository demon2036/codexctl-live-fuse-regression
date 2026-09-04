import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createLiveFrameDecoder,
  createLiveResponse,
  encodeLiveFrame,
  validateLiveRequest,
} from "./live-protocol.mjs";
import { ensureLivePrivateDirectory } from "./live-private-files.mjs";

function sameToken(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ownedSocket(filename, identity) {
  try {
    const stat = await fs.lstat(filename);
    return stat.isSocket() && stat.dev === identity.dev && stat.ino === identity.ino;
  } catch {
    return false;
  }
}

async function reclaimStaleSocket(filename) {
  let before;
  try { before = await fs.lstat(filename); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const uid = typeof process.getuid === "function" ? process.getuid() : before.uid;
  if (!before.isSocket() || before.isSymbolicLink() || before.uid !== uid
    || (process.platform !== "win32" && (before.mode & 0o777) !== 0o600)) {
    throw new Error(`live socket path is foreign: ${filename}`);
  }
  const identity = { dev: before.dev, ino: before.ino };
  const activity = await new Promise((resolve) => {
    const socket = net.connect(filename);
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    timer = setTimeout(() => finish("unknown"), 250);
    socket.once("connect", () => finish("active"));
    socket.once("error", (error) => finish(
      ["ECONNREFUSED", "ENOENT"].includes(error.code) ? "stale" : "unknown",
    ));
  });
  if (activity !== "stale") throw new Error(`live socket already exists: ${filename}`);
  if (await ownedSocket(filename, identity)) await fs.unlink(filename);
}

export async function startLiveServer({ authToken, dispatch, sessionId, socketPath }) {
  if (!path.isAbsolute(socketPath) || Buffer.byteLength(socketPath) > 96
    || typeof dispatch !== "function") {
    throw new TypeError("live server requires an absolute socket and dispatcher");
  }
  await ensureLivePrivateDirectory(path.dirname(socketPath));
  await reclaimStaleSocket(socketPath);
  const clients = new Set();
  const server = net.createServer((client) => {
    clients.add(client);
    client.once("close", () => clients.delete(client));
    const send = (value) => {
      if (!client.destroyed) client.write(encodeLiveFrame(value));
    };
    const decoder = createLiveFrameDecoder((raw) => {
      let request;
      try {
        request = validateLiveRequest(raw);
        if (request.sessionId !== sessionId || !sameToken(request.authToken, authToken)) {
          const error = new Error("live session authentication failed");
          error.code = "unauthorized";
          throw error;
        }
      } catch (error) {
        const requestId = typeof raw?.requestId === "string"
          ? raw.requestId : "00000000-0000-4000-8000-000000000000";
        try { send(createLiveResponse(requestId, { error })); } catch {}
        client.end();
        return;
      }
      Promise.resolve(dispatch(request)).then(
        (result) => send(createLiveResponse(request.requestId, { result })),
        (error) => send(createLiveResponse(request.requestId, { error })),
      );
    });
    client.on("data", (chunk) => {
      try { decoder(chunk); }
      catch { client.destroy(); }
    });
    client.on("error", () => {});
  });
  server.on("error", () => {});
  let identity = null;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    const before = await fs.lstat(socketPath);
    if (!before.isSocket()) throw new Error("live socket path is not a socket");
    identity = { dev: before.dev, ino: before.ino };
    await fs.chmod(socketPath, 0o600);
    if (!await ownedSocket(socketPath, identity)) {
      throw new Error("live socket identity changed during setup");
    }
  } catch (error) {
    for (const client of clients) client.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    if (identity && await ownedSocket(socketPath, identity)) {
      await fs.unlink(socketPath).catch(() => {});
    }
    throw error;
  }
  let closed = false;
  return {
    server,
    socketPath,
    async close() {
      if (closed) return;
      closed = true;
      for (const client of clients) client.destroy();
      let foreign = null;
      if (!await ownedSocket(socketPath, identity)) {
        try {
          await fs.lstat(socketPath);
          foreign = `${socketPath}.foreign-${randomUUID()}`;
          await fs.rename(socketPath, foreign);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      await new Promise((resolve) => server.close(resolve));
      if (await ownedSocket(socketPath, identity)) await fs.unlink(socketPath);
      if (foreign) {
        try { await fs.lstat(socketPath); throw new Error("live socket path changed during close"); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        await fs.rename(foreign, socketPath);
      }
    },
  };
}
