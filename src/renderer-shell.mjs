const SHELL_PROBE = `(() => ({
  codex: location.protocol === "app:" && document.title === "Codex",
  chatgpt: location.protocol === "app:" && document.title === "ChatGPT",
  protocol: location.protocol,
  visibility: document.visibilityState,
  hasRoot: Boolean(document.documentElement && document.getElementById("root")),
  windowType: document.documentElement?.getAttribute("data-codex-window-type")
    || document.documentElement?.getAttribute("data-window-type"),
  hasMain: Boolean(document.querySelector('[data-app-shell-main-surface], main')),
  hasComposer: Boolean(document.querySelector('[data-codex-composer="true"]')),
}))()`;

export function isPrimaryRendererShell(shell) {
  return shell?.protocol === "app:" && shell.hasMain === true && shell.hasComposer === true;
}

export function isStartupRendererShell(shell, { allowHidden = false } = {}) {
  return shell?.protocol === "app:" && shell.hasRoot === true
    && (shell.codex === true || shell.chatgpt === true || shell.windowType === "electron")
    && (allowHidden || shell.visibility !== "hidden");
}

export async function waitForRendererShell(session, {
  allowHidden = false,
  timeoutMs = 6000,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let delayMs = 50;
  let shell = null;
  while (!session.closed) {
    shell = await session.evaluate(SHELL_PROBE, Math.min(2000, Math.max(250, deadline - Date.now())));
    if (isPrimaryRendererShell(shell) || isStartupRendererShell(shell, { allowHidden })) return shell;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remaining)));
    delayMs = Math.min(400, delayMs * 2);
  }
  const state = shell
    ? `title=${shell.codex ? "Codex" : shell.chatgpt ? "ChatGPT" : "other"}, root=${Boolean(shell.hasRoot)}, main=${Boolean(shell.hasMain)}, composer=${Boolean(shell.hasComposer)}, visibility=${shell.visibility ?? "unknown"}`
    : "no renderer state";
  throw new Error(`Target is not the primary Codex/ChatGPT renderer shell after startup wait (${state})`);
}
