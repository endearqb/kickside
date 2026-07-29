# Kimi API Config Canonical Provider

## Status

Accepted

## Decision

- 控制中心 API Key 配置只管理 `providers."managed:kimi-code"` 与 `models."kimi-code/*"`；可用模型以认证后的 `GET <base_url>/models` 响应为准。
- 保存会同步该 Provider 的 upstream 模型字段并选择仍可用的当前默认模型、`kimi-code/k3` 或首个模型，不再创建 `kimi-app-api-key` / `kimi-app/*`。
- 旧版小助手条目仅在形状匹配、无自定义字段且无剩余模型引用时自动清理；其他条目保留。
- `managed:kimi-code` 含 OAuth 引用时阻止 API Key 保存，认证方式不得静默切换。
- Search/Fetch 不以无业务语义的 GET 响应判定成功；控制中心不主动执行真实搜索或抓取。

## Rationale

- Kimi Code 0.29.1 已将 `managed:kimi-code`、`kimi-code/*` 与 `/models` 定义为托管端点 API Key 的 canonical 结构。
- 旧实现把任意 HTTP 响应视为可达，导致 404 误报；固定的自有 Provider/Model ID 又会与 CLI 生成配置并存。
- 复用 Kimi 的模型目录和 `kimi doctor config` 比维护第二套静态模型清单与 schema 更可靠。

## Consequences

- 测试与保存都需要有效 API Key 和可用 `/models`；网络或认证失败时不覆盖当前配置。
- API Key 已保存但未重新输入时，仅 Rust 后端读取并使用该秘密，前端仍只接收脱敏值。
- Tauri 配置 view/input/result 只增加可选或带默认值字段，保留旧字段兼容现有调用方。

## Verification

- Rust 测试覆盖模型映射、404、迁移幂等、引用保护、默认选择、清除语义和配置原子写入。
- 前端测试覆盖模型选择、验证三态与 404 失败展示。
- Shell G0/G1 及候选文件 `kimi doctor config` 是合入门槛。
