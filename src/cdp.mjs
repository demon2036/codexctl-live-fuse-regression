export async function probeCodexCdp(port, timeoutMs = 800) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return { reachable: false, targets: 0, detail: "invalid-port" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return { reachable: false, targets: 0, detail: `HTTP ${response.status}` };
    const payload = await response.json();
    const targets = Array.isArray(payload)
      ? payload.filter((target) => target?.type === "page"
        && typeof target?.url === "string"
        && target.url.startsWith("app://")
        && typeof target?.webSocketDebuggerUrl === "string")
      : [];
    return {
      reachable: targets.length > 0,
      targets: targets.length,
      detail: targets.length ? null : "no-codex-target",
    };
  } catch (error) {
    return {
      reachable: false,
      targets: 0,
      detail: error.name === "AbortError" ? "timeout" : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForCodexCdp(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last = { reachable: false, targets: 0, detail: "not-probed" };
  while (Date.now() < deadline) {
    last = await probeCodexCdp(port, Math.min(800, Math.max(100, deadline - Date.now())));
    if (last.reachable) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return last;
}
