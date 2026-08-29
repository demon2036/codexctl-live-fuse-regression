import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  applyRelayEnvironment,
  describeRelay,
  parseRelayOverrides,
  sanitizedBaseEnvironment,
} from "../src/relay.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function runBridge(bridge, env, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridge, "app-server"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("bridge test timed out"));
    }, 5000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

test("zero -c options means official mode", () => {
  assert.deepEqual(parseRelayOverrides([]), { enabled: false, values: {} });
});

test("relay accepts caller-provided url/key/proxy and redacts descriptions", () => {
  const relay = parseRelayOverrides([
    "url=https://relay.example/v1",
    "key_env=TEST_RELAY_KEY",
    "proxy=http://127.0.0.1:10808",
    "websockets=false",
  ], { TEST_RELAY_KEY: "secret-value" });
  assert.equal(relay.enabled, true);
  assert.equal(relay.values.apiKey, "secret-value");
  assert.equal(describeRelay(relay).key, "<redacted:12>");
  const environment = applyRelayEnvironment(sanitizedBaseEnvironment({
    CODEX_CLI_PATH: "/old/bridge",
    CODEX_APP_BASE_URL: "https://old.invalid",
    KEEP_ME: "yes",
  }), relay);
  assert.equal(environment.KEEP_ME, "yes");
  assert.equal(environment.CODEX_APP_BASE_URL, "https://relay.example/v1");
  assert.equal(environment.HTTP_PROXY, "http://127.0.0.1:10808");
  assert.equal(environment.CODEX_APP_WEBSOCKETS, "false");
});

test("one composite -c argument is the primary relay override interface", () => {
  const relay = parseRelayOverrides([
    "url=https://relay.example/v1;key_env=TEST_RELAY_KEY;proxy=http://127.0.0.1:10808;websockets=false",
  ], { TEST_RELAY_KEY: "secret-value" });
  assert.equal(relay.enabled, true);
  assert.equal(relay.values.url, "https://relay.example/v1");
  assert.equal(relay.values.apiKey, "secret-value");
  assert.equal(relay.values.websockets, false);
  assert.equal(relay.values.standaloneWebSearch, false);
});

test("project proxy defaults apply only to an explicit relay launch and CLI wins", () => {
  const defaults = { proxy: "http://127.0.0.1:10808", no_proxy: "localhost" };
  assert.deepEqual(parseRelayOverrides([], {}, defaults), { enabled: false, values: {} });
  const inherited = parseRelayOverrides([
    "url=https://relay.example/v1;key=test-only",
  ], {}, defaults);
  assert.equal(inherited.values.proxy, "http://127.0.0.1:10808");
  assert.equal(inherited.values.noProxy, "localhost");
  const overridden = parseRelayOverrides([
    "url=https://relay.example/v1;key=test-only;proxy=socks5://127.0.0.1:10809",
  ], {}, defaults);
  assert.equal(overridden.values.proxy, "socks5://127.0.0.1:10809");
});

test("relay rejects partial, duplicate, and unknown overrides", () => {
  assert.throws(() => parseRelayOverrides(["url=https://relay.example/v1"]), /key/);
  assert.throws(() => parseRelayOverrides([
    "url=https://relay.example/v1",
    "url=https://second.example/v1",
    "key=x",
  ]), /重复/);
  assert.throws(() => parseRelayOverrides([
    "url=https://relay.example/v1",
    "key=x",
    "profile=polo",
  ]), /未知/);
});

test("bridge uses a non-reserved provider, confirms successful initialize, and never puts the key in argv", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-relay-bridge-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = path.join(directory, "runtime");
  const fakeCli = path.join(directory, "fake-cli.mjs");
  const argsFile = path.join(directory, "args.json");
  const handshake = path.join(runtime, "relay-handshake-11111111-2222-4333-8444-555555555555.json");
  await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
  await fs.writeFile(fakeCli, `#!/usr/bin/env node
import fs from "node:fs";
import { createInterface } from "node:readline";
fs.writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method !== "initialize") return;
  process.stdout.write(JSON.stringify({
    id: request.id,
    result: { requiresOpenaiAuth: false, account: null, authMethod: null },
  }) + "\\n", () => process.exit(0));
});
`, { mode: 0o700 });
  const bridge = path.resolve(here, "../bridge/codexctl-bridge.mjs");
  const key = "test-key-that-must-not-enter-argv";
  const bridgeResult = await runBridge(bridge, {
      ...process.env,
      HOME: directory,
      CODEX_HOME: path.join(directory, "codex-home"),
      CODEXCTL_HOME: directory,
      CODEXCTL_OFFICIAL_CLI: fakeCli,
      CODEXCTL_RELAY_HANDSHAKE: handshake,
      CODEX_APP_BASE_URL: "https://relay.example/v1",
      CODEX_APP_API_KEY: key,
      CODEX_APP_WEBSOCKETS: "true",
      CODEX_APP_STANDALONE_WEB_SEARCH: "false",
      FAKE_ARGS_FILE: argsFile,
    }, { id: "init-test", method: "initialize", params: {} });
  assert.equal(bridgeResult.code, 0, bridgeResult.stderr);
  const argv = JSON.parse(await fs.readFile(argsFile, "utf8"));
  const argvText = JSON.stringify(argv);
  assert.match(argvText, /model_provider=\\?"openai-custom/);
  assert.match(argvText, /model_providers\.openai-custom\.base_url/);
  assert.doesNotMatch(argvText, /model_providers\.openai\.base_url/);
  assert.doesNotMatch(argvText, /codexctl_relay/);
  assert.equal(argvText.includes(key), false);
  const confirmationText = await fs.readFile(handshake, "utf8");
  const confirmation = JSON.parse(confirmationText);
  assert.equal(confirmation.provider, "openai-custom");
  assert.equal(confirmationText.includes(key), false);
  assert.match(bridgeResult.stdout, /"id":"init-test"/);
  assert.equal(bridgeResult.stderr, "");
});

test("bridge never confirms relay when the official CLI fails before initialize", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-relay-failure-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = path.join(directory, "runtime");
  const fakeCli = path.join(directory, "failing-cli.mjs");
  const handshake = path.join(runtime, "relay-handshake-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json");
  await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
  await fs.writeFile(fakeCli, "#!/usr/bin/env node\nprocess.exit(78);\n", { mode: 0o700 });
  const result = await runBridge(path.resolve(here, "../bridge/codexctl-bridge.mjs"), {
    ...process.env,
    HOME: directory,
    CODEX_HOME: path.join(directory, "codex-home"),
    CODEXCTL_HOME: directory,
    CODEXCTL_OFFICIAL_CLI: fakeCli,
    CODEXCTL_RELAY_HANDSHAKE: handshake,
    CODEX_APP_BASE_URL: "https://relay.example/v1",
    CODEX_APP_API_KEY: "failure-test-key",
    CODEX_APP_WEBSOCKETS: "true",
    CODEX_APP_STANDALONE_WEB_SEARCH: "false",
  }, { id: "init-failure", method: "initialize", params: {} });
  assert.equal(result.code, 78);
  await assert.rejects(fs.access(handshake));
});
