import test from "node:test";
import assert from "node:assert/strict";
import { parseProjectPolicy, validateProjectPolicy } from "../src/project-policy.mjs";

const VALID = `schema: codexctl/project-policy/1
launch:
  defaultMode: remote-safe
  injection: explicit
  macOfficial: launch-services
  officialCli: embedded
environment:
  persist: false
relay:
  proxy: null
  noProxy: localhost,127.0.0.1,::1
`;

test("project policy makes Remote-safe launch and non-persistence hard invariants", () => {
  const policy = validateProjectPolicy(parseProjectPolicy(VALID));
  assert.equal(policy.launch.defaultMode, "remote-safe");
  assert.equal(policy.launch.injection, "explicit");
  assert.equal(policy.launch.officialCli, "embedded");
  assert.equal(policy.environment.persist, false);
  assert.equal(policy.relay.proxy, null);
});

test("project policy accepts a credential-free per-launch relay proxy", () => {
  const policy = validateProjectPolicy(parseProjectPolicy(
    VALID.replace("proxy: null", "proxy: socks5://127.0.0.1:10808"),
  ));
  assert.equal(policy.relay.proxy, "socks5://127.0.0.1:10808");
});

test("project policy rejects persistence, unknown fields, and proxy credentials", () => {
  assert.throws(() => validateProjectPolicy(parseProjectPolicy(
    VALID.replace("persist: false", "persist: true"),
  )), /environment\.persist/);
  assert.throws(() => parseProjectPolicy(`${VALID}watcher: true\n`), /未知字段/);
  assert.throws(() => validateProjectPolicy(parseProjectPolicy(
    VALID.replace("proxy: null", "proxy: http://user:secret@127.0.0.1:8080"),
  )), /凭据/);
  assert.throws(() => validateProjectPolicy(parseProjectPolicy(
    VALID.replace("officialCli: embedded", "officialCli: path"),
  )), /launch\.officialCli/);
});
