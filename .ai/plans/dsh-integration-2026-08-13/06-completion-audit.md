# Completion Audit · DSH integration

| 项 | 结论 |
|---|---|
| 审计日期 | 2026-08-14 |
| 产品基线 | KickSide 0.2.0；兼容 bundle id `com.kimi.shell` |
| P0 代码 | 完成 |
| macOS arm64 G3 | 当前 pin 的安装、启动/readiness、WKWebView、TERM/残留、端口与崩溃故障注入已完成；2h 长稳仍在发布候选复跑 |
| Windows x86_64 G3 | 未完成，阻止宣称“双平台可发布” |
| P1 headless | No-Go；安全前置未完成，不进入实现 |

## 1. 需求证据矩阵

| 需求 | 状态 | 代码/证据 |
|---|---|---|
| FR-1 环境检测 | 完成 | `nodejs_locator` 覆盖 GUI 冷环境常见 Node 管理器；固定 `util.parseEnv` 能力探针拒绝 Node 18/过旧运行时，提示最低 Node 20.12.0；控制中心显示 Node/npm/pin；缺失或过旧均为 E-DSH-001 |
| FR-2 启停与 pane | 代码完成，macOS 已证 | 私有固定入口、argv、canonical cwd、精确 loopback port；首次 readiness 同时校验 2xx/3xx 与前 512KiB `__DSH_BOOT__` 页面身份；控制中心可显式恢复 stopped/crashed，pane 恢复使用最后观测工作区；隔离 production App 新判定 767ms ready |
| FR-3 状态 | 完成 | stopped/starting/running/degraded/crashed/stopping；Grid 与控制中心均为 1s 投影；运行期 5s health、3 次失败降级与自动恢复；degraded 保留原 owned iframe，不因瞬态抖动丢失页面状态 |
| FR-4 日志 | 完成 | stdout/stderr 落 `dsh.log`，写前脱敏，10MiB projected-size 轮转，仅保留 `.1`，单行 64KiB；控制中心 tail 与 pane 日志入口 |
| FR-5 开关 | 完成 | `agentBackends.dsh.enabled` 默认 false；启用后随 KickSide 启动默认工作区；关闭先停 owned tree 再保存 false |
| FR-6 首次引导 | 完成 | DSH pane 首次覆盖层说明工作区/API key 由 DSH UI 管理；兼容内部 ack key 保留 |
| NFR-1 关停 | 代码完成，macOS 已证 | 当前 Child/process group ownership；TERM→8s→KILL；独立探针 60ms exit 0、残留 0；隔离 production App 标准 Quit 后 Kimi/DSH PID 与端口全部消失；Windows G3 待证 |
| NFR-2 崩溃 | 完成 | 非主动退出转 E-DSH-005/crashed，不自动重启；控制中心与 pane 展示恢复入口 |
| NFR-3 隐私 | 完成（Web P0） | minimal env、无 key 注入、不设置 telemetry、写入/读取双重 redaction；DSH 凭据仍由其 UI 管理 |
| NFR-4 卸载 | M3 | 计划已改为明确的受管组件清理能力；不声称 macOS 拖废纸篓会执行不存在的钩子；`$DSH_HOME` 永不删除 |
| NFR-5 安全 | 完成 | 受控 Node；package/entry canonicalize 后须留在私有根内并直接执行 canonical entry，符号链接/junction 越界 fail closed；argv 数组、127.0.0.1、精确 URL trust、generic external allowlist 未扩大、运行时 authority 不持久化 |

## 2. 用户追加目标

| 目标 | 状态 |
|---|---|
| KickSide / 启伴品牌与 GitHub 仓库改名 | 完成；仓库为 `endearqb/kickside`，保留 `com.kimi.shell` 与兼容 key/路径/图标 |
| Node/npm GUI 冷环境检测与一键安装 | 完成；当前 Mac 实际识别 NVM Node 24.19.0，私有 pin 已安装 |
| KimiCode + DSH 随应用启动 | 完成；Kimi 后端常规自启，DSH 在用户启用后随应用启动并加载 `workDir` 默认工作区 |
| 新建菜单、正式名称、官方 icon | 完成；纵向菜单、KimiCode/KimiChat/DSH，标题与 Pane Shelf 品牌图标 |
| 每次点击新增 DSH pane | 完成；多个 pane 唯一 namespace，共享单后端 |
| 最后 pane 关闭不停 DSH | 完成；只有 App/更新退出或控制中心关闭/停止会停 owned 后端 |
| 控制中心标题/版本/暗色/UI 统一 | 完成；KickSide 设置、0.2.0、共享 disclosure row、亮暗 token；DSH 安装/开关/启动/停止共享互斥动作状态，各动作 busy 文案独立 |
| 跳过 KimiCode 欢迎页 | 完成；使用官方 `kimi_onboarded=1` query，保留 token fragment |
| DSH 当前会话目录与 Pane Shelf 标题 | 完成；per-iframe session/cwd 只读桥、严格 source/origin/path 校验 |

## 3. 真机证据

- 当前用户配置：`workDir=/Users/qian/同步空间/Skill-workspace`、DSH enabled；私有安装 package version `0.1.0-rc.6`，固定入口存在。
- 当前 App-owned DSH：受控 NVM Node 绝对路径，独立 PGID，`GET http://127.0.0.1:3080/` 返回 200。
- 隔离探针：独立 `DSH_HOME` + 固定入口 + 3179，805ms ready；SIGTERM process group 后 60ms exit 0，残留 group member 0。
- S-10 启动基线（Node 24.19.0 / Apple Silicon）：固定 pin 的 5 次隔离 `DSH_HOME` 冷启动为 578/361/361/362/360ms，中位数 361ms；预热后复用同一 `DSH_HOME` 的 5 次热启动为 318/321/321/319/320ms，中位数 320ms；10 次均软停、未强杀且端口全部释放。Windows 数据未取得前保留 spec/生产设置的 60s 默认启动超时；runtime smoke 的 90s 仅为 CI 容错上限。
- 多轮 runtime smoke 真实复验：隔离 npm 安装 165926ms 后连续 3 次启动，ready 1012/507/505ms（中位数 507ms），stop 252/251/252ms（中位数 252ms）；均未强杀且端口关闭。固定 pin canary 已配置为每个 Windows/macOS × Node job 连续采样 5 次，仍待原生 Actions 首跑。
- macOS 应用级退出复验：以临时 product/bundle identity `KickSide Soak` / `com.kimi.shell.soak` 和独立配置、Kimi home、DSH home 启动 production Tauri App；owned Kimi 0.36.0 在 58235 ready、DSH rc.6 在 33080 ready。通过标准 macOS Quit 事件退出后约 0.5s App 消失，Kimi PID 42201、DSH PID 42118 均不存在，两个端口均无 listener；隔离配置和日志已移至 `/tmp` 证据目录，未触碰正式 `com.kimi.shell` 配置。
- canonical 入口收紧后的应用级复验：从当前源码以编译期隔离 identity `KickSide Soak` / `com.kimi.shell.soak` 重建 production App，复制固定 pin 到隔离私有根；受控 Node 以 canonical entry 启动 PID 49758，33080 根页含 `__DSH_BOOT__`，日志 1787ms 进入 ready。标准 macOS Quit 后 App、DSH、Kimi 三个 PID 均消失，33080/55143 均关闭；Windows 结论不从该证据外推。
- macOS 发布候选故障注入：只占用 33080 时 production App 选择 33081 并通过 `__DSH_BOOT__`；33080–33179 共 100 个端口全部占用时 250ms 内记录 E-DSH-003 且不拉起 DSH；外部 SIGKILL 当前 owned DSH 后 1250ms 内日志记录 `E-DSH-005（exit=None）`，没有自动重启；flag 关闭时 App/Kimi 正常运行但没有 DSH child 或启动日志。各隔离 App 标准 Quit 后 owned PID/端口均清零。
- 用户提供的 macOS 截图证明当前 pin 已在 KickSide WKWebView pane 内完成加载、会话交互、多 pane 并排和目录切换投影。
- 最新本地测试包：`KickSide_0.2.0_macos_arm64_dsh-p0-recovery.zip`，SHA-256 `988bebd335bcaf11348cdb80c126ff564dcf809a27a2611c365a85015734781d`，20379346 bytes；包含控制中心显式启动/重试、pane 按当前工作区恢复、失败 Promise 状态收口、按原始字节有界校验的 production 页面身份 readiness、canonical 私有入口约束及 E-DSH-005 崩溃日志；从 zip 解包后 strict deep ad-hoc 签名、主程序/Bridge arm64、`com.kimi.shell` 与 0.2.0 均复验通过。

## 4. 尚不能宣称完成的范围

1. Windows 11 原生 npm 私有安装、WebView2 对话、端口故障、更新/退出/关开关三条停止路径及 descendant 残留矩阵；人工步骤见 `07-windows-g3-checklist.md`，自动 runtime canary 与 Windows descendant test 已入库、待 Actions 首跑。
2. 双平台 2h Kimi + DSH 长稳与完整故障注入发布矩阵。
3. P1 headless：A-8 env-only、A-10 approval fail-closed、系统凭据库、Bridge handoff、双平台 descendant kill、逐 connector authz/取消/心跳均未完成。继续保持 No-Go 是安全结论，不是漏做 P0。

## 5. 发布判定

- 可以称为：`P0 代码完成；macOS 当前 pin 本机可测`。
- 不可以称为：`Windows/macOS 双平台发布完成` 或 `IM 已支持 DSH headless`。
- 下一发布门：用户在 Windows 11 测试机运行 `07-windows-g3-checklist.md`；随后以 0.2.0 release candidate 在两平台复跑 2h 与故障注入。
