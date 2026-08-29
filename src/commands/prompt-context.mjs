import path from "node:path";
import { loadConfig } from "../config.mjs";
import { UsageError } from "../errors.mjs";
import { recommendedCompactLimit, validateContextPreset } from "../policy.mjs";
import { assertId, formatTokenCount, parseTokenCount } from "../util.mjs";
import {
  assertNoArgs,
  canonicalFile,
  extractOption,
  printJson,
  updateControllerConfig,
} from "../cli-utils.mjs";

export async function commandPrompt(paths, args) {
  const subcommand = args.shift();
  if (subcommand === "list") {
    assertNoArgs(args, "用法：codexctl prompt list");
    const config = await loadConfig(paths);
    const rows = [{ id: "default", label: "Default", path: null }, ...config.prompt.profiles];
    for (const profile of rows) {
      const marker = profile.id === config.prompt.defaultProfileId ? "*" : " ";
      console.log(`${marker} ${profile.id}\t${profile.label}\t${profile.path ?? "Codex built-in"}`);
    }
    return;
  }
  if (subcommand === "status") {
    assertNoArgs(args, "用法：codexctl prompt status");
    const config = await loadConfig(paths);
    printJson({ enabled: config.modules.prompt, defaultProfileId: config.prompt.defaultProfileId,
      profiles: config.prompt.profiles });
    return;
  }
  if (subcommand === "on" || subcommand === "off") {
    assertNoArgs(args, `用法：codexctl prompt ${subcommand}`);
    await updateControllerConfig(paths, (draft) => { draft.modules.prompt = subcommand === "on"; });
    console.log(`Developer Prompt 已${subcommand === "on" ? "启用" : "停用"}；下次完整启动生效。`);
    return;
  }
  if (subcommand === "add") {
    const labelOption = extractOption(args, "--label");
    if (args.length !== 2) throw new UsageError("用法：codexctl prompt add <id> <文件> [--label <名称>]");
    const id = assertId(args[0], "Prompt id");
    if (["default", "original"].includes(id)) throw new UsageError(`${id} 是保留 id。`);
    const filename = await canonicalFile(args[1], 4 * 1024 * 1024, "Prompt");
    const label = String(labelOption ?? path.basename(filename, path.extname(filename))).trim();
    if (!label || label.length > 80) throw new UsageError("Prompt label 长度必须为 1–80。");
    await updateControllerConfig(paths, (draft) => {
      draft.prompt.profiles = draft.prompt.profiles.filter((profile) => profile.id !== id);
      draft.prompt.profiles.push({ id, label, path: filename });
    });
    console.log(`已添加 Prompt ${id}：${filename}；下次完整启动生效。`);
    return;
  }
  if (subcommand === "remove") {
    if (args.length !== 1) throw new UsageError("用法：codexctl prompt remove <id>");
    const id = assertId(args[0], "Prompt id");
    const { result } = await updateControllerConfig(paths, (draft) => {
      const before = draft.prompt.profiles.length;
      draft.prompt.profiles = draft.prompt.profiles.filter((profile) => profile.id !== id);
      if (draft.prompt.defaultProfileId === id) {
        draft.prompt.defaultProfileId = "default";
        draft.prompt.selectionRevision += 1;
      }
      return before !== draft.prompt.profiles.length;
    });
    if (!result) throw new UsageError(`找不到 Prompt：${id}`);
    console.log(`已移除 Prompt 配置 ${id}；原文件未删除，下次完整启动生效。`);
    return;
  }
  if (subcommand === "use") {
    if (args.length !== 1) throw new UsageError("用法：codexctl prompt use <default|id>");
    const id = assertId(args[0], "Prompt id");
    await updateControllerConfig(paths, (draft) => {
      if (id !== "default" && !draft.prompt.profiles.some((profile) => profile.id === id)) {
        throw new UsageError(`找不到 Prompt：${id}`);
      }
      draft.prompt.defaultProfileId = id;
      draft.prompt.selectionRevision += 1;
    });
    console.log(`下次完整启动的默认 Developer Prompt：${id}`);
    return;
  }
  throw new UsageError("用法：codexctl prompt add|remove|use|on|off|list|status ...");
}

export async function commandContext(paths, args) {
  const subcommand = args.shift();
  if (subcommand === "list") {
    assertNoArgs(args, "用法：codexctl context list");
    const config = await loadConfig(paths);
    for (const preset of config.context.presets) {
      const marker = preset.id === config.context.defaultPresetId ? "*" : " ";
      if (preset.native) console.log(`${marker} ${preset.id}\tofficial model/provider defaults`);
      else console.log(`${marker} ${preset.id}\twindow=${formatTokenCount(preset.contextWindow)}\tcompact=${formatTokenCount(preset.autoCompactTokenLimit)}\tscope=${preset.scope}`);
    }
    return;
  }
  if (subcommand === "status") {
    assertNoArgs(args, "用法：codexctl context status");
    const config = await loadConfig(paths);
    printJson({ enabled: config.modules.context, defaultPresetId: config.context.defaultPresetId,
      presets: config.context.presets });
    return;
  }
  if (subcommand === "on" || subcommand === "off") {
    assertNoArgs(args, `用法：codexctl context ${subcommand}`);
    await updateControllerConfig(paths, (draft) => { draft.modules.context = subcommand === "on"; });
    console.log(`Context/Compact 已${subcommand === "on" ? "启用" : "停用"}；下次完整启动生效。`);
    return;
  }
  if (subcommand === "use") {
    if (args.length !== 1) throw new UsageError("用法：codexctl context use <preset-id>");
    const id = assertId(args[0], "Context id");
    await updateControllerConfig(paths, (draft) => {
      if (!draft.context.presets.some((preset) => preset.id === id)) {
        throw new UsageError(`找不到 Context preset：${id}`);
      }
      draft.context.defaultPresetId = id;
      draft.context.selectionRevision += 1;
    });
    console.log(`下次完整启动的默认 Context：${id}`);
    return;
  }
  if (subcommand === "set") {
    const compact = extractOption(args, "--compact");
    const scope = extractOption(args, "--scope") ?? "total";
    const id = assertId(extractOption(args, "--id") ?? "custom", "Context id");
    const labelOption = extractOption(args, "--label");
    if (args.length !== 1) throw new UsageError("用法：codexctl context set <window> [--compact <limit>] [--scope total|body_after_prefix] [--id <id>] [--label <名称>]");
    const contextWindow = parseTokenCount(args[0], "Context window");
    const autoCompactTokenLimit = compact ? parseTokenCount(compact, "Compact 阈值")
      : recommendedCompactLimit(contextWindow);
    const label = String(labelOption ?? formatTokenCount(contextWindow)).trim();
    const preset = validateContextPreset({ id, label, contextWindow, autoCompactTokenLimit,
      scope, builtin: false });
    await updateControllerConfig(paths, (draft) => {
      const existing = draft.context.presets.find((item) => item.id === id);
      if (existing?.builtin) throw new UsageError(`内置 preset ${id} 不能被覆盖。`);
      draft.context.presets = draft.context.presets.filter((item) => item.id !== id);
      draft.context.presets.push(preset);
      draft.context.defaultPresetId = id;
      draft.context.selectionRevision += 1;
    });
    console.log(`已设置 ${id}：window=${contextWindow}，compact=${autoCompactTokenLimit}；下次完整启动生效。`);
    return;
  }
  throw new UsageError("用法：codexctl context set|use|on|off|list|status ...");
}
