import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const browserCandidates = Object.freeze([
  process.env.CODEXCTL_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean));

export async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("Chrome/Chromium not found; set CODEXCTL_CHROME_PATH");
}

export function resultFromDump(stdout) {
  const encoded = /<pre id="result">([^<]+)<\/pre>/u.exec(stdout)?.[1];
  if (!encoded) throw new Error("Browser regression result was not emitted");
  return JSON.parse(encoded.replaceAll("&quot;", "\"").replaceAll("&amp;", "&"));
}

export function dumpDom(browser, args, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(browser, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let resultReady = false;
    let failure = null;
    const timer = setTimeout(() => {
      failure = new Error("Headless browser regression timed out");
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 4 * 1024 * 1024) {
        failure = new Error("Headless browser output exceeded 4 MiB");
        child.kill("SIGKILL");
      } else if (!resultReady && /<pre id="result">[^<]+<\/pre>/u.test(stdout)) {
        resultReady = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_000); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (resultReady) resolve(stdout);
      else reject(failure ?? new Error(
        `Headless browser exited before results: code=${code} signal=${signal}\n${stderr}`,
      ));
    });
  });
}

export function chromeArgs({ fixtureUrl, profile, virtualTimeMs = null, windowSize }) {
  return [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-extensions",
    "--disable-gpu",
    "--no-default-browser-check",
    "--no-first-run",
    `--user-data-dir=${path.resolve(profile)}`,
    `--window-size=${windowSize}`,
    ...(virtualTimeMs === null ? [] : [`--virtual-time-budget=${virtualTimeMs}`]),
    "--dump-dom",
    fixtureUrl,
  ];
}
