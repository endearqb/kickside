# 审查证据索引

审查基线：`c2aaa14b9891c7de31363610d643ba70fa95c1e4`。

| 结论 | 文件与范围 |
|---|---|
| Explorer 注册范围与重叠键 | `apps/kimi-shell/src-tauri/src/context_menu.rs:18-91` |
| OpenDir/OpenFiles 注册命令 | `context_menu.rs:142-155` |
| enable/disable 顺序写注册表 | `context_menu.rs:633-902`（按本次读取分段） |
| save labels 先存设置后重写菜单 | `context_menu.rs:323-335` |
| ContextMenuStatus/labels 数据模型 | `src-tauri/src/types.rs:1288-1331` |
| AppSettings 没有菜单 desired state | `src-tauri/src/types.rs:393-421` |
| settings schema 与迁移 | `src-tauri/src/settings_store.rs:11-71` |
| startup 无条件 auto repair | `src-tauri/src/lib.rs:1783-1820`；调用点 `lib.rs:1034` |
| single-instance 先 focus 再路由 | `src-tauri/src/lib.rs:974-980` |
| startup/forwarded CLI 路由 | `src-tauri/src/open_request.rs:65-187` |
| OpenFiles 350 ms batch | `open_request.rs:189-280` |
| OpenDir 修改全局 cwd并 restart | `open_request.rs:424-445` |
| OpenFiles 复制后修改 cwd并 restart | `open_request.rs:448-520` |
| pending bootstrap 是单一 Option | `workspace_session.rs:118-152`，`app_state.rs` RuntimeState |
| auto_session=false 跳过 session | `workspace_session.rs:198-236` |
| 已有 create session runtime API | `workspace_session.rs:477-549`（`create_workspace_session_for_grid`） |
| 同一 payload 双事件发布 | `workspace_session.rs:428-439` |
| 前端覆盖 active/first Code pane | `src/app/useShellController.ts:625-661` |
| workDir 只更新 active Code pane | `useShellController.ts:663-679` |
| preset 1–6 | `features/workspace-grid/gridPresets.ts:16-83` |
| pane 与 slot 分离，可表达隐藏 pane | `features/workspace-grid/gridTypes.ts:30-85` |
| 总数硬限制 6 与 load 截断 | `features/workspace-grid/gridStore.ts` 的 `WORKSPACE_GRID_MAX_PANES`、`addPane`、sanitize |
| Grid 仅渲染 slots | `WorkspaceGridView.tsx:336-435` |
| sessionId 决定 Code pane URL | `PaneFrame.tsx` 的 `resolvePaneSource` 与 `paneUrl.ts` |
| 工作区导入实际复制 | `workspace_import.rs:474-637` |
| 当前主工作区窗口 label 为 main | `window_manager.rs` 的窗口常量和创建逻辑 |

## 外部规范

- Microsoft Learn — Creating Shortcut Menu Handlers  
  https://learn.microsoft.com/en-us/windows/win32/shell/context-menu-handlers
- Microsoft Learn — Creating Shell Extension Handlers  
  https://learn.microsoft.com/en-us/windows/win32/shell/handlers

外部规范用于确认静态 verb 的 command 结构、`MultiSelectModel`、各文件类型注册范围，以及修改关联后调用 `SHChangeNotify(SHCNE_ASSOCCHANGED)` 的建议。
