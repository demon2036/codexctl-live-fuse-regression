#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

const originalArgs = process.argv.slice(2);
let relayAppServer = false;
let relayHandshakeContext = null;

function firstExisting(candidates) {
  return candidates.filter(Boolean).find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) ?? null;
}

function officialCli() {
  const resources = process.env.CODEX_ELECTRON_RESOURCES_PATH;
  return firstExisting([
    process.env.CODEXCTL_OFFICIAL_CLI,
    resources ? path.join(resources, "codex") : null,
    "/Applications/Codex.app/Contents/Resources/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/usr/lib/chatgpt/resources/codex",
    "/usr/lib/ChatGPT/resources/codex",
    "/opt/chatgpt/resources/codex",
    "/opt/ChatGPT/resources/codex",
  ]);
}

function parseBooleanEnv(name, fallback) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  console.error(`${name} must be true or false`);
  process.exit(64);
}

function writeRelayHandshake(baseUrl, provider) {
  const requested = process.env.CODEXCTL_RELAY_HANDSHAKE;
  const controllerHome = process.env.CODEXCTL_HOME;
  if (!requested) return;
  if (!controllerHome || !path.isAbsolute(controllerHome) || !path.isAbsolute(requested)) {
    throw new Error("relay handshake path is not absolute");
  }
  const runtimeRoot = path.resolve(controllerHome, "runtime");
  const target = path.resolve(requested);
  const relative = path.relative(runtimeRoot, target);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)
    || !/^relay-handshake-[a-f0-9-]{36}\.json$/.test(path.basename(target))) {
    throw new Error("relay handshake path escaped the controller runtime");
  }
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  const record = {
    schema: "codexctl-relay-handshake/1",
    bridgePid: process.pid,
    parentPid: process.ppid,
    provider,
    baseUrlHash: createHash("sha256").update(baseUrl).digest("hex"),
    createdAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
}

const cli = officialCli();
if (!cli) {
  console.error("codexctl bridge: unable to locate the official embedded Codex CLI");
  process.exit(127);
}

let args = originalArgs;
if (originalArgs.includes("app-server")) {
  const baseUrl = process.env.CODEX_APP_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const apiKey = process.env.CODEX_APP_API_KEY ?? "";
  if (!baseUrl || !apiKey) {
    console.error("codexctl bridge: url and key must be supplied together by codexctl app -c");
    process.exit(64);
  }
  let parsed;
  try { parsed = new URL(baseUrl); } catch {
    console.error("codexctl bridge: CODEX_APP_BASE_URL is invalid");
    process.exit(64);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    console.error("codexctl bridge: CODEX_APP_BASE_URL must use http or https");
    process.exit(64);
  }
  // Current Codex releases reserve the built-in `openai` id and reject any
  // attempt to override it. Keep the custom id explicit and stable instead.
  const providerId = "openai-custom";
  const provider = `model_providers.${providerId}`;
  const supportsWebSockets = parseBooleanEnv("CODEX_APP_WEBSOCKETS", true);
  const standaloneWebSearch = parseBooleanEnv("CODEX_APP_STANDALONE_WEB_SEARCH", false);
  args = [
    "-c", `model_provider=${JSON.stringify(providerId)}`,
    "-c", `${provider}.name="OpenAI"`,
    "-c", `${provider}.base_url=${JSON.stringify(baseUrl)}`,
    "-c", `${provider}.wire_api="responses"`,
    "-c", `${provider}.requires_openai_auth=false`,
    "-c", `${provider}.env_key="CODEX_APP_API_KEY"`,
    "-c", `${provider}.supports_websockets=${supportsWebSockets}`,
    "-c", `${provider}.supports_standalone_web_search=${standaloneWebSearch}`,
    ...originalArgs,
  ];
  relayHandshakeContext = { baseUrl, providerId };
  relayAppServer = true;
}

function readChatgptState() {
  const codexHome = process.env.CODEX_HOME && path.isAbsolute(process.env.CODEX_HOME)
    ? process.env.CODEX_HOME
    : process.env.HOME && path.isAbsolute(process.env.HOME)
      ? path.join(process.env.HOME, ".codex") : null;
  if (!codexHome) return null;
  let auth;
  try { auth = JSON.parse(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8")); }
  catch { return null; }
  if (auth?.auth_mode !== "chatgpt") return null;
  const validPlans = new Set([
    "free", "go", "plus", "pro", "prolite", "team",
    "self_serve_business_usage_based", "business", "ent26",
    "enterprise_cbp_usage_based", "enterprise", "edu", "unknown",
  ]);
  let planType = "unknown";
  for (const token of [auth.tokens?.id_token, auth.tokens?.access_token]) {
    if (typeof token !== "string") continue;
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
      const openAiAuth = payload["https://api.openai.com/auth"] ?? {};
      const candidate = openAiAuth.chatgpt_plan_type ?? openAiAuth.chatgpt_plan ?? payload.plan_type;
      if (typeof candidate === "string" && validPlans.has(candidate)) planType = candidate;
    } catch {}
  }
  return {
    accessToken: typeof auth.tokens?.access_token === "string" ? auth.tokens.access_token : null,
    account: { type: "chatgpt", email: null, planType },
  };
}

function exitLikeChild(child) {
  child.on("error", (error) => {
    console.error(`codexctl bridge: ${error.message}`);
    process.exit(127);
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
  }
}

if (!relayAppServer) {
  exitLikeChild(spawn(cli, args, { stdio: "inherit", env: process.env }));
} else {
  // A custom provider correctly reports requiresOpenaiAuth=false, but the
  // Desktop shell still uses getAuthStatus to decide whether it may enter the
  // app. Preserve the user's existing ChatGPT account identity from the
  // official auth file while the model request itself uses only the ephemeral
  // relay key. Tokens are returned only for an explicit includeToken request.
  const child = spawn(cli, args, {
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
  });
  const tokenRequestIds = new Set();
  const initializeRequestIds = new Set();
  let handshakeWritten = false;
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    try {
      const request = JSON.parse(line);
      if (request?.method === "initialize" && request.id !== undefined) {
        initializeRequestIds.add(JSON.stringify(request.id));
      }
      if (request?.method === "getAuthStatus" && request.params?.includeToken === true
        && request.id !== undefined) tokenRequestIds.add(JSON.stringify(request.id));
    } catch {}
    child.stdin.write(`${line}\n`);
  });
  input.on("close", () => child.stdin.end());
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  output.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); }
    catch { process.stdout.write(`${line}\n`); return; }
    const result = message?.result;
    const responseId = message.id === undefined ? null : JSON.stringify(message.id);
    if (!handshakeWritten && relayHandshakeContext && responseId !== null
      && initializeRequestIds.delete(responseId) && !message.error
      && result && typeof result === "object") {
      try {
        writeRelayHandshake(
          relayHandshakeContext.baseUrl,
          relayHandshakeContext.providerId,
        );
        handshakeWritten = true;
      } catch (error) {
        console.error(`codexctl bridge: unable to confirm relay activation: ${error.message}`);
        child.kill("SIGTERM");
        process.exitCode = 74;
        return;
      }
    }
    if (result && typeof result === "object" && result.requiresOpenaiAuth === false) {
      const state = readChatgptState();
      if (state && Object.hasOwn(result, "account") && result.account === null) {
        result.account = state.account;
      }
      if (state && Object.hasOwn(result, "authMethod") && result.authMethod === null) {
        result.authMethod = "chatgpt";
        if (responseId !== null && tokenRequestIds.delete(responseId)
          && state.accessToken !== null) result.authToken = state.accessToken;
      }
    }
    process.stdout.write(`${JSON.stringify(message)}\n`);
  });
  exitLikeChild(child);
}
