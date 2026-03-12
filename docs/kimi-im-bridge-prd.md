# Kimi IM Bridge 需求文档（PRD）

## 1. 文档信息

- 文档名称：Kimi IM Bridge 需求文档（PRD）
- 适用版本：v1 / MVP
- 当前状态：Draft
- 目标仓库：`kimi-app`
- 关联文档：
  - [Kimi IM Bridge 设计方案](./kimi-im-bridge-design.md)
  - [Kimi IM Bridge 实施计划](./kimi-im-bridge-implementation-plan.md)
  - [项目中文 README](../README_zh.md)

## 2. 背景

`kimi-app` 当前的核心产物是 `apps/kimi-shell`，它已经把 `Kimi Web` 的本地启动、工作区接管、控制中心、日志诊断和 Windows 安装包整合进一个桌面壳中。当前产品边界清晰：桌面壳负责“启动 + 承载 + 管理”，不直接重写 Kimi runtime 本身。

这条产品线已经解决了以下问题：

- 在 Windows 上稳定拉起并托管 `Kimi Web`
- 提供 Control Center、日志、设置、安装引导
- 处理工作目录、会话接管、后端重启、诊断与发布

但它仍然只覆盖“本地桌面入口”。对于正在运行的 Kimi，会话不能通过 Telegram、飞书等 IM 渠道远程驱动，也没有跨渠道的会话绑定、审批闭环和恢复能力。

## 3. 问题陈述

当前缺口主要集中在远程控制和多渠道接入：

1. 用户只能在本机桌面壳中使用 Kimi，无法通过手机或团队 IM 远程触达。
2. Kimi runtime 的多轮上下文、审批请求、日志和异常状态没有映射到 IM 语境。
3. 不同 IM 平台的 chat / group / thread / topic 缺少统一会话键，无法稳定绑定到 Kimi session。
4. 渠道轮询位点、去重键、审批记录和恢复状态当前没有独立持久化层。
5. 如果把各 IM SDK 直接塞进 Tauri UI，本地轮询、WebSocket、鉴权、重试和消息分片会与 UI 生命周期耦合，复杂度和故障面都明显放大。

## 4. 目标与非目标

### 4.1 Goals

MVP 必须达成以下目标：

1. 在 `kimi-app` 内新增一个可托管的本地 IM bridge 子系统，使 Kimi 可被 Telegram 和飞书远程驱动。
2. 采用“`apps/kimi-shell` 控制中心 + `apps/kimi-im-bridge` Go sidecar”架构，而不是把 IM 接入做进 Tauri UI 本体。
3. 通过统一的 `BindingKey(platform/chat/thread)` 机制，把 IM 会话稳定映射到 Kimi session。
4. 支持文本消息、多轮会话、审批请求、长消息分片、重启恢复、日志和状态观测。
5. 使用官方 `kimi-agent-sdk` 作为 Kimi runtime 的主接入层，避免通过 stdout/stderr 文本解析驱动 runtime。
6. 让桌面壳继续承担配置、启停、日志、状态查看和审批兜底，而不是承担渠道网络连接本身。

### 4.2 Non-goals

以下内容不进入 v1 / MVP：

- 不在 Tauri 前端直接接入 Telegram、飞书、Slack 等平台 SDK。
- 不修改现有 `kimi web` 启动链路的职责，不把 bridge 并入当前 `backend_manager` 的业务语义。
- 不在首版支持 Slack、QQ、企业微信、钉钉、Discord、WhatsApp 等额外渠道。
- 不在首版支持语音输入、语音回复、图片上传、文件上传、RAG、cron、MCP 管理面。
- 不把 `kimi acp` 作为首版主接入协议。
- 不承诺恢复未完成 turn 的中间流式状态；首版只恢复 bindings、offsets、approvals 和已存在的 session 关联。

## 5. 调研依据与方案选择

### 5.1 结构性结论

本次方案不照搬某个项目的 UI，而是明确借鉴这些项目共同收敛出来的结构：

`IM adapter -> router / binding -> agent runtime adapter -> delivery layer -> state store`

这是本方案的核心结论。

### 5.2 外部项目对比

| 项目 | 观察到的结论 | 对本项目的价值 |
| --- | --- | --- |
| OpenClaw | Gateway 是一个常驻、单端口、多渠道的控制面；渠道路由是确定性的，并基于统一的 `SessionKey` 建模 group / channel / thread / topic。 | 证明“渠道适配器 + 确定性路由 + 统一会话键”是长期可维护的方向。 |
| CodePilot | Bridge 数据流拆成 `Adapter -> channelRouter -> conversationEngine -> deliveryLayer -> Adapter`，并把 `channel_bindings`、`channel_offsets` 单独落 SQLite；还用 `permission-broker` 把审批转成 IM 按钮。 | 证明桌面产品里存在可行的“本地桥接子系统”模式。 |
| DeerFlow | 服务端架构是 `LangGraph Server + Gateway API + Frontend`；2026-03-07 的 issue [#1009](https://github.com/bytedance/deer-flow/issues/1009) 提出 IM 交互，2026-03-08 的 PR [#1010](https://github.com/bytedance/deer-flow/pull/1010) 合入 Feishu / Slack / Telegram channels，2026-03-10 的 PR [#1040](https://github.com/bytedance/deer-flow/pull/1040) 继续补文件附件上传。 | 证明“agent runtime 外挂 IM channels”的方向成立，但其 IM 能力仍偏新，不适合作为现成基座。 |
| cc-connect | 直接把本地 coding agents 桥接到多平台 IM，支持多项目、多 bot relay、slash commands，且 README 中已把 Kimi Code 标记为 exploring。 | 证明社区已把“本地 coding agent -> IM bridge”视为真实需求。 |
| golembot | 明确支持把 Cursor / Claude Code / OpenCode / Codex 接到 Slack、Telegram、Discord、飞书、钉钉、企业微信，也支持嵌入任意 Node.js 产品或自定义 adapter。 | 证明“网关 / adapter / runtime 解耦”适合做平台化产品。 |
| MuseBot | 已经是通用多 IM LLM bot 基座，覆盖 Telegram、Discord、Slack、飞书、钉钉、企业微信、QQ、微信，并支持流式、多模态、RAG、MCP。 | 证明多 IM 能力成熟，但它更像通用机器人平台，不是本地 coding agent bridge。 |

### 5.3 为什么选择 sidecar，而不是塞进 Tauri UI

选择独立 sidecar 的原因：

1. IM 渠道接入包含轮询、长连接、Webhook / Socket、offset 去重、重试和速率限制，这些都是长期运行进程职责，不应跟前端页面生命周期绑死。
2. `kimi-shell` 已经有控制中心、设置、日志和安装包能力，天然适合承担 sidecar 的配置和宿主管理角色。
3. sidecar 可以无 UI 独立运行，更利于调试、打包、自动恢复和未来复用。
4. sidecar 失败时不会直接拖垮 Tauri UI，也不会把平台 SDK 带进 WebView/Tauri 权限边界。

### 5.4 为什么选择 `kimi-agent-sdk`，而不是 `kimi acp`

选择 `kimi-agent-sdk` 的原因：

1. 官方 README 将其定义为“把 Kimi Code / Kimi CLI agent runtime 暴露给应用的多语言 SDK”。
2. SDK 明确复用 Kimi CLI 现有的配置、tools、skills、MCP servers。
3. SDK 明确支持流式响应、approval、tool call 和程序化 session 编排。
4. Go SDK 已经提供 `NewSession`、`Prompt`、`Turn.Steps`、`ApprovalRequest` 等核心接口，适合做 Windows 单二进制 sidecar。

不选择 `kimi acp` 作为主路径的原因：

1. 官方文档将 `kimi acp` 定位为“启动一个支持多会话的 ACP 服务器”。
2. 官方文档给出的典型场景是 IDE 插件集成、自定义 ACP 客户端开发、多会话并发处理。
3. 对 IM bridge 这种自控两端的本地集成场景，直接接 SDK 少一层协议适配，链路更短、错误面更小。

## 6. 目标用户与核心场景

### 6.1 目标用户

- 个人开发者：离开桌面后，希望通过手机 IM 继续驱动本地 Kimi。
- 小团队负责人：希望在飞书或 Telegram 中直接请求 Kimi 处理工作区问题。
- Kimi 重度用户：希望保留本地桌面壳的稳定性，同时增加远程入口。

### 6.2 核心场景

1. Telegram 私聊触发：用户在手机上向 Telegram Bot 发送任务，bridge 自动绑定或恢复对应 Kimi session，并流式返回结果。
2. 飞书群聊协作：团队在飞书群中触发 Kimi，bridge 按群聊或线程维度绑定到对应 session。
3. 审批请求闭环：Kimi 触发审批，IM 中出现 approve / deny 操作；若 IM 无法完成，则用户可回到 Control Center 处理。
4. 重启恢复：sidecar 或 shell 重启后，bindings、offsets、pending approvals 可恢复，后续消息继续落到正确 session。
5. 控制中心托管：用户在桌面壳中配置 bot token、启停 bridge、查看 logs、查看 bindings 和审批列表。

## 7. MVP 范围

### 7.1 In Scope

- 渠道：Telegram、飞书
- 消息类型：文本消息
- 会话能力：自动绑定、多轮对话、手动重绑、重启恢复
- Kimi 能力：通过 `kimi-agent-sdk` 进行 session 创建、prompt、resume、approval 处理
- 审批：IM inline actions + Control Center 兜底审批
- 交付：长消息分片、基础 Markdown 降级、typing / processing 状态提示
- 状态：SQLite 持久化 bindings / offsets / approvals / sessions / delivery events
- 运维：本地日志、health/status、控制中心启停和状态查看

### 7.2 Out of Scope

- Slack / QQ / 企业微信 / 钉钉 / Discord / WhatsApp
- 语音、图片、文件上传下载
- 多 bot relay、cron、RAG、MCP 可视化管理
- 远程公网暴露 sidecar admin API
- 跨机器部署和多用户共享同一个本地 sidecar

## 8. 功能需求

### 8.1 配置与控制中心

- FR-01：Control Center 提供 “IM Channels” 管理入口。
- FR-02：用户可以配置 Telegram Bot Token、飞书 App ID / App Secret、bridge 开关和日志查看入口。
- FR-03：非敏感配置保存到 `bridge_settings.json`；敏感配置保存到单独 secret 文件，并在 UI 中掩码显示。
- FR-04：前端不得直接连接 sidecar；所有读写配置、启停和审批操作必须经 Tauri invoke / event 中转。

### 8.2 Bridge 生命周期

- FR-05：`apps/kimi-shell` 可以启动、停止、重启 sidecar，并展示 bridge 独立运行状态。
- FR-06：bridge 生命周期必须独立于现有 `BackendState`，不得复用 `kimi web` 的状态枚举。
- FR-07：sidecar 提供本地 `health/status/log` admin API，仅监听 `127.0.0.1`。

### 8.3 渠道适配

- FR-08：Telegram adapter 使用 long polling 接收入站消息并发送回执消息。
- FR-09：飞书 adapter 使用 WebSocket / 长连接模式接收入站消息并发送回执消息。
- FR-10：渠道接入必须支持私聊和基础群聊；线程 / topic 能力按平台能力纳入 BindingKey。

### 8.4 绑定与路由

- FR-11：bridge 使用统一 `BindingKey(platform, account, chat, thread)` 路由消息。
- FR-12：同一 BindingKey 在默认情况下命中同一 Kimi session。
- FR-13：Control Center 可查看当前 bindings，并支持手动清理或重绑。
- FR-14：首次收到未绑定消息时，bridge 自动创建 binding 和 session；已绑定消息必须命中原 session。

### 8.5 Kimi runtime 接入

- FR-15：bridge 通过官方 Go SDK 创建 / 恢复 Kimi session。
- FR-16：bridge 支持多轮 prompt，且后续 prompt 自动复用现有 session。
- FR-17：bridge 支持 approval request 的检测、记录、回写和 `resume(...)`。

### 8.6 交付与渲染

- FR-18：bridge 支持流式文本输出，并能在平台不支持原生流式更新时做分段发送。
- FR-19：bridge 对超长消息进行安全分片。
- FR-20：bridge 对 Markdown 做平台兼容降级。
- FR-21：bridge 记录每次 outbound delivery，用于幂等、重试和排障。

### 8.7 持久化与恢复

- FR-22：bridge 使用 SQLite 保存渠道配置快照、bindings、offsets、approval requests、delivery events。
- FR-23：shell 或 sidecar 重启后，bindings、offsets 和 pending approvals 必须恢复。
- FR-24：bridge 必须对重复入站消息做去重，避免同一条消息重复触发 Kimi。

### 8.8 观测与故障处理

- FR-25：Control Center 必须显示 bridge 当前状态、渠道状态、最近错误和日志入口。
- FR-26：bridge 必须分类记录 token 错误、网络错误、SQLite 锁冲突、SDK turn 失败和消息投递失败。
- FR-27：当 IM 审批失败或平台按钮不可用时，Control Center 必须能查看并手动处理 pending approvals。

## 9. 非功能需求

### 9.1 可靠性

- NFR-01：有效配置下，bridge 启动到 ready 的目标时间不超过 10 秒。
- NFR-02：sidecar 重启后，已持久化的 bindings / offsets / approvals 必须自动恢复。
- NFR-03：同一入站消息在正常网络条件下不得触发重复执行。

### 9.2 性能

- NFR-04：本地 loopback admin API 调用不应成为消息主链路瓶颈。
- NFR-05：在单用户 MVP 负载下，Telegram / 飞书文本交互应保持可接受的首 token 反馈，原则上优先显示 processing / typing 状态。

### 9.3 安全

- NFR-06：所有 admin API 仅监听 `127.0.0.1`，并使用宿主生成的本地 admin token 做二次保护。
- NFR-07：敏感配置不得混入现有 `settings.json`。
- NFR-08：日志默认只记录必要诊断字段，避免明文泄露 bot secret。

### 9.4 可维护性

- NFR-09：渠道 adapter、binding router、runtime adapter、delivery layer、store 必须模块化拆分。
- NFR-10：表结构、接口名、状态枚举、phase 名称在三份文档中保持一致。

## 10. 成功指标

MVP 上线后，以以下指标判断是否达标：

1. 在打包后的 Windows 安装版中，用户可通过 Control Center 完成 Telegram / 飞书配置、启动 bridge 并看到状态。
2. Telegram 私聊与飞书群聊的基础文字会话可连续完成多轮交互。
3. 在 shell 或 sidecar 重启后，bindings、offsets、pending approvals 能恢复，且后续消息继续命中正确 session。
4. 审批请求可以在 IM 或 Control Center 中完成闭环。
5. 发生 token 错误、网络异常、SQLite 锁冲突、SDK turn 失败时，用户能在控制中心或日志中定位问题。

## 11. 依赖与风险

### 11.1 外部依赖

- Kimi CLI 已安装且本机可运行
- 官方 `kimi-agent-sdk` Go 版本可在 Windows 场景稳定工作
- Telegram Bot API 凭据
- 飞书应用凭据与必要权限
- 本地 SQLite 文件系统可写

### 11.2 主要风险

| 风险 | 说明 | 缓解策略 |
| --- | --- | --- |
| 平台 API 差异 | Telegram 与飞书在线程、按钮、格式化能力上差异很大 | delivery layer 统一抽象，adapter 内部做平台适配 |
| 审批交互不一致 | 不同平台按钮能力不同，审批链路容易断 | 保留 Control Center 兜底审批面板 |
| 轮询 / 长连接恢复 | 断线或进程重启后容易丢位点 | `channel_offsets` 持久化，adapter 启动时从 offset 恢复 |
| Sidecar 打包与升级 | Windows 安装包需要分发 sidecar 可执行文件 | 在实施计划中单列打包阶段，明确资源路径与升级策略 |
| 配置与 secrets 泄露 | bot token 若写入通用设置或日志，风险高 | 独立 secret 存储、日志脱敏、前端不直连 sidecar |

## 12. MVP 验收场景

1. 用户在 Telegram 私聊里发送第一条消息，bridge 自动创建 binding 和 Kimi session，并返回流式文本。
2. 用户继续在同一 Telegram 私聊发送第二条消息，bridge 复用同一 session。
3. 用户在飞书群聊或线程中触发 Kimi，bridge 按群 / 线程粒度创建 binding；控制中心可将该 binding 重定向到已有 session。
4. Kimi 触发 approval request，IM 中可 approve / deny；若 IM 无法完成，用户可在 Control Center 完成处理。
5. sidecar 重启后，bridge 继续从上次 offset 拉取消息，不重复处理历史消息。
6. token 错误、网络异常、SQLite 锁冲突、SDK turn 失败时，Control Center 能看到错误摘要和日志入口。

## 13. 调研依据 / 参考链接

### 本地仓库事实

- [项目中文 README](../README_zh.md)
- [Kimi Desktop Shell README](../apps/kimi-shell/README.md)
- [现有设置存储实现](../apps/kimi-shell/src-tauri/src/settings_store.rs)
- [现有应用状态与日志目录实现](../apps/kimi-shell/src-tauri/src/app_state.rs)

### GitHub / 官方资料

- [OpenClaw Gateway Runbook](https://github.com/openclaw/openclaw/blob/main/docs/gateway/index.md)
- [OpenClaw 聊天渠道](https://github.com/openclaw/openclaw/blob/main/docs/zh-CN/channels/index.md)
- [OpenClaw 渠道路由](https://github.com/openclaw/openclaw/blob/main/docs/zh-CN/channels/channel-routing.md)
- [CodePilot ARCHITECTURE](https://github.com/op7418/CodePilot/blob/main/ARCHITECTURE.md)
- [CodePilot README_CN](https://github.com/op7418/CodePilot/blob/main/README_CN.md)
- [CodePilot Bridge 文档](https://www.codepilot.sh/zh/docs/bridge)
- [DeerFlow Architecture](https://github.com/bytedance/deer-flow/blob/main/backend/docs/ARCHITECTURE.md)
- [DeerFlow issue #1009](https://github.com/bytedance/deer-flow/issues/1009)
- [DeerFlow PR #1010](https://github.com/bytedance/deer-flow/pull/1010)
- [DeerFlow PR #1040](https://github.com/bytedance/deer-flow/pull/1040)
- [cc-connect README](https://github.com/chenhg5/cc-connect)
- [golembot README.zh-CN](https://github.com/0xranx/golembot/blob/main/README.zh-CN.md)
- [MuseBot README_ZH](https://github.com/yincongcyincong/MuseBot/blob/main/README_ZH.md)
- [Kimi Agent SDK README](https://github.com/MoonshotAI/kimi-agent-sdk/blob/main/README.md)
- [Kimi Agent SDK Go quickstart](https://github.com/MoonshotAI/kimi-agent-sdk/blob/main/guides/go/quickstart.md)
- [`kimi acp` 官方文档](https://moonshotai.github.io/kimi-cli/zh/reference/kimi-acp.html)
