import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function readPs(args, maximum = 2 * 1024 * 1024) {
  const { stdout } = await execFileAsync("/bin/ps", args, {
    timeout: 5000,
    maxBuffer: maximum,
    // `lstart` is a persistent PID identity. A fixed locale keeps it stable
    // across GUI and terminal launches on both supported platforms.
    env: { ...process.env, LANG: "C", LC_ALL: "C" },
  });
  return stdout;
}

export function parseProcessRows(output) {
  return output.split("\n").flatMap((line) => {
    const parsed = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/,
    );
    if (!parsed) return [];
    return [{
      pid: Number(parsed[1]),
      ppid: Number(parsed[2]),
      startedAt: parsed[3],
      command: parsed[4],
    }];
  });
}

export async function listProcessRows() {
  return parseProcessRows(await readPs(["-axo", "pid=,ppid=,lstart=,command="]));
}

export async function readProcessRow(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return null;
  let output;
  try {
    output = await readPs([
      "-p", String(pid), "-o", "pid=,ppid=,lstart=,command=",
    ], 256 * 1024);
  } catch (error) {
    if (error.code === 1) return null;
    throw error;
  }
  return parseProcessRows(output).find((row) => row.pid === pid) ?? null;
}

export function descendantProcessRows(rows, rootPid) {
  const childrenByParent = new Map();
  for (const row of rows) {
    const children = childrenByParent.get(row.ppid) ?? [];
    children.push(row);
    childrenByParent.set(row.ppid, children);
  }
  const descendants = [];
  const pending = [rootPid];
  const visited = new Set(pending);
  while (pending.length) {
    const parentPid = pending.shift();
    for (const child of childrenByParent.get(parentPid) ?? []) {
      if (visited.has(child.pid)) continue;
      visited.add(child.pid);
      descendants.push(child);
      pending.push(child.pid);
    }
  }
  return descendants;
}

export async function processStartToken(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return "";
  try { return (await readProcessRow(pid))?.startedAt ?? ""; }
  catch { return ""; }
}

export async function processCommand(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return "";
  try { return (await readProcessRow(pid))?.command ?? ""; }
  catch { return ""; }
}

export function processIdentityKey(processInfo) {
  return `${processInfo.pid}:${processInfo.startedAt}`;
}
