# Feishu IM Bridge Tools

本文档说明 `kimi-app` 当前已经落地的飞书消息交互能力，分为两层：

1. 使用者手册：告诉你如何在飞书里和 IM Bridge 对话、切会话、改工作目录、处理审批、做诊断。
2. 开发者附录：告诉你这些行为在项目里是如何被解析、路由和渲染的。

本文只覆盖仓库里已经实现的飞书能力，不包含未来规划中的额外平台能力、文件上传、图片输入、语音交互或跨平台 session 统一切换。

## 1. 文档定位与前置条件

使用前请确认：

- `apps/kimi-shell` 控制中心已经启用 Feishu channel。
- 已配置 Feishu `appId` 与 `appSecret`。
- bridge 已启动，且 Feishu channel 至少可连接；理想状态是 `ready`。
- 如果需要更细的工作目录控制，可在控制中心配置：
  - `defaultWorkDir`
  - `workDirPresets`
  - `feishuReplyCards`

当前飞书侧只支持文本消息交互：

- 支持文本 prompt
- 支持交互卡片
- 不支持文件、图片、语音输入

## 2. 使用者手册

### 2.1 入口与触发规则

飞书入口规则以聊天类型区分：

| 场景 | 触发方式 | 说明 |
| --- | --- | --- |
| 私聊 `p2p` | 直接发送文本 | 会进入 Kimi 普通对话流。 |
| 群聊 `group` | `@机器人` + 文本 | 不显式召唤不会触发。 |
| 话题群 `topic_group` / 线程 | `@机器人` + 文本 | 绑定粒度会带上 `threadId` 或 `rootId`。 |

推荐示例：

```text
私聊：
请帮我总结一下当前项目的 IM bridge 能力

群聊：
@Kimi /bridge doctor
@Kimi 帮我看看这个报错是不是工作目录配置错了
```

补充规则：

- `/bridge ...` 管理命令在私聊里可直接发送。
- `/bridge ...` 管理命令在群里也建议显式 `@机器人`，否则不会进入命令解析。
- 非文本消息不会进入当前飞书 bridge 流程。

### 2.2 普通对话行为

普通对话的工作方式如下：

- 首条有效消息会自动创建当前 chat/thread 对应的 binding 和 Kimi session。
- 后续消息会继续复用同一个 binding 命中的 session。
- 私聊首次进入时，如果当前 binding 还没完成 onboarding，系统会自动补发 onboarding 卡片。
- 群聊不会自动发 onboarding；如果需要重新打开欢迎面板，请使用 `/bridge start`。
- 长回复会自动分片发送。
- 普通回复默认优先走 Feishu `post/text` 兼容模式。
- 如果控制中心启用了 `feishuReplyCards`，普通回复会改走 `interactive` 卡片，并使用 `lark_md` 渲染正文。

### 2.3 管理命令

以下命令均为当前已实现的公开交互面：

| 命令 | 作用 | 结果 |
| --- | --- | --- |
| `/bridge help` | 打开帮助面板 | 返回命令列表和常用面板按钮。 |
| `/bridge start` | 重新打开 onboarding 面板 | 私聊里可作为欢迎卡片重开入口；群里也可手动打开。 |
| `/bridge sessions` | 查看 bridge-native sessions | 返回最近的持久化 session 列表，并可点 `Use session` 切换。 |
| `/bridge use <session-id>` | 把当前 chat/thread 绑定到指定 session | 返回 `Bridge session updated` 卡片。 |
| `/bridge cwd` | 查看当前聊天的工作目录状态 | 显示默认目录、当前覆盖目录、preset 按钮和清除入口。 |
| `/bridge cwd set <path>` | 为当前 chat/thread 设置独立工作目录 | 返回更新后的 workdir 卡片。 |
| `/bridge cwd add <path>` | `set` 的同义别名 | 行为与 `set` 相同。 |
| `/bridge cwd clear` | 清除当前 chat/thread 的工作目录覆盖 | 回退到 bridge 默认目录。 |
| `/bridge cwd remove` | `clear` 的同义别名 | 行为与 `clear` 相同。 |
| `/bridge approvals` | 查看当前 chat/thread 的待审批项 | 返回 pending approvals 卡片，并可直接审批。 |
| `/bridge doctor` | 获取当前 chat/thread 的桥接诊断快照 | 返回 bridge / channel / binding / approvals / probe / error 摘要。 |

示例：

```text
/bridge help
/bridge start
/bridge sessions
/bridge use session_abc123
/bridge cwd
/bridge cwd set <workspace-root>
/bridge cwd add D:\workspace\repo
/bridge cwd clear
/bridge approvals
/bridge doctor
```

命令结果的几个细节：

- `/bridge sessions` 当前最多展示最近 5 个持久化 bridge session。
- `/bridge approvals` 当前最多展示当前 chat/thread 下前 4 个 pending approvals。
- `/bridge cwd` 当前最多展示前 6 个已配置的 workdir presets。

### 2.4 卡片按钮交互

飞书卡片中当前支持的主要按钮如下：

| 面板 | 按钮 | 作用 |
| --- | --- | --- |
| onboarding | `Run doctor` | 打开 doctor 面板。 |
| onboarding | `Open sessions` | 打开 sessions 面板。 |
| onboarding | `Open workdir` | 打开 workdir 面板。 |
| onboarding | `Open approvals` | 打开 approvals 面板。 |
| help | `Start onboarding` | 打开 onboarding 面板。 |
| help/doctor | `Sessions` / `Open sessions` | 切到 sessions 面板。 |
| help/doctor | `Workdir` / `Open cwd` | 切到 workdir 面板。 |
| help/doctor | `Approvals` / `Open approvals` | 切到 approvals 面板。 |
| help/doctor | `Doctor` / `Refresh doctor` | 刷新 doctor 面板。 |
| doctor | `Show details` / `Hide details` | 展开或折叠详细诊断。 |
| sessions | `Use session` | 把当前 chat/thread 绑定到该 session。 |
| workdir | preset 按钮 | 直接把当前 chat/thread 切换到某个预设目录。 |
| workdir | `Clear current workdir` | 删除当前 chat/thread 的 workdir override。 |
| approvals | `Approve once` | 只批准当前这次审批。 |
| approvals | `Approve for session` | 为当前 session 批准该类继续操作。 |
| approvals | `Reject` | 拒绝本次审批。 |

这些按钮的特点：

- 大多数面板按钮会直接原地刷新当前卡片，而不是新发一条消息。
- 审批按钮成功后会优先更新原卡片；如果卡片更新失败，会回退为文本状态提示。
- workdir preset 按钮在没有 binding 时也可触发，此时会为当前 chat/thread 创建 binding。

### 2.5 工作目录规则

飞书侧的工作目录规则如下：

- `defaultWorkDir` 是 bridge 级默认目录。
- 某个 chat/thread 可以通过 `/bridge cwd set` 或 preset 按钮设置独立 workdir。
- binding 上设置的 workdir 会覆盖 `defaultWorkDir`。
- `/bridge cwd clear` 或 `/bridge cwd remove` 会删除覆盖值，回退到默认目录。
- `workDirPresets` 由控制中心配置后同步给飞书卡片使用。
- 如果 bridge 运行中修改了 preset，飞书卡片通常要在 bridge 重启后才能看到最新预设列表。

### 2.6 审批规则

工具审批当前通过交互卡片提供：

- 当 Kimi 触发 approval request 时，飞书会收到 interactive approval 卡片。
- 你可以选择：
  - `Approve once`
  - `Approve for session`
  - `Reject`
- `/bridge approvals` 只查看当前 chat/thread 下的 pending approvals。
- 如果飞书侧审批失败，仍可回到 `kimi-shell` Control Center 的 pending approvals 区域处理。

审批决策在实现中使用以下固定值：

- `approved`
- `approved_for_session`
- `denied`

### 2.7 诊断规则

`/bridge doctor` 是飞书侧的首选排障入口，会返回当前 chat/thread 的安全诊断摘要，包含：

- bridge overall state
- Feishu channel state
- 当前 binding 与 session
- 当前 chat/thread 的 pending approvals 数量
- live probe 状态
- 最近错误码
- 推荐 next steps

展开详情后还会补充：

- binding key
- effective workdir
- last heartbeat
- last inbound
- checkpoint
- last error
- onboarding metadata
- session summary
- probe detail

适用场景：

- 机器人无响应或怀疑凭证异常
- 当前群聊/线程是否命中了正确 binding 不确定
- 怀疑 workdir、session、审批状态不一致

### 2.8 已知边界

当前飞书能力存在以下明确边界：

- 只支持文本消息，不支持文件、图片、语音。
- 群消息必须显式 `@机器人` 才会进入路由。
- 飞书里可以直接切换 bridge-native session。
- shell/web session 仍以控制中心查看和导入为主，不在飞书里直接统一切换。

## 3. 开发者附录

### 3.1 主要实现入口

飞书交互的主要入口位于：

- `apps/kimi-im-bridge/internal/adapters/feishu/commands_cards.go`
- `apps/kimi-im-bridge/internal/adapters/feishu/approval.go`
- `apps/kimi-im-bridge/internal/adapters/feishu/service.go`
- `apps/kimi-im-bridge/internal/adapters/feishu/mapper.go`
- `apps/kimi-im-bridge/internal/adapters/feishu/sender.go`

### 3.2 消息路由规则

普通文本与管理命令是两条独立解析路径：

1. 普通文本消息：
   - 入口：`mapMessageToInbound`
   - 要求：`MessageType == text`
   - 私聊 `p2p`：直接放行
   - 群聊 / `topic_group`：先经过 `stripExplicitSummon`
   - 若没有显式召唤或正文为空，则不会路由到 Kimi
2. `/bridge` 管理命令：
   - 入口：`parseBridgeCommand`
   - 仍要求 `MessageType == text`
   - 在群里同样依赖 `stripExplicitSummon`
   - 命令由 `parseBridgeCommandText` 解析

binding key 的组成规则：

- `platform = feishu`
- `chatId = event.ChatID`
- `threadId = event.ThreadID`
- 如果 `threadId` 为空，则回退使用 `rootId`

这意味着：

- 私聊通常按 `platform + chatId` 绑定
- 群线程按 `platform + chatId + threadId/rootId` 绑定

### 3.3 已实现的命令集合

`parseBridgeCommandText` 当前支持：

- `help`
- `start`
- `sessions`
- `use <session-id>`
- `cwd`
- `cwd set <path>`
- `cwd add <path>`
- `cwd clear`
- `cwd remove`
- `cwd delete`
- `approvals`
- `doctor`

文档面对用户时统一写 `clear/remove` 即可；`delete` 目前是解析层兼容别名。

### 3.4 卡片 action 语义

飞书卡片回调在 `processCardAction` 中统一分发，当前 action 类型为：

- `approval_decision`
  - 用于审批卡片
  - 决策值：`approved` / `approved_for_session` / `denied`
- `bridge_use_session`
  - 用于把当前 binding 切到指定 session
- `bridge_set_preset_workdir`
  - 用于应用 preset workdir
- `bridge_clear_workdir`
  - 用于清空当前 binding 的 workdir override
- `bridge_show_panel`
  - 用于在 help / start / sessions / cwd / approvals / doctor 间切换卡片面板

### 3.5 回复渲染策略

普通回复的发送策略在 `sender.go` 中：

- `feishuReplyCards = false`
  - 默认路径
  - 优先构建 rich text `post`
  - 必要时继续回退到 `text`
- `feishuReplyCards = true`
  - 改走 `interactive` 卡片回复
  - 卡片正文使用 `lark_md`

两条路径都支持长度分片：

- 文本回复分片上限由 `feishuTextMaxRunes` 控制
- 卡片回复分片上限由 `feishuCardMaxRunes` 控制
- 卡片分片标题会带 `Kimi reply (n/N)`

### 3.6 与手工验证的一致性边界

当前文档与仓库中的手工测试/排障资料保持一致，重点边界包括：

- 覆盖 Feishu DM / group / thread 路由
- 覆盖 approval 卡片回写与失败回退
- 覆盖 reconnect / checkpoint 恢复语义
- 覆盖 invalid credentials 分类与 doctor 诊断入口

如果后续飞书能力新增，请优先同步：

- `commands_cards.go`
- `approval.go`
- `service.go`
- `sender.go`
- 本文档
