# Workspace Grid V2 for Agent Room

## Status

Accepted

## Decision

- Workspace Grid 持久状态升级为 `version: 2`，写入独立 key `kimi-workspace-grid-state-v2`；Saved Layouts 写入 `kimi-workspace-grid-saved-layouts-v2`。既有两个 v1 key 永不回写、删除或改写，保证旧版本可回滚读取。
- 加载顺序为：有效 v2 → v2 缺失或损坏时迁移有效 v1 → v1 也缺失/损坏时迁移 legacy split keys/default。迁移只发生在内存；保留所有原始 key 供回滚、Doctor 或人工恢复，下一次正常 mutation 只写 v2。
- V1→V2 是纯函数迁移：保留 Pane ID、顺序、slots、active/maximized、track sizes、session/workDir/url/theme、时间戳与 6 visible/12 total 上限；所有既有 Pane 固定映射为 `carrier: "iframe"`，不得改变用户布局。
- `WorkspacePaneKind` 增加 `agent_room`，`WorkspacePaneCarrier` 增加 `local`，Pane 增加可选 `roomId`。Sanitizer 强制 `agent_room ↔ local`，其他 kind 强制 `iframe`；非法组合被规范化而不是带入渲染层。
- Agent Room Pane 只保存协作引用 `roomId`，不保存 Session transcript。它清除 `sessionId/activeSessionId/url/workDir`，不创建 iframe `storageNamespace`；iframe Pane 继续使用稳定 namespace。
- 同一 `roomId` 最多存在一个 Agent Room Pane。Add/configure/open 默认聚焦并展示既有 Pane；恢复和 Saved Layout sanitizer 按稳定 Pane 顺序保留第一个重复 Room Pane，其余丢弃。
- V2 Saved Layout 的内嵌 state 同样为 version 2。v2 layouts 缺失时读取并纯迁移 v1 layouts；只有下一次显式保存/更新 layout 时才写 v2 key，v1 原样保留。
- Grid V2 不改变 preset、slot、drag、maximize、suspend、Shelf、6 visible/12 total 和 iframe Webview 生命周期规则；Local Pane 渲染在 AR-602 单独接入。

## Rationale

- 在同一 v1 key 内升版会让旧加载器因 `version !== 1` 重置用户布局，破坏升级回滚。
- kind/carrier 由 sanitizer 强制可避免 local Pane 进入 iframe token/storage 路径，也避免 iframe Pane 被错误当作本地 UI。
- Room 只保存引用可维持 Kimi Code Session 作为对话与执行唯一事实来源。

## Consequences

- `gridTypes.ts` 同时保留只读 V1 输入类型与 V2 当前类型；运行 Store 和新 Saved Layout 只使用 V2。
- 所有持久化 helper、fixture、Store action 和 Pane rendering 必须处理可选 `storageNamespace` 与 `roomId`。
- Room 已删除或不可读时，Pane 仍保留 `roomId` 并显示可修复 Empty State，不静默改成其他 Room。

## Verification

- fixture 覆盖 v2 优先、v1 state/layout 迁移、损坏 v2、不删除/不写 v1、重复 Room、非法 kind/carrier、缺失 Room、6/12 上限。
- 现有 Code/Chat/External state 与 saved-layout fixtures 在迁移后逐字段等价。
- Store/UI 测试覆盖添加/聚焦唯一 Room Pane、configure carrier、Shelf、移动/最大化/收纳/恢复和准确 Session Open 无回归。
