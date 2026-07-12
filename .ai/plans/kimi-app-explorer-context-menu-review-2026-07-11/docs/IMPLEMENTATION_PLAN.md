# 实施计划

## Phase 0：安全前置

1. 给 session navigation 增加 `requestId` 强制要求和前端 TTL dedupe。
2. 把 `active_session_updated` 的 workDir 同步改为 sessionId 精确匹配。
3. settings schema 增加 `context_menu_desired_enabled`，auto repair 只服从该字段。

这些改动不改变用户主要流程，但消除 new-pane 上线后双建和错配风险。

## Phase 1：后端 Explorer Open Service

1. 从 `open_request.rs` 抽出 `WorkspaceOpenIntent`：
   - `request_id`
   - `work_dir`
   - `source`
   - `origin: startup | forwarded`
   - `disposition: new_pane`
   - `force_create_new=true`
2. 使用 FIFO 代替 `pending_workspace_bootstrap: Option<_>`。
3. runtime ready：调用现有 `create_workspace_session_for_grid`。
4. runtime not ready：排队；若是第一实例启动，由正常 setup `start_backend` 启动一次。
5. session 创建成功后发布 canonical event；失败只移除当前 request，继续下一条。

## Phase 2：Grid Store 原子动作

新增动作：

```ts
openPaneFromExplorer(input): {
  kind: "added_visible" | "added_swapped" | "reused_visible" |
        "reused_swapped" | "limit_reached";
  paneId: string | null;
  displacedPaneId?: string;
}

showPane(paneId, targetSlotId?): ShowPaneResult
```

动作必须在一次 Zustand update 中完成 pane 创建、preset/slots 更新、active 更新和持久化，避免 `setPreset()` 与 `addPane()` 之间短暂无槽位或重复事件竞态。

## Phase 3：Pane Shelf

1. titlebar 接入 `PaneShelf.tsx`。
2. selector 分出 visible/shelf。
3. 点击 shelf item 调 `showPane`。
4. 添加 toast 文案、总上限管理对话框。
5. 记录埋点：Explorer open 成功率、session 创建耗时、placement kind、shelf count、limit reached。

## Phase 4：注册表清理

1. 删除现有 Kimi 的 `AllFilesystemObjects` 键；保留 `*`、`Directory`、`Directory\Background`。
2. 默认标签“移动”改“复制”。
3. install/uninstall 失败时回滚/清理自身键。
4. `SHChangeNotify`。
5. 一次性迁移旧键，确保更新安装后不残留。

## 建议 feature flags

- `explorer_new_pane_v1`
- `workspace_pane_shelf_v1`
- `context_menu_registry_v2`

后端先兼容没有 disposition 的旧前端；前端把缺省 disposition 解释为 `replace_active`，仅 Explorer source 或显式字段走 `new_pane`。
