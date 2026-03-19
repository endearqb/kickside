现在 `kimi-im-bridge` 已经有清晰的 `internal/{adapters,admin,app,binding,config,domain,reliability,runtime,store}` 分层；`runtime` 已拆成 `driver / sdk_driver / service / session_registry / turn_runner / approval_coordinator`；Telegram/Feishu 两边目录也几乎镜像成 `approval / classification / client / mapper / sender / service / types`。同时，`Claude-to-IM` 的核心优势就在于把 bridge manager、channel adapter、conversation engine、permission broker、delivery layer、markdown IR 和 security 都抽成平台无关基础设施。([GitHub][1])

## 一、重构目标

目标不是“把代码搬成另一个项目”，而是把你现在已经存在的几条主线**收口成一个真正的一等 Bridge Core**：

* `app` 只负责组装和启动，不再承载业务判断。
* `bridgecore` 负责统一编排 turn、审批、投递、checkpoint、session binding。
* `providers/kimi` 只负责把 Kimi SDK 事件适配成统一事件流。
* `platforms/{telegram,feishu}` 只负责平台入站、平台 UI、平台发送。
* `adapterkit` 提供 Feishu/Telegram 共享能力：入站归一化、审批 UI 协议、回复渲染、checkpoint 语义、delivery 幂等。
  当前代码里 `app.go` 仍然直接创建 `binding.NewRouter(...)`、`runtime.NewSDKDriver(...)`，并在 `buildAdapter()` 中直接判断 `"telegram"` / `"feishu"`；而 `Claude-to-IM` 的设计则是宿主只提供 `BridgeStore / LLMProvider / PermissionGateway / LifecycleHooks`，核心模块自行围绕统一接口运行。([GitHub][2])

---

## 二、目标目录树

建议把 `internal` 调整为下面这样。这里不是把所有旧目录删掉，而是**重命名主干、抽出共享层**。

```text
apps/kimi-im-bridge/
├─ cmd/
│  └─ kimi-im-bridge/
│     └─ main.go
├─ internal/
│  ├─ app/
│  │  ├─ wire.go                 # 依赖组装（替代现在 app.go 的大部分逻辑）
│  │  └─ service.go              # 进程生命周期 / admin server / adapter start-stop
│  │
│  ├─ bridgecore/
│  │  ├─ types.go                # 核心领域类型：InboundEnvelope / TurnEvent / OutboundMessage
│  │  ├─ orchestrator.go         # turn 编排中枢
│  │  ├─ binding_service.go      # 绑定解析 / 自动建绑定
│  │  ├─ session_router.go       # binding -> runtime session target
│  │  ├─ approval_broker.go      # 审批注册 / claim / resolve / reconcile
│  │  ├─ delivery_service.go     # 平台无关的 delivery 请求 / edit / retry / audit
│  │  ├─ checkpoint_service.go   # fetched/committed checkpoint 语义
│  │  └─ event_sink.go           # turn event 分发接口
│  │
│  ├─ adapterkit/
│  │  ├─ inbound.go              # 共享入站结构 / prompt 抽取结果
│  │  ├─ mention_policy.go       # summon / mention / reply-to-bot 判定
│  │  ├─ threading.go            # thread/root/topic 统一抽象
│  │  ├─ approval_ui.go          # 审批 UI 共享协议
│  │  ├─ reply_renderer.go       # 文本 -> 渲染块 / chunk
│  │  ├─ delivery_exec.go        # 从 reliability 抽上来的执行器
│  │  ├─ idempotency.go          # delivery key / approval key / event key
│  │  └─ checkpoint.go           # checkpoint 比较 / 提交策略
│  │
│  ├─ providers/
│  │  └─ kimi/
│  │     ├─ driver.go            # 原 sdk_driver.go 的宿主化版本
│  │     ├─ stream_adapter.go    # Kimi SDK event -> bridgecore TurnEvent
│  │     ├─ session_pool.go      # 原 session_registry.go
│  │     └─ types.go             # provider 侧 request/result/usage
│  │
│  ├─ platforms/
│  │  ├─ telegram/
│  │  │  ├─ adapter.go           # 原 service.go，平台生命周期和轮询
│  │  │  ├─ inbound_mapper.go    # 原 mapper.go
│  │  │  ├─ approval_ui.go       # 原 approval.go
│  │  │  ├─ sender.go            # 原 sender.go
│  │  │  ├─ client.go
│  │  │  ├─ classifier.go
│  │  │  └─ types.go
│  │  │
│  │  └─ feishu/
│  │     ├─ adapter.go
│  │     ├─ inbound_mapper.go
│  │     ├─ approval_ui.go
│  │     ├─ sender.go
│  │     ├─ client.go
│  │     ├─ classifier.go
│  │     └─ types.go
│  │
│  ├─ admin/
│  ├─ binding/                   # 先保留，后续把核心逻辑迁入 bridgecore/binding_service.go
│  ├─ config/
│  ├─ domain/                    # 可逐步瘦身，只保留纯数据模型
│  ├─ logging/
│  ├─ store/
│  │  ├─ store.go
│  │  ├─ sessions.go
│  │  ├─ approvals.go
│  │  ├─ delivery.go
│  │  ├─ checkpoints.go
│  │  └─ bindings.go
│  └─ security/
│     ├─ validators.go
│     ├─ sender_acl.go
│     └─ rate_limit.go
└─ migrations/
   ├─ 0001_init.sql
   ├─ 0002_approval_runtime_fields.sql
   ├─ 0003_bridge_channel_activity.sql
   ├─ 0004_turns_and_events.sql
   ├─ 0005_session_leases.sql
   ├─ 0006_delivery_expansion.sql
   └─ 0007_channel_checkpoints_v2.sql
```

这个目录树是顺着你当前代码来的，不是凭空想象：当前 `app.go` 同时负责配置加载、store 创建、runtime service 初始化、adapter 构造；`runtime` 已经天然分成 driver / session / approval / turn；而 Telegram/Feishu 已经都有独立 `mapper / approval / sender / service` 文件，正适合把共享部分上提到 `adapterkit`。([GitHub][2])

---

## 三、目录迁移映射

你可以按下面映射搬，不会乱：

```text
现有 -> 目标

internal/app/app.go
  -> internal/app/wire.go
  -> internal/app/service.go

internal/runtime/sdk_driver.go
  -> internal/providers/kimi/driver.go
  -> internal/providers/kimi/stream_adapter.go

internal/runtime/session_registry.go
  -> internal/providers/kimi/session_pool.go

internal/runtime/turn_runner.go
  -> internal/bridgecore/orchestrator.go

internal/runtime/approval_coordinator.go
  -> internal/bridgecore/approval_broker.go

internal/reliability/*
  -> internal/adapterkit/delivery_exec.go

internal/adapters/telegram/service.go
  -> internal/platforms/telegram/adapter.go

internal/adapters/telegram/mapper.go
  -> internal/platforms/telegram/inbound_mapper.go

internal/adapters/telegram/approval.go
  -> internal/platforms/telegram/approval_ui.go

internal/adapters/feishu/service.go
  -> internal/platforms/feishu/adapter.go

internal/adapters/feishu/mapper.go
  -> internal/platforms/feishu/inbound_mapper.go

internal/adapters/feishu/approval.go
  -> internal/platforms/feishu/approval_ui.go
```

---

## 四、核心接口定义

### 1）Bridge Core 对外接口

```go
package bridgecore

import "context"

type PlatformAdapter interface {
	Name() string
	Start(ctx context.Context) error
	Done() <-chan struct{}
}

type BindingResolver interface {
	ResolveBinding(ctx context.Context, key BindingKey) (*SessionBinding, error)
	CreateBinding(ctx context.Context, key BindingKey, sessionID string, workDir string, source string) (*SessionBinding, error)
	UpdateBindingActivity(ctx context.Context, bindingID string, inboundMessageID string, outboundMessageID string) error
}

type RuntimeProvider interface {
	RunTurn(ctx context.Context, target RuntimeTarget, request TurnRequest, sink TurnEventSink) (TurnResult, error)
	ResolveApproval(ctx context.Context, approvalID string, status string, payloadJSON string) error
	ReconcilePendingApprovals(ctx context.Context, reason string) (int, error)
	Close() error
}

type DeliveryService interface {
	Send(ctx context.Context, msg OutboundMessage) (DeliveryReceipt, error)
	Edit(ctx context.Context, mutation OutboundMutation) error
}

type ApprovalStore interface {
	CreateApproval(ctx context.Context, ticket ApprovalTicket) error
	GetApproval(ctx context.Context, approvalID string) (*ApprovalTicket, error)
	ClaimApproval(ctx context.Context, approvalID string, actorID string, claimedAt string) (bool, error)
	ResolveApproval(ctx context.Context, approvalID string, status string, payloadJSON string, resolvedAt string) error
	ListPendingApprovals(ctx context.Context) ([]ApprovalTicket, error)
}

type CheckpointStore interface {
	LoadCheckpoint(ctx context.Context, platform string, kind string) (*ChannelCheckpoint, error)
	CommitCheckpoint(ctx context.Context, platform string, kind string, fetched string, committed string) error
}
```

### 2）Platform 层统一消费的 Bridge Core 类型

```go
package bridgecore

type BindingKey struct {
	Platform  string
	AccountID string
	ChatID    string
	ThreadID  string
}

type SessionBinding struct {
	BindingID      string
	Key            BindingKey
	KimiSessionID  string
	WorkDir        string
	Source         string
	CreatedAt      string
	UpdatedAt      string
	LastInboundID  string
	LastOutboundID string
}

type RuntimeTarget struct {
	Platform string
	ChatID   string
	ThreadID string
}

type TurnRequest struct {
	Prompt        string
	WorkDir       string
	KimiSessionID string
	AutoApprove   bool
	MetadataJSON  string
}
```

### 3）平台适配器与共享层之间的接口

```go
package adapterkit

import "context"

type InboundMapper[T any] interface {
	Normalize(raw T) (NormalizedInbound, bool, error)
}

type ApprovalUI[TDecision any] interface {
	BuildPending(ticket ApprovalView) (RenderedMessage, error)
	DecodeDecision(raw TDecision) (ApprovalDecision, bool, error)
	BuildResolved(ticket ApprovalView, status string) (RenderedMutation, error)
}

type ReplyRenderer interface {
	RenderReply(text string, opts ReplyRenderOptions) ([]RenderedMessage, error)
	SupportsEdit() bool
}

type CheckpointPolicy interface {
	ShouldSkip(current string, incoming string) bool
	NextFetched(current string, incoming string) string
	NextCommitted(current string, incoming string) string
}

type SendExecutor interface {
	Execute(ctx context.Context, operation string, run func(context.Context) error, classify func(error) ErrorClass) error
}
```

---

## 五、统一事件协议

你现在已经有两层事件：

* `DriverEventType`: `step_started / content_delta / status_update / approval_requested / approval_resolved`
* `PromptEvent`: 再补 `turn_started / turn_completed / turn_failed`。([GitHub][3])

建议直接把这两层并成 **一个统一的 TurnEvent 协议**，Bridge Core 只认这一种。

```go
package bridgecore

type EventKind string

const (
	EventTurnAccepted      EventKind = "turn.accepted"
	EventTurnStarted       EventKind = "turn.started"
	EventStepStarted       EventKind = "step.started"
	EventContentDelta      EventKind = "content.delta"
	EventStatusUpdated     EventKind = "status.updated"
	EventApprovalRequested EventKind = "approval.requested"
	EventApprovalResolved  EventKind = "approval.resolved"
	EventDeliveryRequested EventKind = "delivery.requested"
	EventDeliverySent      EventKind = "delivery.sent"
	EventTurnCompleted     EventKind = "turn.completed"
	EventTurnFailed        EventKind = "turn.failed"
)

type TurnEvent struct {
	EventID       string
	Kind          EventKind
	TurnID        string
	KimiSessionID string
	Platform      string
	ChatID        string
	ThreadID      string

	StepIndex     int
	MessageID     string
	TextDelta     string
	ThinkingDelta string
	Status        string

	RequestKind        string
	ApprovalID         string
	RequestPayloadJSON string
	ResolutionJSON     string

	ContextUsage float64
	TokenUsage   TokenUsage

	ErrorCode string
	Error     string
	At        string
}

type TokenUsage struct {
	InputTokens  int64
	OutputTokens int64
	TotalTokens  int64
}
```

### 事件流规则

```text
平台收到消息
  -> inbound normalized
  -> binding resolved
  -> turn.accepted
  -> turn.started
  -> [step.started]
  -> [content.delta...]
  -> [approval.requested -> approval.resolved]
  -> [delivery.requested -> delivery.sent]
  -> turn.completed | turn.failed
```

### 为什么一定要统一成这一层

因为你当前 `turn_runner.go` 已经把 provider 事件转成 `PromptEvent`，再由 adapter 在 callback 里临时消费；这一步其实已经证明“统一事件流”是自然边界。问题只是现在 sink 还是“临时闭包”，不是正式协议。`Claude-to-IM` 也把 conversation engine、permission broker、delivery layer 全都围绕统一流转来做，而不是让 adapter 直接理解 provider 原始事件。([GitHub][4])

---

## 六、SQLite 表扩展方案

你当前数据库已经有：

* `bridge_channels`
* `channel_bindings`
* `channel_offsets`
* `bridge_sessions`
* `approval_requests`
* `delivery_events`
  并且后续 migration 又给 `approval_requests` 加了 `turn_id / step_id`，给 `bridge_channels` 加了 `last_inbound_at / last_outbound_at`。([GitHub][5])

我的建议是：**保留这些表，不做破坏式重命名，只加新表和新列。**

---

### migration 0004_turns_and_events.sql

```sql
CREATE TABLE IF NOT EXISTS bridge_turns (
  turn_id TEXT PRIMARY KEY,
  kimi_session_id TEXT NOT NULL,
  binding_id TEXT NULL,
  platform TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  thread_id TEXT NULL,
  inbound_message_id TEXT NULL,
  prompt_text TEXT NOT NULL,
  status TEXT NOT NULL,                 -- accepted/running/completed/failed/cancelled
  provider_name TEXT NOT NULL,          -- kimi
  started_at TEXT NOT NULL,
  completed_at TEXT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bridge_turns_session
  ON bridge_turns (kimi_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bridge_turns_binding
  ON bridge_turns (platform, chat_id, ifnull(thread_id, ''), created_at DESC);

CREATE TABLE IF NOT EXISTS turn_events (
  event_id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  kimi_session_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  thread_id TEXT NULL,
  kind TEXT NOT NULL,
  step_index INTEGER NULL,
  message_id TEXT NULL,
  approval_id TEXT NULL,
  request_kind TEXT NULL,
  text_delta TEXT NULL,
  thinking_delta TEXT NULL,
  status_text TEXT NULL,
  payload_json TEXT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(turn_id) REFERENCES bridge_turns(turn_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turn_events_turn
  ON turn_events (turn_id, created_at);

CREATE INDEX IF NOT EXISTS idx_turn_events_approval
  ON turn_events (approval_id, created_at);
```

### migration 0005_session_leases.sql

```sql
ALTER TABLE bridge_sessions ADD COLUMN session_state TEXT NULL;          -- active/idle/closed/broken
ALTER TABLE bridge_sessions ADD COLUMN lease_owner TEXT NULL;            -- process id / instance id
ALTER TABLE bridge_sessions ADD COLUMN lease_expires_at TEXT NULL;
ALTER TABLE bridge_sessions ADD COLUMN auto_approve INTEGER NULL;
ALTER TABLE bridge_sessions ADD COLUMN provider_name TEXT NULL;
ALTER TABLE bridge_sessions ADD COLUMN runtime_metadata_json TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_bridge_sessions_lease
  ON bridge_sessions (lease_owner, lease_expires_at);
```

### migration 0006_delivery_expansion.sql

```sql
ALTER TABLE delivery_events ADD COLUMN turn_id TEXT NULL;
ALTER TABLE delivery_events ADD COLUMN step_index INTEGER NULL;
ALTER TABLE delivery_events ADD COLUMN delivery_kind TEXT NULL;          -- reply/approval/edit/callback_ack
ALTER TABLE delivery_events ADD COLUMN renderer TEXT NULL;               -- telegram_html/telegram_plain/feishu_post/feishu_text/card
ALTER TABLE delivery_events ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_events ADD COLUMN target_message_id TEXT NULL;      -- sent platform message id
ALTER TABLE delivery_events ADD COLUMN retry_after_at TEXT NULL;
ALTER TABLE delivery_events ADD COLUMN supersedes_event_id TEXT NULL;    -- edit/replace linkage

CREATE INDEX IF NOT EXISTS idx_delivery_events_turn
  ON delivery_events (turn_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_events_retry
  ON delivery_events (status, retry_after_at);
```

### migration 0007_channel_checkpoints_v2.sql

```sql
CREATE TABLE IF NOT EXISTS channel_checkpoints (
  platform TEXT NOT NULL,
  checkpoint_kind TEXT NOT NULL,         -- telegram_update / feishu_event
  fetched_value TEXT NULL,
  committed_value TEXT NULL,
  last_seen_at TEXT NULL,
  committed_at TEXT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (platform, checkpoint_kind)
);
```

---

## 七、现有表的字段建议

### `channel_bindings`

当前字段已经有 `platform/account_id/chat_id/thread_id/kimi_session_id/work_dir/source/last_inbound_message_id/last_outbound_message_id`，足够作为“会话地址绑定表”。([GitHub][5])

建议新增：

```sql
ALTER TABLE channel_bindings ADD COLUMN binding_state TEXT NULL;         -- active/paused/archived
ALTER TABLE channel_bindings ADD COLUMN last_runtime_status TEXT NULL;   -- completed/failed/waiting_approval
ALTER TABLE channel_bindings ADD COLUMN last_prompt_at TEXT NULL;
ALTER TABLE channel_bindings ADD COLUMN settings_json TEXT NULL;         -- per binding options
```

### `approval_requests`

当前已含 `platform/chat_id/thread_id/request_kind/prompt/status/request_payload_json/resolution_payload_json/dedupe_key`，并已加上 `turn_id / step_id`。([GitHub][5])

建议再加：

```sql
ALTER TABLE approval_requests ADD COLUMN claimed_by_actor_id TEXT NULL;
ALTER TABLE approval_requests ADD COLUMN claimed_at TEXT NULL;
ALTER TABLE approval_requests ADD COLUMN platform_message_id TEXT NULL;   -- 审批卡片/消息 id
ALTER TABLE approval_requests ADD COLUMN resolution_by TEXT NULL;         -- telegram/feishu/admin
ALTER TABLE approval_requests ADD COLUMN request_hash TEXT NULL;
```

### `bridge_channels`

当前已含 `state/last_offset/last_error/last_heartbeat_at`，后续又加了 `last_inbound_at/last_outbound_at`。([GitHub][5])

建议再加：

```sql
ALTER TABLE bridge_channels ADD COLUMN adapter_version TEXT NULL;
ALTER TABLE bridge_channels ADD COLUMN last_ready_at TEXT NULL;
ALTER TABLE bridge_channels ADD COLUMN capabilities_json TEXT NULL;
```

---

## 八、Feishu / Telegram 共享抽象

你现在两边最像的地方，不是 API，而是**生命周期骨架**：

* 都有 `Service`，都持有 `bindings / runtime / store / logger / delivery`；
* 都会在入站消息后 `resolveOrCreateBinding -> ExecuteBindingPrompt -> sendReply`；
* 都会在审批回调时 `GetApprovalByID -> context 校验 -> ResolveApproval -> 更新原消息/卡片`；
* 都把投递交给 `reliability.Executor` 并记录 `delivery_events`。([GitHub][6])

所以共享抽象不要做成“一个大 Adapter 基类”，而要拆成 5 个点。

### 1）InboundMapper

```go
type NormalizedInbound struct {
	MessageID   string
	Platform    string
	AccountID   string
	ChatID      string
	ThreadID    string
	SenderID    string
	SenderName  string
	Text        string
	Mentions    []string
	Attachments []InboundAttachment
	ReceivedAt  string
	RawRef      string
	BindingKey  bridgecore.BindingKey
}
```

#### Telegram 实现策略

* 私聊直接接受。
* 群聊要求“回复 bot”或“@bot”。([GitHub][7])

#### Feishu 实现策略

* `p2p` 直接接受。
* `group/topic_group` 要显式 summon，去掉前导 @ 后才形成 prompt。([GitHub][8])

### 2）ReplyRenderer

```go
type ReplyRenderOptions struct {
	PreferRich bool
	MaxRunes   int
}

type RenderedMessage struct {
	Kind        string            // text/html/post/card/interactive
	Body        string
	ReplyToID   string
	ThreadID    string
	Meta        map[string]string
}
```

#### Telegram 实现策略

* 先 HTML，解析失败回退纯文本。
* 长文本分块。
* 支持 edit。([GitHub][9])

#### Feishu 实现策略

* 先 `post`，失败回退 `text`。
* 审批走 `interactive` card。
* resolved 优先更新卡片，失败再补一条文本。([GitHub][10])

### 3）ApprovalUI

```go
type ApprovalView struct {
	ApprovalID  string
	RequestKind string
	Prompt      string
	ChatID      string
	ThreadID    string
}

type ApprovalDecision struct {
	ApprovalID string
	Status     string
	ActorID    string
	ActorName  string
	ChatID     string
	ThreadID   string
	MessageID  string
	RawJSON    string
}
```

#### Telegram

* 发送 inline keyboard。
* callback data 只放短码和 approval id。
* resolve 后 callback ack + edit 原消息。([GitHub][11])

#### Feishu

* 发送 interactive card。
* action value 带 `approval_id/chat_id/thread_id/decision`。
* resolve 后优先更新卡片，否则 fallback 文本。([GitHub][12])

### 4）CheckpointPolicy

```go
type CheckpointState struct {
	Fetched   string
	Committed string
}

type CheckpointPolicy interface {
	ShouldSkip(state CheckpointState, incoming string) bool
	MarkFetched(state CheckpointState, incoming string) CheckpointState
	MarkCommitted(state CheckpointState, incoming string) CheckpointState
}
```

#### 规则

* **收到 update/event 不等于 committed**
* 只有 `processMessage / processCardAction / processCallback` 成功后才 commit

这是你下一步最应该补强的稳定性点。当前 Telegram 侧已经通过 offset store 管理 `telegram_update`，Feishu 侧也有 checkpoint 读取/推进，但都还是“单值 offset”语义，建议升级为 fetched/committed 双值。([GitHub][6])

### 5）DeliveryAudit

```go
type DeliveryIntent struct {
	Platform        string
	ChatID          string
	ThreadID        string
	Direction       string
	DeliveryKind    string
	DeliveryKey     string
	TurnID          string
	StepIndex       int
	SourceMessageID string
	PayloadJSON     string
}
```

统一由 `bridgecore.delivery_service` 做：

* 幂等 key 生成
* pending -> sent/failed 状态流转
* attempt 计数
* retry/backoff
* sent message id 记录

---

## 九、Orchestrator 的职责

当前 `turn_runner.go` 的职责有点过满：校验请求、生成 turn id、打开 session、消费 stream、注册审批、写 session、回填 events。([GitHub][4])

建议拆成下面三段：

```go
// bridgecore/orchestrator.go
type Orchestrator struct {
	bindings    BindingResolver
	runtime     RuntimeProvider
	approvals   ApprovalStore
	delivery    DeliveryService
	checkpoints CheckpointStore
	turns       TurnStore
	events      TurnEventStore
}

func (o *Orchestrator) HandleInbound(
	ctx context.Context,
	inbound adapterkit.NormalizedInbound,
	defaultWorkDir string,
) error
```

### HandleInbound 内部流程

```text
1. Resolve/Create binding
2. 写 bridge_turns(status=accepted)
3. 调 runtime.RunTurn(..., sink)
4. sink 每来一个 TurnEvent：
   - turn_events 落库
   - content.delta 聚合为 reply buffer
   - approval.requested -> approval_broker.register + platform send pending UI
   - status.updated -> 更新 bridge_sessions / channel_bindings
5. runtime 返回成功：
   - flush reply buffer -> delivery_service.send
   - bridge_turns.status = completed
6. runtime 返回失败：
   - bridge_turns.status = failed
   - 可选发送错误摘要
```

---

## 十、Provider（Kimi）侧怎么改

### 当前问题

`runtime.NewService(...)` 内部自己 new `SessionRegistry` 和 `ApprovalCoordinator`，`TurnRunner` 也直接依赖这些实现。([GitHub][13])

### 目标

把 Kimi provider 变成“只负责把 SDK 驱动成统一 TurnEvent”。

```go
package kimi

type Driver interface {
	OpenSession(req ProviderRequest) (DriverSession, error)
}

type Provider struct {
	driver      Driver
	sessionPool *SessionPool
}

func (p *Provider) RunTurn(
	ctx context.Context,
	target bridgecore.RuntimeTarget,
	request bridgecore.TurnRequest,
	sink bridgecore.TurnEventSink,
) (bridgecore.TurnResult, error)
```

### `SessionPool` 替代现在 `SessionRegistry`

保留你当前“同 session id + workdir + autoApprove 复用，否则重开”的语义，但把 lease 信息同步写到 `bridge_sessions`。你现在这一逻辑已经在 `session_registry.go` 中存在，只是停留在进程内。([GitHub][14])

---

## 十一、`app` 层最终只做什么

### 旧

现在 `app.New()` 同时处理配置、secret、store、runtime、reconcile、adapter build。([GitHub][2])

### 新

`app/wire.go` 只组装依赖：

```go
func Build(opts Options) (*Service, error) {
  cfg := loadConfig(...)
  db := openStore(...)
  approvalStore := store.NewApprovalStore(db)
  turnStore := store.NewTurnStore(db)
  deliveryStore := store.NewDeliveryStore(db)

  provider := kimi.NewProvider(...)
  delivery := bridgecore.NewDeliveryService(...)
  orchestrator := bridgecore.NewOrchestrator(...)

  tg := telegram.NewAdapter(telegram.Options{
    Orchestrator: orchestrator,
    Store: db,
    Logger: logger,
  })

  fs := feishu.NewAdapter(feishu.Options{
    Orchestrator: orchestrator,
    Store: db,
    Logger: logger,
  })

  return &Service{...}
}
```

---

## 十二、建议的实现顺序

### Phase 1：先抽中轴，不动平台行为

1. 新建 `bridgecore/types.go`
2. 新建 `bridgecore/orchestrator.go`
3. 把 `turn_runner.go` 的编排逻辑迁进去
4. `providers/kimi` 接上统一事件
5. Telegram/Feishu 继续复用原 sender/approval/mapper

### Phase 2：再抽 adapterkit

1. 提炼 `NormalizedInbound`
2. 提炼 `ApprovalUI`
3. 提炼 `ReplyRenderer`
4. 提炼 `CheckpointPolicy`

### Phase 3：最后扩表

1. 先加 `bridge_turns / turn_events`
2. 再加 session lease
3. 再升级 delivery/checkpoint 语义

---

## 十三、最小可落地版本

如果你不想一次改太大，我建议先做这 4 个文件，就已经会非常有“收口感”：

```text
internal/bridgecore/types.go
internal/bridgecore/orchestrator.go
internal/providers/kimi/stream_adapter.go
internal/adapterkit/approval_ui.go
```

只做这一步，你的项目就会从：

> adapter 直接驱动 runtime，runtime 再临时回调 adapter

变成：

> platform -> bridgecore -> provider -> turn events -> bridgecore -> platform UI

这就是“差的那口气”。


[1]: https://github.com/endearqb/kimi-app/tree/codex/kimi-im-bridge/apps/kimi-im-bridge/internal "kimi-app/apps/kimi-im-bridge/internal at codex/kimi-im-bridge · endearqb/kimi-app · GitHub"
[2]: https://github.com/endearqb/kimi-app/raw/refs/heads/codex/kimi-im-bridge/apps/kimi-im-bridge/internal/app/app.go "raw.githubusercontent.com"
[3]: https://github.com/endearqb/kimi-app/raw/refs/heads/codex/kimi-im-bridge/apps/kimi-im-bridge/internal/runtime/driver.go "raw.githubusercontent.com"
[4]: https://github.com/endearqb/kimi-app/raw/refs/heads/codex/kimi-im-bridge/apps/kimi-im-bridge/internal/runtime/turn_runner.go "raw.githubusercontent.com"
[5]: https://github.com/endearqb/kimi-app/blob/codex/kimi-im-bridge/apps/kimi-im-bridge/migrations/0001_init.sql "kimi-app/apps/kimi-im-bridge/migrations/0001_init.sql at codex/kimi-im-bridge · endearqb/kimi-app · GitHub"
[6]: https://github.com/endearqb/kimi-app/blob/codex/kimi-im-bridge/apps/kimi-im-bridge/internal/adapters/telegram/service.go "kimi-app/apps/kimi-im-bridge/internal/adapters/telegram/service.go at codex/kimi-im-bridge · endearqb/kimi-app · GitHub"
[7]: https://github.com/endearqb/kimi-app/blob/codex/kimi-im-bridge/apps/kimi-im-bridge/internal/adapters/telegram/mapper.go "kimi-app/apps/kimi-im-bridge/internal/adapters/telegram/mapper.go at codex/kimi-im-bridge · endearqb/kimi-app · GitHub"
[8]: https://github.com/endearqb/kimi-app/blob/codex/kimi-im-bridge/apps/kimi-im-bridge/internal/adapters/feishu/mapper.go "kimi-app/apps/kimi-im-bridge/internal/adapters/feishu/mapper.go at codex/kimi-im-bridge · endearqb/kimi-app · GitHub"
[9]: https://github.com/endearqb/kimi-app/blob/codex/kimi-im-bridge/apps/kimi-im-bridge/internal/adapters/telegram/sender.go "kimi-app/apps/kimi-im-bridge/internal/adapters/telegram/sender.go at codex/kimi-im-bridge · endearqb/kimi-app · GitHub"
[10]: https://github.com/endearqb/kimi-app/blob/codex/kimi-im-bridge/apps/kimi-im-bridge/internal/adapters/feishu/sender.go "kimi-app/apps/kimi-im-bridge/internal/adapters/feishu/sender.go at codex/kimi-im-bridge · endearqb/kimi-app · GitHub"
[11]: https://github.com/endearqb/kimi-app/blob/codex/kimi-im-bridge/apps/kimi-im-bridge/internal/adapters/telegram/approval.go "kimi-app/apps/kimi-im-bridge/internal/adapters/telegram/approval.go at codex/kimi-im-bridge · endearqb/kimi-app · GitHub"
[12]: https://github.com/endearqb/kimi-app/blob/codex/kimi-im-bridge/apps/kimi-im-bridge/internal/adapters/feishu/approval.go "kimi-app/apps/kimi-im-bridge/internal/adapters/feishu/approval.go at codex/kimi-im-bridge · endearqb/kimi-app · GitHub"
[13]: https://github.com/endearqb/kimi-app/raw/refs/heads/codex/kimi-im-bridge/apps/kimi-im-bridge/internal/runtime/service.go "raw.githubusercontent.com"
[14]: https://github.com/endearqb/kimi-app/raw/refs/heads/codex/kimi-im-bridge/apps/kimi-im-bridge/internal/runtime/session_registry.go "raw.githubusercontent.com"
