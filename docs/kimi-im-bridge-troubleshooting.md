# Kimi IM Bridge 故障排查

## 文件位置

- Bridge settings: `%APPDATA%\com.kimi.shell\bridge_settings.json`
- Bridge secrets: `%APPDATA%\com.kimi.shell\bridge_secrets.json`
- Bridge database: `%APPDATA%\com.kimi.shell\bridge.db`
- Bridge log: `%APPDATA%\com.kimi.shell\logs\bridge.log`
- Shell app log: `%APPDATA%\com.kimi.shell\logs\app.log`
- Release sidecar staging during build:
  - `apps/kimi-shell/src-tauri/binaries/kimi-im-bridge.exe`
  - `apps/kimi-shell/src-tauri/target/release/binaries/kimi-im-bridge.exe`
- Packaged installer evidence:
  - `apps/kimi-shell/src-tauri/target/release/wix/x64/main.wxs`
  - `apps/kimi-shell/src-tauri/target/release/nsis/x64/installer.nsi`

## 常见 `lastErrorCode`

| Code | Meaning | Typical Root Cause | Retry Expectation |
| --- | --- | --- | --- |
| `rate_limited` | 平台触发限流 | Telegram `429`、平台明确 `retry_after` | 会自动重试 |
| `transient_network` | 短暂网络故障 | DNS、连接超时、连接重置 | 会自动重试 |
| `platform_unavailable` | 平台暂时不可用 | 5xx、平台维护、长连接短时异常 | 会自动重试 |
| `invalid_credentials` | 凭证错误 | token、app secret、签名相关配置错误 | 不重试 |
| `permission_denied` | 权限不足 | webhook 冲突、bot 权限缺失、平台动作不允许 | 不重试 |
| `payload_invalid` | 发送内容不合法 | 平台拒收 payload、长度或格式非法 | 不重试 |
| `delivery_failed` | 明确送达失败 | 非重试型发送失败 | 不重试 |
| `unknown` | 未分类错误 | 尚未显式归类的异常 | 视具体日志判断 |

## 快速排查顺序

1. 先看 `%APPDATA%\com.kimi.shell\logs\bridge.log` 最新 `ERROR/WARN/FATAL`。
2. 再看 Control Center 的 `Recent Errors`，确认是否已有 `lastErrorCode`。
3. 核对 `%APPDATA%\com.kimi.shell\bridge_settings.json` 中对应 channel 是否 `enabled=true`。
4. 核对 `%APPDATA%\com.kimi.shell\bridge_secrets.json` 是否真的已配置必填项。
5. 如果是安装版，确认安装目录 `binaries\kimi-im-bridge.exe` 存在，而不是只在仓库开发路径存在。

## 如何区分主要故障类型

### 凭证错误

- Signal:
  - `lastErrorCode=invalid_credentials`
  - 启动即失败，且不会在短时间后自动恢复
- Check:
  - Telegram `botToken`
  - Feishu `appId` / `appSecret`
  - 若启用回调验签，再查 `verificationToken` / `encryptKey`

### 权限问题

- Signal:
  - `lastErrorCode=permission_denied`
  - 常见于 Telegram webhook 冲突、平台不允许编辑原消息、bot 权限不足
- Check:
  - 平台后台的权限设置
  - 是否存在残留 webhook 或受限 chat/thread

### 限流问题

- Signal:
  - `lastErrorCode=rate_limited`
  - 日志含 `retryable=true` 和 `nextBackoffMs`
- Check:
  - 是否出现长消息分片或批量 approval 更新
  - 是否平台返回显式 `retry_after`

### 平台暂时不可用 / 网络抖动

- Signal:
  - `lastErrorCode=transient_network` 或 `platform_unavailable`
  - 同一操作出现重试并最终恢复
- Check:
  - 本机网络
  - 平台状态页
  - 代理、防火墙、证书链

## 重点日志字段

- `platform`
- `operation`
- `errorCode`
- `attempt`
- `retryable`
- `nextBackoffMs`

如果日志里缺这些字段，先确认运行的是包含 Phase 6 稳定化改动的新 sidecar，而不是旧二进制。

## Release 打包资源检查

1. 运行 `pnpm -C apps/kimi-shell tauri build`
2. 确认以下文件存在：
  - `apps/kimi-shell/src-tauri/binaries/kimi-im-bridge.exe`
  - `apps/kimi-shell/src-tauri/target/release/binaries/kimi-im-bridge.exe`
3. 检查打包脚本：
  - WiX: `apps/kimi-shell/src-tauri/target/release/wix/x64/main.wxs`
  - NSIS: `apps/kimi-shell/src-tauri/target/release/nsis/x64/installer.nsi`
4. 只有仓库开发路径存在而 release/bundle 证据不存在时，不能视为安装版打包成功。

## 恢复指引

### Bridge 无法启动

1. 确认 `bridge_settings.json` 中 `enabled=true` 且至少一个 channel enabled。
2. 看 `bridge.log` 首屏错误。
3. 如果是 `invalid_credentials`，先修 secret，再重启。
4. 如果是 `permission_denied`，去平台后台修权限或 webhook。

### Bridge 已启动但没有消息进来

1. 看对应 channel 是否 `ready`。
2. 看 offset/checkpoint 是否持续更新。
3. 若是 restart 后首条消息异常，优先排查 dedupe / checkpoint 恢复。

### 消息能进来但回复失败

1. 看 `bridge.log` 中 sender 操作的 `errorCode`。
2. 若反复出现 `rate_limited`，优先确认是否有大量分片或 approval 更新。
3. 若是 `payload_invalid`，检查平台限制和消息格式降级逻辑。
