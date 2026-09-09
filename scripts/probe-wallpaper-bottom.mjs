#!/usr/bin/env node

import fs from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { withRendererSessions } from "../src/renderer-injection.mjs";

const port = Number(process.argv[2]);
const options = process.argv.slice(3);
const assertThread = options.includes("--assert-thread");
const assertSidebar = options.includes("--assert-sidebar");
const unknownOptions = options.filter((value) => value.startsWith("--")
  && !["--assert-thread", "--assert-sidebar"].includes(value));
const screenshotArgs = options.filter((value) => !value.startsWith("--"));
if (unknownOptions.length || screenshotArgs.length > 1) {
  throw new Error(`Unknown or duplicate option: ${unknownOptions[0] ?? screenshotArgs[1]}`);
}
const [screenshotArg] = screenshotArgs;
const screenshotPath = screenshotArg ? path.resolve(screenshotArg) : null;
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error(
    "Usage: probe-wallpaper-bottom.mjs <debug-port> [--assert-thread] [--assert-sidebar] [bottom-screenshot.png]",
  );
}

const expression = `(() => {
  const root = document.documentElement;
  const compact = (value, limit = 320) => String(value || "").replace(/\\s+/g, " ")
    .trim().slice(0, limit);
  const descriptor = (node) => {
    if (!(node instanceof Element)) return null;
    const style = getComputedStyle(node);
    const before = getComputedStyle(node, "::before");
    const after = getComputedStyle(node, "::after");
    const rect = node.getBoundingClientRect();
    const attributes = {};
    for (const name of [
      "data-app-shell-focus-area",
      "data-app-shell-main-content-layout",
      "data-app-shell-main-surface",
      "data-composer-layout",
      "data-composer-footer-responsive",
      "data-codex-composer",
      "data-testid",
      "role",
    ]) {
      if (node.hasAttribute(name)) attributes[name] = node.getAttribute(name);
    }
    const ancestors = [];
    for (let parent = node.parentElement, depth = 0; parent && depth < 7;
      parent = parent.parentElement, depth += 1) {
      const parentRect = parent.getBoundingClientRect();
      ancestors.push({
        tag: parent.tagName.toLowerCase(),
        className: compact(typeof parent.className === "string" ? parent.className : ""),
        focusArea: parent.getAttribute("data-app-shell-focus-area"),
        composerLayout: parent.getAttribute("data-composer-layout"),
        rect: {
          x: Number(parentRect.x.toFixed(1)),
          y: Number(parentRect.y.toFixed(1)),
          width: Number(parentRect.width.toFixed(1)),
          height: Number(parentRect.height.toFixed(1)),
        },
      });
    }
    return {
      tag: node.tagName.toLowerCase(),
      className: compact(typeof node.className === "string" ? node.className : ""),
      attributes,
      ancestors,
      rect: {
        x: Number(rect.x.toFixed(1)),
        y: Number(rect.y.toFixed(1)),
        width: Number(rect.width.toFixed(1)),
        height: Number(rect.height.toFixed(1)),
        right: Number(rect.right.toFixed(1)),
        bottom: Number(rect.bottom.toFixed(1)),
      },
      backgroundColor: style.backgroundColor,
      backgroundImage: compact(style.backgroundImage),
      backgroundBlendMode: style.backgroundBlendMode,
      boxShadow: compact(style.boxShadow),
      maskImage: compact(style.maskImage || style.webkitMaskImage),
      filter: compact(style.filter),
      backdropFilter: compact(style.backdropFilter || style.webkitBackdropFilter),
      beforeBackgroundColor: before.backgroundColor,
      beforeBackgroundImage: compact(before.backgroundImage),
      beforeBoxShadow: compact(before.boxShadow),
      beforeOpacity: before.opacity,
      afterBackgroundColor: after.backgroundColor,
      afterBackgroundImage: compact(after.backgroundImage),
      afterBoxShadow: compact(after.boxShadow),
      afterOpacity: after.opacity,
      color: style.color,
      opacity: style.opacity,
      visibility: style.visibility,
      display: style.display,
      position: style.position,
      zIndex: style.zIndex,
      overflow: style.overflow,
    };
  };
  const pointStack = (x, y) => ({
    x: Math.round(x),
    y: Math.round(y),
    stack: document.elementsFromPoint(x, y).map(descriptor).filter(Boolean),
  });
  const xPoints = [
    Math.max(2, innerWidth * 0.02),
    innerWidth * 0.24,
    innerWidth * 0.5,
    innerWidth * 0.76,
    innerWidth * 0.9,
    innerWidth - 2,
  ];
  const yPoints = [innerHeight - 2, innerHeight - 12, innerHeight - 40,
    innerHeight - 90, innerHeight - 160, innerHeight - 260].filter((value) => value >= 0);
  const bottomCandidates = [...document.querySelectorAll("body *")]
    .map((node) => ({ node, rect: node.getBoundingClientRect(), style: getComputedStyle(node) }))
    .filter(({ rect, style }) => rect.width > 180 && rect.height > 1
      && rect.bottom >= innerHeight - 1 && rect.top < innerHeight
      && style.display !== "none" && style.visibility !== "hidden")
    .map(({ node }) => descriptor(node))
    .slice(-120);
  const composerEditor = [...document.querySelectorAll(
    'textarea, [contenteditable="true"], [role="textbox"]',
  )].find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && node.closest(
      '[data-composer-layout], .composer-surface-chrome, [data-codex-composer="true"]',
    );
  }) ?? null;
  const visible = (node) => {
    const value = descriptor(node);
    return value && value.rect.width > 1 && value.rect.height > 1
      && value.display !== "none" && value.visibility !== "hidden";
  };
  const dockedSidebar = [...document.querySelectorAll("aside.app-shell-left-panel")]
    .find(visible) ?? null;
  const mainSurface = [...document.querySelectorAll("[data-app-shell-main-surface]")]
    .find(visible) ?? null;
  const wallpaperStyle = document.getElementById("codexctl-wallpaper-v2-style")?.textContent ?? "";
  return {
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    wallpaper: window.__CODEXCTL_WALLPAPER_V2__?.diagnostics?.() ?? null,
    root: descriptor(root),
    body: descriptor(document.body),
    composerDraftLength: String(composerEditor
      ? ("value" in composerEditor ? composerEditor.value : composerEditor.textContent) || ""
      : "").length,
    threadBottomFades: [...document.querySelectorAll(
      ".thread-scroll-container .bg-gradient-to-t.from-surface.via-surface",
    )].map(descriptor),
    sidebarLayout: {
      docked: descriptor(dockedSidebar),
      main: descriptor(mainSurface),
      sharedParent: Boolean(dockedSidebar && dockedSidebar.parentElement === mainSurface?.parentElement),
      floatingSelectorThemed: wallpaperStyle.includes("app-shell-floating-left-panel"),
    },
    points: xPoints.flatMap((x) => yPoints.map((y) => pointStack(x, y))),
    bottomCandidates,
  };
})()`;

const results = await withRendererSessions(port, async (session) => {
  const value = await session.evaluate(expression);
  if (screenshotPath && value?.wallpaper?.installed) {
    if (value.composerDraftLength > 0) {
      throw new Error("refusing to capture a screenshot with a non-empty composer draft");
    }
    const width = value.viewport.width;
    const height = value.viewport.height;
    const cropHeight = Math.min(160, height);
    const result = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip: {
        x: Math.floor(width * 0.2),
        y: Math.max(0, height - cropHeight),
        width: Math.ceil(width * 0.8),
        height: cropHeight,
        scale: 1,
      },
    });
    await fs.writeFile(screenshotPath, Buffer.from(result.data, "base64"), { mode: 0o600 });
  }
  return value;
});

const summary = {};
if (assertThread) {
  const pages = results.map((result) => result.value).filter((value) => value?.wallpaper?.installed);
  assert.ok(pages.length > 0, "no wallpaper-enabled primary App renderer");
  const fades = pages.flatMap((value) => (value.threadBottomFades ?? [])
    .filter((fade) => fade.rect.width > 200 && fade.rect.height > 20
      && Math.abs(fade.rect.bottom - value.viewport.height) < 2));
  assert.ok(fades.length > 0, "visible real App thread bottom fade was not present");
  for (const fade of fades) {
    assert.equal(fade.backgroundColor, "rgba(0, 0, 0, 0)");
    assert.equal(fade.backgroundImage, "none");
    assert.equal(fade.boxShadow, "none");
  }
  for (const page of pages) {
    assert.equal(page.wallpaper.metrics?.observers, 0);
    assert.equal(page.wallpaper.metrics?.timers, 0);
  }
  summary.thread = {
    pages: pages.length,
    threadBottomFades: fades.map(({ className, rect, backgroundColor, backgroundImage }) => ({
      className, rect, backgroundColor, backgroundImage,
    })),
  };
}
if (assertSidebar) {
  const pages = results.map((result) => result.value).filter((value) => value?.wallpaper?.installed);
  assert.ok(pages.length > 0, "no wallpaper-enabled primary App renderer");
  for (const page of pages) {
    const { docked, main, sharedParent, floatingSelectorThemed } = page.sidebarLayout;
    assert.ok(docked && main, "docked Sidebar or Main surface was not visible");
    assert.equal(sharedParent, true, "docked Sidebar and Main must share the official flex shell");
    assert.ok(docked.rect.right <= main.rect.x + 0.5, "docked Sidebar overlaps Main");
    assert.ok(main.rect.width < page.viewport.width - 32, "expanded Sidebar did not reduce Main width");
    assert.ok(!["absolute", "fixed"].includes(docked.position), "docked Sidebar became an overlay");
    assert.equal(floatingSelectorThemed, true, "Floating Sidebar must paint art over chat");
    assert.equal(page.wallpaper.metrics?.observers, 0);
    assert.equal(page.wallpaper.metrics?.timers, 0);
  }
  summary.sidebar = {
    caseId: "WALLPAPER-SIDEBAR-DOCKED-GEOMETRY-001",
    pages: pages.length,
    layouts: pages.map(({ viewport, sidebarLayout }) => ({
      viewport, docked: sidebarLayout.docked.rect, main: sidebarLayout.main.rect,
    })),
  };
}
if (assertThread || assertSidebar) {
  console.log(JSON.stringify({ pass: true, port, screenshotPath, ...summary }, null, 2));
} else {
  console.log(JSON.stringify({ port, screenshotPath, results }, null, 2));
}
