# Legacy 功能对齐

目标不是逐行复制旧实现，而是保留可观察功能并删除造成卡顿的生命周期设计。

## 保留的行为

- 多 Developer Prompt profile、默认选择和新 task request transform；
- 历史 thread 保留 rollout instructions；
- Native 与自定义 Context/compact preset；
- Prompt 与 Context 独立开关；
- 内置/用户 Wallpaper、图片焦点、透明度、外观和 Safe CSS；
- official 默认连接与单次 relay；
- macOS/Linux 的 App 发现、隔离测试与精确清理。

## 主动删除的行为

- LaunchAgent/XDG 自动接管；
- 常驻 supervisor 和模块 worker；
- browser target discovery watcher；
- renderer 全 subtree `MutationObserver`；
- 每条 message/token 的 Dream Skin 标记；
- 大型 legacy CSS、`:has()`、blur/filter 和持续动画；
- 把 hot cleanup 当成官方性能恢复。

## Context 映射

自定义 preset 继续映射到：

```text
model_context_window
model_auto_compact_token_limit
model_auto_compact_token_limit_scope
```

`native` 不写这些字段。Prompt 只在启用且选择非 default 时写 `model_instructions_file`，不会删除请求中的无关配置。

## UI 生命周期

Prompt/Context 在启动时安装控件，并只在真实 navigation 后做三次有界修复。流式 token、字符输入和普通 message 更新不会触发 observer callback，因为 renderer 不再注册全局 observer。

Wallpaper 只在 root 设置 Blob 与静态样式；不枚举 message DOM，不维护 part map。diagnostics 明确报告 observer=0、timer=0、layoutReads=0。

## 恢复语义

旧逻辑尝试在同一个 renderer 内删除 style/global/hook。实际观察表明，同一进程即使撤销仍可能卡，只有完整退出重开恢复。因此新版本的配置切换和 clean 都以完整 App 进程边界为准。

低级 `cleanup()` 仍用于单元测试、安装失败回滚和资源释放，但不再是用户级恢复流程。

## 启动语义

模块默认关闭。用户显式开启后运行 `codexctl app`，控制器一次性注入并退出。普通 Dock/应用菜单打开保持官方原样；这是“无监控”与“自动注入”之间明确选择前者的结果。

## 验收

功能对齐必须同时满足行为与性能：request transform 正确、控件/壁纸可见、无重复安装、无后台进程、输入/滚动 A/B 无明显回归、完整 clean 能恢复无 CDP 官方 App。详细步骤见 [TESTING.md](TESTING.md)。
