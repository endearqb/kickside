# ADR · DSH P0 集成契约

| 项 | 值 |
|---|---|
| 日期 | 2026-08-14 |
| 状态 | Accepted |
| 范围 | `apps/kimi-shell` 的 DSH Web pane P0；为未来 Bridge headless 规定边界 |

## Context

DSH 是 rc 阶段的独立 Node CLI/Web 服务。仓库当前只有 Kimi 专属 runtime、Kimi/PowerShell 特化安装流和 Kimi session 语义的 IM RuntimeAdapter。直接推广为通用 registry、复用 external allowlist 或持久化 PID 都会制造尚未被重复证明的抽象或扩大安全边界。

## Decision

1. P0 使用专属、薄的 `dsh_manager`；不建立 `AgentBackendRegistry`，也不迁移既有 Kimi runtime。
2. 唯一持久设置键为 `agentBackends.dsh`，设置 schema 升至 12；只持久化用户意图和稳定配置，不持久化 PID、端口、URL、状态或凭据。
3. DSH 以固定源码常量 pin。KickSide 自有支持矩阵为 Node 22.19+ 的 22.x 或 24+，并额外要求固定 `node:util.parseEnv` 能力探针；rc.6 npm 元数据未声明 `engines`，Node 20.12 真实可运行证据只作为观察性兼容，不取得产品支持权限。安装到壳私有前缀的临时目录，完成版本与入口校验后再替换；`package.json` 与入口 canonicalize 后必须仍在当前私有安装根内，符号链接/junction 越界时 fail closed；生产直接执行已验证 canonical 入口，不使用运行时 `npx` fallback。运行选择与安装工具链选择分离，安装只接受 Node/npm 同目录配对；Windows `npm.cmd` 优先解析同工具链 `npm-cli.js` 并由 Node 直接执行，缺失时只允许通过 canonical System32 `cmd.exe` 的 `/D /S /V:OFF /C` 回退执行固定包名、版本与 flags；shim 只按原生 working directory 定位，安装前缀只经 `npm_config_prefix` 环境变量传入，其他命令处理器或 shim 名称 fail closed。
4. Rust→TS 只暴露 main-window 命令：preflight、安装、读/写设置、start、status、stop、log tail。preflight additive 区分 `runtime_ready`、`install_ready`、Node/npm 与安装有效性，旧 `ready` 保持等价于 `runtime_ready`；安装命令通过 typed Tauri Channel 推送阶段与已经脱敏/限长的 stdout/stderr。所有字段使用一个 serde/TypeScript 契约，状态词保持项目既有中文 UI 词汇。
5. 终止权限只来自当前运行期持有的 `Child` / process group。应用退出、更新和开关关闭都先执行有界停止；停止失败则阻止把状态宣称为已关闭。不得依据持久化旧 PID 杀进程。
6. 运行 URL 必须精确等于本次分配的 `http://127.0.0.1:<port>`；首次 HTTP readiness 必须同时满足 2xx/3xx 与固定 pin 的有界页面身份 `__DSH_BOOT__`，任意其他 200 页面不能取得 ready authority；进入 running 后使用轻量状态健康检查，持续失败进入可恢复的 degraded 状态。stdout 和重定向目标都不能扩大 origin 权限。
7. Grid 使用独立 `dsh` pane kind。运行 URL/状态由 Rust 活状态投影；不扩宽 generic `external` 白名单。首期只允许一个 DSH 后端实例，但可创建多个共享该实例的 pane；关闭任意 pane（包括最后一个）只移除视图，不停止后端。后端只在应用退出/更新退出，或用户在控制中心显式关闭时停止。
8. headless 不实现为 Kimi `RuntimeAdapter`。后续采用 one-shot task executor + 显式 backend router，并以系统凭据库、默认 `workspace-write` fail-closed、整树终止和逐 connector 验收为硬门槛。

## Consequences

- P0 的改动面小且可以独立回滚；代价是暂不提供通用后端抽象和多实例。
- 本地开关不是远程开关；回滚需要用户/版本操作，文档不得声称可远程关闭。
- Windows/macOS 真机安装、WebView 与进程树证据仍是发布级 G3 gate；自动化单测只能证明契约与局部实现。
- 收紧支持矩阵会拒绝曾真实运行成功的 Node 20；收益是与 Kimi/上游开发基线统一，代价是兼容范围主动收窄。Windows shim 回退扩大了受控 shell 面，因此必须由同工具链约束、系统命令处理器校验、固定命令串、脱敏日志和 Windows 特殊字符路径回归共同守护。
- 当第三种后端或第二个真实复用点出现时，再评估抽取共享 process supervisor / backend contract。
