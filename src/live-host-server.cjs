"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { randomUUID, timingSafeEqual } = require("node:crypto");

const FRAME_MAX_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{24}$/;
const OPERATIONS = new Set([
  "recovery.clear", "recovery.set", "slot.diagnostics", "slot.mount", "slot.unmount",
  "status", "ui.status",
]);

function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function sameToken(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function frame(value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.length > FRAME_MAX_BYTES) throw new Error("live host frame exceeds size limit");
  return bytes;
}

function decoder(onValue) {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (true) {
      const newline = buffered.indexOf(0x0a);
      if (newline < 0) break;
      if (newline + 1 > FRAME_MAX_BYTES) throw new Error("live host frame exceeds size limit");
      const current = buffered.subarray(0, newline);
      buffered = buffered.subarray(newline + 1);
      if (!current.length) continue;
      onValue(JSON.parse(current.toString("utf8")));
    }
    if (buffered.length >= FRAME_MAX_BYTES) throw new Error("live host frame exceeds size limit");
  };
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let stat = fs.lstatSync(directory);
  const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid) {
    throw new Error("live host directory is not owned by the current user");
  }
  fs.chmodSync(directory, 0o700);
  stat = fs.lstatSync(directory);
  if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o700) {
    throw new Error("live host directory is not private");
  }
}

function validateHello(value, options) {
  if (!exact(value, ["authToken", "hostRevision", "schema", "sessionId"])
    || value.schema !== "codexctl-live-host-hello/1" || !TOKEN.test(String(value.authToken ?? ""))
    || !UUID.test(String(value.sessionId ?? "")) || !REVISION.test(String(value.hostRevision ?? ""))
    || value.sessionId !== options.sessionId || value.hostRevision !== options.hostRevision
    || !sameToken(value.authToken, options.authToken)) {
    throw new Error("live host authentication failed");
  }
}

function validateRequest(value, sessionId) {
  if (!exact(value, ["operation", "params", "requestId", "schema", "sessionId"])
    || value.schema !== "codexctl-live-host-request/1" || value.sessionId !== sessionId
    || !UUID.test(String(value.requestId ?? "")) || !OPERATIONS.has(value.operation)
    || !value.params || typeof value.params !== "object" || Array.isArray(value.params)) {
    throw new Error("live host request is invalid");
  }
  return value;
}

function response(requestId, result, error = null) {
  const failure = error ? {
    code: String(error.code ?? "host-operation-failed").slice(0, 80),
    message: String(error.message ?? error).slice(0, 600),
  } : null;
  return {
    error: failure,
    ok: failure === null,
    requestId,
    result: failure ? null : result ?? null,
    schema: "codexctl-live-host-response/1",
  };
}

async function dispatch(controller, request) {
  const { operation, params } = request;
  if (operation === "status") {
    if (!exact(params, [])) throw new Error("host status accepts no params");
    return controller.status();
  }
  if (operation === "slot.mount") {
    if (!exact(params, ["artifact", "slotId"])) throw new Error("host mount params are invalid");
    return controller.mount(params.slotId, params.artifact);
  }
  if (operation === "ui.status") {
    if (!exact(params, ["status"])) throw new Error("host UI status params are invalid");
    return controller.setUiStatus(params.status);
  }
  if (operation === "slot.unmount" || operation === "slot.diagnostics"
    || operation === "recovery.clear") {
    if (!exact(params, ["slotId"])) throw new Error(`${operation} params are invalid`);
    if (operation === "slot.unmount") return controller.unmount(params.slotId);
    if (operation === "slot.diagnostics") return controller.diagnostics(params.slotId);
    return controller.clearRecovery(params.slotId);
  }
  if (!exact(params, ["artifact", "slotId"]) || !(params.artifact === null
    || typeof params.artifact === "object" && !Array.isArray(params.artifact))) {
    throw new Error("recovery.set params are invalid");
  }
  return controller.setRecovery(params.slotId, params.artifact);
}

async function startLiveHostServer(options) {
  const { authToken, controller, electron, hostRevision, sessionId, socketPath } = options;
  if (!path.isAbsolute(socketPath) || Buffer.byteLength(socketPath) > 96) {
    throw new Error("live host socket path is invalid");
  }
  privateDirectory(path.dirname(socketPath));
  if (fs.existsSync(socketPath)) throw new Error("live host socket already exists");
  let active = null;
  let activeSend = null;
  let closing = false;
  const clients = new Set();
  controller.setActionHandler((action) => {
    if (!activeSend) return false;
    activeSend({ action, event: "ui.action", schema: "codexctl-live-host-event/1" });
    return true;
  });
  const server = net.createServer((socket) => {
    clients.add(socket);
    let authenticated = false;
    const send = (value) => { if (!socket.destroyed) socket.write(frame(value)); };
    const decode = decoder((value) => {
      if (!authenticated) {
        try {
          if (active && active !== socket) throw new Error("live host already has a companion");
          validateHello(value, options);
          authenticated = true;
          active = socket;
          activeSend = send;
          send({
            hostRevision,
            pid: process.pid,
            schema: "codexctl-live-host-welcome/1",
            sessionId,
          });
        } catch { socket.destroy(); }
        return;
      }
      let request;
      try { request = validateRequest(value, sessionId); }
      catch { socket.destroy(); return; }
      Promise.resolve(dispatch(controller, request)).then(
        (result) => send(response(request.requestId, result)),
        (error) => send(response(request.requestId, null, error)),
      );
    });
    socket.on("data", (chunk) => { try { decode(chunk); } catch { socket.destroy(); } });
    socket.on("error", () => {});
    socket.once("close", () => {
      clients.delete(socket);
      if (active !== socket) return;
      active = null;
      activeSend = null;
      if (!closing) void controller.setConnected(false).then(
        () => controller.recover(), () => controller.recover(),
      ).catch(() => {});
    });
  });
  server.on("error", () => {});
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    fs.chmodSync(socketPath, 0o600);
    const socket = fs.lstatSync(socketPath);
    const uid = typeof process.getuid === "function" ? process.getuid() : socket.uid;
    if (!socket.isSocket() || socket.uid !== uid
      || (process.platform !== "win32" && (socket.mode & 0o777) !== 0o600)) {
      throw new Error("live host socket is not private");
    }
  } catch (error) {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    throw error;
  }
  const identity = fs.lstatSync(socketPath);
  const ownedSocket = () => {
    try {
      const current = fs.lstatSync(socketPath);
      return current.isSocket() && current.dev === identity.dev && current.ino === identity.ino;
    } catch { return false; }
  };
  const close = async () => {
    if (closing) return;
    closing = true;
    controller.setActionHandler(null);
    for (const client of clients) client.destroy();
    let foreign = null;
    if (!ownedSocket()) {
      try {
        fs.lstatSync(socketPath);
        foreign = `${socketPath}.foreign-${randomUUID()}`;
        fs.renameSync(socketPath, foreign);
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    await new Promise((resolve) => server.close(resolve));
    if (ownedSocket()) fs.unlinkSync(socketPath);
    if (foreign) {
      if (fs.existsSync(socketPath)) throw new Error("live host socket changed during close");
      fs.renameSync(foreign, socketPath);
    }
    await controller.close();
  };
  electron.app.once("before-quit", () => { void close(); });
  return { close, controller, server, socketPath };
}

module.exports = { FRAME_MAX_BYTES, startLiveHostServer };
