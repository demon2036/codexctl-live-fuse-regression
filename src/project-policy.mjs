import fs from "node:fs/promises";
import { ConfigError } from "./errors.mjs";

const POLICY_SCHEMA = "codexctl/project-policy/1";
const TOP_LEVEL_KEYS = new Set(["schema", "launch", "environment", "relay"]);
const SECTION_KEYS = Object.freeze({
  launch: new Set(["defaultMode", "injection", "macOfficial", "officialCli"]),
  environment: new Set(["persist"]),
  relay: new Set(["proxy", "noProxy"]),
});

function scalar(source, lineNumber) {
  const value = source.trim();
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch {}
    throw new ConfigError(`codexctl.yaml 第 ${lineNumber} 行字符串无效。`);
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new ConfigError(`codexctl.yaml 第 ${lineNumber} 行字符串无效。`);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (!value || /[\[\]{}&*!|>`]/.test(value)) {
    throw new ConfigError(`codexctl.yaml 第 ${lineNumber} 行值不受支持。`);
  }
  return value;
}

export function parseProjectPolicy(source) {
  const result = {};
  let section = null;
  for (const [index, rawLine] of String(source).split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    if (rawLine.includes("\t")) throw new ConfigError(`codexctl.yaml 第 ${lineNumber} 行不能使用 Tab。`);
    const match = rawLine.match(/^( *)([A-Za-z][A-Za-z0-9]*):(?: +(.*))?$/);
    if (!match || !new Set([0, 2]).has(match[1].length)) {
      throw new ConfigError(`codexctl.yaml 第 ${lineNumber} 行格式无效；只支持两级 mapping。`);
    }
    const [, indentation, key, rawValue] = match;
    if (!indentation) {
      if (!TOP_LEVEL_KEYS.has(key)) throw new ConfigError(`codexctl.yaml 未知字段：${key}`);
      if (Object.hasOwn(result, key)) throw new ConfigError(`codexctl.yaml 重复字段：${key}`);
      if (rawValue === undefined) {
        if (!SECTION_KEYS[key]) throw new ConfigError(`codexctl.yaml ${key} 需要值。`);
        result[key] = {};
        section = key;
      } else {
        result[key] = scalar(rawValue, lineNumber);
        section = null;
      }
      continue;
    }
    if (!section || !SECTION_KEYS[section]?.has(key)) {
      throw new ConfigError(`codexctl.yaml 第 ${lineNumber} 行字段无效：${section ?? "<root>"}.${key}`);
    }
    if (Object.hasOwn(result[section], key)) {
      throw new ConfigError(`codexctl.yaml 重复字段：${section}.${key}`);
    }
    if (rawValue === undefined) throw new ConfigError(`codexctl.yaml ${section}.${key} 需要值。`);
    result[section][key] = scalar(rawValue, lineNumber);
  }
  return result;
}

function assertEqual(value, expected, name) {
  if (value !== expected) throw new ConfigError(`codexctl.yaml ${name} 必须是 ${String(expected)}。`);
}

function validateProxy(value) {
  if (value === null) return null;
  let parsed;
  try { parsed = new URL(value); } catch { throw new ConfigError("codexctl.yaml relay.proxy 不是合法 URL。"); }
  if (!["http:", "https:", "socks:", "socks5:"].includes(parsed.protocol)
    || parsed.username || parsed.password) {
    throw new ConfigError("codexctl.yaml relay.proxy 的协议或凭据格式不受支持。");
  }
  return parsed.href.replace(/\/$/, "");
}

export function validateProjectPolicy(input) {
  assertEqual(input.schema, POLICY_SCHEMA, "schema");
  assertEqual(input.launch?.defaultMode, "remote-safe", "launch.defaultMode");
  assertEqual(input.launch?.injection, "explicit", "launch.injection");
  assertEqual(input.launch?.macOfficial, "launch-services", "launch.macOfficial");
  assertEqual(input.launch?.officialCli, "embedded", "launch.officialCli");
  assertEqual(input.environment?.persist, false, "environment.persist");
  const noProxy = input.relay?.noProxy;
  if (typeof noProxy !== "string" || !noProxy || noProxy.length > 2048 || /[\u0000\r\n]/.test(noProxy)) {
    throw new ConfigError("codexctl.yaml relay.noProxy 无效。");
  }
  return {
    schema: POLICY_SCHEMA,
    launch: {
      defaultMode: "remote-safe",
      injection: "explicit",
      macOfficial: "launch-services",
      officialCli: "embedded",
    },
    environment: { persist: false },
    relay: { proxy: validateProxy(input.relay?.proxy ?? null), no_proxy: noProxy },
  };
}

export async function loadProjectPolicy(paths) {
  let source;
  try {
    source = await fs.readFile(paths.projectPolicyFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new ConfigError(`缺少项目启动策略：${paths.projectPolicyFile}`);
    throw error;
  }
  return validateProjectPolicy(parseProjectPolicy(source));
}
