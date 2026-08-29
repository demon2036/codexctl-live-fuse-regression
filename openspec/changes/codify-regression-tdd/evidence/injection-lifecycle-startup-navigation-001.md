# INJECTION-LIFECYCLE-STARTUP-NAVIGATION-001

## 缺陷

在 `codexctl app --inject` 启动期间切换具体 Session 时，Prompt/Context 控件可能暂时消失。旧 preload 把当前文档中的控件可见性当成整个安装是否成功；任务数据较晚到达时，renderer 也没有后续业务事件重新挂载控件。

## Red 证据

- Parent revision：`d1f390148ff587742a152e4d49c46a539cc87df3`
- 命令：`node --test test/macos-preload-hook.test.mjs test/prompt-performance.test.mjs`
- preload 断言按预期收到 `Prompt/Context controls were not visible`，或旧文档执行被导航悬挂而不产生回执。
- renderer 断言按预期发现 `thread/read` 完成后没有安排有界 UI 修复。
- 边界导航、早于 renderer 指标的 Electron 导航和一次性 listener 释放分别产生对应 Red。

## Green 边界

- preload 与父事务共用只读有界预算，永久缺控件一次失败，不用默认重试掩盖。
- Electron 主文档导航立即废弃旧安装代次，最终文档只重装最新代次。
- 没有 composer 的登录/首页可明确返回 controls dormant；一旦存在 composer，仍要求两个控件唯一且可见。
- `thread/read`、`thread/resume` 或 `thread/turns/list` 完成且控件确实缺失时，复用现有最多 3 个导航修复 timer。
- 普通 App 请求、打字和滚动不触发修复；不增加 observer、轮询、worker 或常驻 controller。
- 回执前要求导航 timer 为 0；回执后 preload 的 DOM/navigation listener 全部为 0。

## 验证

- 定向 Node：Green。
- 全量 Node：Green。
- 真实 Chrome：Green。
- 两个临时 profile 的真实隔离 Electron renderer 均确认 Prompt/Context 各一份、可见，且稳态 diagnostics 不随输入或滚动增长。
- production LaunchServices 环境通过显式 `open --env` 进入隔离实例；真实 L5 证据必须另行绑定最终 revision，不以本文件中的历史探针代替。
