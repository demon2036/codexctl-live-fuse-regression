#!/usr/bin/env node

import { runRendererBenchmark } from "../regression/renderer-benchmark.mjs";

const rawArgs = process.argv.slice(2);
const inputOnly = rawArgs.includes("--input-only");
const help = rawArgs.includes("--help");
const args = rawArgs.filter((value) => !["--input-only", "--help"].includes(value));
if (help) {
  console.log("Usage: benchmark-renderer.mjs <port> [label] [--input-only]");
  process.exit(0);
}
if (args.some((value) => value.startsWith("--"))) {
  throw new Error("Usage: benchmark-renderer.mjs <port> [label] [--input-only]");
}
const port = Number(args[0]);
const label = args[1] ?? "renderer";
const report = await runRendererBenchmark({ inputOnly, label, port });
console.log(JSON.stringify(report, null, 2));
