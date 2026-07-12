# ADR-001：六个可见 Pane + Pane Shelf

- 状态：建议采纳
- 日期：2026-07-11

## 背景

Workspace Grid 最多有六个 slot，现有 store 同时把 pane 总数限制为六。Explorer open 的用户意图是看到新打开的工作区；当六窗已满时，仅把新 pane 隐藏会让操作看起来失败，直接关闭旧 pane又会破坏会话连续性。

## 决策

1. 六是可见/渲染上限，不是总 pane 上限。
2. 默认总上限为 12。
3. 第七及后续 Explorer pane 创建成功后，交换到 active slot；被替换 pane进入 shelf。
4. titlebar 提供 `窗格 6+N` 入口；点击 shelf item 与 active slot 交换。
5. 达到 12 时要求用户显式决定，不做静默 LRU 删除。

## 理由

- 新请求立即可见，符合直接操控原则。
- 旧 session 保留，避免会话丢失。
- 现有 `panes[]` 与 `slots[]` 已分离，数据模型天然支持。
- 隐藏 pane 不渲染 iframe，可控制资源使用。

## 代价

- 需要 Pane Shelf UI和总数治理。
- 重新显示隐藏 pane 时 iframe 会重建，网页本地未提交草稿可能丢失。
- 多窗口未来需要 target window 路由，当前先以 `main` 为目标。
