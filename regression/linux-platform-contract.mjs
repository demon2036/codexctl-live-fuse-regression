import path from "node:path";
import { verifiedRendererDebuggerUrl } from "../src/renderer-injection.mjs";

const PACKAGE_NAMES = new Set(["chatgpt", "codex", "codex-desktop", "ChatGPT", "Codex"]);

export function evaluateLinuxPlatformContract({
  endpointHost,
  executable,
  launcherName,
  port,
  socketClosed,
  target,
  persistentStateChanged = false,
} = {}) {
  const failures = [];
  const push = (condition, code) => { if (condition) failures.push(code); };
  push(!PACKAGE_NAMES.has(launcherName), "package-name");
  push(!path.isAbsolute(executable ?? "")
    || !new Set(["ChatGPT", "Codex", "chatgpt", "codex-desktop"])
      .has(path.basename(executable ?? "")), "package-executable");
  push(!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(endpointHost),
    "non-loopback-endpoint");
  push(!verifiedRendererDebuggerUrl(target, port), "wrong-renderer-target");
  push(socketClosed !== true, "cdp-not-closed");
  push(persistentStateChanged !== false, "persistent-state-changed");
  return { failures, status: failures.length ? "fail" : "pass" };
}
