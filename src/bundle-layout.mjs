import path from "node:path";

// macOS Codex/ChatGPT App 的内嵌 CLI 有两代布局：
//  - 旧布局（≤ 26.928）：CLI 直接在 Contents/Resources/codex。
//  - 统一包布局（26.930 起，codex-package.json layoutVersion 1）：真实二进制在
//    CodexCLI.app/Contents/MacOS/codex，bin/codex 是声明入口 shim，运行时会 exec 到
//    真实二进制。App 自身日志里的 codexCliPath/executablePath/spawnCommand 也指向
//    真实二进制，因此它排在 shim 之前。
// discovery、进程归属匹配和平台回归脚本共用同一份候选，避免各写一份而漏掉新布局。
const MAC_EMBEDDED_CLI_LAYOUTS = Object.freeze([
  ["Contents", "Resources", "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"],
  ["Contents", "Resources", "codex-cli", "bin", "codex"],
  ["Contents", "Resources", "codex"],
]);

export function macEmbeddedCliCandidates(bundle) {
  if (!bundle) return [];
  return MAC_EMBEDDED_CLI_LAYOUTS.map((segments) => path.join(bundle, ...segments));
}
