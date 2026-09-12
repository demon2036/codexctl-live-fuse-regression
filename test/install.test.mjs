import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PROJECT_ROOT } from "../src/paths.mjs";
const execFileAsync = promisify(execFile);

test("installer has no automatic takeover path", async () => {
  const source = await fs.readFile(path.join(PROJECT_ROOT, "scripts", "install.sh"), "utf8");
  assert.doesNotMatch(source, /ENABLE_AUTO|auto on|--auto/);
  assert.match(source, /usage: \.\/scripts\/install\.sh \[--no-init\]/);
});

test("installer and installed CLI accept a Node path and destination containing spaces", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-install-lts-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const nodeDirectory = path.join(directory, "node lts");
  await fs.mkdir(nodeDirectory);
  const node = path.join(nodeDirectory, "node");
  await fs.symlink(process.execPath, node);
  const target = path.join(directory, "local bin", "codexctl");
  const env = { ...process.env, PATH: `${nodeDirectory}${path.delimiter}${process.env.PATH}`,
    CODEXCTL_NODE: node, CODEXCTL_BIN_DIR: path.dirname(target),
    CODEXCTL_HOME: path.join(directory, "state") };
  await execFileAsync("sh", [path.join(PROJECT_ROOT, "scripts/install.sh"), "--no-init"], { env });
  assert.equal(await fs.readlink(target), path.join(PROJECT_ROOT, "bin/codexctl"));
  const { stdout } = await execFileAsync(target, ["help"], { env });
  assert.match(stdout, /codexctl live start/);
  await assert.rejects(fs.access(env.CODEXCTL_HOME), { code: "ENOENT" });
});

test("installer rejects an unsupported Node runtime before writing the command", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-old-node-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const node = path.join(directory, "old-node");
  await fs.writeFile(node, '#!/bin/sh\nif [ "$1" = "-p" ]; then echo 20; else echo v20.0.0; fi\n', { mode: 0o755 });
  const targetDirectory = path.join(directory, "bin");
  await assert.rejects(execFileAsync("sh", [path.join(PROJECT_ROOT, "scripts/install.sh"), "--no-init"], {
    env: { ...process.env, CODEXCTL_NODE: node, CODEXCTL_BIN_DIR: targetDirectory },
  }), (error) => error.code === 1 && /Node.js 22\+ is required/.test(error.stderr));
  await assert.rejects(fs.access(targetDirectory), { code: "ENOENT" });
});
