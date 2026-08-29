import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_THREAD_COUNT = 36;
const FIXTURE_DEADLINE_MS = 45_000;
const REQUEST_BATCH_SIZE = 2;

function assertThreadCount(threadCount) {
  if (!Number.isSafeInteger(threadCount) || threadCount < 2 || threadCount > 100) {
    throw new RangeError("threadCount must be between 2 and 100");
  }
}

function assertInputs({ cli, codexHome, cwd, threadCount }) {
  for (const [name, value] of Object.entries({ cli, codexHome, cwd })) {
    if (!path.isAbsolute(value ?? "")) throw new Error(`${name} must be an absolute fixture path`);
  }
  assertThreadCount(threadCount);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timer = setTimeout(() => reject(new Error("fixture app-server exit deadline")), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function createLineClient(child, deadlineAt) {
  let buffer = "";
  let sequence = 0;
  const events = [];
  const pending = new Map();
  const waiters = new Set();
  const rejectPending = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    waiters.clear();
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (typeof message.method === "string") {
        events.push(message);
        if (events.length > 256) events.shift();
        for (const waiter of [...waiters]) {
          if (message.method !== waiter.method || !waiter.predicate(message)) continue;
          waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        }
      }
      const entry = pending.get(message.id);
      if (!entry) continue;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(`fixture RPC ${entry.method} failed`));
      else entry.resolve(message.result);
    }
  });
  child.once("error", rejectPending);
  child.once("exit", (code) => rejectPending(
    new Error(`fixture app-server exited before completion: ${code}`),
  ));
  const write = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  return {
    notify(method, params = {}) { write({ method, params }); },
    request(method, params = {}) {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) return Promise.reject(new Error("fixture RPC deadline"));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`fixture RPC ${method} deadline`));
        }, Math.min(10_000, remaining));
        pending.set(id, { method, reject, resolve, timer });
        write({ id, method, params });
      });
    },
    waitForEvent(method, predicate) {
      const found = events.find((message) => message.method === method && predicate(message));
      if (found) return Promise.resolve(found);
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) return Promise.reject(new Error(`fixture event ${method} deadline`));
      return new Promise((resolve, reject) => {
        const waiter = { method, predicate, reject, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`fixture event ${method} deadline`));
        }, Math.min(10_000, remaining));
        waiters.add(waiter);
      });
    },
  };
}

export async function seedThreadCatalog({
  cwd, request, threadCount = DEFAULT_THREAD_COUNT, waitForEvent,
} = {}) {
  if (!path.isAbsolute(cwd ?? "")) throw new Error("cwd must be an absolute fixture path");
  if (typeof request !== "function") throw new TypeError("request must be a function");
  if (typeof waitForEvent !== "function") throw new TypeError("waitForEvent must be a function");
  assertThreadCount(threadCount);
  const indexes = Array.from({ length: threadCount }, (_, index) => index);
  const batched = async (values, operation) => {
    const output = [];
    for (let offset = 0; offset < values.length; offset += REQUEST_BATCH_SIZE) {
      output.push(...await Promise.all(
        values.slice(offset, offset + REQUEST_BATCH_SIZE)
          .map((value, index) => operation(value, offset + index)),
      ));
    }
    return output;
  };
  const ids = await batched(indexes, async (index) => {
    const started = await request("thread/start", {
      cwd, ephemeral: false, threadSource: "user",
    });
    const threadId = started?.thread?.id;
    if (typeof threadId !== "string" || threadId.length < 8) {
      throw new Error("fixture thread/start returned no thread id");
    }
    const turn = await request("turn/start", {
      approvalPolicy: "never",
      input: [{ text: `Regression session ${String(index + 1).padStart(2, "0")}`, type: "text" }],
      threadId,
    });
    const turnId = turn?.turn?.id;
    if (typeof turnId !== "string" || turnId.length < 8) {
      throw new Error("fixture turn/start returned no turn id");
    }
    await waitForEvent("item/completed", ({ params }) => (
      params?.threadId === threadId && params?.turnId === turnId
      && params?.item?.type === "userMessage"
    ));
    await request("turn/interrupt", { threadId, turnId }).catch(() => null);
    return threadId;
  });
  const listed = await request("thread/list", { limit: threadCount });
  const listedRows = listed?.data ?? [];
  const listedIds = new Set(listedRows.map(({ id }) => id));
  const targetIds = new Set(ids);
  if (ids.some((id) => !listedIds.has(id))) {
    const persisted = ids.filter((id) => listedIds.has(id)).length;
    throw new Error(
      `fixture thread catalog was not persisted: expected=${ids.length}, persisted=${persisted}`,
    );
  }
  if (listedRows.filter(({ id }) => targetIds.has(id))
    .some(({ status }) => status?.type !== "idle")) {
    throw new Error("fixture thread catalog did not become idle");
  }
  return ids;
}

export async function seedIsolatedCodexProfile({
  cli,
  codexHome,
  cwd,
  env,
  spawnImpl = spawn,
  threadCount = DEFAULT_THREAD_COUNT,
} = {}) {
  assertInputs({ cli, codexHome, cwd, threadCount });
  const child = spawnImpl(cli, ["app-server", "--stdio"], {
    env: { ...env, CODEX_HOME: codexHome },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const deadlineAt = Date.now() + FIXTURE_DEADLINE_MS;
  const client = createLineClient(child, deadlineAt);
  try {
    await client.request("initialize", {
      clientInfo: { name: "codexctl-regression", title: "codexctl regression", version: "1" },
    });
    client.notify("initialized");
    const ids = await seedThreadCatalog({
      cwd, request: client.request, threadCount, waitForEvent: client.waitForEvent,
    });
    child.stdin.end();
    const code = await waitForExit(child, 5000);
    if (code !== 0) throw new Error(`fixture app-server exited ${code}`);
    return { status: "pass", threadCount: ids.length };
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    await waitForExit(child, 2000).catch(() => child.kill("SIGKILL"));
    throw error;
  }
}

export { DEFAULT_THREAD_COUNT };
