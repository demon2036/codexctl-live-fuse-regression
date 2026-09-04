import path from "node:path";
import { ConfigError } from "./errors.mjs";
import { planAppLaunch } from "./platform.mjs";
import { allocateLoopbackPort } from "./ports.mjs";

export async function planLiveAppLaunch(
  config,
  paths,
  relay,
  bootstrapFile,
  options = {},
  env = process.env,
  platform = process.platform,
) {
  if (!path.isAbsolute(String(bootstrapFile ?? ""))) {
    throw new ConfigError("live 启动缺少私有 bootstrap。");
  }
  const plan = await planAppLaunch(config, paths, relay, {
    hidden: options.hidden,
    isolatedProfile: options.isolatedProfile,
    extraArgs: options.extraArgs,
    proxyServer: options.proxyServer,
    officialCliSource: options.officialCliSource,
    inject: false,
  }, env, platform);
  const debugPort = await allocateLoopbackPort(options.debugPort ?? config.app.debugPort);
  return {
    ...plan,
    argv: [
      ...plan.argv,
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${debugPort}`,
    ],
    debugPort,
    injectionEnabled: true,
    injectionTransport: "cdp-live",
    liveBootstrapFile: bootstrapFile,
    liveHost: true,
    liveTransport: "cdp",
  };
}
