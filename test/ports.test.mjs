import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { allocateLoopbackPort, loopbackPortOpen } from "../src/ports.mjs";

test("automatic CDP allocation returns a free non-privileged loopback port", async () => {
  const port = await allocateLoopbackPort(0);
  assert.ok(port >= 1024 && port <= 65535);
  assert.equal(await loopbackPortOpen(port), false);
});

test("an explicitly occupied CDP port fails closed", async (t) => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  await assert.rejects(allocateLoopbackPort(port), /已被占用/);
});
