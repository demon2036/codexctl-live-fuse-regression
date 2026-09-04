"use strict";

const fs = require("node:fs");
const path = require("node:path");

function resolveThemeAsset(specFile, relativeImage) {
  const runtimeRoot = path.dirname(specFile);
  const themeRoot = fs.realpathSync(path.join(runtimeRoot, "theme"));
  const asset = fs.realpathSync(path.resolve(runtimeRoot, relativeImage));
  const relative = path.relative(themeRoot, asset);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)) {
    throw new Error("Wallpaper asset escaped runtime theme");
  }
  return asset;
}

module.exports = { resolveThemeAsset };
