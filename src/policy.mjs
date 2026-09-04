import { UsageError } from "./errors.mjs";

export function recommendedCompactLimit(contextWindow) {
  if (!Number.isInteger(contextWindow) || contextWindow < 32_000) {
    throw new UsageError("Context window 至少为 32K。" );
  }
  const rounded = Math.floor((contextWindow * 0.9) / 1_000) * 1_000;
  return Math.min(rounded, contextWindow - 16_000);
}

export function validateContextPreset(preset) {
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) {
    throw new UsageError("Context preset 必须是对象。" );
  }
  if (preset.id === "native" || preset.native === true) {
    if (preset.contextWindow != null || preset.autoCompactTokenLimit != null
      || preset.scope != null) {
      throw new UsageError("Native Context 不允许携带 window、compact 或 scope 覆盖。" );
    }
    return {
      ...preset,
      id: "native",
      contextWindow: null,
      autoCompactTokenLimit: null,
      scope: null,
      native: true,
    };
  }
  const contextWindow = Number(preset.contextWindow);
  const autoCompactTokenLimit = Number(preset.autoCompactTokenLimit);
  if (!Number.isInteger(contextWindow) || contextWindow < 32_000 || contextWindow > 4_096_000) {
    throw new UsageError("Context window 必须在 32K–4.096M 之间。" );
  }
  if (!Number.isInteger(autoCompactTokenLimit)
    || autoCompactTokenLimit < 16_000
    || autoCompactTokenLimit > contextWindow - 16_000) {
    throw new UsageError("Compact 阈值必须至少为 16K，并给 context 保留至少 16K。" );
  }
  if (!["total", "body_after_prefix"].includes(preset.scope)) {
    throw new UsageError("Compact scope 只能是 total 或 body_after_prefix。" );
  }
  return {
    ...preset,
    contextWindow,
    autoCompactTokenLimit,
    scope: preset.scope,
  };
}

export function buildThreadConfig({ baseConfig = {}, promptPath = null, context = null } = {}) {
  const nextConfig = { ...baseConfig };
  if (promptPath) nextConfig.model_instructions_file = promptPath;
  if (context) {
    const validated = validateContextPreset(context);
    if (!validated.native) {
      nextConfig.model_context_window = validated.contextWindow;
      nextConfig.model_auto_compact_token_limit = validated.autoCompactTokenLimit;
      nextConfig.model_auto_compact_token_limit_scope = validated.scope;
    }
  }
  return nextConfig;
}

export function transformThreadStart(params, { promptPath = null, context = null } = {}) {
  const next = {
    ...params,
    config: buildThreadConfig({ baseConfig: params?.config, promptPath, context }),
  };
  if (promptPath) next.baseInstructions = null;
  return next;
}
