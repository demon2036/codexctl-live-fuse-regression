"use strict";

const fs = require("node:fs");
const { createHash } = require("node:crypto");

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const HASH_CHUNK_BYTES = 64 * 1024;
const TRANSFER_CHUNK_BYTES = 192 * 1024;
const PLACEHOLDER = JSON.stringify("blob:codexctl-pending");

function sameStat(left, right) {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function readChunk(descriptor, buffer, position, maximum) {
  return fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, maximum - position), position);
}

async function cleanupWallpaper(contents) {
  return contents.executeJavaScript(`(() => {
    try { window.__CODEXCTL_WALLPAPER_V2__?.cleanup?.(); } catch {}
    const blobs = window.__CODEXCTL_WALLPAPER_V2_BLOBS__;
    for (const record of Object.values(blobs || {})) {
      try { if (record?.url) URL.revokeObjectURL(record.url); } catch {}
    }
    delete window.__CODEXCTL_WALLPAPER_V2__;
    delete window.__CODEXCTL_WALLPAPER_V2_BLOBS__;
    delete window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__;
    const root = document.documentElement;
    const attributes = ["data-codexctl-wallpaper", "data-codexctl-wallpaper-theme",
      "data-codexctl-wallpaper-task-mode", "data-dream-skin", "data-dream-art-ready"];
    return {
      state: Boolean(window.__CODEXCTL_WALLPAPER_V2__),
      blobs: Object.keys(window.__CODEXCTL_WALLPAPER_V2_BLOBS__ || {}).length,
      transfers: Object.keys(window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__ || {}).length,
      styles: document.querySelectorAll("#codexctl-wallpaper-v2-style").length,
      rootAttributes: attributes.filter((name) => root?.hasAttribute(name)).length,
    };
  })()`, true);
}

async function wallpaperProbe(contents) {
  return contents.executeJavaScript(`(() => {
    const state = window.__CODEXCTL_WALLPAPER_V2__;
    const diagnostics = state?.diagnostics?.() ?? null;
    const root = document.documentElement;
    const attributes = ["data-codexctl-wallpaper", "data-codexctl-wallpaper-theme",
      "data-codexctl-wallpaper-task-mode", "data-dream-skin", "data-dream-art-ready"];
    return {
      revision: diagnostics?.revision ?? null,
      installed: diagnostics?.installed === true,
      blobs: Object.keys(window.__CODEXCTL_WALLPAPER_V2_BLOBS__ || {}).length,
      transfers: Object.keys(window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__ || {}).length,
      styles: document.querySelectorAll("#codexctl-wallpaper-v2-style").length,
      rootAttributes: attributes.filter((name) => root?.hasAttribute(name)).length,
      observers: Number(diagnostics?.metrics?.observers ?? 0),
      timers: Number(diagnostics?.metrics?.timers ?? 0),
    };
  })()`, true);
}

async function mountWallpaper(contents, artifact) {
  const descriptor = fs.openSync(
    artifact.image.path,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size !== artifact.image.bytes
      || before.size < 1 || before.size > MAX_IMAGE_BYTES) {
      throw new Error("wallpaper image identity is invalid");
    }
    const hash = createHash("sha256");
    const hashBuffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    let position = 0;
    while (position < before.size) {
      const count = readChunk(descriptor, hashBuffer, position, before.size);
      if (count < 1) throw new Error("wallpaper image ended while hashing");
      hash.update(hashBuffer.subarray(0, count));
      position += count;
    }
    if (hash.digest("hex") !== artifact.image.hash
      || !sameStat(before, fs.fstatSync(descriptor))) {
      throw new Error("wallpaper image changed before transfer");
    }
    const revision = JSON.stringify(artifact.revision);
    await contents.executeJavaScript(`(() => {
      const revision = ${revision};
      (window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__ ||= Object.create(null))[revision] = {
        bytes: 0, chunks: [], expected: ${before.size}, mime: ${JSON.stringify(artifact.image.mime)}
      };
    })()`, true);
    const transferBuffer = Buffer.allocUnsafe(TRANSFER_CHUNK_BYTES);
    position = 0;
    while (position < before.size) {
      const count = readChunk(descriptor, transferBuffer, position, before.size);
      if (count < 1) throw new Error("wallpaper image ended during transfer");
      const encoded = transferBuffer.subarray(0, count).toString("base64");
      const accepted = await contents.executeJavaScript(`(() => {
        const transfer = window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__?.[${revision}];
        if (!transfer || transfer.bytes !== ${position}) throw new Error("wallpaper-transfer-order");
        const binary = atob(${JSON.stringify(encoded)});
        const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
        transfer.chunks.push(bytes); transfer.bytes += bytes.length; return transfer.bytes;
      })()`, true);
      position += count;
      if (accepted !== position) throw new Error("wallpaper transfer was not acknowledged");
    }
    const artUrl = await contents.executeJavaScript(`(() => {
      const revision = ${revision};
      const transfer = window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__?.[revision];
      if (!transfer || transfer.bytes !== transfer.expected) throw new Error("wallpaper-transfer-incomplete");
      const blob = new Blob(transfer.chunks, { type: transfer.mime });
      const url = URL.createObjectURL(blob);
      (window.__CODEXCTL_WALLPAPER_V2_BLOBS__ ||= Object.create(null))[revision] =
        { revision, url, bytes: blob.size, mime: transfer.mime, blob };
      delete window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__[revision];
      return url;
    })()`, true);
    if (artifact.payload.split(PLACEHOLDER).length !== 2) {
      throw new Error("wallpaper payload placeholder is invalid");
    }
    await contents.executeJavaScript(
      artifact.payload.replace(PLACEHOLDER, JSON.stringify(artUrl)),
      true,
    );
    if (!sameStat(before, fs.fstatSync(descriptor))) {
      throw new Error("wallpaper image changed during transfer");
    }
    const diagnostics = await wallpaperProbe(contents);
    if (!diagnostics.installed || diagnostics.revision !== artifact.revision
      || diagnostics.blobs !== 1 || diagnostics.transfers !== 0
      || diagnostics.styles !== 1 || diagnostics.rootAttributes < 1
      || diagnostics.observers !== 0 || diagnostics.timers !== 0) {
      throw new Error("wallpaper mount diagnostics failed");
    }
    return diagnostics;
  } catch (error) {
    await cleanupWallpaper(contents).catch(() => {});
    throw error;
  } finally {
    fs.closeSync(descriptor);
  }
}

module.exports = { cleanupWallpaper, mountWallpaper, wallpaperProbe };
