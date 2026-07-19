# Agent Profile 与 Connector 解耦绑定

## Status

Accepted

## Decision

- DB migration `0019_agent_room_workflow.sql` 同时建立独立 `agent_connector_bindings(connector_id PRIMARY KEY, agent_id, session_mode, created_at, updated_at)` 关系表；`agent_id` 与 `connector_id` 分别引用 Agent Profile 和 Bridge Channel，并在任一主体删除时只级联删除关系行。Agent Profile 不保存 Connector ID 或凭据，Connector settings/secrets JSON 不保存 Agent 绑定。Connector 与 Agent 均可独立创建、更新和删除。
- 有效 WorkDir 的确定顺序固定为：Connector `defaultWorkDir` 显式 override → 已绑定且仍存在/启用的 Agent `defaultWorkDir` → Bridge 全局 `defaultWorkDir`。绑定失效时 Connector 明确降级为 unbound 并继续使用自身/全局配置，不隐式选择其他 Agent。
- 已绑定 Agent 的 Role Prompt、allowlisted Runtime Controls 与 Session Policy 由 Bridge 后端在接收入站消息时动态解析并加入统一执行请求；`independent_session` 保持既有 per-chat Binding，`same_session` 只允许绑定 Agent 的 `persistent/resume_selected` 明确 pinned Session，并要求 Workspace 精确一致。React 只编辑关系中的 Agent ID/session mode，不访问 Runtime、Admin token 或平台凭据。
- 外部 Connector 执行继续以 Kimi Code Session 为唯一事实来源；migration 0019 的 `bridge_turn_origins` 以 Turn ID 保存不可变的 `origin_kind=connector`、`connector_id` 与可空 `agent_id` 来源，不把秘密写入 Turn/Event。不复制 Session transcript，不让外部 Bot reply 自动触发 Workflow。Agent 可属于多个 Room，V1 不从 Agent 或 Session 猜测 Room/Member，也不伪造 Agent Room Run；桌面/外部 Room 镜像仍是非阻塞后续能力。
- 删除 Connector 只删除 Connector settings/secrets/binding context 与关系行，不删除 Agent；删除 Agent 只删除关系行，不删除 Connector。Connector prune 白名单不得增加 Agent Room 表，关系行仅通过 Connector FK 清理。
- 飞书群聊触发必须同时满足：发送者不是 bot/app、自身 bot open ID 已通过 `GET /open-apis/bot/v3/info` 获取并仅在内存缓存、事件 mentions 中存在该精确 open ID。普通 Prompt 与 `/bridge` command 共用同一个 identity gate；不得再把任意文本前缀 `@` 当作召唤。
- 飞书 Event conversion 必须保留 SDK 的 sender type 与 mention identity；bot info 查询失败时群聊触发 fail closed 并报告 capability degradation，单聊行为保持既有契约。日志和 Doctor 不输出 app secret、token、原始 payload 或完整消息。

## Rationale

- Connector 是平台入口，Agent 是可复用行为配置；双向外键或把凭据放入 Agent 会耦合生命周期并扩大秘密暴露面。
- 在 Bridge 后端解析绑定可保持 React 无 token 架构，并让 Telegram、Feishu、Weixin 共享一致的 Agent 行为与 WorkDir 优先级。
- 精确 bot identity 是多个真实 Bot 同群共存和防自触发循环的必要条件；文本 `@` 前缀无法区分目标 Bot。

## Consequences

- Admin API 增量提供 Connector Binding list/put/delete；Rust/Tauri/TypeScript 增加对应 additive types 与 main-only commands，旧 settings 和旧客户端保持兼容。
- Connector 设置 UI 提供显式 Agent 选择和 Unbound；不可用/已删除 Agent 显示降级，不自动重绑。
- 飞书 websocket 启动的 credential probe 同时承担 bot identity 获取；真实凭据不可用时本地 fake server 可验证协议，但真实多 Bot 共存 Gate 标记 blocked 并写明解除条件。

## Verification

- Config/Store/Rust/TS 测试覆盖 round-trip、旧 settings、Agent/Connector 独立删除、失效绑定和 WorkDir 三层优先级。
- Fake Orchestrator 覆盖绑定 Agent 的 Role/Controls/Session Policy、connector origin metadata 与禁止 bot reply 触发 Workflow。
- 飞书 fake server/event 测试覆盖 bot info cache、精确 mention、其他 Bot mention、自身 bot/app sender、普通命令共用 gate、失败降级与脱敏。
- 真实 Connector 共存、多 Bot 同群和凭据相关验证仅在明确测试环境执行；不可用时记录为 blocked，不发送生产消息。
