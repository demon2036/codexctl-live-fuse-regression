## Purpose

本能力规定 codexctl 的缺陷修复、性能优化与重构必须遵循可审计的测试先行流程，并通过分层、可复现、不可用跳过或放宽门槛伪造的质量门禁后才能交付。

## ADDED Requirements

### Requirement: 每个行为修复先产生有效 Red
任何改变外部行为的缺陷修复 SHALL 先有一个最小回归测试，并证明该测试在生产实现修改前因预期行为偏差而失败。语法错误、夹具损坏、环境缺失和不相关断言失败 MUST NOT 算作 Red。

#### Scenario: 缺陷修复的 Red 证据有效
- **WHEN** 开始修复一个可观察缺陷
- **THEN** 变更记录包含稳定 case ID、最小复现、修复前命令和预期失败断言，且失败原因直接对应用户可见问题

#### Scenario: 无法自动化的缺陷先定义可执行边界
- **WHEN** 缺陷依赖尚未具备的真实 App 或平台能力而不能立即自动化
- **THEN** 工作先补齐最小测试接口或确定性夹具并保持交付为未通过，不得仅以人工描述跳过 Red

#### Scenario: 纯重构使用 Characterization 测试
- **WHEN** 变更声称不改变外部行为
- **THEN** 先记录现有行为并让 characterization 测试保持 Green，重构前后使用同一断言，若发现行为变化则转为正式 Red/Green 流程

### Requirement: Green 只做满足契约的最小实现
Green 阶段 SHALL 以最小职责改动让新回归测试和既有相关测试通过，不得删除旧断言、扩大容差、修改基线、增加无限重试、使用 `.skip`/`.only` 或只在 mock 中伪造成功。

#### Scenario: 最小实现通过相关测试
- **WHEN** Red 用例已因预期原因失败
- **THEN** 实现只修改解决该失败所需的职责边界，新用例、邻近用例和快速全量门禁全部通过

#### Scenario: 修改预算或期望值需要独立决策
- **WHEN** 实现无法满足现有性能预算、视觉基线或行为断言
- **THEN** 当前修复保持失败；任何预算或契约调整必须作为独立、可审阅的规格变更说明理由，不能与规避失败的实现混在一起

#### Scenario: Mock 不能替代真实边界
- **WHEN** 单元测试通过但缺陷发生在 App 进程、renderer、Remote、文件系统或真实 Chromium 边界
- **THEN** 至少一个更高层用例必须穿过发生缺陷的真实边界后才能判定 Green

### Requirement: Refactor 在全绿状态下保持行为不变
Refactor 阶段 SHALL 在所有相关行为测试为 Green 时进行，按职责拆分并保持每个文本文件不超过 400 行。重构不得引入 watcher、全树 observer、轮询、输入/滚动热路径扫描或无法对称释放的 listener/timer。

#### Scenario: 文件接近上限时按职责拆分
- **WHEN** 任一文本文件达到 320 行或预计改动后可能超过 400 行
- **THEN** 在保持测试全绿的前提下按加载、校验、编译、传输、生命周期或测试职责拆分，禁止压行、删必要说明或创建循环依赖

#### Scenario: 性能敏感重构保持零稳态合同
- **WHEN** 重构 Wallpaper 或 Prompt/Context renderer 代码
- **THEN** 既有 diagnostics 与压力测试继续证明 observer/timer/worker 和输入触发 reconciliation 未增长，cleanup 对所有新增资源对称

### Requirement: 回归门禁采用五层证据
质量门禁 SHALL 将用例映射到五层：L1 单元/纯契约、L2 事务集成、L3 真实 Chromium、L4 隔离 App A/B、L5 目标平台发布验收。低层测试可以加速反馈，但 MUST NOT 替代缺陷实际发生层级的证据。

#### Scenario: 日常修改执行快速层
- **WHEN** 任一实现或测试文件发生变化
- **THEN** L1、L2、静态检查和 400 行门禁必须通过；涉及 renderer 视觉或浏览器行为时 L3 也必须通过

#### Scenario: App 边界修改执行隔离 A/B
- **WHEN** 变更影响启动、进程、Remote、注入、Wallpaper、Prompt/Context、输入、滚动或 CPU
- **THEN** L4 必须在隔离 profile 上执行 official/injected A/B，记录真实 PID、App 版本、metrics 和清理结果

#### Scenario: 发布候选执行目标平台验收
- **WHEN** 变更准备标记为可发布或声称 macOS/Linux 支持完成
- **THEN** 每个受影响平台的 L5 必须真实通过；缺失环境、登录或连接权限只能得到 unverified/blocked 结果，不能得到 pass

### Requirement: 回归目录可追踪且无静默缺口
所有核心回归场景 SHALL 具有稳定 case ID、能力映射、层级、平台、执行命令、预算或断言、证据类型和责任状态。机器校验 MUST 检测重复 ID、没有实现的必选 case、孤立测试和只存在于文档的核心清单项。

#### Scenario: 新回归场景加入目录
- **WHEN** 新缺陷、平台差异或用户可见行为被纳入规格
- **THEN** 对应 case ID 被加入机器可读目录并绑定至少一个可执行测试，必要的 L4/L5 证据要求同时声明

#### Scenario: 测试被删除或改名
- **WHEN** 目录引用的测试路径、名称或 case ID 不再存在
- **THEN** 静态门禁失败并指出缺失映射，不得静默减少覆盖率

#### Scenario: 同一行为跨层覆盖
- **WHEN** 一个 case 同时有纯逻辑、浏览器和 App 边界测试
- **THEN** 目录显示各层互补目的，失败报告能够定位是契约、集成、渲染还是平台问题，而不是重复运行无差别断言

### Requirement: 测试环境确定、隔离且可安全回收
自动回归 SHALL 使用唯一临时目录、动态端口、固定或可记录的夹具和精确拥有关系。测试 MUST 验证目标不属于用户主目录或正在工作的生产 App 后才允许启动、关闭或清理。

#### Scenario: 并发测试互不污染
- **WHEN** 两个测试进程同时运行浏览器或隔离 App 回归
- **THEN** 它们使用不同 profile、端口、runtime 和事务记录，结果与清理只引用各自拥有的资源

#### Scenario: 用户主 App 正在工作
- **WHEN** 检测到不属于本次测试事务的生产 App 实例
- **THEN** 自动测试不得注入、点击、读取、滚动、关闭或替换该实例，并在需要真实主实例验证时等待用户明确授权

#### Scenario: 测试异常退出
- **WHEN** runner 收到错误、超时或终止信号
- **THEN** 它只回收已登记且再次验证身份的子进程、socket 和临时目录，随后执行残留扫描并把未能清理的项目作为失败报告

#### Scenario: fixture 进程晚于临时目录退出
- **WHEN** 测试断言已经结束但其精确拥有的 fixture 进程仍可能写入临时目录
- **THEN** 单一清理边界先按 PID、start time 和 command 验证并等待进程退出，再删除该测试拥有的目录；退出或删除失败必须使测试失败且不得触碰生产 App

### Requirement: 失败必须确定且禁止用重试掩盖
测试 SHALL 使用有界事件等待和明确状态条件，不使用任意 sleep、无限轮询或默认自动重试。外部噪声导致的无效样本 MUST 与产品失败分开报告，并保留原始数据。

#### Scenario: 条件在超时内未满足
- **WHEN** Remote、DOM ready、注入回执或进程退出没有在声明超时内发生
- **THEN** 用例一次性失败并报告最后观测状态、时间线和拥有资源，不通过重复执行把偶发成功当作通过

#### Scenario: 性能样本被判为无效
- **WHEN** 基线稳定性检查发现系统负载、版本、profile 或网络状态不满足前置条件
- **THEN** 样本标记为 invalid、保留原因且不计入通过率；重新采样次数有上限，耗尽后整体结果为未通过

### Requirement: 每次运行生成可审计结果
完整回归 SHALL 输出人类可读摘要和机器可读结果，至少包含源码 revision、dirty 状态、OS/架构、App/内置 CLI/Node/Chromium 版本、case 结果、性能样本、PID/端口/profile、Remote 状态、diagnostics、截图或 computed-style 证据以及清理扫描。结果不得包含凭据、Prompt 正文、会话正文或用户隐私数据。

#### Scenario: 完整回归成功
- **WHEN** 所有必选 case 在要求层级和平台通过且资源已清理
- **THEN** 摘要明确列出 pass 数、性能预算、平台矩阵和零残留结论，机器结果可由 schema 校验并与当前源码 revision 对应

#### Scenario: 任一必选 case 未通过
- **WHEN** 结果包含 fail、unverified、blocked、invalid 耗尽或 cleanup failure
- **THEN** 总体状态不得为 pass，摘要把首个根因和所有未完成门禁分开列出，禁止只输出成功用例数量

### Requirement: 交付门禁不可由文案替代
实现变更 SHALL 只有在需求对应的 Red/Green 证据、快速全量测试、真实边界测试、受影响平台验收和干净资源扫描全部满足后才可宣称完成。用户最终人工确认是额外验收，MUST NOT 替代开发者自测。

#### Scenario: 自动测试通过但真实 App 未验证
- **WHEN** 变更影响真实 App 体验但只执行了 L1-L3
- **THEN** 状态只能是“自动化基础通过、App 回归未完成”，不得交付为完全修复

#### Scenario: 开发者自测完成后请求用户确认
- **WHEN** L1-L5 中所有可用且必需的门禁已经通过并保存证据
- **THEN** 才向用户请求最终验证窗口，并清楚说明会否重启或影响当前工作，不得把探索性测试压力转移给用户

#### Scenario: 工作区或结果与 revision 不一致
- **WHEN** 测试后源码继续变化、存在未说明 dirty 文件或结果 revision 与待交付 revision 不同
- **THEN** 相关门禁失效并必须对最终 revision 重跑，不能沿用旧结果
