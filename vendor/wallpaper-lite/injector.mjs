#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { withRendererSessions } from "../../src/renderer-injection.mjs";
import { compileSource, loadPayload } from "./payload.mjs";

export { compileSource, loadPayload, optimizeWallpaperCss } from "./payload.mjs";
export const WALLPAPER_TRANSFER_CHUNK_BYTES = 192 * 1024;

function parseArgs(argv) {
  const options = { mode: "install", port: 9342, themeDir: null, timeoutMs: 20_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--theme-dir") options.themeDir = path.resolve(argv[++index]);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--install" || arg === "--once") options.mode = "install";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--check-payload") options.mode = "check";
    else if (arg === "--allow-hidden") continue;
    else if (arg === "--watch") throw new Error("--watch was removed; injection is one-shot only");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 250
    || options.timeoutMs > 120_000) throw new Error(`Invalid timeout: ${options.timeoutMs}`);
  if (options.mode !== "remove" && !options.themeDir) throw new Error("Wallpaper requires --theme-dir");
  return options;
}

export function assessWallpaperDiagnostics(diagnostics, expected = {}) {
  const result = diagnostics && typeof diagnostics === "object" ? { ...diagnostics } : {};
  result.checks = {
    installed: result.installed === true,
    revision: !expected.revision || result.revision === expected.revision,
    theme: !expected.themeId || result.themeId === expected.themeId,
    artReady: result.artReady === true,
    stylePresent: result.stylePresent === true,
    rootAttribute: result.rootAttribute === "on",
    noObservers: result.metrics?.observers === 0,
    noTimers: result.metrics?.timers === 0,
  };
  result.pass = Object.values(result.checks).every(Boolean);
  return result;
}

export async function createRendererBlob(session, loaded) {
  const revision = JSON.stringify(loaded.revision);
  const mime = JSON.stringify(loaded.mime);
  const initialized = await session.evaluate(`(() => {
    const revision = ${revision};
    const blobs = window.__CODEXCTL_WALLPAPER_V2_BLOBS__ ||= Object.create(null);
    const existing = blobs[revision];
    if (existing?.blob instanceof Blob && existing.bytes === ${loaded.art.length}) {
      existing.url = URL.createObjectURL(existing.blob);
      return { complete: true, record: { revision, url: existing.url, bytes: existing.bytes, mime: existing.mime } };
    }
    const transfers = window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__ ||= Object.create(null);
    transfers[revision] = { bytes: 0, chunks: [], expected: ${loaded.art.length}, mime: ${mime} };
    return { complete: false };
  })()`);
  if (initialized?.complete) return initialized.record;
  for (let offset = 0; offset < loaded.art.length; offset += WALLPAPER_TRANSFER_CHUNK_BYTES) {
    const end = Math.min(loaded.art.length, offset + WALLPAPER_TRANSFER_CHUNK_BYTES);
    const encoded = loaded.art.subarray(offset, end).toString("base64");
    const accepted = await session.evaluate(`(() => {
      // codexctl-wallpaper-transfer:chunk
      const transfer = window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__?.[${revision}];
      if (!transfer || transfer.bytes !== ${offset}) throw new Error("wallpaper-transfer-order");
      const binary = atob(${JSON.stringify(encoded)});
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      transfer.chunks.push(bytes); transfer.bytes += bytes.length; return transfer.bytes;
    })()`, 10_000);
    if (accepted !== end) throw new Error("Renderer rejected wallpaper bytes");
  }
  const result = await session.evaluate(`(() => {
    // codexctl-wallpaper-transfer:commit
    const revision = ${revision};
    const transfer = window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__?.[revision];
    if (!transfer || transfer.bytes !== transfer.expected) throw new Error("wallpaper-transfer-incomplete");
    const blob = new Blob(transfer.chunks, { type: transfer.mime });
    const url = URL.createObjectURL(blob);
    const record = { revision, url, bytes: blob.size, mime: transfer.mime, blob };
    (window.__CODEXCTL_WALLPAPER_V2_BLOBS__ ||= Object.create(null))[revision] = record;
    delete window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__[revision];
    return { revision, url, bytes: blob.size, mime: transfer.mime };
  })()`, 10_000);
  if (result?.bytes !== loaded.art.length || !result?.url?.startsWith("blob:")) {
    throw new Error("Renderer did not confirm wallpaper Blob");
  }
  return result;
}

export async function installIntoSession(record, loaded, timeoutMs = 20_000) {
  const blob = await createRendererBlob(record.session, loaded);
  const prepared = compileSource(loaded.source, blob.url);
  await record.session.evaluate(prepared.payload, timeoutMs);
  const diagnostics = await record.session.evaluate(
    `window.__CODEXCTL_WALLPAPER_V2__?.diagnostics?.() ?? null`,
  );
  const assessed = assessWallpaperDiagnostics(diagnostics, {
    revision: prepared.revision,
    themeId: prepared.theme.id,
  });
  if (!assessed.pass) throw new Error("Renderer did not confirm wallpaper revision");
  record.revision = prepared.revision;
  record.artUrl = blob.url;
  return assessed;
}

async function operate(options, loaded) {
  return withRendererSessions(options.port, async (session, target) => {
    if (options.mode === "remove") {
      const removed = await session.evaluate(`window.__CODEXCTL_WALLPAPER_V2__?.cleanup?.() ?? false`);
      return { removed };
    }
    if (options.mode === "install") {
      const record = { session, target };
      return installIntoSession(record, loaded, options.timeoutMs);
    }
    const diagnostics = await session.evaluate(`window.__CODEXCTL_WALLPAPER_V2__?.diagnostics?.() ?? null`);
    return assessWallpaperDiagnostics(diagnostics, {
      revision: loaded.revision,
      themeId: loaded.theme.id,
    });
  });
}

export async function main(argv) {
  const options = parseArgs(argv);
  const loaded = options.mode === "remove" ? null : await loadPayload(options.themeDir);
  if (options.mode === "check") {
    console.log(JSON.stringify({ pass: true, revision: loaded.revision, themeId: loaded.theme.id,
      imageBytes: loaded.imageBytes, payloadBytes: Buffer.byteLength(loaded.payload) }));
    return;
  }
  const deadline = Date.now() + options.timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await operate(options, loaded);
      console.log(JSON.stringify({ ok: true, mode: options.mode, revision: loaded?.revision ?? null, targets }));
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw lastError ?? new Error("Wallpaper renderer was not ready");
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
