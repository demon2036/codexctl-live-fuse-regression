import path from "node:path";
import { ConfigError } from "./errors.mjs";
import { planAppLaunch } from "./platform.mjs";

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
  return {
    ...plan,
    environment: {
      ...plan.environment,
      CODEXCTL_LIVE_BOOTSTRAP: bootstrapFile,
      NODE_OPTIONS: `--require=${JSON.stringify(paths.liveHostHook)}`,
    },
    liveBootstrapFile: bootstrapFile,
    liveHost: true,
  };
}
