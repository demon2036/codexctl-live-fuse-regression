import { spawn } from "node:child_process";
import { openPrivateLog } from "./logs.mjs";
import { sanitizedBaseEnvironment } from "./relay.mjs";

export function validateWorkerEvent(value, sessionId) {
  if (!value || value.schema !== "codexctl-live-worker-event/1"
    || value.sessionId !== undefined && value.sessionId !== sessionId
    || !["booted", "ready", "paired", "error"].includes(value.phase)) {
    throw new Error("live companion worker event is invalid");
  }
  if (value.phase === "error") throw new Error(value.message || "live companion failed");
  return value;
}

export async function spawnCompanion(paths, bootstrapFile, env, checkpoint = null) {
  const log = await openPrivateLog(paths.liveCompanionLogFile);
  let child;
  try {
    child = spawn(process.execPath, [paths.liveCompanionWorker], {
      detached: true,
      env: {
        ...sanitizedBaseEnvironment(env),
        CODEXCTL_HOME: paths.home,
        CODEXCTL_LIVE_BOOTSTRAP: bootstrapFile,
      },
      stdio: ["ignore", log.fd, log.fd, "ipc"],
    });
    child.unref();
  } finally { await log.close(); }
  const events = [];
  const waiters = [];
  let failure = null;
  const fail = (error) => {
    failure = error;
    for (const waiter of waiters.splice(0)) waiter.reject(error);
  };
  child.on("message", (value) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(value);
    else events.push(value);
  });
  child.once("exit", (code, signal) => fail(
    new Error(`live companion exited before pairing (${code ?? signal})`),
  ));
  child.once("error", fail);
  const worker = {
    child,
    launch({ appPid, debugPort, sessionId }) {
      if (!child.connected) throw new Error("live companion IPC closed before App binding");
      child.send({ appPid, debugPort, schema: "codexctl-live-worker-launch/1", sessionId });
    },
    next(timeoutMs = 30_000) {
      if (events.length) return Promise.resolve(events.shift());
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve(value) { clearTimeout(timer); resolve(value); },
          reject(error) { clearTimeout(timer); reject(error); },
        };
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("live companion startup timed out"));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
  try {
    const booted = validateWorkerEvent(await worker.next(), undefined);
    if (booted.phase !== "booted") throw new Error("live companion did not request preparation");
    child.send({ checkpoint, schema: "codexctl-live-worker-prepare/1" });
    return worker;
  } catch (error) {
    await terminateCompanion(child);
    throw error;
  }
}

export async function terminateCompanion(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  let timer;
  try {
    const deadline = new Promise((resolve) => { timer = setTimeout(resolve, 3000, "timeout"); });
    if (await Promise.race([exited, deadline]) === "timeout" && child.exitCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  } finally { clearTimeout(timer); }
}
