# Gitee Update Mirror and Selectable Update Source

## Status

Accepted

## Context

- 中国大陆用户访问 GitHub Releases 时可能无法稳定完成版本检测或安装包下载。
- 现有 Tauri updater 只读取 GitHub `latest.json`，发布 workflow 也只生成包含 GitHub asset URL 的清单。
- 安装与发布表面、updater 签名信任链和持久化设置都属于发布后高成本契约，不能通过第二套独立构建或未签名镜像扩展。

## Decision

- GitHub Actions 继续作为唯一构建、平台签名、Tauri updater 签名和 canonical Release 来源；Gitee 不独立构建安装包。
- GitHub Release 中经验证的 Windows NSIS/MSI、macOS app archive/DMG 及 updater `.sig` 原字节镜像到 `endearqb/kickside` 的 Gitee Release。
- GitHub 与 Gitee 分别发布自己的 updater manifest；两份清单版本、说明、平台键和签名相同，仅下载 URL 指向各自平台的同一字节产物。
- Gitee 发布顺序固定为：以 prerelease 创建或复用 tag Release、上传非 manifest 资产、下载回验 SHA-256、最后上传该版本 manifest 并回验、再提升为 stable。应用使用经过发布探针验证的 `/releases/download/latest/latest.json` 匿名入口；该 Gitee 路由需要持续监控。任何一步失败都保留 prerelease，不影响已经成功的 GitHub canonical Release。
- AppSettings additive 增加 `appUpdateSource`，合法值为 `auto | gitee | github`，默认 `auto`。旧设置缺字段时按 `auto` 读取并在 schema migration 后落盘。
- 明确选择 `gitee` 或 `github` 时，只从所选源检查和下载。`auto` 由 Rust 原生 updater 层并行检查两个源：单源失败不阻断另一源；双源均可用时选择 SemVer 较高者，同版本优先 Gitee；双源均失败时返回包含两端上下文的脱敏错误。
- 检查结果 additive 返回实际解析源；下载/安装前按当前持久化设置重新执行同一选择算法并继续使用 Tauri updater 的既有公钥验签与 graceful exit 流程。
- React 只展示和保存更新源选择及更新状态，不直接获取 manifest、下载安装包或执行验签。

## Rationale

- 单一构建保证两个分发站点不会产生难以审计的二进制、签名和平台签名差异。
- 每个镜像使用独立 manifest，避免从 Gitee 检测成功后又跳回 GitHub 下载。
- 自动模式不依赖 Tauri 多 endpoint 的非 2xx fallback 语义，因此不会被返回 200 但版本滞后的镜像提前截断。
- 更新能力仍属于原生层，符合渲染表面之下的平台能力由宿主持有的边界；前端保持可替换的展示层。

## Consequences

- GitHub Actions 需要 `GITEE_ACCESS_TOKEN` Secret；token 只通过环境变量传入镜像脚本，日志不得输出 token 或带 token 的 URL。
- Gitee API、Release 附件限制或匿名下载行为变化会使 Gitee 腿失败，但不会改变 GitHub canonical 产物；发布 workflow 将 fail closed，不更新任何 latest manifest。
- 自动模式最多执行两次 manifest 请求，换取可比较版本和单源容错；需要通过并发与合理 timeout 控制感知延迟。
- 更新源设置成为持久化契约，后续改名或删除需要新的迁移与 ADR。

## Verification

- Node 测试覆盖双源 manifest URL、签名复用、Gitee API 响应解析、附件回验和 manifest-last 顺序。
- Rust 测试覆盖设置默认/round-trip、源端点解析、自动模式单源失败、版本选择与同版本 Gitee 优先。
- React 测试覆盖启动加载、源切换保存、重新检测、忙碌态禁用和 browser mode。
- Release workflow 静态检查 Secret fail-fast、唯一构建、Gitee 镜像位于 build 之后、GitHub draft 仅在 Gitee 稳定入口成功后发布。
- G3 分别从中国大陆网络下的 Gitee 源与可访问 GitHub 的网络完成旧版升级、签名损坏、下载中断和服务退出回归；未完成前不得声明双源已发布验证。
