# DSH 接入 KickSide 代码库对齐审查

| 项 | 值 |
|---|---|
| 日期 | 2026-08-14 |
| 审查基线 | KickSide `0.2.0`（兼容目录 `apps/kimi-shell`）；`@deepseek-ai/dsh@0.1.0-rc.6` |
| 上游快照 | `deepseek-ai/DeepSeek-Harness` commit `47f943859bef60e4160492346772ded9b24f765a` |
| 结论 | Web pane P0 可按独立生命周期实现；headless 必须改为独立 one-shot 执行面并通过安全 Spike 后再开发 |

## 1. 任务契约

- 用户目标：以 research / PRD / spec / plan 为输入，先校正与真实代码库、上游行为不一致之处，再实现可验证的首期开发目标。
- 直接交付物：评审结论、Accepted ADR、修订后的 PRD/spec/plan、P0 Web pane 代码、测试与变更记录。
- 影响范围：Shell Rust/Tauri 生命周期与设置、Workspace Grid、控制中心、命令权限、安装与日志；Bridge 只做架构审查，不在未收口的安全前置下接入 headless。
- 非目标：不实现远程 DSH、不扩宽 generic external URL 白名单、不将 DSH 伪装成 Kimi session、不持久化运行时 PID/URL/凭据。
- 验收标准：设置默认关闭；受控安装可验证；显式启停与退出清理；仅加载壳拥有的 loopback URL；异常可诊断；Rust/TS 定向测试和命令注册检查通过。

## 2. 代码库对齐结论

1. 现有 Kimi `RuntimeState`、安装目录和命令语义都是领域专属实现。根据项目宪法“抽象应由重复证明”，P0 不建立预测性的 `AgentBackendRegistry`，而是实现窄而清晰的 `dsh_manager`。
2. `provider` 已是模型 API 供应商命名空间。功能开关唯一落点是 `agentBackends.dsh.enabled`；设置 schema 采用加法迁移。
3. 仓库没有远程 feature-flag 基础设施。P0 是本地持久化实验开关；关闭操作必须先停进程，成功后才写入 `false`。
4. DSH 不进入 `external` pane，也不扩宽其 origin 白名单。新增独立 `dsh` kind，URL 由 Rust 活状态投影，不写入 Grid 持久化状态。
5. 持久化 PID 后跨重启回收存在 PID 重用风险。P0 只对当前进程持有的 `Child` / process group 具有终止权；不按旧 PID 盲杀。
6. 现有 `InstallFlowCatalog` 是 Kimi/PowerShell 特化实现，macOS 还会拒绝非 Kimi flow。DSH 使用独立、显式的私有 npm 前缀安装流程，并复用同一套设置与诊断展示，而不是假复用目录。
7. Bridge 的 `RuntimeAdapter` 是 Kimi 持久 session 协议，`ExecutionService` 也硬编码 `providerName="kimi"`。一次性 DSH 任务应使用 `OneShotTaskExecutor` + 显式 backend router（或等价独立路径），不能作为“第四个 RuntimeAdapter”。
8. 飞书、Telegram、微信只共享部分 inbound/orchestrator 投影，轮询、取消、心跳与消息上限不同；因此 P1 先做飞书，再逐通道验收，不能宣称另外两条通道“自然获得”。

## 3. 上游核验结论

- npm 当前 pin 为 `0.1.0-rc.6`，包未声明 Node `engines`；最低 Node 版本必须由双平台 Spike 或壳自身支持基线决定，不能伪造上游约束。
- DSH 默认权限是 `workspace-write + ask`。headless 没有浏览器审批回答器，触发审批时会 fail-closed 为 `unavailable`；它不是自动放行，也不是无限挂起。
- `DSH_PERMISSION_MODE=danger-full-access` 会关闭审批并扩大权限，IM 路径不得使用。
- 隔离环境实测运行时 `npx --yes` 超过 90 秒仍未形成监听或可用就绪信号，证明它不适合作为生产启动 fallback；生产只执行已验证私有前缀中的固定入口。

## 4. 分阶段发布门槛

### P0 Web pane

- 当前主流程：preflight → 私有前缀安装 → 以 Shell 默认工作区分配 loopback 端口 → 直接 Node 启动固定入口 → HTTP 状态与有界页面身份 readiness → 独立 pane；pane 内后续工作区切换由 DSH UI 完成并经只读桥更新壳标题/目录动作。
- 必须在 Windows 与 macOS 各完成真实安装、WebView2/WKWebView 交互、停止后整棵进程树消失的 G3 证据，才能称为双平台发布完成。
- 未取得 Windows 软停证据时，代码可提供有界强制终止作为安全兜底，但发布清单必须保留未完成项。

### P1 Headless

- 硬前置：干净环境 env-only 验证、默认 `workspace-write` 的 fail-closed 审批验证、macOS/Windows descendant-kill 验证、系统凭据库存取方案和明确的 connector authz/命令语法。
- runner 必须有 minimal env allowlist、有界 stdout/stderr、全局与 workspace 并发闸、queued/running 取消以及整树终止。
- 任一硬前置不满足时，headless 保持 No-Go；这不阻塞 P0 Web pane。
