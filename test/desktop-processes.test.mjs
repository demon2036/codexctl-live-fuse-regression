import test from "node:test";
import assert from "node:assert/strict";
import {
  descendantProcessRows,
  detachedDesktopHelperRows,
} from "../src/desktop-processes.mjs";

function row(pid, ppid, command, startedAt = `start-${pid}`) {
  return { pid, ppid, command, startedAt };
}

test("descendantProcessRows returns only the complete selected process tree", () => {
  const rows = [
    row(10, 1, "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT"),
    row(11, 10, "renderer"),
    row(12, 10, "codex app-server"),
    row(13, 12, "node_repl"),
    row(20, 1, "unrelated"),
    row(21, 20, "unrelated child"),
  ];

  assert.deepEqual(
    descendantProcessRows(rows, 10).map(({ pid }) => pid),
    [11, 12, 13],
  );
});

test("detachedDesktopHelperRows finds orphan monitors beside a live App", () => {
  const bundle = "/Applications/ChatGPT.app";
  const main = `${bundle}/Contents/MacOS/ChatGPT`;
  const monitor = `${bundle}/Contents/Resources/native/bare-modifier-monitor --key DoubleCommand`;
  const crashpad = `${bundle}/Contents/Frameworks/Codex Framework.framework/Helpers/`
    + "browser_crashpad_handler --monitor-self";
  const desktop = { bundle, executable: main };
  const rows = [
    row(100, 1, main),
    row(101, 100, monitor),
    row(102, 1, monitor, "old-monitor"),
    row(103, 1, crashpad),
  ];

  assert.deepEqual(
    detachedDesktopHelperRows(rows, desktop).map(({ pid }) => pid),
    [102],
  );
});

test("detachedDesktopHelperRows reclaims crash handlers only without a main App", () => {
  const bundle = "/Applications/ChatGPT.app";
  const crashpad = `${bundle}/Contents/Frameworks/Codex Framework.framework/Helpers/`
    + "browser_crashpad_handler --monitor-self";
  const desktop = { bundle, executable: `${bundle}/Contents/MacOS/ChatGPT` };

  assert.deepEqual(
    detachedDesktopHelperRows([row(103, 1, crashpad)], desktop).map(({ pid }) => pid),
    [103],
  );
});
