# Kimi IM Bridge Manual Test Runbook

## Phase 5 Deferred Manual Validation

### P5-01 Control Center Pending Approvals

- Goal: 确认 Control Center 可看到当前 pending approvals。
- Preconditions:
  - bridge sidecar 已启动。
  - SQLite 中存在至少 1 条 `pending` approval。
- Steps:
  - 打开 `Control Center -> 运行与日志 -> Bridge sidecar`。
  - 观察 `Pending Approvals` 区块。
- Expected:
  - 列表展示 `approvalId`、平台、session、`requestKind`、`prompt`、创建时间。
  - `Pending Approvals` 计数与 status 区块一致。
- Evidence:
  - 截图 pending approvals 列表。
  - 记录 approvalId 与 pending 数量。

### P5-02 Control Center Resolve Approval

- Goal: 确认 Control Center 可手动 approve / reject approval。
- Preconditions:
  - 至少存在 1 条 pending approval。
- Steps:
  - 在 `Pending Approvals` 区块点击 `Approve` 或 `Reject`。
  - 等待界面自动刷新。
- Expected:
  - 目标 approval 从 pending 列表移除。
  - status 区块 `Pending Approvals` 计数下降。
  - sidecar 日志记录 approval resolve。
- Evidence:
  - 操作前后截图。
  - `bridge.log` 中对应 resolve 日志片段。

### P5-03 Bridge Log Tail And Error Summary

- Goal: 确认 `bridge.log` tail 与最近错误摘要可用。
- Preconditions:
  - `logs/bridge.log` 已生成。
  - bridge 最近有 error 或 warn 时优先覆盖该场景。
- Steps:
  - 打开 `Logs & Secrets` 区块。
  - 查看 `Bridge Log Tail`。
  - 返回 status 区块查看 `最近错误摘要`。
- Expected:
  - `Bridge Log Tail` 显示最近 80 行以内日志。
  - `最近错误摘要` 至少覆盖 `status.lastError` / channel error / log tail 中最新 `ERROR|WARN|FATAL` 行。
- Evidence:
  - 日志区截图。
  - 错误摘要区截图。

### P5-04 Packaged Build Sidecar Lifecycle

- Goal: 确认安装版内置 sidecar，并可完成 start / stop / restart。
- Preconditions:
  - 已执行 `pnpm -C apps/kimi-shell tauri build`。
  - 使用新构建的安装包完成安装。
- Steps:
  - 打开安装版 Control Center 的 Bridge sidecar 面板。
  - 执行 `Start`、`Stop`、`Restart`。
  - 检查安装目录资源中是否包含 `kimi-im-bridge.exe`。
- Expected:
  - sidecar 能成功启动、停止、重启。
  - resource/bundle 内存在 `kimi-im-bridge.exe`。
  - release 运行时不依赖 `apps/kimi-im-bridge/bin` 开发路径。
- Evidence:
  - 安装目录资源截图。
  - Start / Stop / Restart 结果截图。
  - `bridge.log` 或 app log 中的生命周期片段。
