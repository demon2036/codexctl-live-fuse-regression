// Unit-test geometry only. Chromium regression owns real CSS widths and hit testing.
const controlWidths = { "base-prompt": 80, "context-window": 80,
  "context-usage": 96, provider: 90, "live-control": 72, "control-overflow": 64 };

export function harnessComputedStyle(node) {
  const host = node.classList.contains("cbps-control-host") ? node : node.parentElement;
  let display = node.hidden ? "none" : "block";
  if (node.classList.contains("cbps-control") && host?.classList.contains("cbps-control-host")) {
    const target = node.dataset.composerNavigationTarget;
    const mode = host.dataset.cbpsPresentation ?? "direct";
    const inline = (host.dataset.cbpsInline ?? "").split(" ");
    const shown = target === "control-overflow" ? mode !== "direct"
      : mode === "direct" || mode === "overflow" && inline.includes(target);
    display = shown && !host.hidden ? "inline-flex" : "none";
  }
  const probing = host?.dataset.cbpsProbing === "true" || host?.dataset.cbpsMeasuring === "true";
  return { display, visibility: probing ? "hidden" : "visible", opacity: "1",
    pointerEvents: "auto", gap: "5px", columnGap: "5px", contain: "none", ...node.style };
}

function rect(left, top, width, height) {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
}

export function harnessBoundingRect(node) {
  if (harnessComputedStyle(node).display === "none") return rect(0, 0, 0, 0);
  const host = node.classList.contains("cbps-control-host") ? node : node.parentElement;
  if (host?.classList.contains("cbps-control-host")
    && (node === host || node.classList.contains("cbps-control"))) {
    const controls = host.children.filter((child) => child.classList.contains("cbps-control")
      && harnessComputedStyle(child).display !== "none");
    const widths = controls.map((child) => (controlWidths[child.dataset.composerNavigationTarget] ?? 80)
      + (host.dataset.cbpsDensity === "comfortable" ? 24 : 0));
    const left = Number.parseFloat(host.style.left) || 0;
    const top = Number.parseFloat(host.style.top) || 0;
    if (node === host) return rect(left, top,
      widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 4, 28);
    const index = controls.indexOf(node);
    if (index < 0) return rect(0, 0, 0, 0);
    return rect(left + widths.slice(0, index).reduce((sum, width) => sum + width + 4, 0),
      top, widths[index], 28);
  }
  return { ...node.boundingRect };
}
