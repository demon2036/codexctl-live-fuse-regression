import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { BrowserSession } from "../src/live-cdp-host.mjs";
import { chromeArgs } from "./browser-runner-support.mjs";

const RESULT = `new Promise((resolve, reject) => {
  const read = () => {
    const result = document.getElementById("result");
    if (!result) { reject(new Error("Fixture result element is missing")); return; }
    const finish = () => {
      if (!result.textContent) return;
      observer.disconnect();
      try { resolve(JSON.parse(result.textContent)); } catch (error) { reject(error); }
    };
    const observer = new MutationObserver(finish);
    observer.observe(result, { childList: true, characterData: true, subtree: true });
    finish();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", read, { once: true });
  else read();
})`;

async function fixtureEndpoint(profile, fixtureUrl, child) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Fixture browser exited before CDP was ready");
    try {
      const text = await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8");
      const port = Number(text.split("\n")[0]);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid fixture port");
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        redirect: "error", signal: AbortSignal.timeout(1000),
      });
      const targets = await response.json();
      const matches = targets.filter((target) => target.type === "page" && target.url === fixtureUrl);
      if (matches.length === 1) {
        const target = matches[0];
        const url = new URL(target.webSocketDebuggerUrl);
        if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || Number(url.port) !== port
          || !/^[a-z0-9-]+$/i.test(target.id) || url.pathname !== `/devtools/page/${target.id}`
          || url.username || url.password || url.search || url.hash) throw new Error("Invalid fixture endpoint");
        return url.href;
      }
    } catch (error) {
      if (/Invalid fixture/.test(error.message)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Owned fixture browser CDP timed out");
}

export async function runFrameFixture(browser, options) {
  const args = chromeArgs(options).filter((arg) => arg !== "--dump-dom");
  args.unshift("--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0");
  const child = spawn(browser, args, { stdio: ["ignore", "ignore", "pipe"] });
  const exited = once(child, "exit");
  exited.catch(() => {});
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  let session;
  try {
    session = await new BrowserSession(await fixtureEndpoint(options.profile, options.fixtureUrl, child)).open();
    const result = await session.send("Runtime.evaluate", {
      expression: RESULT, awaitPromise: true, returnByValue: true,
    }, 30_000);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description
      ?? result.exceptionDetails.text);
    return result.result.value;
  } catch (error) {
    throw new Error(`${error.message}\n${stderr}`);
  } finally {
    session?.close();
    if (child.exitCode === null) child.kill("SIGTERM");
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 3000);
    try { await exited; } finally { clearTimeout(timer); }
  }
}
