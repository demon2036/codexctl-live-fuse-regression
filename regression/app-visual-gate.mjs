import path from "node:path";

const REGIONS = ["wallpaper", "bottom", "sidebar", "main", "composer"];
const REVISION = /^[0-9a-f]{24}$/;

function add(failures, condition, code) {
  if (condition) failures.push(code);
}

function close(left, right, tolerance = 1) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function inside(inner, outer) {
  return inner.width > 0 && inner.height > 0
    && inner.x >= outer.x - 1 && inner.y >= outer.y - 1
    && inner.x + inner.width <= outer.x + outer.width + 1
    && inner.y + inner.height <= outer.y + outer.height + 1;
}

export function evaluateAppVisualPair({ official, injected, screenshots } = {}) {
  const failures = [];
  const baseline = official?.visual;
  const candidate = injected?.visual;
  if (!baseline?.regions || !candidate?.regions) {
    return { failures: ["visual-missing"], status: "fail" };
  }
  for (const name of REGIONS) {
    add(failures, candidate.regions[name]?.visible !== true, `${name}-not-visible`);
    add(failures, candidate.regions[name]?.background === "opaque-black", `${name}-opaque-black`);
  }
  add(failures, candidate.regions.wallpaper?.background !== "theme", "wallpaper-not-themed");
  add(failures, candidate.regions.bottom?.background !== "transparent", "bottom-not-transparent");
  for (const name of ["sidebar", "main", "composer"]) {
    add(failures, candidate.regions[name]?.background !== "theme", `${name}-not-themed`);
  }
  add(failures, candidate.sidebarDocked !== true || candidate.sidebarMainGap < -0.5,
    "sidebar-overlaps-main");
  add(failures, !Number.isFinite(candidate.wallpaperVisibleMs)
    || candidate.wallpaperVisibleMs > 750, "wallpaper-visible-budget");
  const before = baseline.regions.wallpaper.bounds;
  const after = candidate.regions.wallpaper.bounds;
  for (const field of ["height", "width", "x", "y"]) {
    add(failures, !close(before?.[field], after?.[field]), `viewport-${field}-mismatch`);
  }
  for (const name of ["prompt", "context"]) {
    const control = injected.controls?.[name];
    add(failures, control?.count !== 1, `${name}-count`);
    add(failures, control?.reachable !== true, `${name}-unreachable`);
    add(failures, !inside(control?.bounds ?? {}, after ?? {}), `${name}-outside-viewport`);
  }
  const diagnostics = injected.diagnostics ?? {};
  add(failures, !REVISION.test(diagnostics.promptRevision ?? ""), "prompt-revision");
  add(failures, diagnostics.contextRevision !== diagnostics.promptRevision, "context-revision");
  add(failures, !REVISION.test(diagnostics.wallpaperRevision ?? ""), "wallpaper-revision");
  add(failures, Object.values(official.diagnostics ?? {}).some((value) => value !== null),
    "official-has-injection-revision");
  for (const name of ["official", "injected"]) {
    const screenshot = screenshots?.[name];
    add(failures, !Number.isFinite(screenshot?.bytes) || screenshot.bytes < 100,
      `${name}-screenshot-empty`);
    add(failures, typeof screenshot?.name !== "string"
      || path.basename(screenshot.name) !== screenshot.name
      || !screenshot.name.endsWith(".png"), `${name}-screenshot-name`);
  }
  const unique = [...new Set(failures)];
  return { failures: unique, status: unique.length ? "fail" : "pass" };
}
