import net from "node:net";
import { ConfigError } from "./errors.mjs";

export async function allocateLoopbackPort(preferred = 0) {
  if (!Number.isInteger(preferred) || preferred < 0 || preferred > 65535
    || (preferred > 0 && preferred < 1024)) {
    throw new ConfigError("调试端口必须是 0（自动）或 1024–65535。");
  }
  const server = net.createServer();
  server.unref();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: preferred, exclusive: true }, resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("无法取得 loopback 端口");
    return address.port;
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      throw new ConfigError(`调试端口 127.0.0.1:${preferred} 已被占用。`);
    }
    throw error;
  } finally {
    await new Promise((resolve) => server.close(() => resolve())).catch(() => {});
  }
}

export async function loopbackPortOpen(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
