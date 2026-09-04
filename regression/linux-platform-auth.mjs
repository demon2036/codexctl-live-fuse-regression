import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const OFFLINE_FIXTURE_CREDENTIAL = "codexctl-offline-shell-fixture";

function waitForLogin(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    child.stderr?.resume?.();
    const timer = setTimeout(() => {
      child.kill?.("SIGTERM");
      reject(new Error("isolated Codex login deadline"));
    }, timeoutMs);
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`isolated Codex login exited ${code ?? signal}`));
    });
  });
}

export async function loginIsolatedLinuxProfile({
  apiKey,
  cli,
  codexHome,
  env,
  spawnImpl = spawn,
  timeoutMs = 30_000,
} = {}) {
  const credential = apiKey || OFFLINE_FIXTURE_CREDENTIAL;
  if (typeof credential !== "string" || credential.length < 8) {
    throw new Error("invalid isolated CI credential");
  }
  if (!path.isAbsolute(cli ?? "") || !path.isAbsolute(codexHome ?? "")) {
    throw new Error("isolated Codex login requires absolute owned paths");
  }
  await fs.mkdir(codexHome, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(codexHome, "config.toml"),
    'cli_auth_credentials_store = "file"\n',
    { mode: 0o600 },
  );
  const child = spawnImpl(cli, ["login", "--with-api-key"], {
    env: { ...env, CODEX_HOME: codexHome },
    stdio: ["pipe", "ignore", "pipe"],
  });
  const completion = waitForLogin(child, timeoutMs);
  child.stdin.end(`${credential}\n`);
  await completion;
  return {
    method: apiKey ? "api-key" : "offline-shell-fixture",
    serviceAccess: Boolean(apiKey),
    status: "pass",
  };
}
