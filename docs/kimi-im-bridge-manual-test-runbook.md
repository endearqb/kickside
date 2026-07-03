# Kimi IM Bridge 统一手工测试闸门

## 执行快照（2026-03-13）

- 范围：`Kimi IM Bridge` Phase 2-6 统一手工闸门
- 工作站：`<workspace-root>`
- 记录时间：2026 年 3 月 13 日
- 已收集的环境证据：
  - `%APPDATA%\com.kimi.shell\bridge_settings.json` shows bridge disabled and both channels disabled.
  - `%APPDATA%\com.kimi.shell\bridge_secrets.json` shows Telegram / Feishu credentials are all `null`.
  - `pnpm -C apps/kimi-shell tauri build` passed and produced:
    - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.19_x64-setup.exe`
    - `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.19_x64_en-US.msi`
  - Bundle staging confirms sidecar inclusion:
    - `apps/kimi-shell/src-tauri/target/release/wix/x64/main.wxs`
    - `apps/kimi-shell/src-tauri/target/release/nsis/x64/installer.nsi`
    - `apps/kimi-shell/src-tauri/target/release/binaries/kimi-im-bridge.exe`
- 本机实际阻塞项：
  - No Telegram bot token is configured.
  - No Feishu `appId/appSecret` pair is configured.
  - No installed `Kimi Desktop Shell` directory exists under `%LOCALAPPDATA%\Programs`.
- 闸门状态：
  - 代码与打包证据：已收集
  - 真实 Telegram / 飞书 / 安装版点击验证：受环境阻塞

## 结果标记

- `Passed`：已在本机执行，且符合预期。
- `Partial`：已执行部分证据收集，但未完成完整终端用户路径。
- `Blocked`：因本机缺少所需外部环境而无法执行。

## P2-01 Stale Approval Reconciliation After Restart

- Goal: 验证 sidecar 重启后，历史 `pending approval` 会被标记为 `failed`，原因写为 `runtime_restarted_before_resume`。
- Preconditions:
  - 已有一个运行中的 turn 触发 approval。
  - approval 尚未 resolve 时停止 sidecar。
- Configuration / Accounts:
  - 任一可用 Telegram 或 Feishu 测试账号。
  - 可打开 Control Center 与 `bridge.db`。
- Steps:
  - 触发一个需要 approval 的 turn。
  - 在 approval 仍为 `pending` 时执行 `Stop`，再执行 `Start`。
  - 查看 approvals 列表和 `approval_requests` 记录。
- Expected:
  - 旧 approval 不再保持 `pending`。
  - 失败原因可追溯为 runtime 重启前未恢复 responder。
- Evidence:
  - Control Center approvals 截图。
  - `bridge.log` 中 restart 与 approval reconciliation 日志。
  - `bridge.db` 中对应 approval 状态记录。
- Actual Result:
  - `Blocked`。本机未配置 Telegram / Feishu 凭证，无法制造真实 pending approval。
- Issue ID:
  - `ENV-BLOCKED-001`

## P2-02 Cooperative Stop / Restart During In-Flight Turn

- Goal: 验证 Windows 协作式 `Stop` / `Restart` 不会继续接收新 inbound，且重启后从持久化 offset/checkpoint 恢复，不重复投递历史消息。
- Preconditions:
  - sidecar 已启动并正在处理一个 turn。
  - 至少有一个平台 adapter 处于真实运行态。
- Configuration / Accounts:
  - Telegram 或 Feishu 测试环境。
- Steps:
  - 在 turn 进行中触发 `Stop` 或 `Restart`。
  - 观察 sidecar 停止期间是否仍接收 inbound。
  - 重启后再次发送消息并核对去重与 offset/checkpoint。
- Expected:
  - stop 期间不继续接收新 inbound。
  - restart 后继续从持久化位置消费，且历史消息不重复投递。
- Evidence:
  - `bridge.log` 生命周期日志。
  - 平台侧会话截图。
- Actual Result:
  - `Blocked`。当前机器没有可运行的 Telegram / Feishu channel。
- Issue ID:
  - `ENV-BLOCKED-001`

## P3-01 Telegram Private Chat Multi-Turn And Approval

- Goal: 验证 Telegram 私聊多轮、approval 按钮、Approve/Reject 回写闭环。
- Preconditions:
  - Telegram channel 已启用。
  - bot token 有效。
- Configuration / Accounts:
  - 可用 Telegram bot。
  - 可向 bot 发消息的测试账号。
- Steps:
  - 在私聊中连续发送两轮消息，确认复用同一 `kimiSessionId`。
  - 触发一个 approval。
  - 在 Telegram 按钮或 Control Center 中执行 `Approve` / `Reject`。
- Expected:
  - reply 正常送达。
  - approval 状态回写成功。
  - Control Center pending approvals 计数同步变化。
- Evidence:
  - Telegram 对话截图。
  - Control Center approvals 截图。
  - `bridge.log` 中 sender / resolve 日志。
- Actual Result:
  - `Blocked`。`%APPDATA%\com.kimi.shell\bridge_secrets.json` 中 `telegram.botToken=null`。
- Issue ID:
  - `ENV-BLOCKED-002`

## P3-02 Telegram Invalid Token Error Classification

- Goal: 验证 Telegram 无效 token 会落到 `invalid_credentials`，且 sidecar 不崩溃。
- Preconditions:
  - 可临时写入一个无效 Telegram token。
- Configuration / Accounts:
  - Telegram channel enabled。
- Steps:
  - 把 Telegram token 改为无效值。
  - 启动 bridge。
  - 查看 Control Center 和 `bridge.log`。
- Expected:
  - Telegram channel 进入 `error`。
  - `lastErrorCode=invalid_credentials`。
  - bridge 进程仍保持存活。
- Evidence:
  - Control Center 渠道状态截图。
  - `bridge.log` 中 startup failure 日志。
- Actual Result:
  - `Blocked`。本机没有可切换的 Telegram 凭证，无法执行真实 invalid-token smoke。
- Issue ID:
  - `ENV-BLOCKED-002`

## P3-03 Telegram Restart Dedupe And Offset Recovery

- Goal: 验证 Telegram restart 后从 persisted offset 恢复，不重复处理旧消息。
- Preconditions:
  - Telegram polling 已就绪。
- Configuration / Accounts:
  - 同 P3-01。
- Steps:
  - 正常收发一轮消息。
  - 记录当前 offset。
  - 执行 `Restart` 后再次发送消息，并确认旧消息不重放。
- Expected:
  - 旧消息不重复投递。
  - 新消息可正常消费。
- Evidence:
  - `bridge.log` 中 offset / polling 日志。
  - Telegram 对话截图。
- Actual Result:
  - `Blocked`。缺少 Telegram 运行环境。
- Issue ID:
  - `ENV-BLOCKED-002`

## P4-01 Feishu DM / Group / Thread And Approval

- Goal: 验证飞书私聊、群聊、线程和 approval 卡片闭环。
- Preconditions:
  - Feishu channel 已启用并连接成功。
- Configuration / Accounts:
  - 可用飞书应用。
  - 私聊、群聊和线程测试环境。
- Steps:
  - 在私聊、群聊显式召唤、线程中分别发送消息。
  - 触发 approval 并完成一次 resolve。
  - 构造一个长时间运行或阻塞中的 turn；在该 turn 未完成时，从飞书 approval 卡片点击 Approve / Reject。
- Expected:
  - 三类入口都能正确路由。
  - approval 结果能更新原卡片或回退文本状态。
  - turn 阻塞期间，CardAction 仍能在飞书超时窗口内返回结果，不被 websocket 读循环卡住。
- Evidence:
  - 飞书会话截图。
  - Control Center approvals 截图。
  - `bridge.log` 中 sender / action 日志。
- Actual Result:
  - `Blocked`。`%APPDATA%\com.kimi.shell\bridge_secrets.json` 中飞书 `appId/appSecret/verificationToken/encryptKey` 全为 `null`。
- Issue ID:
  - `ENV-BLOCKED-003`

## P4-02 Feishu Invalid Credentials Error Classification

- Goal: 验证飞书无效凭证会落到 `invalid_credentials`，且 sidecar 不崩溃。
- Preconditions:
  - 可临时写入错误飞书凭证。
- Configuration / Accounts:
  - Feishu channel enabled。
- Steps:
  - 写入错误凭证并启动 bridge。
  - 查看 Control Center 与 `bridge.log`。
- Expected:
  - Feishu channel 进入 `error`。
  - `lastErrorCode=invalid_credentials`。
  - bridge 进程继续存活。
- Evidence:
  - Control Center 渠道状态截图。
  - `bridge.log` 中 credential probe 失败日志。
- Actual Result:
  - `Blocked`。当前机器没有可切换的飞书凭证。
- Issue ID:
  - `ENV-BLOCKED-003`

## P4-03 Feishu Reconnect Dedupe And Checkpoint Recovery

- Goal: 验证飞书长连接重连后不会重复投递首个历史事件，checkpoint 持久化生效。
- Preconditions:
  - Feishu 长连接已就绪。
- Configuration / Accounts:
  - 同 P4-01。
- Steps:
  - 正常完成一轮消息收发。
  - 触发 `Restart`。
  - 观察重连后的第一批事件和后续新消息。
- Expected:
  - checkpoint 恢复后不会重复消费历史事件。
  - 新消息可继续处理。
- Evidence:
  - `bridge.log` 中 checkpoint / reconnect 日志。
  - 飞书会话截图。
- Actual Result:
  - `Blocked`。缺少飞书运行环境。
- Issue ID:
  - `ENV-BLOCKED-003`

## P5-01 Control Center Pending Approvals And Resolve

- Goal: 验证 Control Center 可以列出 pending approvals，并执行 `Approve` / `Reject`。
- Preconditions:
  - bridge 已启动。
  - 至少存在 1 条 pending approval。
- Configuration / Accounts:
  - 任一可用平台环境。
- Steps:
  - 打开 `Control Center -> Bridge sidecar`。
  - 查看 `Pending Approvals` 区块。
  - 对一条 approval 执行 `Approve` 或 `Reject`。
- Expected:
  - 列表展示 `approvalId`、平台、session、`requestKind`、`prompt`、创建时间。
  - resolve 后该 approval 从 pending 列表移除。
- Evidence:
  - 操作前后截图。
  - `bridge.log` 中 resolve 日志。
- Actual Result:
  - `Blocked`。本机无法制造真实 approval。
- Issue ID:
  - `ENV-BLOCKED-001`

## P5-02 Bridge Log Tail And Recent Error Summary

- Goal: 验证 `bridge.log` tail、`recent errors` 摘要、`lastErrorCode` 展示。
- Preconditions:
  - bridge sidecar 面板可打开。
  - `bridge.log` 已生成或可由 bridge 创建。
- Configuration / Accounts:
  - 无额外外部账号要求；若要验证真实错误摘要，仍需要实际 channel 错误场景。
- Steps:
  - 打开 `Logs & Secrets`。
  - 查看 `Bridge Log Tail`。
  - 返回状态区查看最近错误摘要。
- Expected:
  - 最近日志最多显示 80 行。
  - 摘要优先汇总 bridge error、channel error、log tail 中最新 `ERROR/WARN/FATAL`。
- Evidence:
  - Control Center 截图。
  - `bridge.log` 文件路径记录。
- Actual Result:
  - `Blocked`。当前线程未执行桌面 UI 点击验证，且没有运行中的 bridge 进程产生实时日志。
- Issue ID:
  - `ENV-BLOCKED-004`

## P5-03 Secrets Mask View

- Goal: 验证 Control Center 只显示“是否已配置 + 掩码值”，不泄露明文 secret。
- Preconditions:
  - shell 可读取 `bridge_secrets.json`。
- Configuration / Accounts:
  - 可为空配置。
- Steps:
  - 打开 `Logs & Secrets` 的 secrets 区块。
  - 核对 Telegram / Feishu 字段是否仅显示掩码。
- Expected:
  - 无论配置与否，UI 不显示明文。
  - 长 token 遵循 `首 3 + *** + 末 2` 掩码规则；短值只显示 `***`。
- Evidence:
  - Secrets 区截图。
- Actual Result:
  - `Blocked`。当前线程没有桌面 UI 交互；仅能从代码与自动化测试确认掩码逻辑已实现。
- Issue ID:
  - `ENV-BLOCKED-004`

## P5-04 Installed Build Packaging And Sidecar Lifecycle

- Goal: 验证安装版包含 `kimi-im-bridge.exe`，并可完成配置、`Start`、`Stop`、`Restart`。
- Preconditions:
  - 已执行 `pnpm -C apps/kimi-shell tauri build`。
  - 已使用新安装包完成安装。
- Configuration / Accounts:
  - 安装版桌面环境。
- Steps:
  - 安装 `Kimi Desktop Shell_0.0.19_x64-setup.exe` 或 MSI。
  - 打开安装版 Control Center。
  - 完成 bridge 配置，并验证 `Start` / `Stop` / `Restart`。
  - 核对安装目录 `binaries/kimi-im-bridge.exe`。
- Expected:
  - 安装包内含 sidecar。
  - release 运行时不依赖仓库开发路径。
  - sidecar 生命周期按钮可用。
- Evidence:
  - `apps/kimi-shell/src-tauri/target/release/wix/x64/main.wxs`
  - `apps/kimi-shell/src-tauri/target/release/nsis/x64/installer.nsi`
  - 安装目录截图。
  - Control Center 生命周期截图。
- Actual Result:
  - `Partial`。已确认打包成功，且 WiX / NSIS 脚本都包含 `binaries\\kimi-im-bridge.exe`；但 `%LOCALAPPDATA%\Programs` 下没有已安装的 `Kimi Desktop Shell` 目录，本线程未执行安装版点击验证。
- Issue ID:
  - `ENV-BLOCKED-005`

## 闸门结论

- 仓库级别的 Phase 6 稳定化实现已经落地，自动化验证已通过。
- 统一手工闸门仍受本机外部环境阻塞，主要缺少 Telegram / 飞书凭证和安装版点击验证。
- 在 `ENV-BLOCKED-001` 到 `ENV-BLOCKED-005` 清除并重跑受阻用例之前，Phase 6 仍不得标记为“完全闭环”。
