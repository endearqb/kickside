# Kimi IM Bridge 实施计划

## 1. 计划摘要

本计划用于把以下目标落成可执行工程任务：

- 新增 `apps/kimi-im-bridge` Go sidecar
- 在 `apps/kimi-shell` 中新增 `IM Channels` 控制面
- 首版打通 Telegram + 飞书
- 使用 `kimi-agent-sdk` 作为唯一 runtime 主接入层
- 让桥接子系统与当前 `kimi web` 启动链路并行存在

本计划默认以 Windows 打包场景为主，且要求每个阶段都有明确入口、出口、验证命令和回归点。

## 2. 预设决策

以下决策在实施前已经锁定，不再在编码阶段重复讨论：

1. 运行体形态：Go sidecar
2. 渠道范围：Telegram + 飞书
3. 宿主：`apps/kimi-shell`
4. 主接入层：`kimi-agent-sdk`
5. 持久化：SQLite + WAL
6. 控制面：Tauri invoke / event + loopback admin API
7. 配置文件：
   - `bridge_settings.json`
   - `bridge_secrets.json`
   - `bridge.db`
   - `logs/bridge.log`

## 3. 总体交付物

### 3.1 代码交付物

- `apps/kimi-im-bridge`
- `apps/kimi-shell` 中新的 bridge Rust 管理模块
- `apps/kimi-shell` Control Center 中新的 IM Channels 面板
- sidecar 打包与发布链路

### 3.2 文档交付物

- 本计划文档
- `docs/kimi-im-bridge-manual-test-runbook.md`
- 最终用户配置说明
- 发布说明 / 回归清单

### 3.3 测试交付物

- Go 单元测试
- bridge SQLite 恢复测试
- Rust 命令层测试
- 前端面板基本交互测试
- 手工联调清单

## 4. Phase 0：脚手架与控制面

### 4.1 目标

建立 sidecar 工程骨架、基础 admin API、shell 托管链路和 Control Center 入口。

### 4.2 任务

1. 新建 `apps/kimi-im-bridge`：
   - `go.mod`
   - `cmd/kimi-im-bridge/main.go`
   - `internal/app`
   - `internal/admin`
   - `internal/config`
   - `internal/logging`
2. 建立 sidecar 启动参数：
   - `--config`
   - `--secrets`
   - `--db`
   - `--log-file`
   - `--admin-port`
   - `--admin-token`
3. 实现最小 admin API：
   - `GET /healthz`
   - `GET /api/v1/status`
4. 在 `apps/kimi-shell` Rust 侧新增：
   - `bridge_manager.rs`
   - `bridge_http_client.rs`
   - `bridge_settings_store.rs`
5. 在前端新增 `IM Channels` 面板，只展示：
   - bridge 总开关
   - admin port
   - Telegram / 飞书启用状态
   - Start / Stop / Restart
   - 日志入口

### 4.3 入口条件

- 三份设计文档已定稿
- sidecar 目录结构和命名已锁定

### 4.4 出口条件

- `kimi-shell` 可启动和停止一个空壳 sidecar
- Control Center 可显示基础 bridge 状态
- sidecar 健康检查与日志文件路径可用

### 4.5 验证命令

```powershell
go test ./...
go build ./cmd/kimi-im-bridge
pnpm -C apps/kimi-shell build
cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml
```

## 5. Phase 1：核心域模型与 SQLite

### 5.1 目标

实现 bindings、offsets、delivery events、approvals 和 session 元数据存储，完成基本路由与去重骨架。

### 5.2 任务

1. 定义统一模型：
   - `BindingKey`
   - `InboundMessage`
   - `SessionBinding`
   - `ApprovalTicket`
   - `OutboundMessage`
   - `ChannelStatus`
2. 实现 `internal/store`：
   - schema 初始化
   - migrations / `PRAGMA user_version`
   - WAL 模式
3. 创建以下表：
   - `bridge_channels`
   - `channel_bindings`
   - `channel_offsets`
   - `bridge_sessions`
   - `approval_requests`
   - `delivery_events`
4. 实现 `binding router`：
   - `ResolveBinding(BindingKey)`
   - `CreateBinding(BindingKey -> kimiSessionId)`
   - `ClearBinding(bindingId)`
   - `Rebind(bindingId -> kimiSessionId)`
5. 实现第一版去重：
   - adapter 级 offset 去重
   - `delivery_key` 幂等
   - `approval_requests.dedupe_key`

### 5.3 入口条件

- Phase 0 完成
- sidecar 可稳定启动

### 5.4 出口条件

- SQLite schema 稳定
- bindings / offsets / approvals / delivery events 可写可读
- sidecar 重启后可恢复持久化数据

### 5.5 验证命令

```powershell
go test ./internal/store/...
go test ./internal/binding/...
go test ./...
```

## 6. Phase 2：Kimi Runtime Adapter

### 6.1 目标

用 Go SDK 打通 session、prompt、streaming、approval、resume。

### 6.2 任务

1. 建立 `internal/runtime`：
   - `session_registry.go`
   - `turn_runner.go`
   - `approval_coordinator.go`
2. 封装 SDK：
   - `NewSession`
   - `Prompt`
   - `Turn.Steps`
   - `ApprovalRequest`
3. 设计 session 串行策略：
   - 同一 `kimiSessionId` 单队列处理
   - 新 turn 前必须消费完上一个 turn
4. 将 runtime 事件转换为统一事件流：
   - 文本内容
   - 状态更新
   - approval request
   - turn 结束 / 错误
5. 实现 approval 闭环：
   - pending ticket 入库
   - resolve 后 resume
6. 补齐启动恢复语义：
   - 启动时扫描 `approval_requests.status = pending`
   - 对没有 live responder 的遗留项直接标记为 `failed`
   - `resolution_payload_json` 写入 `runtime_restarted_before_resume`
7. 收敛 runtime 服务入口：
   - 统一由 runtime service 接收 `Binding + PromptRequest`
   - debug prompt、Telegram、飞书共用同一 prompt 执行与 approval 处理层

### 6.3 入口条件

- Phase 1 schema 和 router 可用
- 本机 Kimi CLI 与 Go SDK 调用可通

### 6.4 出口条件

- 侧车可用 Go SDK 驱动一个本地 session
- 单条 prompt 能完整流式返回
- approval request 能进入 pending 并被 resume

### 6.5 验证命令

```powershell
go test ./internal/runtime/...
go test ./...
```

### 6.6 Deferred Manual Validation

本阶段开发完成后暂不立即执行手工联调；以下用例统一沉淀到 runbook，并在最终统一测试闸门中一次性执行：

1. 本机启动 sidecar
2. 用伪造的 binding 直接触发 prompt
3. 验证文本流、错误处理和 approval 路径
4. sidecar 重启后检查历史 pending approval 已被转为 `failed`

## 7. Phase 3：Telegram Adapter

### 7.1 目标

打通 Telegram 私聊、多轮、恢复、审批按钮和长消息分片。

### 7.2 任务

1. 新增 `internal/adapters/telegram`
2. 实现 long polling：
   - update 拉取
   - offset 保存
   - 启动恢复
3. 将 Telegram 消息转换为 `InboundMessage`
4. 实现 reply：
   - 文本发送
   - 分片发送
   - HTML / plain text 降级
5. 实现 inline approval buttons
6. 实现 Telegram forum topic -> `threadId`
7. 实现 Telegram 适配器级错误分类：
   - token 错误
   - polling 失败
   - sendMessage 失败

### 7.3 入口条件

- Phase 2 完成
- 测试 Bot Token 可用

### 7.4 出口条件

- Telegram 私聊第一轮可自动建 session
- Telegram 私聊多轮可复用 session
- 审批按钮可回写
- sidecar 重启后 offset 恢复有效

### 7.5 验证命令

```powershell
go test ./internal/adapters/telegram/...
go test ./...
```

### 7.6 Deferred Manual Validation

本阶段开发完成后暂不立即执行 Telegram 联调；以下用例统一沉淀到 runbook，并在最终统一测试闸门中一次性执行：

1. Telegram 私聊首次发消息
2. 连续发送第二条消息
3. 触发一次 approval
4. 重启 sidecar 后再次发消息，确认未重复消费历史消息
5. 启动前人为配置 webhook，确认 channel 进入 `error` 且 webhook 不被自动删除
6. 使用无效 bot token 启动，确认 channel 进入 `error` 且不进入 polling

## 8. Phase 4：飞书 Adapter

### 8.1 目标

打通飞书长连接、群聊 / 线程、审批按钮与消息更新。

### 8.2 任务

1. 新增 `internal/adapters/feishu`
2. 实现长连接接入：
   - 鉴权
   - 事件接收
   - checkpoint / 恢复
3. 将飞书消息转换为 `InboundMessage`
4. 支持群聊与线程路由
5. 实现飞书 interactive approval action
6. 实现飞书文本消息回发与 Markdown 降级
7. 实现飞书适配器错误分类：
   - app credential 错误
   - 长连接断链
   - 消息发送失败

### 8.3 入口条件

- Phase 2 完成
- 飞书应用和权限就绪

### 8.4 出口条件

- 飞书私聊和群聊文本路径可用
- 飞书线程可映射到 `threadId`
- 审批操作可回写
- checkpoint 恢复有效

### 8.5 验证命令

```powershell
go test ./internal/adapters/feishu/...
go test ./...
```

### 8.6 Deferred Manual Validation

本阶段开发完成后暂不立即执行飞书联调；以下用例统一沉淀到 runbook，并在最终统一测试闸门中一次性执行：

1. 飞书私聊触发新会话
2. 飞书群聊触发同群多轮
3. 飞书线程绑定已有 session
4. 触发 approval 并从飞书完成处理
5. 使用无效 appId / appSecret 启动，确认 channel 进入 `error`
6. 长连接重连后遇到首个重复投递事件，确认通过 `feishu_checkpoint` 去重

## 9. Phase 5：Control Center 集成与打包

### 9.1 目标

让 `kimi-shell` 成为完整的 bridge 控制中心，并把 sidecar 分发进 Windows 安装包。

### 9.2 任务

1. 完善 Control Center 面板：
   - 配置页
   - 渠道状态页
   - bindings 列表
   - pending approvals
   - 日志 tail
2. Rust 侧实现命令：
   - `get_bridge_settings`
   - `save_bridge_settings`
   - `get_bridge_status`
   - `start_bridge`
   - `stop_bridge`
   - `restart_bridge`
   - `list_bridge_bindings`
   - `clear_bridge_binding`
   - `list_bridge_approvals`
   - `resolve_bridge_approval`
3. 实现 sidecar 打包：
   - dev 构建
   - release 构建
   - Tauri resource / binary 分发
4. 实现日志和错误展示：
   - `bridge.log` tail
   - 最近错误摘要
   - token 掩码显示

### 9.3 入口条件

- Phase 3、4 已完成
- sidecar 在开发环境联调稳定

### 9.4 出口条件

- 安装版可配置并启动 bridge
- 控制中心可完成 bindings / approvals / logs 全链路观察
- sidecar 二进制随安装包分发

### 9.5 验证命令

```powershell
go build ./cmd/kimi-im-bridge
pnpm -C apps/kimi-shell build
pnpm -C apps/kimi-shell tauri build
```

### 9.6 Deferred Manual Validation

本阶段开发完成后暂不立即执行控制中心与安装版手工验证；以下用例统一沉淀到 runbook，并在最终统一测试闸门中一次性执行：

1. 控制中心查看 pending approvals
2. 控制中心手动 resolve approval
3. 查看 `bridge.log` tail 与最近错误
4. 安装版启动、停止、重启 sidecar

## 10. Phase 6：稳定化与发布

### 10.1 目标

补齐恢复、速率限制、错误分类、回归测试和发布资料。

### 10.2 任务

1. 完善断线重连
2. 实现发送速率限制与退避
3. 完善错误分类与日志字段
4. 增加集成测试：
   - bindings 恢复
   - approvals 恢复
   - duplicate inbound 去重
   - delivery 幂等
5. 撰写发布说明和故障排查文档
6. 做安装版手工回归

### 10.3 入口条件

- Phase 5 完成

### 10.4 出口条件

- 关键场景全部通过
- 发布说明与支持文档齐备
- 安装版 smoke test 通过

### 10.5 验证命令

```powershell
go test ./...
pnpm -C apps/kimi-shell build
pnpm -C apps/kimi-shell tauri build
```

### 10.6 Deferred Manual Validation

本阶段开发完成后执行统一手工回归，但在此之前只维护 runbook，不提前拆散执行。至少覆盖：

1. Windows 协作式 stop/restart 对运行中 turn 的影响
2. 打包安装版的配置、日志、停止、重启
3. Telegram / 飞书双渠道恢复、审批、幂等与错误定位

## 11. 测试矩阵

### 11.1 单元测试

- SQLite schema 初始化
- bindings 查找 / 创建 / 重绑 / 清理
- offsets 更新与恢复
- approval 状态迁移
- delivery 分片和幂等键生成
- Telegram / 飞书消息转换
- runtime adapter 流事件解析

### 11.2 集成测试

- 伪造 adapter -> binding router -> runtime adapter -> delivery layer 全链路
- 同一 binding 多轮消息
- 重启后恢复 bindings / offsets / approvals
- 失败场景：
  - invalid token
  - network error
  - SQLite busy
  - SDK turn failed

### 11.3 手工测试

1. Telegram 私聊新建会话并持续多轮
2. 飞书群聊或线程绑定到已有 session
3. 审批从 IM 发起并完成
4. Control Center 处理 pending approvals
5. sidecar / shell 重启恢复
6. 安装版启动、配置、日志查看、停止和重启

## 12. 关键兼容要求

1. `apps/kimi-shell` 的现有 `BackendState` 不得复用于 bridge。
2. bridge 是平行子系统，不改 `kimi web` 启动职责。
3. 前端不直连 sidecar；所有操作都经 Rust 命令层。
4. Shell 或 sidecar 重启后，以 SQLite 恢复 bindings / offsets / approvals；不恢复未完成 turn 的中间流。
5. `kimi-agent-sdk` 是主接口；`kimi acp` 仅在文档和后续增强中保留。

## 13. 风险与缓解计划

| 风险 | 发生阶段 | 缓解策略 |
| --- | --- | --- |
| Go SDK 与 Windows 场景存在兼容性问题 | Phase 2 | 尽早做本机 smoke test；保留 Node POC 作为应急 fallback，但不切主方案。 |
| Telegram / 飞书平台细节差异导致交付层复杂 | Phase 3-4 | delivery layer 统一抽象，平台差异仅留在 adapter 内部。 |
| 控制中心逻辑侵入过深 | Phase 5 | 限制 shell 只做 invoke / status / logs / config，不做平台逻辑。 |
| 安装包 sidecar 分发复杂 | Phase 5 | 尽早验证 dev / release 资源路径，先打通构建，再做 UI。 |

## 14. 完成判定

当以下条件全部满足时，本项目的第一阶段可标记完成：

1. 三份文档中的类型名、表名、phase 名与代码实现一致。
2. Telegram 与飞书都能完成文本、多轮、审批、恢复的 MVP 闭环。
3. Control Center 可完成配置、启停、日志、bindings、approvals 管理。
4. 安装版可分发并托管 sidecar。
5. 关键失败场景均可定位。

## 15. Unified Manual Test Gate

统一手工测试只在 Phase 2-6 代码开发完成后执行，不在阶段中途插入零散联调。执行入口与记录规范如下：

1. 所有手工用例统一登记在 `docs/kimi-im-bridge-manual-test-runbook.md`
2. 每条用例都必须记录：
   - 目标
   - 前置条件
   - 配置 / 账号
   - 操作步骤
   - 期望结果
   - 需保存的证据
   - 实际结果
   - 问题编号
3. 阶段开发过程中只补充用例，不填写“实际结果”
4. 只有当自动化验证稳定通过后，才进入统一手工测试闸门

## 16. 调研依据 / 参考链接

- [项目中文 README](../README_zh.md)
- [Kimi Desktop Shell README](../apps/kimi-shell/README.md)
- [settings_store.rs](../apps/kimi-shell/src-tauri/src/settings_store.rs)
- [app_state.rs](../apps/kimi-shell/src-tauri/src/app_state.rs)
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
