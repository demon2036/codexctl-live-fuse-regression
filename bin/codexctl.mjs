#!/usr/bin/env node

import { main } from "../src/cli.mjs";

try {
  if (Number(process.versions.node.split(".")[0]) < 22) {
    throw new Error("Node.js 22+ is required; use Node.js 22 or 24 LTS.");
  }
  await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`codexctl: ${message}`);
  if (error?.showHelp) console.error("运行 codexctl help 查看用法。");
  process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
}
