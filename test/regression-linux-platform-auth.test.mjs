import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { loginIsolatedLinuxProfile } from "../regression/linux-platform-auth.mjs";

function successfulSpawn(calls) {
  return (cli, args, options) => {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.stdin = {
      end(value) {
        calls.push({ args, cli, env: options.env, stdin: value });
        queueMicrotask(() => child.emit("exit", 0, null));
      },
    };
    child.kill = () => {};
    return child;
  };
}

function failingSpawn(secret) {
  return () => {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.stdin = {
      end() {
        child.stderr.end(`upstream echoed ${secret}`);
        queueMicrotask(() => child.emit("exit", 7, null));
      },
    };
    child.kill = () => {};
    return child;
  };
}

test("Linux L5 uses an explicitly offline credential when CI has no secret", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-linux-auth-offline-"));
  const calls = [];
  try {
    assert.deepEqual(await loginIsolatedLinuxProfile({
      cli: "/opt/chatgpt/resources/codex",
      codexHome: path.join(root, "codex-home"),
      env: { HOME: root },
      spawnImpl: successfulSpawn(calls),
    }), {
      method: "offline-shell-fixture", serviceAccess: false, status: "pass",
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].stdin, /^codexctl-offline-shell-fixture\n$/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Linux L5 passes a CI key only through stdin into an owned file-backed profile", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-linux-auth-test-"));
  const calls = [];
  try {
    const codexHome = path.join(root, "codex-home");
    const result = await loginIsolatedLinuxProfile({
      apiKey: "test-key-value", cli: "/opt/chatgpt/resources/codex", codexHome,
      env: { HOME: root }, spawnImpl: successfulSpawn(calls),
    });
    assert.deepEqual(result, { method: "api-key", serviceAccess: true, status: "pass" });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ["login", "--with-api-key"]);
    assert.equal(calls[0].stdin, "test-key-value\n");
    assert.ok(!calls[0].args.join(" ").includes("test-key-value"));
    assert.equal(calls[0].env.CODEX_HOME, codexHome);
    assert.equal(await fs.readFile(path.join(codexHome, "config.toml"), "utf8"),
      'cli_auth_credentials_store = "file"\n');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Linux L5 login failure cannot echo the credential into logs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-linux-auth-fail-"));
  const secret = "test-secret-never-log";
  try {
    await assert.rejects(loginIsolatedLinuxProfile({
      apiKey: secret,
      cli: "/opt/chatgpt/resources/codex",
      codexHome: path.join(root, "codex-home"),
      env: { HOME: root },
      spawnImpl: failingSpawn(secret),
    }), (error) => {
      assert.match(error.message, /exited 7/);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
