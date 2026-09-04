import net from "node:net";
import {
  createLiveFrameDecoder,
  createLiveRequest,
  encodeLiveFrame,
  validateLiveResponse,
} from "./live-protocol.mjs";

export async function callLiveSession({ socketPath, timeoutMs = 3000, ...requestOptions }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error("live request timeout is invalid");
  }
  const request = createLiveRequest(requestOptions);
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const decoder = createLiveFrameDecoder((raw) => {
      try {
        const response = validateLiveResponse(raw, request.requestId);
        if (!response.ok) {
          const error = new Error(response.error.message);
          error.code = response.error.code;
          finish(error);
        } else finish(null, response.result);
      } catch (error) { finish(error); }
    });
    const timer = setTimeout(() => finish(new Error("live request timed out")), timeoutMs);
    socket.once("connect", () => socket.write(encodeLiveFrame(request)));
    socket.on("data", (chunk) => {
      try { decoder(chunk); } catch (error) { finish(error); }
    });
    socket.once("error", finish);
    socket.once("end", () => {
      if (!settled) finish(new Error("live session closed before responding"));
    });
  });
}
