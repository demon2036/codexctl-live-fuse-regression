import { UsageError } from "./errors.mjs";
import { parseBoolean, redactSecret } from "./util.mjs";

const ALLOWED_KEYS = new Set([
  "url", "key", "key_env", "proxy", "websockets", "no_proxy", "standalone_web_search",
]);

function expandOverrideArguments(pairs) {
  const expanded = [];
  for (const pair of pairs) {
    const source = String(pair).trim();
    // The primary interface is one quoted -c value:
    //   -c 'url=...;key_env=...;proxy=...'
    // Repeated -c remains accepted for shell completion/backward compatibility.
    const chunks = source.split(";").map((value) => value.trim()).filter(Boolean);
    if (!chunks.length) throw new UsageError("-c 不能为空。" );
    expanded.push(...chunks);
  }
  return expanded;
}

function parseHttpUrl(value, name, protocols) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new UsageError(`${name} 不是合法 URL。`);
  }
  if (!protocols.includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new UsageError(`${name} 的协议或凭据格式不受支持。`);
  }
  return parsed.href.replace(/\/$/, "");
}

export function parseRelayOverrides(pairs, env = process.env, defaults = {}) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return { enabled: false, values: {} };
  }
  const values = Object.fromEntries(
    ["proxy", "no_proxy"].flatMap((key) => defaults[key] == null ? [] : [[key, defaults[key]]]),
  );
  const provided = new Set();
  for (const pair of expandOverrideArguments(pairs)) {
    const source = String(pair);
    const separator = source.indexOf("=");
    if (separator < 1) throw new UsageError(`-c 必须使用 key=value：${source}`);
    const key = source.slice(0, separator).trim();
    const value = source.slice(separator + 1).trim();
    if (!ALLOWED_KEYS.has(key)) {
      throw new UsageError(`未知的 -c 键：${key}。可用：url、key、key_env、proxy、websockets、standalone_web_search、no_proxy。`);
    }
    if (provided.has(key)) throw new UsageError(`重复的 -c 键：${key}`);
    if (!value) throw new UsageError(`-c ${key} 不能为空。`);
    values[key] = value;
    provided.add(key);
  }
  if (!values.url) throw new UsageError("使用 bridge 时必须提供 -c url=...。" );
  if (Boolean(values.key) === Boolean(values.key_env)) {
    throw new UsageError("使用 bridge 时必须且只能提供 -c key=... 或 -c key_env=... 之一。" );
  }
  if (values.key_env && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(values.key_env)) {
    throw new UsageError("key_env 必须是合法环境变量名。" );
  }
  const url = parseHttpUrl(values.url, "url", ["http:", "https:"]);
  const apiKey = values.key ?? env[values.key_env];
  if (!apiKey) throw new UsageError(`环境变量 ${values.key_env} 为空或不存在。`);
  if (String(apiKey).length > 8192 || /[\u0000\r\n]/.test(String(apiKey))) {
    throw new UsageError("relay key 长度或字符无效。" );
  }
  const proxy = values.proxy
    ? parseHttpUrl(values.proxy, "proxy", ["http:", "https:", "socks:", "socks5:"])
    : null;
  return {
    enabled: true,
    values: {
      url,
      apiKey,
      keySource: values.key ? "argument" : `env:${values.key_env}`,
      proxy,
      websockets: values.websockets === undefined
        ? true
        : parseBoolean(values.websockets, "websockets"),
      standaloneWebSearch: values.standalone_web_search === undefined
        ? false
        : parseBoolean(values.standalone_web_search, "standalone_web_search"),
      noProxy: (() => {
        const noProxy = values.no_proxy ?? "localhost,127.0.0.1,::1";
        if (noProxy.length > 2048 || /[\u0000\r\n]/.test(noProxy)) {
          throw new UsageError("no_proxy 长度或字符无效。" );
        }
        return noProxy;
      })(),
    },
  };
}

export function sanitizedBaseEnvironment(source = process.env) {
  const environment = { ...source };
  for (const key of [
    "CODEX_CLI_PATH",
    "CODEX_APP_BASE_URL",
    "CODEX_APP_API_KEY",
    "CODEX_APP_WEBSOCKETS",
    "CODEX_APP_STANDALONE_WEB_SEARCH",
    "CODEXCTL_RELAY_HANDSHAKE",
    "CODEXCTL_PRELOAD_SPEC",
    "CODEXCTL_PRELOAD_RESULT",
    "CODEXCTL_LIVE_BOOTSTRAP",
    "CODEX_ELECTRON_USER_DATA_PATH",
    "NODE_OPTIONS",
    "CRS_OAI_KEY",
  ]) delete environment[key];
  return environment;
}

export function applyRelayEnvironment(environment, relay) {
  if (!relay.enabled) return environment;
  environment.CODEX_APP_BASE_URL = relay.values.url;
  environment.CODEX_APP_API_KEY = relay.values.apiKey;
  environment.CODEX_APP_WEBSOCKETS = relay.values.websockets ? "true" : "false";
  environment.CODEX_APP_STANDALONE_WEB_SEARCH = relay.values.standaloneWebSearch ? "true" : "false";
  if (relay.values.proxy) {
    for (const key of [
      "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
      "http_proxy", "https_proxy", "all_proxy",
    ]) environment[key] = relay.values.proxy;
    environment.NO_PROXY = relay.values.noProxy;
    environment.no_proxy = relay.values.noProxy;
  }
  return environment;
}

export function describeRelay(relay) {
  if (!relay.enabled) return { mode: "official" };
  return {
    mode: "relay",
    url: relay.values.url,
    key: redactSecret(relay.values.apiKey),
    keySource: relay.values.keySource,
    proxy: relay.values.proxy,
    websockets: relay.values.websockets,
    standaloneWebSearch: relay.values.standaloneWebSearch,
  };
}
