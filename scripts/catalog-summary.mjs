#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regressionCases } from "../regression/catalog/index.mjs";
import { renderCatalogSummary } from "../regression/catalog/report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: catalog-summary.mjs [--write]\nPrints or updates the generated regression catalog.");
  process.exit(0);
}
if (args.some((arg) => arg !== "--write")) throw new Error("Usage: catalog-summary.mjs [--write]");
const output = renderCatalogSummary(regressionCases);
if (args.includes("--write")) {
  await fs.writeFile(path.join(root, "docs", "REGRESSION_CATALOG.md"), output, "utf8");
  console.log(`wrote ${regressionCases.length} cases to docs/REGRESSION_CATALOG.md`);
} else {
  process.stdout.write(output);
}
