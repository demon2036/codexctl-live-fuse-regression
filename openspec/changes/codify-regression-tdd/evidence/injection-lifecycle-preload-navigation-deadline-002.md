# INJECTION-LIFECYCLE-PRELOAD-NAVIGATION-DEADLINE-002

## 缺陷

`codexctl app --inject` 在 macOS 冷启动或 renderer 导航期间可能在 15 秒后退出，提示 preload 未返回。旧 hook 把整个安装锁在一个全局 `inFlight` 状态；若旧文档中的 `executeJavaScript` 因导航不再返回，下一份文档的 DOM ready 无法重新安装，也不会生成成功或失败回执。父事务同时使用与 hook 内部阶段无关的固定 15 秒 deadline。

## Red 证据

- Parent revision：`8ac47fc14e0a4c70021a10213bc9b180d9193299`
- 用户边界：`codexctl app --inject` 返回 `macOS preload 未在 15 秒内返回`，事务随后留下干净 official 状态而非有效注入回执。
- 命令：`node --test test/macos-preload-hook.test.mjs`
- 失败一：模拟旧文档执行 Promise 永不返回、随后新文档 DOM ready，fixture 得到 `preload fixture produced no result`。
- 失败二：父事务源码不存在共享 `MAC_PRELOAD_TRANSACTION_TIMEOUT_MS`，仍匹配 `preloadTimeoutMs ?? 15_000`。
- 失败三：永久缺控件只返回 `Prompt/Context controls were not visible after 5000ms`，没有 `stage`、`navigations` 和 `elapsedMs`。
- 同文件其余四个既有启动导航用例保持 Green，证明 Red 对应新增边界而不是通用夹具或语法故障。

## Green 边界

- 主文档导航使旧安装代次失效，下一次 DOM ready 只运行一个最新代次。
- 旧 Promise 后续完成不能提交回执或覆盖新代次。
- hook 与父事务使用同一只读预算来源；父等待覆盖 hook 最坏有界路径及文件交接余量。
- 成功回执仍绑定最终 PID、URL 和启用模块 revision。
- 失败一次性报告最后阶段、导航次数和耗时。
- 成功或失败后 DOM/navigation listener、deadline timer 和 controller 全部释放。
