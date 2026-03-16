# Bridge status 500（last_heartbeat_at NULL）排查与修复计划

## 1. 目标与现象

- 目标：定位并消除 `bridge status returned error status: 500 Internal Server Error`，并避免同类错误再次出现。
- 已知报错：`failed to scan channel status: sql: Scan error on column index 3, name "last_heartbeat_at": converting NULL to string is unsupported`。
- 已知影响：bridge 进程已启动（`admin listening`），但 shell 在启动窗口内无法拿到可用 `/api/v1/status`，被判定为 `status probe failed`。

## 2. 根因假设（按优先级）

1. **运行中的 sidecar 版本与当前源码不一致（最高优先）**
   - 当前仓库 `ListChannelStatuses` 查询未直接扫描 `last_heartbeat_at`，而报错明确来自该字段。
   - 推断：实际运行的是旧 sidecar（或安装版残留二进制），旧实现直接把 `NULL` 扫描到 `string`。

2. **数据库历史数据含 `last_heartbeat_at = NULL`，旧实现不兼容**
   - 迁移脚本允许 `last_heartbeat_at TEXT NULL`，旧代码若未做 `ifnull/NullString` 会触发该错误。

3. **二进制路径命中策略导致加载了非预期文件**
   - 需核对 bridge 可执行文件实际来源（开发路径 / 资源路径 / 环境变量覆盖）。

4. **次要并发因素**
   - 即使非核心根因，仍需排除 sqlite 文件锁或异常写入导致 status 查询失败链路被放大。

## 3. 执行步骤

### 步骤 A：确认“实际运行版本”与“源码版本”是否一致

1. 在 shell 侧打印/记录 `resolve_bridge_binary_path` 最终命中路径（启动前后都记录）。
2. 对命中二进制做版本与时间戳比对（文件哈希、构建时间、版本号）。
3. 校验是否命中安装目录旧文件、环境变量 `KIMI_IM_BRIDGE_BIN` 覆盖、或资源目录旧副本。

**验收标准**
- 能给出“当前报错实例实际使用的 sidecar 绝对路径 + 文件签名信息”。

### 步骤 B：复现并确认 500 的直接触发点

1. 用当前实例对 `/api/v1/status` 做请求，保留响应码与 body。
2. 对 `bridge.db` 执行只读查询，确认 `bridge_channels.last_heartbeat_at` 是否存在 `NULL`。
3. 在同一数据文件上用当前源码编译 sidecar 运行，验证是否仍会触发相同扫描错误。

**验收标准**
- 明确是“旧二进制导致”还是“当前代码仍有扫描漏洞”。

### 步骤 C：实施修复（双保险）

1. **发布路径修复（主修复）**
   - 保证 shell 启动 bridge 时优先使用本次构建产物，不再命中旧残留二进制。
   - 增加启动日志：输出 bridge 二进制实际路径与版本摘要。

2. **代码健壮性修复（兜底）**
   - 在 sidecar 的 channel status 扫描逻辑中，对可空字段统一采用 `ifnull(...)` 或 `sql.NullString`（包括 `last_heartbeat_at`）。
   - 即使历史/异常数据为 `NULL`，status 也应返回 200 且字段降级为空值。

3. **错误可观测性修复（辅助）**
   - 保持 shell 侧 status 错误信息包含 HTTP 状态码 + body（已具备，需确认实际运行版本生效）。

**验收标准**
- 在存在 `last_heartbeat_at = NULL` 的库上，`/api/v1/status` 连续返回 200。
- shell 启动 bridge 不再出现 `status probe failed`（同等环境下）。

### 步骤 D：回归验证

1. Rust 校验：`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
2. 前端构建：`pnpm -C apps/kimi-shell build`
3. Go 校验：`go test ./...`（至少覆盖 `apps/kimi-im-bridge`）
4. 手工 smoke：
   - 启动 bridge，确认控制中心可读取 status。
   - 在 `bridge_channels.last_heartbeat_at` 为 `NULL` 的情况下重复验证。

**验收标准**
- 自动化校验通过，且手工场景中不再出现本次 500 报错。

## 4. 交付物

- 修复后的 shell + sidecar 代码变更（版本路径与可空字段扫描兜底）。
- 日志证据：启动时二进制路径、status 请求成功记录。
- 回归记录：构建/测试通过与关键场景截图或日志片段。

