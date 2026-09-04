import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { withRendererSessions } from "../../src/renderer-injection.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_PROMPT_BYTES = 4 * 1024 * 1024;
const DEFAULT_PORT = 9342;
const ID = /^[A-Za-z0-9._-]{1,80}$/;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function parseArgs(argv) {
  const options = {
    mode: "install",
    port: DEFAULT_PORT,
    profilesPath: path.join(here, "profiles.json"),
    timeoutMs: 20_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--profiles") options.profilesPath = path.resolve(argv[++index]);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--install" || arg === "--once") options.mode = "install";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--watch") throw new Error("--watch was removed; injection is one-shot only");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 250
    || options.timeoutMs > 120_000) throw new Error(`Invalid timeout: ${options.timeoutMs}`);
  return options;
}

async function rendererTemplate() {
  const fragmentsDir = path.join(here, "renderer");
  try {
    const entries = (await fs.readdir(fragmentsDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".part.js"))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (!entries.length) throw new Error("Prompt renderer has no fragments");
    return (await Promise.all(entries.map((entry) => (
      fs.readFile(path.join(fragmentsDir, entry.name), "utf8")
    )))).join("");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return fs.readFile(path.join(here, "renderer.js"), "utf8");
  }
}

export async function validatePromptPath(candidate) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)
    || candidate.includes("\0") || candidate.length > 4096) {
    throw new Error("Prompt file must be an absolute path");
  }
  await fs.access(candidate, fsConstants.R_OK);
  const stat = await fs.stat(candidate);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_PROMPT_BYTES) {
    throw new Error(`Prompt must be a 1-${MAX_PROMPT_BYTES} byte regular file`);
  }
  const hash = createHash("sha256").update(await fs.readFile(candidate)).digest("hex");
  const extension = path.extname(candidate);
  const label = (extension ? path.basename(candidate, extension) : path.basename(candidate)).slice(0, 80);
  return { path: candidate, label: label || "Prompt", hash };
}

function validateContext(entry, seen) {
  const id = String(entry?.id ?? "").trim();
  const label = String(entry?.label ?? "").trim();
  const native = id === "native" || entry?.native === true;
  const contextWindow = native ? null : Number(entry?.contextWindow);
  const autoCompactTokenLimit = native ? null : Number(entry?.autoCompactTokenLimit);
  const scope = native ? null : entry?.scope === "body_after_prefix" ? "body_after_prefix" : "total";
  if (!ID.test(id) || !label || label.length > 80 || seen.has(id)
    || (!native && (!Number.isInteger(contextWindow) || contextWindow < 32_000
    || contextWindow > 4_096_000 || !Number.isInteger(autoCompactTokenLimit)
    || autoCompactTokenLimit < 16_000 || autoCompactTokenLimit > contextWindow - 16_000))) {
    throw new Error(`Invalid context profile: ${id || "<missing>"}`);
  }
  seen.add(id);
  return { id, label, contextWindow, autoCompactTokenLimit, scope, native };
}

function featureValue(overrides, parsed, name, fallback = false) {
  if (typeof overrides?.[name] === "boolean") return overrides[name];
  if (typeof parsed?.features?.[name] === "boolean") return parsed.features[name];
  return fallback;
}

function liveControlConfig(value) {
  if (value == null) return null;
  const sessionId = String(value.sessionId ?? "");
  if (value.enabled !== true
    || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sessionId)) {
    throw new Error("Live control config is invalid");
  }
  return { enabled: true, sessionId };
}

export function compileSource(source, options = {}) {
  const promptEnabled = featureValue(options.features, source.runtime, "prompt");
  const contextEnabled = featureValue(options.features, source.runtime, "context");
  const runtime = {
    ...source.runtime,
    features: {
      prompt: promptEnabled,
      context: contextEnabled,
      provider: featureValue(
        options.features, source.runtime, "provider", promptEnabled || contextEnabled,
      ),
      live: options.liveControl?.enabled === true,
    },
    liveControl: liveControlConfig(options.liveControl),
  };
  const revision = createHash("sha256").update(source.version).update(source.template)
    .update(JSON.stringify(source.profiles)).update(JSON.stringify(runtime)).digest("hex").slice(0, 24);
  const config = { version: source.version, revision, bindingName: null,
    profiles: source.profiles, ...runtime };
  const payload = source.template.replace(
    "__CODEX_BASE_PROMPT_CONFIG_JSON__", () => JSON.stringify(config),
  );
  if (payload.includes("__CODEX_BASE_PROMPT_CONFIG_JSON__")) throw new Error("Renderer placeholder remained");
  new Script(payload, { filename: "codex-prompt-context-renderer.js" });
  return { config, payload, revision, source };
}

export async function loadSource(profilesPath) {
  const [template, versionText, profilesText] = await Promise.all([
    rendererTemplate(),
    fs.readFile(path.join(here, "VERSION"), "utf8"),
    fs.readFile(profilesPath, "utf8"),
  ]);
  const parsed = JSON.parse(profilesText);
  if (parsed?.schema !== "codex-base-prompt-profiles/1" || !Array.isArray(parsed.profiles)) {
    throw new Error("profiles.json has an unsupported schema");
  }
  const seenIds = new Set();
  const seenPaths = new Set();
  const profiles = [];
  for (const entry of parsed.profiles) {
    const id = String(entry?.id ?? "").trim();
    const label = String(entry?.label ?? "").trim();
    if (!ID.test(id) || !label || label.length > 80 || seenIds.has(id)) {
      throw new Error(`Invalid prompt profile: ${id || "<missing>"}`);
    }
    const validated = await validatePromptPath(entry.path);
    if (seenPaths.has(validated.path)) throw new Error(`Duplicate prompt path: ${validated.path}`);
    seenIds.add(id);
    seenPaths.add(validated.path);
    profiles.push({ id, ...validated, label });
  }
  const contextIds = new Set();
  const contexts = (Array.isArray(parsed.contexts) ? parsed.contexts : [])
    .map((entry) => validateContext(entry, contextIds));
  const defaultProfileId = String(parsed.defaultProfileId ?? "default");
  const defaultContextId = String(parsed.defaultContextId ?? contexts[0]?.id ?? "oai");
  const launchProviderId = parsed.launchProviderId == null
    ? null : String(parsed.launchProviderId).trim();
  const defaultProviderId = String(
    parsed.defaultProviderId ?? launchProviderId ?? "openai",
  ).trim();
  if (defaultProfileId !== "default" && !seenIds.has(defaultProfileId)) {
    throw new Error(`Unknown default prompt profile: ${defaultProfileId}`);
  }
  if (contexts.length && !contextIds.has(defaultContextId)) {
    throw new Error(`Unknown default context profile: ${defaultContextId}`);
  }
  if (!PROVIDER_ID.test(defaultProviderId)
    || (launchProviderId != null && !PROVIDER_ID.test(launchProviderId))) {
    throw new Error("Invalid default model Provider ID");
  }
  const promptSelectionRevision = Number(parsed.promptSelectionRevision ?? 0);
  const contextSelectionRevision = Number(parsed.contextSelectionRevision ?? 0);
  if (![promptSelectionRevision, contextSelectionRevision]
    .every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Selection revisions must be non-negative integers");
  }
  const version = versionText.trim();
  const promptEnabled = featureValue(null, parsed, "prompt");
  const contextEnabled = featureValue(null, parsed, "context");
  return Object.freeze({
    profiles,
    template,
    version,
    runtime: {
    features: {
      prompt: promptEnabled,
      context: contextEnabled,
      provider: featureValue(null, parsed, "provider", promptEnabled || contextEnabled),
      live: false,
    },
    liveControl: null,
    defaultProfileId,
    defaultContextId,
    defaultProviderId,
    launchProviderId,
    promptSelectionRevision,
    contextSelectionRevision,
    providerSelectionRevision: String(parsed.providerSelectionRevision ?? 0).slice(0, 160),
    contexts,
    },
  });
}

export async function loadPayload(profilesPath, options = {}) {
  return compileSource(await loadSource(profilesPath), options);
}

function diagnosticsExpression() {
  return `window.__CODEX_BASE_PROMPT_SWITCHER__?.diagnostics?.() ?? null`;
}

async function operate(options, loaded) {
  return withRendererSessions(options.port, async (session) => {
    if (options.mode === "install") await session.evaluate(loaded.payload, options.timeoutMs);
    if (options.mode === "remove") {
      await session.evaluate(`window.__CODEX_BASE_PROMPT_SWITCHER__?.cleanup?.() ?? false`);
    }
    const diagnostics = await session.evaluate(diagnosticsExpression());
    if (options.mode === "install" && diagnostics?.revision !== loaded.revision) {
      throw new Error("Renderer did not confirm Prompt/Context revision");
    }
    return diagnostics;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const loaded = await loadPayload(options.profilesPath);
  const deadline = Date.now() + options.timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await operate(options, loaded);
      console.log(JSON.stringify({ ok: true, mode: options.mode, revision: loaded.revision, targets }));
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw lastError ?? new Error("Prompt/Context renderer was not ready");
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
