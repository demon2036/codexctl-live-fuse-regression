import { loadConfig } from "../config.mjs";
import { UsageError } from "../errors.mjs";
import {
  createUserTheme,
  exportThemeArchive,
  importThemeArchive,
  listAvailableThemes,
  loadAvailableTheme,
  removeUserTheme,
} from "../themes.mjs";
import { assertId, parseUnit } from "../util.mjs";
import {
  assertNoArgs,
  canonicalFile,
  extractFlag,
  extractOption,
  printJson,
  updateControllerConfig,
} from "../cli-utils.mjs";

const APPEARANCES = ["auto", "light", "dark"];
const TASK_MODES = ["auto", "ambient", "banner", "full", "off"];
const SAFE_AREAS = ["auto", "left", "right", "center", "none"];
const NEXT_START = "；下次完整启动生效。";

function choice(value, values, label) {
  if (!values.includes(value)) throw new UsageError(`${label} 无效：${value}`);
  return value;
}

async function selectTheme(paths, selected) {
  await updateControllerConfig(paths, (draft) => {
    draft.wallpaper.themeId = selected.id;
    draft.wallpaper.themeSource = selected.source;
    draft.wallpaper.image = null;
    draft.wallpaper.overrides = {};
    draft.modules.wallpaper = true;
  });
}

async function setDirectImage(paths, args) {
  const options = {
    overlayOpacity: extractOption(args, "--opacity"),
    appearance: extractOption(args, "--appearance"),
    taskMode: extractOption(args, "--task-mode"),
    safeArea: extractOption(args, "--safe-area"),
    focusX: extractOption(args, "--focus-x"),
    focusY: extractOption(args, "--focus-y"),
  };
  if (args.length !== 1) throw new UsageError("用法：codexctl wallpaper set <图片> [选项]");
  const image = await canonicalFile(args[0], 10 * 1024 * 1024, "Wallpaper");
  await updateControllerConfig(paths, (draft) => {
    draft.wallpaper.themeId = null;
    draft.wallpaper.themeSource = null;
    draft.wallpaper.image = image;
    draft.wallpaper.overrides = {};
    if (options.appearance !== undefined) {
      draft.wallpaper.appearance = choice(options.appearance, APPEARANCES, "appearance");
    }
    if (options.taskMode !== undefined) {
      draft.wallpaper.taskMode = choice(options.taskMode, TASK_MODES, "task-mode");
    }
    if (options.safeArea !== undefined) {
      draft.wallpaper.safeArea = choice(options.safeArea, SAFE_AREAS, "safe-area");
    }
    for (const key of ["overlayOpacity", "focusX", "focusY"]) {
      if (options[key] !== undefined) draft.wallpaper[key] = parseUnit(options[key], key);
    }
    draft.modules.wallpaper = true;
  });
  console.log(`Wallpaper 已设置并启用：${image}${NEXT_START}`);
}

async function createTheme(paths, args) {
  const options = {
    name: extractOption(args, "--name"),
    tagline: extractOption(args, "--tagline"),
    quote: extractOption(args, "--quote"),
    appearance: extractOption(args, "--appearance") ?? "dark",
    taskMode: extractOption(args, "--task-mode") ?? "auto",
    safeArea: extractOption(args, "--safe-area") ?? "auto",
    focusX: extractOption(args, "--focus-x"),
    focusY: extractOption(args, "--focus-y"),
    overlayOpacity: extractOption(args, "--opacity"),
    sidebarOpacity: extractOption(args, "--sidebar-opacity"),
    composerOpacity: extractOption(args, "--composer-opacity"),
    gradientBias: extractOption(args, "--gradient-bias"),
  };
  const replace = extractFlag(args, "--replace");
  if (args.length !== 2) throw new UsageError("用法：codexctl wallpaper create <id> <图片> [主题选项]");
  choice(options.appearance, APPEARANCES, "appearance");
  choice(options.taskMode, TASK_MODES, "task-mode");
  choice(options.safeArea, SAFE_AREAS, "safe-area");
  for (const key of ["focusX", "focusY", "overlayOpacity", "sidebarOpacity", "composerOpacity"]) {
    if (options[key] !== undefined) options[key] = parseUnit(options[key], key);
  }
  if (options.gradientBias !== undefined) {
    options.gradientBias = parseUnit(options.gradientBias, "gradient-bias", { signed: true });
  }
  const created = await createUserTheme(paths, { id: args[0], image: args[1], ...options }, { replace });
  await selectTheme(paths, { id: created.id, source: "user" });
  console.log(`已创建、选择并启用用户主题：${created.name} (${created.id})${NEXT_START}`);
}

async function transferTheme(paths, subcommand, args) {
  if (subcommand === "import") {
    const replace = extractFlag(args, "--replace");
    if (args.length !== 1) throw new UsageError("用法：codexctl wallpaper import <主题.zip> [--replace]");
    const imported = await importThemeArchive(paths, args[0], { replace });
    await selectTheme(paths, { id: imported.id, source: "user" });
    console.log(`已安全导入、选择并启用：${imported.name} (${imported.id})${NEXT_START}`);
    return;
  }
  const sourceOption = extractOption(args, "--source");
  const force = extractFlag(args, "--force");
  if (args.length < 1 || args.length > 2) {
    throw new UsageError("用法：codexctl wallpaper export [主题 id] <目标.zip> [--source bundled|user] [--force]");
  }
  const config = await loadConfig(paths);
  const id = args.length === 2 ? args[0] : config.wallpaper.themeId;
  if (!id) throw new UsageError("当前使用的是直接图片；请明确给出主题 id。");
  const source = sourceOption ?? (id === config.wallpaper.themeId ? config.wallpaper.themeSource : null);
  const exported = await exportThemeArchive(paths, id, source, args.at(-1), { force });
  console.log(`主题已导出：${exported.output} (${exported.bytes} bytes)`);
}

async function tuneTheme(paths, args) {
  const values = {
    overlayOpacity: extractOption(args, "--opacity"),
    sidebarOpacity: extractOption(args, "--sidebar-opacity"),
    composerOpacity: extractOption(args, "--composer-opacity"),
    gradientBias: extractOption(args, "--gradient-bias"),
    taskMode: extractOption(args, "--task-mode"),
    safeArea: extractOption(args, "--safe-area"),
    focusX: extractOption(args, "--focus-x"),
    focusY: extractOption(args, "--focus-y"),
  };
  assertNoArgs(args, "用法：codexctl wallpaper tune [选项]");
  if (Object.values(values).every((value) => value === undefined)) {
    throw new UsageError("tune 至少需要一个选项。");
  }
  if (values.taskMode !== undefined) choice(values.taskMode, TASK_MODES, "task-mode");
  if (values.safeArea !== undefined) choice(values.safeArea, SAFE_AREAS, "safe-area");
  for (const key of ["overlayOpacity", "sidebarOpacity", "composerOpacity", "focusX", "focusY"]) {
    if (values[key] !== undefined) values[key] = parseUnit(values[key], key);
  }
  if (values.gradientBias !== undefined) {
    values.gradientBias = parseUnit(values.gradientBias, "gradient-bias", { signed: true });
  }
  await updateControllerConfig(paths, (draft) => {
    const target = draft.wallpaper.themeId ? draft.wallpaper.overrides : draft.wallpaper;
    for (const [key, value] of Object.entries(values)) if (value !== undefined) target[key] = value;
  });
  console.log(`Wallpaper 调校已保存${NEXT_START}`);
}

export async function commandWallpaper(paths, args) {
  const subcommand = args.shift();
  if (subcommand === "list") {
    assertNoArgs(args, "用法：codexctl wallpaper list");
    const config = await loadConfig(paths);
    for (const theme of await listAvailableThemes(paths)) {
      const marker = theme.id === config.wallpaper.themeId
        && theme.source === config.wallpaper.themeSource ? "*" : " ";
      console.log(`${marker} ${theme.id}\t${theme.name}\t${theme.appearance ?? "auto"}\t${theme.source}`);
    }
    return;
  }
  if (subcommand === "status") {
    assertNoArgs(args, "用法：codexctl wallpaper status");
    const config = await loadConfig(paths);
    printJson({ enabled: config.modules.wallpaper, ...config.wallpaper });
    return;
  }
  if (subcommand === "on" || subcommand === "off") {
    assertNoArgs(args, `用法：codexctl wallpaper ${subcommand}`);
    await updateControllerConfig(paths, (draft) => {
      if (subcommand === "on" && !draft.wallpaper.themeId && !draft.wallpaper.image) {
        throw new UsageError("请先选择主题或设置图片。");
      }
      draft.modules.wallpaper = subcommand === "on";
    });
    console.log(`Wallpaper 已${subcommand === "on" ? "启用" : "停用"}${NEXT_START}`);
    return;
  }
  if (subcommand === "use") {
    const source = extractOption(args, "--source");
    if (args.length !== 1) throw new UsageError("用法：codexctl wallpaper use <主题 id>");
    const id = assertId(args[0], "Wallpaper id");
    const selected = await loadAvailableTheme(paths, id, source);
    await selectTheme(paths, { id, source: selected.source });
    console.log(`Wallpaper 已切换并启用：${selected.theme.name} (${id})${NEXT_START}`);
    return;
  }
  if (subcommand === "set") return setDirectImage(paths, args);
  if (subcommand === "create") return createTheme(paths, args);
  if (subcommand === "import" || subcommand === "export") return transferTheme(paths, subcommand, args);
  if (subcommand === "remove") {
    if (args.length !== 1) throw new UsageError("用法：codexctl wallpaper remove <用户主题 id>");
    const config = await loadConfig(paths);
    if (config.wallpaper.themeSource === "user" && config.wallpaper.themeId === args[0]) {
      throw new UsageError("不能移除当前正在使用的主题。");
    }
    const removed = await removeUserTheme(paths, args[0]);
    console.log(`用户主题已移到可恢复区：${removed.recoverableAt}`);
    return;
  }
  if (subcommand === "appearance") {
    if (args.length !== 1) throw new UsageError("用法：codexctl wallpaper appearance <auto|light|dark>");
    const appearance = choice(args[0], APPEARANCES, "appearance");
    await updateControllerConfig(paths, (draft) => {
      if (draft.wallpaper.themeId) draft.wallpaper.overrides.appearance = appearance;
      else draft.wallpaper.appearance = appearance;
    });
    console.log(`Wallpaper 外观已设为 ${appearance}${NEXT_START}`);
    return;
  }
  if (subcommand === "tune") return tuneTheme(paths, args);
  if (subcommand === "reset-tuning") {
    assertNoArgs(args, "用法：codexctl wallpaper reset-tuning");
    await updateControllerConfig(paths, (draft) => { draft.wallpaper.overrides = {}; });
    console.log(`已恢复主题自带调校值${NEXT_START}`);
    return;
  }
  throw new UsageError("用法：codexctl wallpaper list|use|set|create|import|export|remove|appearance|tune|reset-tuning|on|off|status ...");
}
