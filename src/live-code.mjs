import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const IGNORED = new Set([
  ".git", ".idea", "node_modules", "regression-results", "test", "test-support",
  "regression", "docs", "openspec", "ddadd", ".github",
]);
const CODE = /\.(?:[cm]?js|json|css|wasm|node)$/;

export function isLiveSource(filename) {
  const parts = String(filename ?? "").split(/[\\/]/);
  return !parts.some((part) => IGNORED.has(part) || part.startsWith("."))
    && (CODE.test(parts.at(-1)) || parts.at(-1) === "VERSION");
}

export async function liveCodeRevision(paths) {
  const hash = createHash("sha256");
  async function visit(directory, relative = "") {
    const entries = (await fs.readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (IGNORED.has(entry.name) || entry.name.startsWith(".")) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const filename = path.join(directory, entry.name);
      if (filename === paths.home) continue;
      if (entry.isDirectory()) await visit(filename, name);
      else if (entry.isFile() && isLiveSource(name)) {
        hash.update(`\0${name}\0`).update(await fs.readFile(filename));
      }
    }
  }
  await visit(paths.projectRoot);
  return hash.digest("hex").slice(0, 24);
}
