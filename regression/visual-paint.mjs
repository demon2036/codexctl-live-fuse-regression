export function classifyPaintStyle(style, { missing = "other" } = {}) {
  if (!style) return missing;
  if (style.backgroundImage !== "none") return "theme";
  const channels = (style.backgroundColor?.match(/[\d.]+/g) || []).map(Number);
  const alpha = channels.length > 3 ? channels[3] : 1;
  if (alpha === 0) return "transparent";
  if (channels.length >= 3 && Math.max(...channels.slice(0, 3)) <= 24 && alpha >= 0.99) {
    return "opaque-black";
  }
  return channels.length >= 3 ? "theme" : "other";
}

export function effectivePaintBackground(direct, overlay, options) {
  const background = classifyPaintStyle(direct, options);
  return background === "transparent" && overlay
    ? classifyPaintStyle(overlay, options)
    : background;
}
