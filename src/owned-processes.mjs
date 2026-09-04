import { listProcessRows } from "./desktop-processes.mjs";

function nodeScriptCommand(command, script) {
  const source = String(command);
  return source.includes(script) && /(?:^|\s)(?:node|[^\s]*\/node)(?:\s|$)/.test(source);
}

export function classifyOwnedWorker(command, paths) {
  const source = String(command);
  if (nodeScriptCommand(source, paths.supervisorWorker)
    && source.includes(paths.home)) return "supervisor";
  if (nodeScriptCommand(source, paths.autoInjectWorker)
    && source.includes(paths.home)) return "autoInject";
  if (nodeScriptCommand(source, paths.promptInjector)
    && source.includes(paths.runtimeGenerationsDir)) return "promptContext";
  if (nodeScriptCommand(source, paths.wallpaperInjector)
    && source.includes(paths.runtimeGenerationsDir)) return "wallpaper";
  return null;
}

export async function listOwnedWorkers(paths) {
  return (await listProcessRows()).flatMap((row) => {
    if (row.pid === process.pid) return [];
    const kind = classifyOwnedWorker(row.command, paths);
    return kind ? [{ ...row, kind }] : [];
  });
}

function matchingRecords(records, rows) {
  const current = new Map(rows.map((row) => [row.pid, row]));
  return records.filter((record) => {
    const row = current.get(record.pid);
    return row?.command === record.command && row.startedAt === record.startedAt;
  });
}

async function waitGone(records, timeoutMs) {
  if (!records.length) return [];
  let remaining = records;
  const deadline = Date.now() + timeoutMs;
  while (remaining.length && Date.now() < deadline) {
    remaining = matchingRecords(remaining, await listProcessRows());
    if (!remaining.length) break;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return matchingRecords(remaining, await listProcessRows());
}

function signal(records, name) {
  for (const record of records) {
    try {
      process.kill(record.pid, name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

export async function terminateOwnedWorkers(paths, { forceAfterMs = 4000 } = {}) {
  const snapshot = await listOwnedWorkers(paths);
  const verified = matchingRecords(snapshot, await listProcessRows());
  signal(verified, "SIGTERM");
  const forced = await waitGone(verified, forceAfterMs);
  signal(forced, "SIGKILL");
  await waitGone(forced, 1200);
  const forcedPids = new Set(forced.map((record) => record.pid));
  return verified.map((record) => ({
    kind: record.kind,
    pid: record.pid,
    forced: forcedPids.has(record.pid),
  }));
}
