# v0.2.3 双源发布与发布流程 Skill

## 任务契约

- 用户目标：在 README 增加局域网功能简介与安全截图，将 0.2.3 推送到 GitHub/Gitee main，按 canonical GitHub build + Gitee 同字节镜像流程发布，并在成功后固化发布 Skill。
- 直接交付物：中英文 README、裁除二维码的 LAN 截图、0.2.3 版本号与发布说明、精确未签名 macOS 例外、双源 main/tag/Release、发布后 Skill。
- 影响范围：根 README、发布图片、Shell 版本与 release notes、GitHub Actions、发布/架构治理记录、GitHub/Gitee 仓库与 Release。
- 非目标：不在 Gitee 二次构建；不发布截图中的二维码凭据；不把 ad-hoc macOS 包描述为 Developer ID 签名、公证或 Gatekeeper 可信。
- 约束：GitHub 是 canonical build；Gitee 只接受经 SHA-256 回验的同字节附件，manifest 最后上传；任何失败保持 prerelease/fail closed；Skill 只在真实 0.2.3 流程成功后创建。
- 验收：main 在两端指向同一提交；GitHub/Gitee `v0.2.3` 均为稳定 Release 且 8 项资产矩阵完整；manifest 平台/版本/URL/签名正确；有效 CI 全绿；Skill 通过 `quick_validate.py`。
- 保守假设：未配置 Apple 发布凭据时，沿用上一版本安全等级并以 Accepted ADR 精确批准 `v0.2.3` ad-hoc 例外；下一版本不得自动沿用。

## Checklist

- [x] README 增加可信局域网访问简介与不含二维码主体的真实界面截图。
- [x] 版本同步到 0.2.3，新增 warning-first release notes 与精确 unsigned macOS ADR。
- [x] 手动 Gitee workflow 改为校验当前 package tag 并动态核对版本化资产名。
- [x] 前端 57 files / 298 tests、安全门、Rust 303 tests/locked check/clippy、Go vet/test/race、Node 发布测试与 workflow YAML 通过。
- [x] 推送同一 main 提交 `2b8aa5dab749061664e99d8e13041ef8ca92eea4` 到 GitHub 与 Gitee；GitHub main CI run `32135084282` 的 8 个 job 全部成功。
- [x] 创建并推送 annotated `v0.2.3`；GitHub canonical Release 为 stable，8 项附件的 API size/state/SHA-256 与本地回下载一致。
- [x] 完成 Gitee 8 项同字节镜像、manifest-last、公开回下载与 stable promotion；`releases/latest` 指向 `v0.2.3`。
- [x] 基于真实成功轨迹创建并以 `quick_validate.py` 验证个人 Skill `/Users/qian/.codex/skills/release-kickside`。

## 发布复盘

- GitHub release run `32135911550` 的 prepare、macOS、Windows 与 updater manifest job 成功；Gitee mirror job 在首个大附件等待 15 分钟后失败，因此整个 run 的结论为 failure，不能把自动镜像描述为成功。
- 失败保持 Gitee `v0.2.3` 为 prerelease 且未暴露 `latest.json`。经用户在提交时确认后，从 GitHub canonical Release 下载并按 API digest 校验 8 项资产；通过已登录 Gitee 会话先上传 7 个安装/签名附件，逐项公开回下载 SHA-256 后最后上传 Gitee 专用 `latest.json`，再提升 stable。
- GitHub/Gitee main 均指向 `2b8aa5dab749061664e99d8e13041ef8ca92eea4`；annotated tag object 均为 `5f01de654d02717ffc637902e09ddea9c6ffb31a`，解引用到同一 release commit。
- macOS `.dmg` 与 `.app.tar.gz` 仍是 ad-hoc、未 Developer ID 签名且未公证；该例外只适用于 `v0.2.3`。

# Gitee 双源发布与应用更新源选择

## 任务契约

- 用户目标：为中国大陆用户提供 Gitee 安装包镜像，并允许在应用内选择自动、Gitee 或 GitHub 更新源。
- 直接交付物：Accepted ADR、GitHub 单一构建后的 Gitee Release 镜像、双源 updater 清单、持久化更新源设置、自动源选择、测试与治理记录。
- 影响范围：发布 workflow、updater manifest/镜像脚本、AppSettings schema、Rust updater command、控制中心更新设置、相关测试和发布文档。
- 非目标：不在 Gitee 独立构建第二套二进制；不更换 Tauri updater 公钥；不把更新下载或验签移到 React；不从自动化结果声明双平台 G3。
- 约束：GitHub 构建产物是唯一可信来源；Gitee 必须镜像完全相同的安装包与 `.sig`；两个源均使用 HTTPS；任何 secret 不进入日志、README 或 `.ai/`。
- 验收：源选择可持久化且旧设置默认兼容；明确源只访问该源；自动模式可在单源失败时继续并选择可用的较新版本；检查与安装复用相同决策；Gitee 在安装包/签名校验后最后发布清单；G0/G1 通过。
- 架构事实入口：`.ai/architecture/current-state.md`、`.ai/architecture/verification-gates.md`、Accepted signed updater ADR、`DESIGN.md`。
- 保守假设：现有 GitHub 发布继续作为 canonical release；Gitee 只承担中国大陆分发镜像；新安装默认自动，既有安装经 additive schema 默认自动。

## Checklist

- [x] 接受双源发布与更新源选择 ADR。
- [x] 实现 Gitee Release 附件镜像与固定清单入口，确保 `latest.json` 最后可见。
- [x] 扩展 manifest 生成器支持经允许的 GitHub/Gitee HTTPS 发布 URL。
- [x] 增加 AppSettings schema 与自动/Gitee/GitHub 源选择 command。
- [x] 控制中心增加符合 DESIGN 的紧凑更新源选择行。
- [x] 补充 Rust、React、Node 与 workflow 静态回归。
- [x] 更新 README、架构事实、验证门和 `.ai/changes/2026-08-18.md`。
- [x] 运行 G0/G1 与 diff 检查，记录无法在本地完成的 G3。
- [x] 增加 `workflow_dispatch` 手动镜像入口，用现有 GitHub stable Release 回填首个 Gitee Release。
- [x] 真实回填 `v0.2.2`：7 个 canonical 资产公开回下载 SHA-256、Gitee manifest-last、固定 tag/latest 双入口与 8 项 stable 矩阵均通过。
- [ ] 将 Gitee 附件上传迁移到可达 Gitee 的受控 runner 或等价国内上传面；GitHub-hosted runner 首个约 21MB 附件已实测 15 分钟超时，当前自动 job 只提供 fail-closed staging，不能视为无人值守镜像完成。

## Review

- 自动模式不复用 Tauri endpoint 顺序 fallback，而是在 Rust 中并行检查并比较 SemVer，避免 Gitee 返回 200 旧清单时阻止 GitHub 较新版本。
- Gitee job 不接触签名私钥，只从已发布 GitHub Release 下载 canonical 资产；manifest 的签名文本继续来自同一 `.sig`。
- 真实发布仍 blocked 于 `GITEE_RELEASE_TOKEN` 与新 tag；首次发布必须观察 prerelease 附件匿名下载和 latest alias，再完成中国大陆网络下的安装版 G3。

# DSH 菜单状态同步与 Kimi 后端控制评估

## 任务契约

- 用户目标：修复控制中心开启 DSH 后，新建窗格与浏览器打开菜单仍不显示 DSH；评估 KimiCode 是否也应增加后端开关。
- 直接交付物：DSH 控制中心动作成功后刷新 App 级运行时投影；补回归测试；给出 Kimi 生命周期结论。
- 影响范围：App DSH controller 透传、控制中心 DSH 面板、标题栏菜单状态、定向测试。
- 非目标：本轮不改变 Kimi 主启动门，不增加可能误杀 external Kimi 实例的无差别开关，不实现 DSH-only Shell。
- 验收：DSH 从关闭切到开启后无需刷新 App 即重渲染两个菜单；浏览器入口在 URL 就绪前保持禁用、就绪后可用；G0/G1 通过。
- 架构事实入口：`.ai/architecture/current-state.md`；Kimi owned/external 生命周期源码；`DESIGN.md`。
- 关键假设：KimiCode 后端控制属于独立产品决策，本轮先修复与它无关的 DSH 状态同步 Bug。

## Checklist

- [x] 确认控制中心 Panel 与 App controller 存在两份不同步的 DSH settings/status。
- [x] 在启用、安装、启动、停止成功后刷新 App 级 DSH 投影。
- [x] 补充关闭→开启会通知外层刷新且不触发展开行为的测试。
- [x] 核对 Kimi owned 与 reused_external 的停止边界及主启动门依赖。
- [ ] 若未来支持 Kimi 停止态，先保证控制中心不依赖 Kimi ready 且外部实例永不被终止。

## Review

- DSH 菜单缺失不是 Rust 启动失败或菜单 memo，而是顶层 `dsh.settings.enabled` 一直停留在 false；刷新后顶层会开始既有的 1 秒运行态轮询。
- 不建议照搬 DSH 的持久化 enabled switch 给 Kimi。Kimi 是 Workspace、Explorer 请求与 IM locator 的主 runtime；更安全的后续方案是 ownership-aware 的“停止/断开”和“启动/重新连接”。

# Kimi Code App 内文件拖放

## 任务契约

- 用户目标：让拖入 Tauri App 的文件事件直接进入 Kimi Code Web，使聊天框能够接收附件。
- 直接交付物：Windows 保持 HTML5 拖放；macOS 通过窗口原生 Drop、单次文件授权与 Kimi 自有 file input 恢复附件。
- 影响范围：macOS main 配置、Rust 原生 drop grant、Workspace Grid 落点路由、all-frame bridge、ACL/command registry、回归测试与架构记录。
- 非目标：不改变 prefill/import picker，不提供任意路径读取，不直接调用 Kimi 上传 API，不依赖 Vue 私有实例。
- 验收：真实 macOS Finder 单文件松开后进入 Kimi 原生附件条目；路径不进入 JS/iframe/日志；非 Code pane 不消费；grant single-use/TTL/上限；Windows base config 仍关闭 native DnD。
- 关键取舍：Tao `NSWindow` 是 macOS 已证明的事件入口；附件内容只通过本次 OS Drop 建立的 opaque grant 跨越原生边界。

## Checklist

- [x] 确认 Tauri 默认原生 handler 会阻止 WebView 默认文件拖放。
- [x] 真实 DOM trace 证明 Finder 事件未进入 Kimi iframe；正确的 `WindowEvent::DragDrop` 收到 Enter/Over/Drop。
- [x] Windows base main 保持 `dragDropEnabled=false`；macOS main 平台覆盖为 true。
- [x] 实现 O_NOFOLLOW 普通文件句柄 grant、30 秒 TTL、single-use、8 文件/25 MiB 单文件/50 MiB 总量上限。
- [x] 只把 Code pane 落点经 exact origin + nonce 转发到 Kimi 自有 file input，不暴露路径。
- [x] 核对 Kimi Code 0.36.1 生产 bundle，确认 dragover 只检查 items、drop 已回退到 files。
- [x] 在可信 Kimi frame 内补充 `types=Files/items=[]` 的窄兼容，并覆盖作用域和事件传播反例。
- [x] macOS debug App 实机拖入单文件并确认出现 Kimi 原生附件条目。
- [ ] 发布前补第二 Code pane、多文件、目录/超限、第三方文件管理器与 Windows WebView2 G3。

## Review

- 先前纯 DOM workaround 被真实事件 trace 推翻：Kimi iframe 连 `dragenter` 都未收到，缺失 Chrome 的“松开鼠标添加附件”正是该事实的 UI 证据。
- 原生窗口链路已稳定收到文件数量与落点；正式桥不暴露路径或通用 fs command，只允许主窗口消费本次 Drop 的一次性句柄 grant。真实单文件端到端已通过。

# Kimi Code Web 响应式布局增强

## 任务契约

- 用户目标：完成 `.ai/plans/kimi-code-web-ui-development-plan.md`，保持左侧 Sessions sidebar 与 Header 原样，并实现红框消息 TOC 在所有 pane 宽度下左侧短条常驻、hover/focus 向右展开，同时修正无-sidebar 窄 pane 的输入区底距与默认蓝色图标。
- 直接交付物：生产 all-frame bridge 响应式增强、精确宿主消息扩展、常驻 TOC rail、DOM contract、单元与视觉回归、治理记录。
- 影响范围：Workspace Grid Kimi pane、`frame_workspace_bridge.js`、定向测试、视觉 fixture、Kimi Web 维护与架构文档。
- 非目标：不恢复 retired EnhancedLocal/workspace proxy，不修改只读上游源码快照，不复制上游已有移动 session switcher，不弱化 postMessage origin。
- 验收：真实 Kimi 0.36.1 DOM 审计完成；480/800/959/960/1179/1180/1280/1440 断点与明暗主题有自动化基线；TOC 折叠/展开可访问且 fail-open；G0/G1、视觉 gate 和生产构建通过。
- 保守假设：计划中的“会话目录”指 Kimi 0.36.1 原生 `ConversationToc`；左侧 `aside.side` 仅用于识别 pane 形态且不得修改。真实 WKWebView/WebView2 与显示缩放属于发布前 G3。

## Checklist

- [x] 以真实 Kimi Code 0.36.1 页面审计生产路径、DOM、断点、计算样式和主题变量。
- [x] 在现有精确 origin 主题 envelope 上 additive 增加 Kimi surface/layout/accent，不创建平行消息协议。
- [x] 在生产 all-frame bridge 实现 Kimi-only、可关闭、fail-open 的布局状态机与 rAF 合并观察器。
- [x] 保持 Header 原生高度；只在无-sidebar 的 compact/narrow pane 应用 12px + safe-area composer 底距和 Kimi 原生蓝色工作区图标。
- [x] 保持 Sessions sidebar DOM/布局原样；所有宽度将原生 ConversationToc 作为正文左侧短条，label 默认折叠并在 hover/focus 时向右展开，mobile 缺失时从 user turn anchors 生成有界 projection。
- [x] 增加精确消息、DOM 失败、功能关闭、断点、主题、折叠/展开和 projection 回归测试。
- [x] 增加 10 张脱敏 Chrome 视觉基线及本地回归命令。
- [x] 更新 README、Kimi Web 维护文档、DOM contract、current state 与 verification gates。
- [ ] macOS WKWebView 与 Windows WebView2 完成 3:2、125%/150% 缩放、IME、触控和屏幕阅读器 G3。

## Review

- 原计划引用的 workspace proxy/injection 已退出生产路径，实现按事实落在 `frame_workspace_bridge.js`。2026-08-16 重新审计生产二进制确认右侧 `nav.conversation-toc` 确实存在；此前把它误判为左侧 Sessions sidebar 的实现、fixture 与文档均已纠正。
- 消息仍发送到 iframe 精确 origin；布局启动还要求 parent source、`surface=kimi-code` 与 `layoutEnhancement=v2`，DSH/external frame 行为不变。
- 功能可在 Shell origin 通过 `localStorage["kimi-web-layout-v2"]="off"` 稳定关闭，frame 同名 key 作为 origin 级紧急关闭；hook 缺失只输出无 DOM/URL/token 的有界诊断并保留原生页面。

# DSH Windows 合并前核查优化

## 任务契约

- 用户目标：根据 Windows 安装、安装反馈、Node 预检与 Explorer 右键菜单核查结论，完成可安全验证的优化与开发。
- 直接交付物：收紧 DSH Node 支持矩阵、分离运行/安装就绪与工具链选择、补 Windows npm shim 安全回退、实时安装阶段/日志、PR runtime gate、测试和治理记录。
- 影响范围：DSH Rust manager、Node locator、Rust→TS 安装事件契约、控制中心、runtime workflow、DSH ADR/架构事实与验证入口。
- 非目标：不把日志伪装成交互终端；不从 CI 声称 Windows 安装包 G3；不在 rc.6 缺少稳定外部 UI 选中契约时用 DOM/localStorage 自动化冒充 Explorer→DSH workspace 聚焦。
- 验收：Node 20.12/22.18/23 拒绝，22.19/24 接受且能力探针通过；裸 Node 可运行已安装 DSH，但只有完整同工具链 Node/npm 可安装；Windows shim 有受信任 cmd fallback 与特殊字符测试；安装阶段/脱敏日志实时可见；PR canary 有稳定汇总检查；G0/G1 与安全 gate 通过。
- 架构事实入口：`.ai/architecture/current-state.md`、`.ai/architecture/verification-gates.md`、Accepted DSH P0 ADR。
- 保守假设：rc.6 npm 元数据没有 `engines`，22.19/24 是 KickSide 自有支持矩阵；Node 20 既有成功记录保留为观察事实，不再取得产品支持权限。

## Checklist

- [x] 核对固定 rc.6 npm 元数据、当前 Rust/TS/CI/Explorer 实现与既有验证记录。
- [x] 将 Node 版本矩阵与 `parseEnv` 能力探针改为 AND，并补边界测试。
- [x] 分离 runtime/install toolchain 选择，禁止跨来源 PATH npm 配对，additive 扩展 preflight。
- [x] 增加 Windows `npm-cli.js` 主路径与受信任 System32 `cmd.exe` shim 回退，补 fail-closed 和特殊字符 argv 测试。
- [x] 通过 Tauri Channel 实时推送安装阶段与脱敏输出，控制中心显示可访问的安装进度/日志。
- [x] 将 Windows/macOS × Node 22.19/24 runtime smoke 接入 PR，并提供稳定 `DSH runtime gate` 汇总；Node 20/latest 留作观察。
- [x] 核验 rc.6 `workspace.create`；确认缺少稳定的外部 UI workspace/session 选中 seam，本轮不实施误导性的 DSH Explorer 打开。
- [ ] 在 GitHub ruleset/branch protection 将 `DSH runtime gate` 设为 required。
- [ ] 用 Windows 安装包完成官方 Node 22.19、Node 24、nvm-windows、Volta、中文/空格目录、代理 registry、WebView2 与整树停止 G3。

## Review

- T6“有意跨越边界”落实为 typed Channel；日志在发往 WebView 前已经过与落盘相同的 redactor 和长度限制，Channel 断开不改变安装结果。
- npm shell fallback 不是通用命令执行器：命令处理器必须 canonical 到 System32 `cmd.exe`，AutoRun/延迟展开关闭，包名、版本与 flags 固定，动态路径只经专用环境变量进入引号上下文。
- `ready` 继续等价于 `runtimeReady` 以保持旧序列化语义；`installReady` 独立表达完整工具链可用性，因此 npm 丢失不会让已安装 DSH 无法启动。
- Explorer P1 的后端路由和 `workspace.create` 可以实现，但 rc.6 没有可靠的外部 UI 选中契约；在官方 seam 或 pin-protected contract 出现前，继续保持 KimiCode 专用菜单比“菜单看似成功、实际未打开目标 workspace”更诚实。

# DSH 接入评审与 P0 Web pane

## 任务契约

- 用户目标：基于 DSH research/PRD/spec/plan 审查并对齐真实代码库，优化计划后实现安全、可验证的开发目标。
- 直接交付物：对齐评审、Accepted ADR、修订后的 PRD/spec/plan、DSH P0 Web pane、测试和架构/变更记录。
- 影响范围：Shell 设置、Rust 生命周期/安装/权限、Workspace Grid、控制中心、退出/更新；Bridge headless 只收敛设计，不在安全前置未完成时实现。
- 非目标：不建立预测性 AgentBackendRegistry；不扩 external allowlist；不持久化 DSH PID/URL/凭据；不把 DSH one-shot 伪装成 Kimi RuntimeAdapter。
- 验收：默认关闭；固定 pin 私有安装；单实例显式启停；精确 loopback URL；关闭/退出收口；日志脱敏；前端/Rust/ACL gate 通过；发布级双平台缺口如实记录。

## Checklist

- [x] 阅读治理、架构、设计系统、计划文档和相关目录 README。
- [x] 核验 DSH 上游 pin、启动入口与 headless approval fail-closed 行为。
- [x] 完成 Shell/Grid/Bridge 三条代码链审计并修正计划误判。
- [x] 新增对齐审查和 Accepted ADR，修订 PRD/spec/plan。
- [x] 实现 schema 12、专属 dsh_manager、私有安装、preflight、生命周期、状态与脱敏日志。
- [x] 接入独立 dsh pane、控制中心实验开关、目录选择和首次使用引导。
- [x] 接入 main-only command ACL、退出与更新停止路径。
- [x] 完成 TypeScript、定向/全量前端、Rust 与 command registry 验证。
- [x] 补齐持续 health/degraded、控制中心 1s 状态投影和 degraded iframe 存活回归。
- [x] 统一 DSH 控制中心动作互斥：停止纳入 busy 流程，安装/停止使用独立进行中文案并阻止重复停止 IPC。
- [x] 完成 macOS 私有 pin 安装、HTTP readiness、WKWebView 对话、SIGTERM 与 process-group 无残留证据。
- [x] 完成 macOS S-10 冷/热启动各 5 次基线：中位数 361ms / 320ms，10 次均软停且端口释放。
- [x] 将真实 runtime smoke 扩展为一次安装后 `--samples 1..10` 多轮采样；本机 3 次复验 ready 中位数 507ms、stop 中位数 252ms、无强杀且端口全部关闭。
- [x] 重建包含 canary/停止交互修复的 macOS arm64 测试包，完成 deep ad-hoc 签名及 zip 解包复验。
- [x] 完成 macOS Kimi + DSH 后端 ≥70min 共存探针：实际 79m14s、950 次采样、0 失败，两端软停且进程组/端口清零。
- [x] 完成隔离签名 updater 真版本差 0.2.0→0.2.1：修复安装后 App 未退出，复跑 App/Kimi/DSH PID 与端口清零，更新后 0.2.1 可启动。
- [x] 定位 Windows E-DSH-002 首轮阻断：官方 `npm.cmd` 被当作原生 executable 直接交给 CreateProcess；改为 paired `node.exe + npm-cli.js`，补 launcher 回归与启动失败诊断日志。
- [x] 为 KickSide NSIS 增加旧 `kimi sidekick` / `Kimi Sidekick` / `kimi小助手` / `Kimi Desktop Shell` 的 NSIS/MSI 精确检测、交互提示与保留数据迁移 hook；显式固定改名前 MSI UpgradeCode，静态安全 gate 与隔离 NSIS 编译通过。
- [ ] 生成包含上述两项修复的 Windows NSIS/MSI 测试包，由用户重跑私有 pin 安装与旧品牌迁移。
- [ ] Windows WebView2/私有安装/进程树真机 G3。
- [ ] 以 0.2.0 RC 补 Windows 长稳/故障注入，以及 macOS 真实 KimiCode/DSH pane 长时交互人工复核；macOS 后端探针不再要求 2h，updater 真版本差退出已完成。
- [ ] headless A-8/A-10、系统凭据库和双平台 descendant-kill gate；未完成前保持 No-Go。

## Review

- P0 采用专属薄 manager，符合“抽象由重复证明”；Kimi runtime 没有被强行迁移。
- DSH URL/PID/状态只存在 Rust 活状态，Grid 只持久化稳定的 pane kind/workDir；generic external 安全边界未扩大。
- degraded 仍绑定当前 owned Child/port/URL，因此保留同一 iframe；stopped/crashed/starting 仍 fail closed，不获得运行 URL。控制中心独立轮询已与 Grid 的 1s 投影对齐。
- headless 不是现有 Kimi RuntimeAdapter 的第四实现；三条 connector 也不共享完整取消/心跳/轮询语义，因此计划改为 one-shot router、飞书先行、逐通道验收。
- 自动化可证明契约、回归和 Unix 整树终止；macOS 当前 pin 的后端共存已按接受的 ≥70min 门槛通过，隔离 updater 真版本差也已验证；双平台发布级完成仍依赖 Windows G3 与 release candidate 的真实 pane 人工复核，不以 CI 代替真机。
- Node 18.20.8 已真实证明因缺少 `util.parseEnv` 不兼容；Node 20.20.2、22.23.2 与本机 24.19.0 均已通过真实 pin 安装/readiness/软停。S-10 的 M4 Pro 数据用于建立 macOS 基线，不据此缩短尚未取得 Windows 数据的 60 秒生产默认启动超时；runtime smoke 的 90 秒只用于 CI 容错。
- Windows 首轮错误发生在 npm 子进程 spawn 前，所以不能按网络/代理问题处理；修复后只有 npm 真正返回非零或超时才进入 E-DSH-002 registry/网络分支。旧产品迁移使用正式卸载器，绝不递归删除旧安装目录或共享 `com.kimi.shell` 应用数据。
- 关闭实验开关的安全语义是“不启动进程、不自动建 pane、不提供运行 URL”；控制中心检测/安装入口仍可发现，标题栏 DSH 新建/浏览器入口则仅在启用后出现。
- DSH 安装、开关和停止共享同一动作互斥边界，但使用明确的 `安装中` / `停止中` 文案；这避免快速双击重复停止，也避免无关的安装按钮被错误标成正在停止。
- 最新 Mac 测试基线为 `KickSide_0.2.0_macos_arm64_dsh-p0-updater-exit.zip`（SHA-256 `ef8fd3a27f9b345260f88b272adb8cc5dd9205ea578b26bad2670f49955befb0`）；旧包不再用于回填新交互结果。

# 工作区 Skill 连续列表与目标选择稳定化

## 任务契约

- 用户目标：将“已有 Skill / 从受管 Skill 投影”改成技能库相同的连续行列表；修复工作区目标切换闪烁和条目不全。
- 直接交付物：连续列表视觉、无竞态目标选择、完整注册工作区目标源、回归测试和新 macOS `.app`。
- 影响范围：Skill Center workspace detail、Skill controller、workspace target Rust 聚合与测试。
- 非目标：不改变 Workspace/Skill 持久化格式、导入语义、容器路径或 Tauri command 名称与返回结构。
- 验收：两组列表不再逐项圆角卡片；快速选择不被迟到请求覆盖；WorkspaceHub 已注册工作区全部出现在目标源；双端 gate 和 App 构建通过。

## Checklist

- [x] 审计 workspace detail 结构、选择调用链和 Rust 目标数据源。
- [x] 将两组列表改为单边框容器内的连续分隔行。
- [x] 合并 Skill 扫描索引与 WorkspaceHub 完整注册表并按路径去重。
- [x] 将目标选择改为 inventory 就绪后原子提交，并拒绝迟到请求。
- [x] 删除进入页面与选择目标时的重复刷新触发。
- [x] 增加 React 竞态、列表结构、CSS 契约和 Rust 合并回归测试。
- [x] 完成前端/Rust 全量 gate 与 macOS `.app` 构建。
- [ ] 用户在真实 App 中确认全部工作区、快速切换和两组列表视觉。

## Review

- 闪烁由三条并发路径共同造成：section handler 主动刷新、可见性 effect 再次刷新、selected id effect 又重新拉取全部目标；旧 inventory 晚返回时会覆盖新目标。
- 当前选择流程先获取目标 inventory，再在同一提交中更新 selected target、inventory 和 container；请求序号保证快速 A→B 时迟到的 A 结果无法回写。
- 旧版 WorkspaceHub 已注册记录可能未进入后来新增的 Skill workspace index；后端现在运行时合并两者，无需破坏性迁移旧数据。
- 列表视觉遵循 DESIGN 的连续桌面列表：分组本身无卡片背景，每组只有一个边框容器，内部条目用细分隔线。

# Skill Center 列表与筛选裁切根因修复

## 任务契约

- 用户目标：修复 Skill 中心仍看不到技能列表、筛选浮层仍被裁切的问题。
- 直接交付物：真实布局根因修复、可计算布局复现、回归测试和新 macOS `.app`。
- 影响范围：Skill Center 内层 surface 类名、外层页面 CSS 作用域与相关测试。
- 非目标：不改变 Skill 数据、扫描、筛选排序逻辑或 Tauri command。
- 验收：35 条数据对应的列表获得非零可滚动高度；筛选浮层完整显示在列表上方；全量 gate 与 macOS 构建通过。

## Checklist

- [x] 用与生产一致的 DOM/CSS 层级复现 2px 列表和浮层裁切。
- [x] 读取每层 `clientHeight`、`scrollHeight`、Grid track 与命中层级。
- [x] 消除外层页面和内层面板复用 `skill-center-page` 的类名冲突。
- [x] 将两行页面 Grid 规则收紧到外层 `cc-image-detail-page`。
- [x] 增加组件类名隔离与 CSS 作用域回归测试。
- [x] 完成 TypeScript、全量测试、安全 gate、前端构建和 macOS `.app` 构建。
- [ ] 用户在新构建 App 中确认列表、滚动与筛选浮层视觉。

## Review

- 上一轮把症状归因于 keep-alive 百分比高度链，但可运行布局复现显示直接根因是类名碰撞：`SkillCenterPanel` 的 `surface="page"` 生成了 `skill-center-page`，与外层页面壳同名。
- 外层的 `auto + minmax(0, 1fr)` 两行 Grid 因此误套到只有一个子节点的内层面板；内容进入 `auto` 行，空的第二行占走剩余空间，目录列表最终只有约 2px 边框，绝对定位的筛选浮层也被同一错误行裁切。
- 修复后同一复现页中列表从约 2px 恢复到约 505px，`scrollHeight=2788`、`clientHeight=504`；浮层约 129px 高且命中层级位于列表之上。
- 本次没有增加固定高度、resize 重试或延时刷新，修复的是错误样式作用域本身。

# Skill 中心首次进入列表塌缩修复

## 任务契约

- 用户目标：首次进入 Skill 中心就正常显示技能列表，不再依赖点击技能库等子菜单触发恢复。
- 直接交付物：根因修复、初始加载回归测试和原因说明。
- 影响范围：Skill Center 高度布局与组件测试。
- 非目标：不改变 Skill 数据、筛选排序、工作区目标或后端接口。
- 验收：初始数据加载完成后不切换 section 即显示技能条目；长列表保持独立滚动；前端 gate 通过。

## Checklist

- [x] 确认截图中的 35 条数据已加载，排除扫描与筛选状态问题。
- [x] 定位遗留两行 Grid、百分比高度链与零 flex-basis 的首次布局循环。
- [x] 将 Skill 根容器和唯一内容行改为确定的单行 Grid。
- [x] 增加初始加载完成后无需切换 section 的组件回归测试。
- [x] 完成 TypeScript、全量前端测试、安全 gate、生产构建、macOS `.app` 构建与 diff 检查。
- [ ] 在真实 macOS WKWebView 中冷进入 Skill 中心，确认首帧列表高度与滚动。

## Review

- 根因不是 Skill 数据缺失：左侧计数与主体卡片共用 `manageEntries`，截图中的 35 已证明数据存在。
- 当前组件仅有一个直接内容节点，但旧 CSS 仍按两行布局；紧凑列表启用 `flex: 1 1 0` 后，首次布局无法从 auto 行和百分比高度链取得确定主轴，列表被压成细条，子菜单切换触发重新布局后恢复。
- 根修是删除过时的空 Grid 行并显式定义唯一内容行，保留独立滚动；没有加入延时、resize 监听或强制刷新补丁。
- 已验证：Skill 定向测试 6 项；43 个测试文件 / 216 项测试；TypeScript；安全 gate；Vite production build；macOS arm64 `.app` 构建及 Info.plist/主程序/Bridge 架构校验；`git diff --check`。真实 WKWebView 首帧仍需手工确认。

# Skill 搜索焦点与筛选浮层关闭

## 任务契约

- 用户目标：搜索框聚焦效果更克制；筛选与排序浮层可以自然关闭。
- 直接交付物：局部焦点样式、点击外部关闭、Escape 关闭及回归测试。
- 影响范围：Skill 目录 UI 和测试。
- 非目标：不改变筛选项、筛选逻辑或排序逻辑。
- 验收：搜索框不再出现厚重阴影；浮层可由外部点击、Escape 和原按钮关闭；键盘焦点可恢复；前端 gate 通过。

## Checklist

- [x] 将 Skill 搜索框改为无阴影轻量焦点描边。
- [x] 支持点击浮层外部关闭。
- [x] 支持 Escape 关闭并把焦点归还触发按钮。
- [x] 保留按钮再次点击关闭和浮层内多项连续调整。
- [x] 完成定向与全量前端验证。

## Review

- 搜索框聚焦时移除叠加阴影，只保留低对比度两像素描边，键盘焦点仍清晰可见。
- 筛选浮层支持点击外部与 Escape 关闭；Escape 关闭后焦点返回“筛选与排序”，浮层内部可连续调整多个条件。
- 已验证：TypeScript；43 个测试文件 / 215 项测试；安全 gate；Vite production build；macOS arm64 `.app` 构建及 Info.plist/主程序/Bridge 架构校验；`git diff --check`。

# 技能库滚动与 WorkspaceHub 详情收敛

## 任务契约

- 用户目标：技能库可独立滚动；WorkspaceHub Harness 详情减少 AI slop，返回入口放到符合桌面习惯的位置。
- 直接交付物：滚动约束修复、详情层级扁平化、标题栏返回与操作、回归测试和重建 macOS App。
- 影响范围：控制中心 CSS、WorkspaceHub Harness 详情及测试。
- 非目标：不改变 Harness 数据、创建流程、文件权限或后端接口。
- 验收：Skill 长列表可纵向滚动且无横向滚动条；Harness 仅保留必要层级；返回位于页面标题栏；前端 gate 与 macOS 构建通过。

## Checklist

- [x] 恢复 Skill 目录列表独立纵向滚动并禁止 Rail 横向溢出。
- [x] 将 Harness 返回、标题、预览和创建操作提升到页面标题栏。
- [x] 移除 Harness 外层卡片与变量字段卡片嵌套。
- [x] 补充 WorkspaceHub 结构回归测试。
- [x] 完成全量前端 gate 与 macOS `.app` 重建。

## Review

- 根因是紧凑目录列表的后置样式把已有纵向滚动覆盖为 `overflow: hidden`；现在列表恢复独立纵向滚动，统一 Rail 禁止横向溢出并对长名称省略。
- WorkspaceHub Harness 详情改成页面标题栏返回 + 主操作、无框概览、分隔线分区，移除了外层卡片和字段卡片的重复层级。
- 已验证：TypeScript；43 个测试文件 / 214 项测试；安全 gate；Vite production build；macOS arm64 `.app` 构建；Info.plist、主程序和 Bridge 架构校验。

# 控制中心已确认原型落地

## 任务契约

- 用户目标：按已确认的优化原型改造正式控制中心，而不是继续停留在 HTML 预览。
- 直接交付物：统一 Rail、三组小助手设置、紧凑 Skill / WorkspaceHub 列表、变量优先的 Harness 创建详情与回归测试。
- 影响范围：控制中心 React 组件、Skill / WorkspaceHub / 调度面板、局部样式和组件测试。
- 非目标：不修改 Tauri command、安装升级状态机、Bridge 契约、Workspace / Skill 持久化格式或发布配置。
- 验收：四个一级页面保持可达；Rail 显示当前页面对象上下文；原有操作不丢失；类型检查、全量前端测试、安全 gate 和生产构建通过。

## Checklist

- [x] 将小助手设置收拢为三个任务分区并保留八个动作入口。
- [x] 将 Skill、Harness、已注册工作区和调度工作区接入统一 Rail。
- [x] 将 Skill / WorkspaceHub 对象卡压缩为可扫描列表。
- [x] 将 Harness 变量表单前置，模板文件改为按需展开。
- [x] 将重启后端移入诊断分区，Rail footer 改为运行状态。
- [x] 移除控制中心页面动画、平滑滚动和按钮手型鼠标。
- [x] 补充统一 Rail 与 WorkspaceHub 交互测试。
- [x] 完成 TypeScript、全量 Vitest、安全 gate 与生产构建。

## Review

- 采用 native-feel T3“采用平台，不与平台竞争”：目录继续使用系统 picker，控制中心导航与按钮保持默认箭头鼠标，不增加 Web 式页面过渡。
- 本轮只改变信息架构与视觉密度；安装、升级、诊断、Bridge、Skill 和 Workspace 操作仍走原有 handler。
- 已验证：43 个测试文件 / 214 项测试、TypeScript、安全 gate 和 Vite production build 通过；双平台真机视觉与字体缩放属于发布前 G3。

# WorkspaceHub 目标目录原生选择

## 任务契约

- 用户目标：目标目录不再只能手动输入，改为与默认工作目录一致的“路径输入 + 浏览 + 打开目录”交互。
- 直接交付物：Harness path 变量接入系统目录选择器和 Finder/Explorer 打开动作，并补交互测试。
- 影响范围：WorkspaceHub Harness 变量表单、局部样式和前端测试。
- 非目标：不改变 Harness manifest、目录创建规则、Workspace 注册格式或 Tauri capability。
- 验收：路径仍可手输；浏览返回目录后回填；有路径时可打开目录；空路径时打开按钮禁用；前端 gate 通过。

## Checklist

- [x] 识别 `type: "path"` 的 Harness 变量并保留文本输入。
- [x] 使用 Tauri 原生目录选择器回填目标路径。
- [x] 复用受控 `open_folder` 调用链打开当前目录。
- [x] 增加浏览、回填和打开目录回归测试。
- [x] 完成 TypeScript、全量 Vitest、security gate 与生产构建。

## Review

- 当前目标目录原先确实只有普通输入框；本轮按变量类型增强，后续新增 path 变量会自动获得相同交互。
- 目录选择沿用 native-feel T3，采用操作系统 picker；不新增 WebView 自绘文件浏览器，也不扩大文件系统权限。
- 验证结果：43 个测试文件 / 212 项测试、TypeScript、安全 gate 和 Vite production build 通过。

# 控制中心 API 编辑退场与 Kimi 登录浏览器放行

## 任务契约

- 用户目标：控制中心不再编辑 API 配置，清晰引导到 Kimi Code Web 内置设置；认证模式展示与诊断不回退；启动登录验证可打开系统浏览器。
- 直接交付物：只读认证/API 状态面板、Kimi Code Web 设置引导、iframe 登录外链桥修复、回归测试与文档记录。
- 影响范围：Shell 控制中心、workspace iframe 外链桥、前端测试、Shell/根 README、架构事实和验证门。
- 非目标：不删除已发布配置 commands，不修改 `kimi web --no-open`，不改认证状态计算、Doctor 或系统浏览器 URL 安全校验。
- 验收：无 API/模型/服务编辑控件；认证模式和双路健康诊断可见；默认 Code pane 登录链接携带 nonce 并转交系统浏览器；自动测试与 G0/G1 最小 gate 通过。
- 保守假设：仓库没有稳定的 Kimi Code Web 设置深链，因此按钮返回工作区，由明确文案引导用户打开内置设置，不猜测路由。

## Checklist

- [x] 将 API 编辑面改为只读认证与健康诊断。
- [x] 引导用户到 Kimi Code Web 内置设置。
- [x] 补齐默认 Code iframe 登录外链的 bridge nonce。
- [x] 增加 UI 与外链桥回归测试。
- [x] 完成前端、Rust、安全与文档 gate。
- [ ] 在真实 Windows 环境完成 OAuth 默认浏览器 G3。

## Review

- 根因：直接 iframe 的外链脚本先拦截登录链接，但消息遗漏 `window.name` nonce，父窗口安全校验将其丢弃；`--no-open`、stdout 日志和系统浏览器 opener 均不是问题。
- 兼容边界：配置读写 commands 保留；当前产品 UI 不再调用写入与测试入口，认证快照继续复用配置读取。
- 文档冲突：历史 release note 描述过认证模式与双路健康展示，当前 HEAD 已缺失；本次在只读面板恢复并用测试锁定，不修改历史 release note。
- 已验证：Vitest 38 files / 197 tests、TypeScript、Vite build、安全 command/capability gate、tracked Markdown 路径 gate、`cargo check` 与 `cargo test --no-run` 通过；真实 Windows OAuth 默认浏览器链路仍属于 G3。

# Agent Room 下线与冻结

## 任务契约

- 用户目标：完整下线并冻结 Agent Room，任何旧设置、环境变量或历史 Pane 都不能恢复产品能力。
- 直接交付物：删除产品入口与独立窗口配置；Shell/Bridge 双端 fail closed；旧 Pane 归一；Accepted retirement ADR；README、架构事实和变更记录同步。
- 影响范围：`apps/kimi-shell`、`apps/kimi-im-bridge`、`.ai/architecture`、`.ai/decisions`、`.ai/changes` 与本任务记录。
- 非目标：不 DROP migration 0014–0019，不删除用户 Room 数据，不移除普通 IM 共享的 ExecutionService、lease、approval link、turn origin 或 connector binding。
- 验收：设置/标题栏/独立窗口/空 Pane 无入口；`KIMI_AGENT_ROOM_ENABLED=true` 与 `Options.AgentRoomEnabled=true` 仍 disabled；旧 Pane 被移除并修复布局引用；最小 G0/G1 gate 通过。
- 保守假设：“冻结”表示历史 schema/data 与短期兼容墓碑惰性保留，禁止写入和新增功能；破坏性清库需用户另行授权。

## Checklist

- [x] 建立下线 ADR，并撤销 Grid V3 Draft。
- [x] 移除设置、标题栏、hash 路由、空 Pane 入口、独立窗口 config/capability。
- [x] Shell 与 Bridge 生产启用门恒为 false。
- [x] V2 state/saved layout 加载时剔除 Agent Room Pane。
- [x] 更新长期 README、架构事实和当日变更记录。
- [x] 完成 Shell/Go/Rust 最小验证。

# Agent Room V1（v1.1，已由下线决策终止）

## 任务契约

- 用户目标：按 `.ai/plans/agent-room-2026-07-18/` 的 v1.1 基线完成并验证 Observer MVP、Forward MVP 与完整 V1 DoD。
- 直接交付物：Go/Rust/React 实现、只增 migration、accepted ADR、自动化/手工 Gate 证据、同步后的 PRD/SPEC/PLAN/current-state/changes/release notes。
- 影响范围：`apps/kimi-im-bridge`、`apps/kimi-shell`、`.ai/decisions`、`.ai/architecture/current-state.md`、`.ai/changes` 与 Agent Room 计划文档。
- 非目标：不重做 Kimi Code Web、不复制完整 Session、不做云端多人协作、不突破 6 个可见 Pane、不 commit/push/PR、不重置或清理用户工作树。
- 约束：Session 是唯一执行/对话真相；Observer 先于 Forward；React 无 token；同 Session 单一执行所有者；Abort 未确认不替代；Feature Flag 默认关闭；migration 只增不改。
- 验收：PLAN §25、§26、§27、§31 全部有可追溯证据；G3 环境缺失项必须写明 `blocked` 与解除条件。
- 已知不确定性：Runtime Phase 0 已收敛；真实 active Abort 确认、Session-scope Approval、真实 Connector 凭据、Runtime model、Windows CGO、签名私钥和隔离安装 VM 仍按证据 blocked。
- 保守假设：未验证 Runtime 能力一律关闭并明确降级；不以 Draft 代替事实；§28 优先于 Phase 章节中 Lease/Queue 与 migration 的顺序冲突。
- 架构入口：`.ai/architecture/README.md`、`current-state.md`、`verification-gates.md`；索引已声明其余三个主题文档尚未建立。
- 验证入口：Go test/race、Rust test、Shell test/build/verify、三个 registry/capability/resource 检查、Tauri build、真实 Runtime/Connector/NSIS/MSI 手工矩阵。
- 文档触发：每个 Phase 更新 PLAN/PRD/SPEC/current-state/changes；CreateMode、migration、Admin/Tauri 契约、Grid V2 跨门前先 accepted ADR；README 只在长期职责/契约变化时更新。

## Phase / AR Checklist

- [x] Phase 0：AR-000 基线、AR-001 Runtime Capability Probe、AR-002 Fake Runtime（桌面截图与本机 race/Rust binary 按证据 blocked，不冒充通过）。
- [x] Phase 1：AR-100 WorkDir、AR-101 CreateMode、AR-102 Session 唯一性、AR-103 Sidecar 语义、AR-104 附件（附件 wire 未验证时显式失败）。
  - [x] AR-100：per-connector WorkDir / reset JSON 契约、三 Adapter override/global fallback、4 Connector round-trip 与 legacy fixture。
  - [x] AR-101：Accepted CreateMode ADR；Server `always` / `resume_exact` / `reuse_latest` / compatibility `if_missing` 与 Workspace mismatch 测试。
  - [x] AR-102：用户库重复 Session 只读审计、IM 跨 Connector 禁止共享、Store 事务级 Create/Rebind 防重与并发测试；Agent Room 独立表约束冻结，实体表留待 AR-300。
- [x] Phase 2a：AR-200 ExecutionService。
  - [x] AR-200：共享执行主链、Room target projection、strict exact、PromptID、Approval 内存关联、Duplicate/Rebind 边界与三 Adapter 回归。
- [x] Phase 3a：AR-300～304 migrations/store。
- [x] Phase 2b：AR-201～203 Lease/Queue/Busy（真实 Abort 确认仍 capability-blocked；替代 Run fail closed）。
- [x] Phase 3b：AR-305～306 Admin API/Diagnostics（flag 默认关闭；Observer/Forward 未开放）。
- [x] Phase 4：AR-400～405 Multi Session Observer（Fake 1/6 全矩阵；真实 0.27.0 只读 1/6 transport）。
- [x] Phase 5～7：Rust Pump、Grid V2、Native Pane、Reverse Mirror；Observer MVP Gate 已通过后才开放 Forward。
- [x] Phase 8～10：Forward Dispatch、Approval/Recovery、Workflow/Connector（真实 Connector matrix 单独 blocked）。
- [x] Release：cancelled/superseded by `.ai/decisions/2026-07-23-agent-room-decommission.md`；不再执行 Agent Room 发布 Gate。

## Phase 0 基线

- [x] 起始 commit：`1cc7dbaca9405d055bd237e2b6f6db83b1cc86cf`；分支 `main`，未切换或重置。
- [x] `go test ./...`：通过。
- [x] `pnpm -C apps/kimi-shell test`：18 files / 134 tests 通过。
- [x] `pnpm -C apps/kimi-shell build`：通过。
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`：Windows manifest 修复后 235 tests 通过。
- [ ] `go test -race ./...`：blocked，当前 `CGO_ENABLED=0`；需 CGO+GCC 或 Linux CI。
- [x] 1/2/6 Pane：Fake Runtime 全矩阵、真实 Runtime 1/6 transport 与独立 Tauri Native Pane/Sidecar 恢复 Gate 通过。

## Final Review

- 已实现：Observer/Forward/Workflow/Connector 本地 V1；Feature Flag 继续默认关闭，未 commit/push/release。
- 已验证：Go 全量/vet、Rust 235 tests、前端 175 tests、正式 release binary、NSIS/MSI、bundled sidecar smoke、Grid/DB migration 与安全 Gate。
- blocked：Go race 需 CGO；真实 Forward 需 Runtime model；真实 Feishu/Weixin 需隔离凭据；updater/安装升级 G3 需签名私钥与隔离 Windows VM。
- 已发布：否。

# Explorer 右键打开独立 Session 与 Pane Shelf

## Checklist
- [x] 校验补丁包 manifest、SHA256、overlay 与参考测试
- [x] 对照当前 HEAD 复核 Explorer 注册表、单实例、session 与 Grid 调用链
- [x] 持久化菜单启用意图并清理重叠注册表入口
- [x] 使用有界单消费者队列创建独立 session，不重启运行中的后端
- [x] 新增 `new_pane` 路由、sessionId 精确 workDir 更新与事件去重
- [x] Pane 目录按 iframe 当前 sessionId 精确解析，移除全部缓存 workDir 回退
- [x] 支持六个可见、十二个总 pane 与 Pane Shelf
- [x] 修复 worker 世代归属竞态，并让异步打开失败拉起主窗口
- [x] 运行 Rust G0/G1 编译门、前端测试与生产构建

## Review
- 包内 `0001`–`0004` 是人工参考且包含并发失序、静默回退和重复 reducer 问题，未机械应用；实现复用现有 `/api/v1` client、RuntimeState queue 与 Zustand Grid store。
- Pane header 通过 iframe route handshake 获取当前 session，并用 `grid_get_session` 精确查询；打开前再次确认 session 未切换。
- `cargo check`、`cargo test --no-run`、前端 116 项测试和 `pnpm build` 通过；Rust 测试执行仍被本机既有 `STATUS_ENTRYPOINT_NOT_FOUND` 阻塞。
- Windows Explorer 真机矩阵属于 G3，发布前补跑；包含后端处于 `Stopping` 时右键打开、停止完成后请求可继续执行的窄窗口场景。

# Windows browser open bugfix

## Checklist
- [x] 确认 Windows URL 打开错误地复用了 `explorer`
- [x] 文件夹打开继续用资源管理器
- [x] URL 打开改用系统默认浏览器关联
- [x] 运行 Rust check 与 diff gate

## Review
- `open_external_url` 现在在 Windows 下走 `rundll32 url.dll,FileProtocolHandler <url>`。
- 只修共享后端函数，覆盖挂起窗格“在浏览器打开”和其他外链入口。

# Workspace Grid pane external link opening

## Checklist
- [x] 确认现有 Chat/旧 proxy 有 link bridge，但 DirectServer Code pane 不走旧 proxy 注入
- [x] 将 Tauri main window all-frames 初始化脚本从 chat-only 泛化到所有子 iframe
- [x] iframe 内跨站 `http/https` 链接和 `window.open` 通过 bridge 交给父窗口
- [x] 父窗口只接受 workspace origin 或当前 DOM 中 `.workspace-iframe` 的消息
- [x] 复用现有 `open_external_url`，不新增打开浏览器实现
- [x] 增加最小 jsdom 测试覆盖已知 iframe source 校验
- [x] 运行前端、Rust 与 diff gate

## Review
- 当前窗格内链接按“跨站链接外部打开、同源链接留在窗格内”处理。
- 这覆盖 Code / Chat / external iframe；native child Webview 内的页面仍由 Webview 自身承载，不在本轮加 hook。

# Workspace Grid pane interaction fixes

## Checklist
- [x] Code 空窗格和 header 切换 Code 不再自动创建 server session
- [x] 无 `sessionId` 的 Code pane 打开 Kimi Code Web 根页面，历史 session pane 继续支持 `/sessions/{id}`
- [x] Code pane 持久化当前 `workDir`，header 增加“打开此窗格目录”
- [x] pane header 增加每窗独立明暗主题切换，全局主题仍影响未单独设置主题的 pane
- [x] `addPane(input, targetSlotId)` 支持直接添加到指定空 slot，修复第四格按钮灰掉/不可用的根因
- [x] 支持拖动 pane header 到另一个 slot 交换或移动窗格
- [x] 更新 store/component 单测与 current-state 事实
- [x] 运行前端 test/tsc/build 与 diff gate

## Review
- 新建/切换 Code pane 现在只打开 Kimi Code Web 根页面，不再调用 `grid_create_session`；旧布局中已经有 `sessionId` 的 pane 仍按历史 session URL 渲染。
- per-pane 主题通过 iframe `postMessage` 即时同步；同源 Kimi Code Web 仍可能在页面重载后受共享 localStorage 影响，完全隔离需要后续 native Webview 或 Web 侧 storage carrier。
- 第四格问题由 store 层指定 slot 添加修复，不依赖添加后再 move。
- 拖拽交换只改变 slot 的 `paneId`，不改变当前 preset、track size 或 pane 内容。

# Workspace Grid toolbar and resize-shadow cleanup

## Checklist
- [x] 移除 Grid 内自定义布局工具栏
- [x] 不再渲染“保存布局 / 选择布局 / 已保存自定义布局尺寸”
- [x] Grid 根布局不再预留工具栏高度
- [x] resize handle 保留拖拽命中区但不再显示 hover/focus 阴影条
- [x] active pane 不再额外绘制布局阴影
- [x] 更新组件测试和 current-state 事实
- [x] 运行前端 test/tsc/build 与 diff gate

## Review
- 本轮只删可见 UI 和阴影视觉，不改 Grid store、preset 或 session 创建逻辑。
- 底层 saved layout helper 仍留给旧状态兼容；没有用户可见入口。

# Workspace Grid session API path payload fix

## Checklist
- [x] 确认仍失败的 root cause 是 API payload 边界可能继续携带 Windows verbatim/url-ish 前缀
- [x] 新增 `api_workspace_root`，把 `/?/D:/...` / `\\?\D:\...` 转成 `D:/...`
- [x] `POST /api/v1/workspaces` 的 `root` 使用同一 helper
- [x] `POST /api/v1/sessions` fallback 的 `metadata.cwd` 使用同一 helper
- [x] 补 Rust 单测覆盖坏输入和普通 `D:/repo`
- [x] 运行 Rust、前端与 diff gate

## Review
- 本轮只修后端 API payload 字符串，不改前端和 Grid UI。
- 外层路径归一化保留，但不再作为唯一防线。
- 验证结果：Rust fmt/check/test no-run、前端 test/tsc、`git diff --check` 均通过。

# Workspace Grid layout entry and path cleanup

## Checklist
- [x] 读取目标 objective，继续采用 `zustand` Grid slice 与 v1 fallback 决策
- [x] 修复 `/?/D:/...` workspace root 归一化为 `D:/...`
- [x] 三窗 preset 改为左侧一格、右侧上下两格
- [x] Grid 内 preset 数字按钮移到标题栏布局 popover
- [x] 移除空 pane 的 Kimi.com 添加入口
- [x] 移除 pane header 的 Kimi.com 切换入口
- [x] Grid resize/active 视觉改为中性色，不再显示黄色长线
- [x] 补前端与 Rust 单测覆盖本轮行为
- [x] 运行完整前端、Rust 与 diff gate

## Review
- 本轮只调整 Workspace Grid 的入口与修复坏路径，不拆旧 `WorkspaceView` 兼容层。
- 标题栏 popover 使用现有 6 个 preset，3 列展示；不新增真实 9 窗布局。
- external pane carrier 代码仍保留，用于已保存布局、fallback 和后续兼容，但 UI 不再提供 Kimi.com 新建/切换按钮。
- 验证结果：前端 test、tsc、build 通过；Rust fmt/check/test no-run 通过；`git diff --check` 通过。直接执行 Rust test binary 仍受本机既有 `STATUS_ENTRYPOINT_NOT_FOUND` 限制。

# Workspace Grid hardening review fixes

## Checklist
- [x] 确认目标文件中的两个决策：Grid 状态切片采用 `zustand`，v1 承载 DoD 以可见 fallback + 外部打开为基线
- [x] `buildCodePaneUrl` 保留运行时 `#token=` hash，避免纯 session 布局恢复后丢 bootstrap
- [x] 新增 pane 默认 `mountPolicy: "eager"`，让新加窗格立即可见
- [x] 现有窗格切换到 Code 时调用 `grid_create_session` 创建真实 server session
- [x] 嵌入式 Tauri 子 Webview 激活后卸载对应 iframe，避免双 carrier 资源和焦点冲突
- [x] 持久化 Grid state 加载/恢复时归一化未知 preset、幽灵 slot、重复/超限 pane 和失效 active/maximized pane
- [x] 补单测和组件测试覆盖上述行为
- [x] 运行前端、Rust、Go 与 diff gate

## Review
- 本轮处理 Workspace Grid 审查中剩余的 P1/P2 收口项，保持现有 Pane/Slot + zustand 架构，不引入新的 picker UI 或大范围重构。
- Code session URL 的 `#token=` 只来自运行时 `codeRemoteUrl`，不会写入 Grid persisted state、saved layout 或 changelog。
- 切换已有 pane 为 Code 现在与空 slot 新增 Code 一样先建真实 server session，不再产生无 session 的 Code pane。
- 嵌入式 Webview 成功接管外部页面后，React iframe 不再留在同一 pane DOM 内。
- 坏 localStorage 会被收敛回可渲染状态；未知 preset fallback 到 `1x2`，pane 上限仍是 6。
- 验证结果：`pnpm --dir apps/kimi-shell test`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --check`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run`、`go test ./...`（`apps/kimi-im-bridge`）通过。

# Workspace Grid native Webview storage namespace

## Checklist
- [x] 每个 Grid pane 持有稳定 `storageNamespace`
- [x] 旧持久化 panes 缺少 namespace 时按 pane id 补齐
- [x] 嵌入式子 Webview 使用 pane namespace 作为 Tauri `dataDirectory`
- [x] 独立 WebviewWindow fallback 使用同一个 pane namespace
- [x] 单测覆盖 legacy pane namespace 补齐，组件测试覆盖 native carrier 调用参数

## Review
- 本轮推进 WG-8 的 native Webview per-pane localStorage namespace：Tauri `Webview` / `WebviewWindow` carrier 通过 `dataDirectory` 隔离本地存储。
- 当前仓库没有 `apps/kimi-web`，DirectServer code pane 仍是同源 iframe carrier；iframe 级 localStorage 隔离不能只靠 shell state 补丁完成。

# Workspace Grid embedded external Webview

## Checklist
- [x] 增加 Tauri v2 子 `Webview` service，复用现有 `urlSafety`
- [x] 外部页 blocked fallback 增加“在窗格内打开”
- [x] 子 Webview 根据 pane bounds 创建，并在 resize/scroll/source change/unmount 时同步或销毁
- [x] 给 main capability 增加 create/focus/position/size/close 子 Webview 权限
- [x] 组件测试覆盖 iframe 超时后调用嵌入式子 Webview

## Review
- 本轮推进 WG-7 的窗格内承载方案：被 iframe 阻止的外部页可选择嵌入式 Tauri 子 Webview，独立 WebviewWindow 仍作为退路。
- 后续已补齐 native Webview per-pane `dataDirectory` namespace；真实 Tauri 桌面中 z-order/focus/DPI 行为还需要人工点击验证。

# Workspace Grid external WebviewWindow fallback

## Checklist
- [x] 增加外部 URL WebviewWindow service，复用现有 `urlSafety`
- [x] 外部页挂起/blocked fallback 增加“在应用窗口打开”
- [x] 给 main capability 增加 `core:webview:allow-create-webview-window`
- [x] 组件测试覆盖 iframe 超时后调用 WebviewWindow fallback

## Review
- 本轮推进 WG-7 的退路方案：被 iframe 阻止的外部页可在独立应用 WebviewWindow 承载。
- 嵌入式子 Webview 与 native Webview per-pane `dataDirectory` namespace 已在后续切片补齐。

# Workspace Grid resizable custom tracks

## Checklist
- [x] 增加 `trackSizes` 持久化字段，保存自定义列/行比例
- [x] Grid canvas 增加列/行 seam 拖拽 handle
- [x] preset 切换时清除不匹配的 custom tracks
- [x] 命名布局保存/恢复自动携带 sanitized track sizes
- [x] 单测覆盖 track resize clamp、持久化与 preset 清理
- [x] 组件测试覆盖拖拽 handle 后写入 store

## Review
- 本轮推进 WG-8 的“逐缝拖拽 resize + 持久化 custom template”；custom template 先实现为当前 preset 的列/行 `fr` track sizes。
- 后续已补齐 WG-7 子 Webview 与 native Webview per-pane `dataDirectory` namespace。

# Workspace Grid named layouts

## Checklist
- [x] 复用现有 sanitized grid state 快照保存命名布局
- [x] 工具栏支持保存当前布局并从下拉框恢复
- [x] 恢复布局时清除 transient 最大化状态
- [x] 单测覆盖 URL fragment 不入保存布局、恢复布局
- [x] 组件测试覆盖保存后切换预设再恢复

## Review
- 本轮推进 WG-8 的“命名布局保存/恢复”；未引入 modal 或新状态库，先用原生 `prompt`/`select`。
- 后续已补齐 WG-7 子 Webview、native Webview per-pane `dataDirectory` namespace 和逐缝拖拽 resize。

# Workspace Grid v1 hardening

## Checklist
- [x] 支持方向键切换 active pane
- [x] 外部网页 pane 支持输入自定义 `http/https` URL，并继续剥离 fragment
- [x] mount policy 具备可见挂起/恢复行为，非活跃 on-focus pane 可延迟挂载
- [x] 顶栏状态展示运行中 Code Session 数量
- [x] 增加 jsdom + React Testing Library 组件级测试，覆盖键盘切换、自定义外部 URL、挂起/恢复
- [x] 运行前端、Rust、Go 与 diff gate

## Review
- 本轮补齐 WG-4/WG-5/WG-6 中上一轮仍偏弱的交互证据：键盘切换、custom external URL、mount policy 行为和状态区运行数量。
- `jsdom` 固定为 `24.1.3`，避免把本仓库 README 里的 Node 18+ 要求悄悄抬到 Node 20+。
- 真实已安装应用当前是旧包且窗口为 13x13，不能作为新源码视觉证据；本轮用组件级 jsdom 测试补强 UI 行为证据。

# Workspace Grid renderer and session commands

## Checklist
- [x] 替换 `WorkspaceView` 内部写死双窗渲染，改为 `WorkspaceGridView` + `PaneFrame`
- [x] 接入 1/2/3/4/5/6 预设、空 slot、窗格关闭、最大化和内容切换
- [x] 外部页使用 timeout fallback + 浏览器打开，不依赖 iframe `onError`
- [x] 将旧 titlebar 的单窗/双窗/换位按钮同步到 Grid store
- [x] 新增 `grid_list_sessions` / `grid_create_session` Tauri command 与前端 service
- [x] 空 Code slot 在存在工作目录时通过 server 创建真实 session，并用 `/sessions/{id}` URL 渲染
- [x] 运行 Vitest、TypeScript、Vite build、Rust fmt/check 与 diff check

## Review
- `WorkspaceView` 现在只作为兼容入口，实际渲染由 `features/workspace-grid/WorkspaceGridView.tsx` 与 `PaneFrame.tsx` 承担。
- Grid v1 已覆盖 WG-2，并推进 WG-3/WG-4/WG-5/WG-6 的最小闭环；Tauri 子 Webview 和 v2 per-pane 隔离仍留在 WG-7/WG-8。
- 验证结果：`pnpm --dir apps/kimi-shell test`、`.\node_modules\.bin\tsc.cmd --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo fmt -- --check`、`cargo check`、`git diff --check` 通过。
- 补充验证：使用临时 `KIMI_CODE_HOME` 启动本机 `kimi server run --foreground`，通过 `/api/v1/workspaces` 和 3 次 `/api/v1/sessions` 创建验证，返回 3 个 distinct server session id。

# Workspace Grid v1 foundation

## Checklist
- [x] 读取目标文件，确认 Workspace Grid 先落 WG-0/WG-1 基础切片
- [x] 建立 README First、架构和设计系统上下文
- [x] 确认 DR-A：Workspace Grid v1 采用 `zustand` 作为独立状态切片试点
- [x] 确认 DR-B：v1 外部页承载只承诺可见 fallback + 外部打开，不要求自动子 Webview
- [x] 新增 Vitest 基线、`pnpm test`、workspace-grid 状态/迁移/URL 纯逻辑和单测
- [x] 运行 `pnpm test`、`tsc --noEmit` 与 `git diff --check`

## Review
- 本轮只完成 WG-0/WG-1 的最小可验证基础：`workspace-grid` 新目录包含 Pane/Slot 分离类型、预设、旧双窗 localStorage 迁移、zustand store、selector、`paneUrl` 与 `urlSafety`。
- 已新增 accepted ADR：`.ai/decisions/2026-06-28-workspace-grid-v1.md`。
- 现有 `WorkspaceView` 和 `useShellController` 未接入新 store，双窗 UI 行为保持不变；WG-2 才替换渲染器。
- 验证结果：`pnpm --dir apps/kimi-shell test` 通过；`.\node_modules\.bin\tsc.cmd --noEmit`（`apps/kimi-shell`）通过；`git diff --check` 通过，仅有既有 CRLF 提示。

# kimi-code v3 迁移与 IM Bridge 安全门禁

## Checklist
- [x] 读取粘贴的 v3 整合目标，收敛当前线程目标
- [x] 建立 README First 上下文并记录 `.ai/CONSTITUTION.md` / `.ai/architecture` 缺失风险
- [x] 盘点 Shell backend、workspace session 与 Bridge 启动 token 触点
- [x] 修复 Bridge admin / host-control token 命令行暴露：Shell 改 env，sidecar 支持 env/token-file
- [x] 切换 Shell 后端主路径到 `kimi server run --foreground --port <port>`
- [x] 新增 server token resolver，生成 `/#token=` workspace URL
- [x] 暂停 P1A 默认 workspace proxy 与旧 `/api/sessions` bootstrap
- [x] 补 `.ai/architecture` 当前事实和验证入口
- [x] 新增 Rust `api_v1_client` 薄客户端，统一 Bearer 与 envelope 解包
- [x] 写出 Shell `kimi_runtime_locator.json`，并传给 Bridge sidecar
- [x] Bridge status 暴露 runtime locator 配置/可读/health 状态
- [x] 用 `/api/v1` 替换 Shell workspace/session 调用，并恢复 DirectServer ready 后 session bootstrap
- [x] 新增 Bridge `RuntimeAdapter` 契约与 `KimiCodeServerAdapter` REST 地基，并在 status 暴露 runtime adapter 状态
- [x] Bridge admin `/api/v1/*` 改为 `{ ok, data, error, requestId }` envelope，Shell client 兼容新旧响应
- [x] Bridge stdout/stderr、bridge log tail 与 Go logger 纳入已知 secret redaction
- [x] 运行最小验证并记录结果
- [x] 把 Bridge channel prompt 主路径切到 `KimiCodeServerAdapter`
- [x] 接入 `/api/v1/ws` prompt 事件流的最小内容/状态/approval 映射
- [x] 完成 server pending approval reconcile 与本地持久 projection
- [x] 实现 ACPAdapter 实验性 stdio/JSON-RPC smoke
- [x] 实现 SDKAdapter wrapper
- [x] 通过 Bridge metadata 映射 server prompt controls：model、thinking、permission、plan、swarm、goal
- [x] P3 安装主链路移除 uv/Python：Kimi 安装改官方 install.ps1，升级改 `kimi upgrade`，core ready 不再依赖 uv/Python
- [x] P3 Git Bash 检测与 `KIMI_SHELL_PATH` 配置：Shell 启动 server 时自动注入检测到的 Git Bash 路径
- [x] P3 Bridge sidecar installed-build smoke：重建 bundled `kimi-im-bridge.exe`，token-file 启动、health/status envelope、runtime stop 和输出 redaction 通过
- [x] P4A `kimi doctor`：控制中心运行诊断面板可直接执行 `kimi doctor`，展示 exit code、路径与脱敏输出
- [x] 后续：把 server-only recovered approvals 重新投递成 Telegram/Feishu IM approval card
- [x] 后续：把 ACPAdapter manual approval 从 live auto/cancel 升级为当前进程内异步 resolve
- [x] 收口本地开发门禁与剩余 P5 真凭证手工门禁边界

## Review
- 已先落 v3 明确标为高风险的 Bridge secret transport 门禁，并开始 P1A DirectServer 主路径迁移。
- DirectServer 主路径已推进：Rust lifecycle 现在启动 `kimi server run --foreground --port <port>`，读取 `KIMI_CODE_HOME/server.token`，并把 `/#token=` URL 交给前端。
- P1B 地基已推进：新增 `api_v1_client`，Shell workspace/session 调用已改到 `/api/v1`，Shell 写出不含明文 token 的 runtime locator，Bridge 接收 locator 并在 status 中报告可读性。
- P4C 主路径已推进：Bridge 新增 `RuntimeAdapter` 契约和 `KimiCodeServerAdapter` REST/WS 客户端；Telegram/Feishu/Weixin 通过 bridgecore orchestrator 优先走 server-backed runtime provider，创建新 binding 时使用 server 返回的真实 session id，旧 synthetic binding 会在 server run 后 rebind。
- `/api/v1/ws` 已接入 prompt 事件流的最小映射，覆盖 assistant/thinking delta、status、turn/prompt completion 和 approval requested/resolved。
- Server pending approval reconcile 已接入：Bridge 启动时按本地 pending 与已知 server session/binding 查询 server pending，保留仍 pending 的审批、将 server 确认不存在的本地 pending 标为 `stale_failed`，并为同一 session 下 server-only pending 重建带 chat context 的本地 projection。
- `internal/runtime` 已补 `SDKAdapter` wrapper 与实验性 `ACPAdapter`。ACPAdapter 具备 stdio JSON-RPC transport、initialize/session/new/session/resume/session/prompt/session/cancel 的 smoke 覆盖；manual approval 已在当前进程内支持 live async resolve，但尚无跨 Bridge 重启恢复。
- Server provider 已从 `MetadataJSON` 读取 `runtime_controls` / `controls`，映射 model、thinking、permission mode、plan、swarm 和 goal controls；未新增配置 UI。
- P3 安装链路已推进：Shell quick/core Kimi 安装不再串联 uv/Python，改用 Kimi Code 官方 Windows installer；升级改走 `kimi upgrade`；卸载清理托管 Kimi CLI binary/npm package；旧 `backend_manager/install_compat.rs` uv/Python 安装路径已删除；安装文档同步移除 uv/Python 主路径。
- P3 Git Bash 已接入：Shell 会检测现有 `KIMI_SHELL_PATH`、Git for Windows `bash.exe` 常见路径或 PATH `bash`，启动 `kimi server run` 时写入 `KIMI_SHELL_PATH`，安装面板展示 Git Bash 状态和检测路径。
- P3 Bridge sidecar installed-build smoke 已补：`apps/kimi-shell/src-tauri/binaries/kimi-im-bridge.exe` 已由当前 Go 源码重建，使用 token files 启动后 `/healthz`、`/api/v1/status` envelope、`/api/v1/runtime/stop` 和 stdout/stderr/log token redaction 检查通过。
- P4A `kimi doctor` 已接入：控制中心运行诊断面板新增手动运行入口，Shell 后端调用本机 `kimi doctor` 并对已知 API key / token / secret 做精确值脱敏后返回 UI。
- Recovered approval redelivery 已接入：Telegram/Feishu adapter 启动后会扫描 pending approvals，用既有 delivery key 幂等重投递 approval card；Feishu 仅在 binding 有 last inbound message id 时重投递以保持线程/回复上下文。
- ACPAdapter manual approval 已从 auto/cancel smoke 升级为 live async：`session/request_permission` 会在 manual mode 下登记 pending approval、发出 approval event，并等待 `ResolveApproval` 返回 ACP selected/cancelled outcome；跨 Bridge 重启恢复仍未实现。
- Admin API 已收紧：sidecar `/api/v1/*` 返回稳定 envelope，Rust `BridgeHttpClient` 已支持 envelope unwrap，并保留旧裸 JSON 兼容。
- Bridge 日志安全门禁已推进：Go logger 会 redaction admin/host-control 与平台密钥；Shell 托管的 sidecar stdout/stderr 通过 redactor 写入 bridge log，UI log tail 与失败摘要也会二次 redaction。
- 本地代码门禁已收口到 P4C：Shell 自有 UI 不新增独立 prompt composer/全局 approval inbox，主交互继续由官方 Kimi Code Web 承载；Bridge approval 由 IM card 与 Bridge runtime panel 承载。
- P5 未在本地自动完成：真实 Telegram/Feishu/Weixin 凭证、NSIS/MSI 安装包环境、OpenAPI/AsyncAPI CI 快照和发布回退仍是发布前手工/专用环境门禁，不阻塞本轮代码合并。
- 验证结果：`go test ./...`（`apps/kimi-im-bridge`）通过；`cargo check` 通过；`cargo test --no-run` 通过；`.\node_modules\.bin\tsc.cmd --noEmit` 通过；`git diff --check` 通过。
- 已知限制：Rust 测试二进制运行在当前 Windows 环境仍报既有 `STATUS_ENTRYPOINT_NOT_FOUND`，未执行到断言阶段。

# 上游 Web 基线与中文化脚手架

## Checklist
- [x] 复查 `tasks/lessons.md`、现有 `sync:kimi-web` / 合规脚本和第三方记录，锁定最小改动面
- [x] 将 `tasks/todo.md` 超长历史归档，并保留最近上下文
- [x] 更新 `apps/kimi-shell/scripts/sync_kimi_cli_web.ps1`，默认同步 `MoonshotAI/kimi-cli` 的最新 `main` HEAD，并落地 `upstream-web/` 快照与来源记录
- [x] 补齐 `third_party/kimi-cli-web/`、`patches/kimi-web/` 与维护文档，明确上游快照只读、所有本地差异走 patch/overlay
- [x] 扩展 enhanced-web 合规检查，验证 `upstream-web/` 快照存在且来源 commit 与记录一致
- [x] 基于同步下来的 `web/` 代码产出中文化入口盘点，区分适合源码 patch 与适合注入兜底的文本类型
- [x] 运行针对性验证，确认同步、脚手架和检查链路可用，且不改动现有增强模式运行时
- [x] 在本节补充 Review，记录本次同步 commit、中文化入口判断和未覆盖风险

## 保留的最近上下文（原 todo 最新 20 行）

### Validation So Far
- `pnpm --dir apps/kimi-shell check:enhanced-web:i18n` 通过。
- `pnpm --dir apps/kimi-shell check:enhanced-web:compliance` 通过。
- `pnpm --dir apps/kimi-shell exec tsc --noEmit` 通过。
- `pnpm --dir apps/kimi-shell build` 通过。
- `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
- `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --check` 通过。
- `pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths` 通过。
- `git diff --check` 通过，仅输出当前工作区 CRLF 提示。
- 已确认本地存在 `0.0.40` / `0.0.41` 的 NSIS 与 MSI 安装包资产。

### Review
- 发布说明：新增 `apps/kimi-shell/docs/release-notes-0.0.40.md` 与 `apps/kimi-shell/docs/release-notes-0.0.41.md`，分别覆盖本地增强版产品化、增强版同源注入/切换修复、后端模块化和桥接/安装/auth 操作流修正。
- 更新说明：新增 `update/updatenote_202604241713.md`，合并说明 2026-04-24 的 `v0.0.40` / `v0.0.41` 更新。
- GitHub：`main` 已推送到 `origin/main`，提交为 `dbb9c6d release: ship v0.0.41`。
- 标签：`v0.0.40` 与 `v0.0.41` 已推送到 GitHub。
- Releases：已创建 `Kimi Desktop Shell v0.0.40` 与 `Kimi Desktop Shell v0.0.41`；`v0.0.41` 为 GitHub latest。
- 资产：每个 release 均已上传对应 NSIS 与 MSI 安装包。
- 已知限制：本轮未完成安装版 UI 点击回归；Rust 测试二进制在当前 Windows 环境仍受既有 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` 影响，未能执行到断言阶段。

### Review
- 上游基线：已通过 `pnpm --dir apps/kimi-shell sync:kimi-web` 将 `MoonshotAI/kimi-cli` 的 `main` HEAD 同步到 `apps/kimi-shell/third_party/kimi-cli-web/upstream-web/`，本次固定 commit 为 `e32568cf2db0e95ad76878a4e6482986c8ecb180`。
- 同步脚本：`apps/kimi-shell/scripts/sync_kimi_cli_web.ps1` 现在默认解析 `refs/heads/main`，并在同步后回写 `SOURCE.md`、`public/enhanced-kimi-web/manifest.json`、`docs/third-party-notices.md` 与 `docs/kimi-web-maintenance.md`。同时补了 UTF-8 无 BOM 写入，避免 Node 侧解析 `manifest.json` 失败。
- 维护边界：已新增 `apps/kimi-shell/docs/kimi-web-maintenance.md` 与 `apps/kimi-shell/patches/kimi-web/README.md`，明确当前运行时仍是 workspace proxy 同源注入，`upstream-web/` 只作为只读上游快照，所有本地差异必须放在 `patches/kimi-web/` 或显式 overlay。
- 中文化盘点：已新增 `apps/kimi-shell/docs/kimi-web-i18n-inventory.md`。本次确认 `sessions.tsx`、`create-session-dialog.tsx`、`message-search-dialog.tsx`、`chat-workspace-header.tsx`、`approval-dialog.tsx`、`error-boundary.tsx` 等文件中存在大量直接写在 JSX/props 里的英文固定文案，适合下一阶段迁到源码 patch；`question-dialog.tsx` 与 approval payload 中来自后端的 question/description/body 仍需单独处理，不能只靠前端 patch 覆盖。
- 合规检查：`apps/kimi-shell/scripts/check_enhanced_web_compliance.mjs` 现在除了检查许可证和免责声明，还会验证 `docs/kimi-web-maintenance.md`、`patches/kimi-web/README.md`、`third_party/kimi-cli-web/upstream-web/` 的存在性，并要求快照目录非空且包含 `src/`。
- 验证结果：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`git diff --check` 已于 2026-04-24 通过；`git diff --check` 仅剩 CRLF 提示，无内容级错误。
- 运行时边界：本轮没有切换增强模式的运行时来源，当前仍保持官方 workspace proxy + same-origin 注入；因此本次交付是“源码基线与中文化脚手架”，不是“本地源码版 Web 接管”。
- 未覆盖项：本轮没有在真实桌面应用里点击验证增强模式切换后的 UI 行为，也没有尝试构建或运行同步下来的上游 `web/` 前端；第二阶段开始源码 patch 前，仍需先挑选一小组高频文案做最小迁移验证。

## 全注入版第二阶段

### Checklist
- [x] 复查现有增强注入表与第二阶段计划，确认仅扩大固定 UI 文案覆盖，不触碰动态 payload 文本
- [x] 按页面块重组 `workspace_injection.rs` 注入表，补齐 sessions / create session / message search / workspace header / approval / error boundary 固定文案
- [x] 保持 `MutationObserver + text node / placeholder / aria-label / title` 机制不变，不引入复杂 DOM 特判
- [x] 更新 `kimi-web-i18n-inventory.md`，将第二阶段已由注入覆盖的页面块标记出来
- [x] 更新 `kimi-web-maintenance.md`，明确第二阶段仍为全注入策略，且动态 payload 文本不在本轮范围内
- [x] 运行 `check:enhanced-web:i18n`、`check:enhanced-web:compliance`、`tsc --noEmit`、`build`、`cargo check` 与 `git diff --check`
- [x] 在本节补充 Review，记录新增注入覆盖范围、刻意不处理的动态文本和验证结果

### Review
- 注入表：`apps/kimi-shell/src-tauri/src/backend_manager/workspace_injection.rs` 仍保持单一增强注入入口，没有新增第二套脚本；现有 `MutationObserver + text node / placeholder / aria-label / title` 机制保持不变，只是把翻译表按 `sessions_sidebar`、`create_session_dialog`、`message_search`、`workspace_header`、`approval_dialog`、`error_boundary` 六个页面块重组并扩容。
- 新增覆盖：本轮补齐了 sessions 主路径文案（关闭侧栏、刷新会话、新建、清除搜索、列表/分组视图、归档/取消归档、删除会话、删除确认文案）、创建会话弹窗（标题、空态、目录不存在确认、分组标题、创建目录按钮）、消息搜索（标题、占位、无结果、跳转）、工作区头部（打开会话侧栏、显示/隐藏工作区文件、搜索消息、折叠/展开全部区块、双击重命名提示）、审批对话框固定按钮文案，以及 `chat.tsx` toast 标题和 `error-boundary.tsx` 错误页按钮文案。
- 动态边界：本轮刻意没有新增对 `question-dialog.tsx` 中 `currentQuestion.*`、`approval.description`、`approval.sender`、服务端错误正文、模型输出正文或用户消息正文的翻译规则；计划中的 `Allow this ...?` 动态句式也没有做中文拼接，避免把注入扩散到 payload 级文本。
- 变量句子策略：`Delete Session` / `The directory ... does not exist ...` 这类包含变量节点的场景，本轮只翻译固定文本节点和按钮，不引入正则组装或复杂 DOM 结构推断，因此路径和会话名仍保持原样嵌入。
- 文档：`apps/kimi-shell/docs/kimi-web-i18n-inventory.md` 已新增“当前注入覆盖状态（第二阶段）”章节，标出已覆盖和仍不在注入范围内的部分；`apps/kimi-shell/docs/kimi-web-maintenance.md` 已明确第二阶段仍是全注入策略，且一旦开始依赖大量变量句子或复杂结构特判，就应停止扩注入并改回源码 patch。
- 验证结果：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-24 通过；`git diff --check` 仅输出当前工作区 CRLF 提示，无新增文本级错误。
- 未覆盖项：本轮未启动桌面应用做手工点击回归，因此第二阶段注入的最终桌面观感仍需人工验证会话侧栏、创建会话弹窗、消息搜索、approval dialog 和 error boundary 五条路径。

## v0.0.42 发版执行

### Checklist
- [x] 复查当前工作区 diff、版本号与本地安装包产物，确认 `0.0.42` 发版边界
- [x] 撰写 `apps/kimi-shell/docs/release-notes-0.0.42.md`
- [x] 撰写 `update/updatenote_202604250034.md`
- [x] 运行本次发版所需验证命令并记录结果
- [x] 提交当前工作区改动并推送 `main`
- [x] 创建并推送 `v0.0.42` tag
- [x] 创建 GitHub release 并上传 `0.0.42` 的 NSIS / MSI 安装包

### Review
- 发版边界：当前版本号已统一到 `0.0.42`，本次发版内容包含两类改动：一是 `kimi-cli/web` 上游源码基线与维护边界落库，二是本地增强版 same-origin 注入的第二阶段中文固定文案扩展；运行时仍保持官方 workspace proxy + 注入模式。
- 发布文档：已新增 `apps/kimi-shell/docs/release-notes-0.0.42.md`，内容覆盖上游 `web/` 基线、第二阶段全注入扩展、保持运行时边界不变，以及 `0.0.42` 的验证和已知限制；已新增 `update/updatenote_202604250034.md`，概括同一批改动及用户影响。
- 安装包产物：已确认本地存在 `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.42_x64-setup.exe` 与 `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.42_x64_en-US.msi`，可用于 GitHub release 上传。
- 自动化验证：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过。
- diff 检查：`git diff --check` 已于 2026-04-25 执行，未发现内容级错误，仅剩当前工作区 CRLF 提示。
- Git 提交：已创建 `f170ddf release: ship v0.0.42`，并已推送到 `origin/main`。
- 标签：`v0.0.42` 已创建并推送到 GitHub。
- Releases：已创建 `Kimi Desktop Shell v0.0.42`，地址为 `https://github.com/endearqb/kimi-app/releases/tag/v0.0.42`；已上传 `0.0.42` 的 NSIS 与 MSI 安装包，且已设置为 latest。
- 已知限制：本轮仍未完成安装版 UI 点击回归；Rust 测试二进制在当前 Windows 环境仍受既有 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` 影响，未能执行到断言阶段。

## 红框区域中文注入扩展

### Checklist
- [x] 复查现有增强注入表、截图定位结果和上游文案来源，锁定仅新增红框区域及相邻固定文案
- [x] 扩展 `workspace_injection.rs` 的翻译分组，补齐 `Thought`、工具标签、活动状态、输入区提示、右键菜单和上下文占用文案
- [x] 在不引入复杂 DOM 特判的前提下，为 `Thought for {n}s`、`{percent}% context`、`{n} selected` 增加轻量动态句式匹配
- [x] 更新 `apps/kimi-shell/docs/kimi-web-i18n-inventory.md`，补充第三阶段注入覆盖范围和仍排除的动态文本
- [x] 更新 `apps/kimi-shell/docs/kimi-web-maintenance.md`，明确第三阶段动态句式边界与停止扩注入条件
- [x] 运行 `check:enhanced-web:i18n`、`check:enhanced-web:compliance`、`tsc --noEmit`、`build`、`cargo check` 与 `git diff --check`
- [x] 在本节补充 Review，记录新增注入命中范围、动态句式策略和验证结果

### Review
- 注入脚本：`apps/kimi-shell/src-tauri/src/backend_manager/workspace_injection.rs` 仍保持单一 same-origin 注入入口；本轮只新增 `ai_reasoning_and_tools`、`chat_activity_and_composer`、`session_context_menu_and_multiselect`、`toolbar_context_usage` 四组翻译，不改观察器和属性覆盖机制。
- 新增覆盖：本轮补齐了 `Thought` / `Thinking...` / `Thought for {n}s`、`Copy`、工具标签 `Edit` / `Read` / `Search` 及同源工具名、`Awaiting input`、批准等待、上传/连接/启动环境状态、输入框提示、`Collapse input` / `Expand input`、`Stop generation` / `Queue message`、会话右键菜单 `Rename` / `Archive` / `Unarchive` / `Select Multiple`、多选条 `Select all` / `Deselect all` / `{n} selected`、以及右下角 `{percent}% context` 和 token 用量说明。
- 动态句式：仅新增三类轻量模式匹配：`Thought for {n}s`、`{percent}% context`、`{n} selected`；没有引入通用正则翻译器，也没有加任何 DOM 结构特判。
- 排除边界：本轮继续排除了 `approval.description`、`approval.sender`、`currentQuestion.*`、模型输出正文、用户消息正文、文件路径、URL 和工具参数本体；例如 `Edit (D:\...)` 只翻译 `Edit`，路径保持原样。
- 文档：`apps/kimi-shell/docs/kimi-web-i18n-inventory.md` 已补充“第三阶段”注入覆盖状态；`apps/kimi-shell/docs/kimi-web-maintenance.md` 已明确第三阶段只允许三类变量句式，并重申超过该边界就应停止扩注入、转源码 patch。
- 验证结果：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过；`git diff --check` 仅剩 CRLF 提示，无内容级错误。
- 未覆盖项：本轮未启动桌面应用做手工点击回归，因此截图里的 `Thought` 折叠头、工具调用行、输入区状态、右键菜单、多选条和 `% context` 仍需你在真实界面点一遍确认最终命中效果。

## 快速设置安装区调整

### Checklist
- [x] 在安装主操作区增加第二行 `安装 Git` / `安装 Node.js` 快捷按钮
- [x] 移除详细选项中的重复“可选增强”入口
- [x] 官方源 tab 下隐藏镜像策略卡
- [x] 镜像源 tab 切换不自动检测，改为手动点击检测按钮触发
- [x] 运行 `tsc --noEmit`、`build`、`cargo check` 并记录结果

### Review
- 主操作区：`InstallFlowTaskContent` 现在将 `install_git` 与 `install_nodejs` 放在安装 / 升级按钮下方第二行，沿用现有探测状态禁用逻辑和任务执行路径。
- 详细选项：已移除原“可选增强”重复卡；官方源只保留来源切换，镜像策略仅在镜像源下显示。
- 镜像检测：点击镜像源 tab 只切换来源；只有点击“检测镜像源”才调用镜像健康检测，并固定以 `preferredSource: "mirror"` 检测。
- 验证结果：`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已通过。

## 左上角品牌名注入

### Checklist
- [x] 复查品牌标题来源，确认左上角 `Kimi Code` 是独立文本节点而非图片资源
- [x] 在 `workspace_injection.rs` 中新增精确品牌映射 `Kimi Code` → `Kimi 小助手`，且不引入更宽的 `Kimi` 匹配
- [x] 更新维护文档与盘点文档，明确当前仅替换可见标题，不改 logo、版本号、链接和可访问属性
- [x] 运行 `check:enhanced-web:i18n`、`check:enhanced-web:compliance`、`tsc --noEmit`、`build`、`cargo check` 与 `git diff --check`
- [x] 在本节补充 Review，记录品牌注入边界、验证结果和仍需手工确认的点

### Review
- 标题来源：已确认上游 `apps/kimi-shell/third_party/kimi-cli-web/upstream-web/src/components/kimi-cli-brand.tsx` 中左上角品牌由 `/logo.png` 图片、独立文本 `Kimi Code` 和独立版本文本 `v{kimiCliVersion}` 组成；红框内文字不是图片。
- 注入范围：`apps/kimi-shell/src-tauri/src/backend_manager/workspace_injection.rs` 仅新增 `brand_identity` 分组，并加入精确映射 `Kimi Code` → `Kimi 小助手`；没有新增 `Kimi` 这类宽匹配，也没有改动现有观察器、属性覆盖逻辑或 logo/版本/链接逻辑。
- 文档：`apps/kimi-shell/docs/kimi-web-maintenance.md` 与 `apps/kimi-shell/docs/kimi-web-i18n-inventory.md` 已补充品牌注入边界，明确当前只替换可见标题，不改 `/logo.png`、版本号、外链和 `alt`/`title`/`aria-label`。
- 验证结果：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过；`git diff --check` 仅剩 CRLF 提示，无内容级错误。
- 手工确认：本轮未启动桌面应用做点击回归，因此仍需在真实界面确认左上角已显示 `Kimi 小助手 v1.39.0`，且黑底 `K` logo、品牌链接和版本号展示保持不变。

## v0.0.43 发版执行

### Checklist
- [x] 复查当前工作区 diff、版本号与本地 `0.0.43` 安装包产物，确认发版边界
- [x] 撰写 `apps/kimi-shell/docs/release-notes-0.0.43.md`
- [x] 撰写 `update/updatenote_202604251248.md`
- [x] 运行本次发版所需验证命令并记录结果
- [x] 提交当前工作区改动并推送 `main`
- [x] 创建并推送 `v0.0.43` tag
- [x] 创建 GitHub release 并上传 `0.0.43` 的 NSIS / MSI 安装包

### Review
- 发版边界：当前版本号已统一到 `0.0.43`。本次发版内容集中在两块：一是增强版官方 Web 的第三阶段中文注入扩展与左上角品牌标题 `Kimi 小助手` 注入；二是控制中心安装流程区的快捷操作与镜像检测交互调整。
- 发布文档：已新增 `apps/kimi-shell/docs/release-notes-0.0.43.md`，覆盖第三阶段注入扩展、品牌标题本地化、安装流程区调整与 `0.0.43` 验证结果；已新增 `update/updatenote_202604251248.md`，概括同一批改动及用户影响。
- 安装包产物：已确认本地存在 `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.43_x64-setup.exe` 与 `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.43_x64_en-US.msi`，可用于 GitHub release 上传。
- 自动化验证：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过。
- diff 检查：`git diff --check` 已于 2026-04-25 执行，未发现内容级错误，仅剩当前工作区 CRLF 提示。
- Git 提交：已创建 `261a3e6 release: ship v0.0.43`，并已推送到 `origin/main`。
- 标签：`v0.0.43` 已创建并推送到 GitHub。
- Releases：已创建 `Kimi Desktop Shell v0.0.43`，地址为 `https://github.com/endearqb/kimi-app/releases/tag/v0.0.43`；已上传 `0.0.43` 的 NSIS 与 MSI 安装包，且已设置为 latest。

## SPEC-08 Phase 0：Kimi Code 接入后端收敛

### Checklist
- [x] 复用 `KIMI_CODE_HOME` 解析，默认配置路径切到 `~/.kimi-code/config.toml`
- [x] 新增 Kimi Code 接入配置读取、保存和连接测试命令
- [x] 保存时只 patch `kimi-app-api-key` provider、`kimi-app/kimi-for-coding` model、`moonshot_search` / `moonshot_fetch` 的白名单字段
- [x] 保存前创建并轮转 `config.toml.kimi-app-backup-*`
- [x] API key 只返回掩码状态，不在新命令中返回明文
- [x] 禁用旧全量 `save_kimi_cli_config_center`
- [x] 子 Agent 并发上限进入 App settings，并在启动 Kimi Code 时注入 `KIMI_CODE_AGENT_SWARM_MAX_CONCURRENCY`
- [x] 运行 Rust fmt/check/test-no-run 并记录 Windows test binary 执行限制

### Review
- Phase 0 后端地基已完成；旧全量读取暂保留给 auth/status 兼容，旧全量保存已被拒绝。
- 验证结果：`cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run` 通过；执行 `cargo test ... config -- --nocapture` 仍受本机既有 `STATUS_ENTRYPOINT_NOT_FOUND` 限制。

## SPEC-08 Phase 1：Kimi Code 接入配置面板

### Checklist
- [x] 新增“Kimi Code 接入配置”面板
- [x] 新增 API Base URL / API Key 表单
- [x] 新增 Search / Fetch service 表单
- [x] 新增子 Agent 并发上限表单
- [x] 移除 providers/models/services/defaults/loop/MCP 全量编辑区
- [x] 保留官方配置状态只读诊断
- [x] 更新控制中心文案
- [x] 运行 `tsc --noEmit`、前端测试、前端 build 和 `cargo check`

### Review
- 控制中心已不再暴露全量 Kimi Code `config.toml` 编辑器；当前只允许编辑 SPEC-08 白名单字段，并通过新 Tauri command 保存。
- 快速 Kimi API 设置入口已复用新的 `save_kimi_code_access_config`，不再调用旧 `save_kimi_cli_api_config` 写入旧路径。
- 连接测试按钮已接入 `test_kimi_code_access_config`，UI 不展示明文 API key，仅显示配置状态和脱敏结果。
- 验证结果：`.\node_modules\.bin\tsc.cmd --noEmit` 通过；`pnpm --dir apps/kimi-shell test -- --run` 通过（4 files / 36 tests）；`pnpm --dir apps/kimi-shell build` 通过；`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
- 未完成项：旧 provider 的显式迁移按钮尚未实现，留待后续小步补齐。

## SPEC-08 Phase 2：Skill 投影与工作区管理

### Checklist
- [x] 将控制中心 Skill 分区命名为“Skill 投影与工作区管理”
- [x] 用户全局默认投影目录改为 `~/.agents/skills`
- [x] 新增显式投影到 `$KIMI_CODE_HOME/skills`
- [x] 当前工作区投影容器收敛为 `.agents/skills` 与 `.kimi-code/skills`
- [x] `~/.config/agents/skills` 只保留为 legacy discovery
- [x] 未信任 Skill 不可通过普通 apply 或 workspace target copy 投影
- [x] 运行 `tsc --noEmit`、前端测试、前端 build、Rust check 和 Rust test no-run

### Review
- Phase 2 已完成目录边界收敛；`.codex/.claude` 保留类型兼容但不再作为新 workspace target 主入口。
- 后端新增 `kimi_code_home` scope，复用全局投影记录但移除动作按 scope 精确删除。
- 前端按钮、chips、容器 tab 和标题栏入口已改为 Skill 投影语义，并隐藏未信任 Skill 的 workspace target 投影候选。
- 验证结果：`.\node_modules\.bin\tsc.cmd --noEmit`、`pnpm --dir apps/kimi-shell test -- --run`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run` 均通过。
- 未完成项：真实桌面点击投影到 `$KIMI_CODE_HOME/skills` 和 `.kimi-code/skills` 仍需人工验证。

## SPEC-08 Phase 3：外部 IM 通道配置

### Checklist
- [x] Bridge 文案明确为“外部 IM 通道配置”
- [x] 新建机器人菜单补齐 Telegram / Feishu / Weixin
- [x] Telegram / Feishu / Weixin 配置 UI 与高级运行面板均保留
- [x] Telegram bot token、Feishu appSecret / verificationToken / encryptKey、Weixin bot token 不明文展示为已保存值
- [x] Feishu verificationToken / encryptKey 加入已保存凭据掩码状态
- [x] Bridge controls 不写官方 `config.toml`，继续通过 runtime metadata/controls
- [x] approval / binding / session / runtime diagnostics 保留
- [x] 运行前端、Rust 与 Go bridge 验证

### Review
- Phase 3 已完成；`apps/kimi-im-bridge` sidecar 名称保持不变，控制中心用户入口改为“外部 IM 通道配置”。
- 新建机器人入口现在覆盖 Telegram、微信、飞书；高级运行面板可正确显示 Weixin 平台与凭据掩码。
- secrets 继续只展示 masked/configured 状态，未把完整 token/appSecret/encryptKey 暴露到 UI。
- 验证结果：`.\node_modules\.bin\tsc.cmd --noEmit`、`pnpm --dir apps/kimi-shell test -- --run`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`go test ./...`（`apps/kimi-im-bridge`）均通过。
- 未完成项：真实桌面三平台创建/保存/高级面板点击仍需人工验证。

## 小助手设置区收敛与环境探测修复

### Checklist
- [x] 删除五个设置栏操作区的重复状态徽章并右对齐按钮
- [x] 修复 Git Bash 的环境变量、PATH、Git 根目录和常见安装目录探测
- [x] 在安装更多选项中恢复 uv / Python 3.13 legacy repair 入口
- [x] 扁平化右键菜单、API 配置和默认工作目录详情
- [x] 移除 Telegram 默认项、新建入口及已保存 connector/secrets
- [x] 将微信/飞书扫码改为机器人行内直接展开二维码
- [x] 补充前端与 Rust 单测、ADR、README、架构事实和变更记录
- [x] 运行类型检查、前端测试/build、Rust fmt/check/test-no-run 和 diff 检查

### Review
- API 配置继续复用既有脱敏读写和连接测试命令，不再创建二级任务面；扫码继续复用现有 onboarding session 和轮询。
- `AppSettings` schema 9 只迁移历史默认菜单名，保留自定义值；启动自愈会重写已启用的 Explorer 菜单。
- Telegram 清理在 Shell 初始化时幂等执行，不写日志或备份 secrets；Go Bridge adapter 保留。
- 自动验证通过：TypeScript、Vitest 12 files / 86 tests、Vite build、cargo fmt check、cargo check、cargo test no-run、git diff check。
- Rust 测试二进制执行仍被本机既有 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` 阻塞；真实 Explorer、Git Bash 和微信/飞书扫码需在 Tauri 窗口手工验证。

## 自定义路径 Git Bash 升级预检修复

### Checklist
- [x] 复用 `kimi_locator::locate_shell_path()`，向安装任务 PowerShell 子进程注入 `KIMI_SHELL_PATH`
- [x] 覆盖 managed file、inline retry 和 elevated fallback 三条启动路径
- [x] 增加最小命令环境回归测试
- [x] 运行 Rust fmt check 和 cargo check

### Review
- 根因是安装面板与升级脚本使用了两套不一致的 Git Bash 探测；现在 PowerShell 子进程直接继承统一 locator 的结果。
- `cargo fmt -- --check`、`cargo check` 通过；目标测试完成编译，但执行仍受既有 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` 阻塞。
- 待在真实 Tauri 窗口验证 `D:\Program Files\Git\bin\bash.exe` 条件下的升级任务。

## 设置主操作按钮右对齐

### Checklist
- [x] 设置列表和卡片头显式占满可用宽度
- [x] 五个桌面主操作按钮统一靠右
- [x] 保留 `820px` 以下单列堆叠布局
- [x] 运行 TypeScript 检查、Vite build 和 diff 检查

### Review
- 本次只调整 `App.css`，未修改组件、交互或按钮尺寸。
- 纯 Web 预览受 Tauri IPC 限制停在启动页；需要在真实 Tauri 控制中心补做最终截图复核。

## kimi-app review fix kit 审核后适配

### Checklist
- [x] 校验工具包基线、manifest、SHA256 和 check-only 行为
- [x] 核验 5 个问题在 `main@c2aaa14` 仍真实存在
- [x] 显式收紧 Tauri 自定义 command 的窗口权限，并恢复 Picker 目录对话框权限
- [x] 隔离 Picker 路由的安装、轮询、Skill 和 loading 后台副作用
- [x] 串行 Bridge `Start` / `Shutdown`，严格拒绝多 JSON 请求体
- [x] 清理异步迟到的嵌入式 Webview controller
- [x] 补齐自动测试、README、架构事实和变更记录
- [x] 运行前端、Rust、Go 与 diff gate，并记录 blocked 的手工/环境门禁

### Deferred TODO：轮询 single-flight / 响应代次
- What：为状态、Bridge 详情和日志轮询增加每个轮询域独立的 single-flight 或 generation 控制。
- Why：固定间隔触发的慢请求可能重叠，较旧响应晚到时可能覆盖新状态。
- Pros：消除轮询重入和旧响应回写，降低后端阻塞时的请求放大。
- Cons：需要逐个确认各刷新函数的取消、错误和可见性语义，不适合混入本轮权限修复。
- Context：入口为 `src/app/useShellPollingController.ts`；本轮只在 Import Picker 路由禁用这些轮询，不改变主窗口轮询模型。
- Depends on / blocked by：先为状态、Bridge 详情和日志轮询建立可独立断言的回归测试。

### Deferred TODO：Workspace embed URL 启动周期保护
- What：为 `useWorkspaceEmbedUrl` 的异步刷新增加请求 generation，并只接受当前 `startCycleId` 的返回值。
- Why：快速重启时旧启动周期的响应可能晚到并覆盖新的 embed URL。
- Pros：避免 iframe 在重启竞态下回退到旧 runtime 地址。
- Cons：需要覆盖启动、重试和状态切换时序，和本轮 child Webview controller 生命周期不是同一问题。
- Context：入口为 `src/app/useWorkspaceEmbedUrl.ts`；本轮 generation 只保护 Workspace Grid 的原生 child Webview 创建。
- Depends on / blocked by：需要可控 deferred response 测试覆盖两个启动周期的逆序返回。

### Review
- Tauri：135 个自定义 commands 已进入应用 manifest；`main`、`prefill`、`workspace-import-picker` 分别使用完整、6 项和 4 项 command permission，现有 command registry 门禁同步检查 build、permission 与 capability。
- Picker：独立窗口保留目录选择和 4 个导入命令；安装 Channel、轮询、Skill 刷新、loading 上报及完成后的全局状态刷新均被隔离，主窗口 modal 的完成后刷新保持不变。
- Bridge/Admin：完整生命周期使用独立互斥锁串行；Admin 请求体只接受一个 JSON 值，并保留 413 body-size 行为。
- Webview：删除 pane、换 URL、挂起或重复打开都会使旧 generation 失效，迟到 controller 只关闭一次。
- 已验证：固定 pnpm 10.34.4 frozen install；前端 `verify` 16 files / 105 tests、Web build、安全门禁；Rust fmt/check/clippy/test-no-run；Go vet/test；Tauri release build 及 MSI/NSIS bundle；`git diff --check`。
- Blocked：完整 Rust test binary 在本机以 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` 退出；Go race 需要 CGO/GCC 或 Linux CI；真实 Prefill/Picker/Bridge/Webview 点击回归仍需桌面人工执行。

## Kimi 小助手本体自动更新

### Checklist
- [x] 接入 Tauri Updater 的应用内检测、下载进度与用户确认安装入口
- [x] 安装前复用退出协调停止 Kimi 后端与 IM Bridge
- [x] 新增 `v*` tag Windows 发布 workflow，校验 tag/version 并生成签名安装包与 `latest.json`
- [x] 固定 Node 22、pnpm 10.34.4、Rust stable 与 `go.mod` Go 版本
- [x] 新增 accepted ADR、README、架构事实、验证门与变更记录
- [x] 配置长期 Tauri 签名密钥的两个 GitHub Actions Secrets
- [ ] 将签名私钥与密码分别离线备份
- [ ] 从旧 NSIS/MSI 安装版完成自动更新与失败场景 G3 矩阵

### Review
- 自动发布在签名 Secrets 缺失或 tag 与 `apps/kimi-shell/package.json` 版本不一致时 fail-fast；workflow 不包含任何密钥值。
- `0.1.13` 是首个支持本体更新的目标版本，`0.1.12` 及更早版本需手动安装一次。
- 当前状态：代码、发布配置与签名 Secrets 已完成；真实 Release 资产、签名信任链及 NSIS/MSI 安装回归在完成 G3 前为 blocked。

## Kimi Code 0.28.0 后端启动兼容修复

### Checklist
- [x] 核对脱敏 `backend.log`、本机 CLI 契约和 Kimi Code 官方 0.28.0 Release/源码
- [x] 将 Shell 自有后端改为 `kimi web --no-open --port <port>`
- [x] 将失败态契约探测改为 `kimi web --help`
- [x] 更新回归测试、Shell README、安装文档和架构事实
- [x] 运行 Rust 格式/编译/针对性测试和 Kimi Code 0.28.0 真实健康检查

### Review
- 根因是 Kimi Code 0.28.0 将 `kimi server` 整个命令树替换为弃用占位命令；它吞掉 `run --help` 后退出，导致启动失败和错误的“支持 server run”诊断。
- 修复只替换共享启动参数与契约探测，不增加版本分支、回退层或新依赖。
- 已验证：`cargo fmt -- --check`、`cargo check`、两条针对性 Rust 测试通过；本机 0.28.0 真实启动后 `/api/v1/healthz` 返回 HTTP 200。

## Agent Room Redesign Phase 0–2

### Checklist
- [x] 核对 `main@f7a89d8`、PRD/SPEC、静态预览、DESIGN 与现有 V1 实现
- [x] 接受独立窗口 / targeted event / dedicated capability ADR
- [x] 预写 Grid V3 Draft ADR 与 7 天 Dogfood 记录模板，不提前执行迁移
- [x] 完成单例 `agent-room` 窗口、关闭隐藏、临时置顶与标题栏入口
- [x] 完成 capability allow-list、双窗口 Event Pump 与 capability-driven Pane Session Publisher
- [x] 完成房间切换/创建、执行成员、任务动态、Compact Composer、内嵌审批和精确 Session 打开（含 `focus_existing` / `new_pane`）
- [x] 完成归档只读、事件 generation 恢复、逐目标失败反馈、键盘目标选择与 Session 错误映射审计
- [x] 修复 Workflow 终态 Reply 投影与本地执行清理并发时的 lost wake-up
- [x] 完成 TypeScript、前端/Rust/Go 全量测试、生产构建、安全门禁与最小视觉静态验证
- [x] 写入 `.ai/changes/2026-07-22.md`、README 与 architecture 当前事实
- [ ] 完成连续 7 天真实 Dogfood Product Gate
- [ ] Product Gate 通过后再决定 Phase 3–5、Grid V3 与旧 Pane 退场

### Review
- 当前交付范围严格停在 Redesign Phase 0–2。Phase 3–5 不是遗漏：PRD 明确要求先通过 7 天真实 Dogfood Product Gate，Gate 前禁止删除旧 Pane、实施 Grid V3 或宣称完整 Redesign DoD。
- 已验证前端 35 个文件 / 186 项测试、TypeScript、Vite build、安全门禁、Rust 237 项 lib 测试与 Go `go test ./...` 全量测试。Workflow 竞态回归目标测试连续 10 次通过。
- G3 仍需真实 Tauri 双窗口、2–6 个 Runtime Session、实际审批、主窗口隐藏后的精确跳转、Sidecar 重启、暗色和 820×560 视觉矩阵。

## 飞书同 Session 后续回复丢失

### Checklist
- [x] 核对 `session_4850bb78-ac22-4125-9771-180287aa0ba8` 的 Bridge DB、Runtime journal 与只读 WS 回放
- [x] 在共享 Server Runtime Adapter 修复无 Prompt ID 的历史 `turn.ended` 提前终止当前流
- [x] 增加历史 Prompt 回放回归并运行 `go test ./...`
- [ ] 重建 bundled Bridge sidecar，重启应用后用真实飞书连续发送两条同 Session 消息完成 G3

### Review
- 三条消息均成功入站；后两条 Runtime 实际完成，但 Bridge 分别提前约 44 秒和 80 秒结束事件流，因此没有内容增量或飞书 outbound。
- 修复只收紧终止事件关联，不改变内容增量、飞书发送、数据库或 UI；历史漏发回复不自动补发。

## Agent Room 独立窗口交互修复

### Checklist
- [x] 核对窗口配置、command、capability、launcher、标题栏与 `CloseRequested` 完整调用链
- [x] launcher 改为幂等 show，并把失败接入主窗口可见错误栏
- [x] 标题栏改用原生手动拖动，交互控件保持不可拖动
- [x] X 统一走原生 close 与 Rust close-to-hide 生命周期
- [x] 收敛 Rust show/focus 与 hide/topmost 的部分成功语义
- [x] 完成前端全量测试、TypeScript、Rust 格式/编译/测试 gate
- [ ] 在真实 Windows 安装版完成焦点、最小化、Alt+F4 与双显示器 G3

### Review
- 审查结论的方向成立，但不存在由静态代码证明的单一根因：首次点击时 toggle 仍会走 show；实际是 launcher 吞错、窗口焦点部分成功、拖动命中区过小和关闭双链叠加。
- 已验证：前端 36 files / 188 tests、TypeScript、`cargo check`、Rust 238 项 lib tests；真实操作系统窗口层级仍属于 G3。

## Windows native-feel 基线审查

### Checklist
- [x] 运行 native-feel 架构 decision tree 与代码态 ship-readiness 审查
- [x] 统一桌面 Chrome 的原生箭头与不可选中文案语义
- [ ] 在真实 Windows 环境检查启动闪烁、IME、Narrator、窗口恢复与后台 CPU

### Review
- 当前应用只发布 Windows；保留既有 Tauri + WebView2 架构，未引入未被产品目标证明的 macOS shell、Node sidecar 或 Rust core 分层。
- 本次只修复重复出现的 Web hand cursor 根因；真实链接、输入与拖拽/缩放语义保持不变。

## 首次引导与 Windows 原生 Kimi 升级修复

### Checklist
- [x] 根据日志确认后端健康、token 验证与 session bootstrap 成功
- [x] 恢复首次引导完成后进入工作区的可见入口
- [x] 为 Kimi 升级增加中断现有连接确认
- [x] 支持 `%USERPROFILE%\.kimi-code\bin\kimi.exe` 官方脚本升级
- [ ] 在 Kimi 0.26.0 Windows 原生安装包环境完成停止、升级、重启和 Workspace G3

### Review
- 重复 cycle 来自健康后端上的“重新连接”操作，不是 Server 启动失败；首次引导重构遗漏了已有完成回调的 UI 入口。
- npm/pnpm 升级保持原逻辑，未知安装来源继续拒绝；普通 `reused_external` 停止语义不变。

## macOS V1（Apple Silicon）

### Checklist
- [x] 读取治理、架构、DESIGN 与 2026-08-05 macOS Research/PRD/SPEC/Plan
- [x] 审查当前仓库并并行调研 Kimi Code 0.34.0 与 Tauri/macOS 官方实践
- [x] 接受 macOS 平台边界与 Kimi instance registry ADR
- [x] 完成跨平台 build/verify、target-triple Bridge 与平台配置
- [x] 完成 PlatformCapabilities、原生 traffic lights、App Menu、Dock reopen 与 Cmd+Q
- [x] 完成 Finder-safe Kimi 定位、instance registry 与 Unix process-group 管理
- [x] 完成 macOS guided install 与 Windows-only UI 隔离
- [x] 通过前端/Rust/Go G0/G1 及本机 unsigned `.app` smoke
- [ ] Developer ID、notarization、stapling、DMG 与 updater G3（需要外部证书）

### Review
- 2026-08-05 文档基线已过期：当前 Kimi Code 稳定版为 0.34.0；Agent Room 已被 Accepted ADR 下线，不进入 macOS 验收。
- 当前主机是 arm64 macOS 26.5.1；本地 `.app` 已构建并以临时 Kimi Code 0.34.0 启动，registry 实际端口与 Bearer OpenAPI probe 通过。自动 UI 验收受宿主辅助功能/屏幕录制权限限制；Developer ID/notarization/DMG/updater 仍需 Apple 凭据完成 G3。

## macOS V1 审查修复与合并门禁

### Checklist
- [x] owned child 在 spawn 后立即登记，并以 lifecycle operation 串行 stop/restart/monitor 清理
- [x] Unix 保存不可变 process-group identity，TERM/KILL 后确认整组消失；未确认时保留 owned ledger 并阻止退出
- [x] owned registry 归属收紧为本次 child PID + launch time；删除新增 server-id/端口启发式归属
- [x] external runtime 在 stop/restart/quit 路径保持 never-kill
- [x] macOS 安装指引增加复制反馈、打开 Terminal 与本地中文步骤，不自动执行远程脚本
- [x] macOS 已安装 Kimi Code 支持原生确认后的应用内升级、实时脱敏日志、复检与后端自动重启
- [x] PR CI 实际运行 Rust tests，并构建/校验/上传 macOS arm64 `.app`
- [x] release gate 精确验证 NSIS、MSI、DMG、app updater 资产及 macOS 架构/签名
- [x] 用 macOS Kimi 0.34.0 隔离 smoke 确认 registry PID 与 spawned PID 一致、health/Bearer 均为 200
- [ ] 用最终 Windows Kimi 0.34 安装基线确认 registry PID 与 spawned PID 一致
- [ ] Developer ID、notarization、stapling、最终 DMG 与真实 updater E2E G3

### Review
- 自动化代码门禁通过后可进入合并候选；最后两项属于真实安装/发布环境 G3，其中签名公证项不应伪装为本地完成。
- 若未来 Kimi wrapper 把 registry PID 改为 descendant，只能用 OS 可证明的进程树/进程组关系扩展，不能恢复共享 token、端口或新增 server-id 启发式。

## 控制中心 API 配置 canonical 化

### Checklist
- [x] 统一 `managed:kimi-code` / `kimi-code/*` 配置
- [x] 使用认证后的 `/models` 验证并同步模型
- [x] 修复 404 误报和已保存 Key 无法测试
- [x] 增加旧配置幂等迁移、OAuth 阻断与 Doctor 保存门禁
- [x] 增加默认模型选择和验证三态 UI
- [ ] 使用真实 API Key 在 Windows 安装版完成保存、重载和新会话 G3

### Review
- Search/Fetch 不再用无意义 GET 冒充成功，也不在验证时消耗真实搜索或抓取请求。
- 非 API 配置、用户自定义 Provider/Model 和仍被引用的旧 Provider 保持不变。
# 控制中心原生交互与信息架构收口

## 任务契约

- 用户目标：按控制中心全面审查建议完成可落地的交互、信息架构、状态保留和视觉一致性优化。
- 直接交付物：修复 Esc 弹层优先级与焦点管理；完善更多菜单和 Unified Rail 键盘操作；调度页只保留 Unified Rail 对象导航；保留页面选择与滚动上下文；统一状态、空状态、焦点和暗色变量；补充测试与验证记录。
- 影响范围：`App.tsx`、控制中心共享组件、ControlCenterView、WorkspaceHub、Schedule、Skill Center、Directory preview、控制中心样式和相关测试。
- 非目标：不新增 Tauri command，不改变安装/升级、Bridge、Workspace 或 Skill 持久化契约；不把现有控制中心迁移为新的原生 Settings 窗口。
- 约束：保留当前用户未提交修改；遵循 `DESIGN.md` 两栏结构、状态词表和 native-feel T3；不新增运行时依赖。
- 验收：内层 Esc 不关闭控制中心；弹窗焦点可圈定并恢复；菜单支持外点、Esc、方向键；Rail 支持 roving focus、方向键、Home/End 和 typeahead；调度对象列表不重复；页面切换保留上下文；G0/G1、安全 gate 和生产构建通过。
- 保守假设：原生独立 Settings 窗口属于后续单独架构任务，本轮保留当前 modal/fullscreen 两种入口；暗色模式沿用现有 CSS `prefers-color-scheme` 能力，不引入新的主题持久化状态。
- 架构事实入口：`.ai/architecture/current-state.md`、`module-map.md`、`dependency-boundaries.md`、`verification-gates.md`。
- 验证入口：`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm check:nfr:security`、`pnpm build`。

## Checklist

- [x] 建立 dismissible layer、dialog focus 与 Unified Rail 键盘测试。
- [x] 修复 Esc 优先级和控制中心 modal 焦点圈定/恢复。
- [x] 完善通用更多菜单的外点、Esc、方向键与焦点恢复。
- [x] 为 Unified Rail 增加 roving focus、方向键、Home/End 与 typeahead。
- [x] 删除调度详情区重复的工作区列表与标题。
- [x] 保留 WorkspaceHub/调度选择、筛选与页面滚动上下文。
- [x] 收敛状态词表、空状态、焦点视觉、暗色变量和 pressed state。
- [x] 完成 G0/G1、安全 gate、生产构建与变更记录。

## Review

- 控制中心现在遵循“最内层先处理 Escape”的 dismiss 顺序；modal、二次确认和菜单均能圈定或恢复焦点，外层只在事件未被消费时关闭。
- Unified Rail 采用 roving tab stop，支持方向键、Home/End、展开/折叠和名称快速定位；调度对象只在 Rail 出现一次，详情页不再重复列表与标题。
- 一级页面访问后保持挂载，切换页面不会丢失筛选、选中项、表单与滚动上下文；隐藏页面使用 `hidden`、`aria-hidden` 与 `inert` 隔离。
- 元数据改用中性 Tag，状态徽标收敛到设计词表；补齐暗色变量、轻量焦点、pressed/reduced-motion，并把外链确认改为原生 dialog + 系统 opener。
- 已验证 TypeScript、47 个测试文件 / 224 项测试、安全 gate、生产构建和 `git diff --check`；真实 macOS/Windows 的 VoiceOver/Narrator、系统字体缩放和暗色视觉仍属于发布前 G3。
# Skill 技能库页面覆盖修复

## 任务契约

- 用户目标：恢复控制中心中消失的技能库目录页面，并让左侧“技能库”稳定返回该页面。
- 直接交付物：修正 Skill 页面分支、Rail 返回目录语义、回归测试和重新构建的 macOS App。
- 影响范围：`SkillCenterPanel.tsx`、Skill Center 组件测试和本地 macOS 构建产物。
- 非目标：不改变 Skill 数据、扫描、导入、投影或工作区目标契约。
- 验收：manage 目录态只渲染技能库，不渲染工作区目标；点击顶层“技能库”清除详情选择；前端 gate 与 macOS App 构建通过。

## Checklist

- [x] 确认技能数据仍存在，问题是目录与工作区目标同时占据同一 Grid 行。
- [x] 将目录、详情、工作区目标改为显式互斥渲染。
- [x] 顶层“技能库”同时切换 manage 并清除详情选择。
- [x] 增加页面覆盖与 Rail 返回目录回归断言。
- [x] 完成 TypeScript、全量测试、安全 gate、生产构建和 macOS App 重建。

## Review

- 根因是 `manage && hasDetail ? manageDetail : workspaceInsights` 把合法的 `manage + noDetail` 目录态误当成工作区目标态；目录组件虽然存在，但后渲染分支将它覆盖。
- 修复后页面状态为 `manage/noDetail → 技能库目录`、`manage/hasDetail → Skill 详情`、`workspace_insights → 工作区目标`，不再依赖 DOM 顺序或 Grid 覆盖关系。
- 已验证 TypeScript、47 个测试文件 / 224 项测试、安全 gate、生产构建以及 macOS arm64 `.app` 构建。
# Skill 目录高度、焦点与筛选浮层修复

## 任务契约

- 用户目标：恢复可见的 Skill 列表，移除搜索框聚焦阴影，并让筛选下拉完整显示。
- 直接交付物：确定高度链、列表独立滚动、浮层层级、无阴影 focus 样式、CSS 契约测试和新 macOS App。
- 影响范围：控制中心 keep-alive wrapper、Skill 目录 CSS、样式测试与本地 App 产物。
- 非目标：不改变 Skill 数据、筛选逻辑、排序逻辑或导入操作。
- 验收：35 条数据对应的列表区域不塌缩；搜索聚焦无 outline/box-shadow；筛选面板不被列表或父容器裁切；全量 gate 与 App 构建通过。

## Checklist

- [x] 将 active preserved page 从 `display: contents` 改为确定高度 Grid 项。
- [x] 固定 `.cc-main` 单一可见页为 `minmax(0, 1fr)`。
- [x] 保留 Skill 列表独立滚动并允许筛选浮层可见溢出。
- [x] 搜索聚焦只改变边框，移除 outline 与 box-shadow。
- [x] 增加 CSS 高度、浮层和焦点契约测试。
- [x] 完成 48 个测试文件 / 227 项测试、安全 gate、生产构建与 macOS App 重建。

## Review

- 根因是 keep-alive wrapper 的 `display: contents` 去掉了 Skill 页的确定高度包含块；内部 `flex: 1 1 0` 列表因此再次压缩为 0，筛选浮层也被过短祖先的 overflow 边界裁切。
- 修复保留真实 wrapper box，统一主区域只有一个 `1fr` 可见页；Skill 顶部控件不滚动，列表获得剩余高度并独立滚动。
- 新增 CSS 源码契约测试，避免 jsdom 无布局计算导致同类 CSS 回归再次漏过。

# macOS V1 合并与 0.1.23 双平台发布

## 任务契约

- 用户目标：将 `codex/macos-v1` 合并到 `main`，提升版本号并发布 Windows/macOS Release，确认 Windows 影响与测试责任。
- 直接交付物：`0.1.23` 版本提交、Windows/macOS PR CI、合并到 `main`、`v0.1.23` Release；若发布凭据缺失则明确 blocked 条件。
- 影响范围：共享 React/Rust/Go 应用、Windows/macOS 打包配置、CI、Release workflow 和版本元数据。
- 非目标：不扩展 Intel macOS、Universal binary 或新的安装器类型；不绕过签名、公证和安装生命周期 G3。
- 验收：本地 Windows G0/G1 通过，PR CI 两端全绿，main 合并成功；Release 同时包含 Windows NSIS/MSI、macOS updater/DMG 与唯一 `latest.json`，否则按项目宪法标记 blocked。
- 保守假设：使用下一个补丁版本 `0.1.23`；保留同一 `com.kimi.shell` 应用身份。

## Checklist

- [x] 核对分支差异、版本、发布工作流与 Secrets。
- [x] 提升 package/Cargo/Tauri 版本至 `0.1.23`。
- [x] 修复 Windows clippy 与 Unix-only 测试边界。
- [x] 完成 Windows 本地 Rust、前端、Go 与安全 gate。
- [ ] 创建 PR 并通过 Windows/macOS CI。
- [ ] 合并到 `main`。
- [ ] 配置 Apple 签名/公证 Secrets 并发布 `v0.1.23`。
- [ ] 完成 Windows/macOS 安装与 updater G3。

## Review

- `codex/macos-v1` 修改 109 个文件，包含共享 UI、Rust 生命周期、Bridge 和 Windows 发布配置；Windows 必须回归，不是仅 macOS 受影响。
- 当前仓库仅配置两个 Tauri updater Secrets，缺少 6 个 Apple Developer ID/公证 Secrets；Release 工作流会在 prepare 阶段 fail closed。

# Windows 0.1.23 Kimi 后端启动修复

## 任务契约

- 用户目标：修复本地 0.1.23 Windows 安装版启动 Kimi Code 0.34.0 后误报“后端异常”，并重新提供 NSIS/MSI 测试包。
- 直接交付物：Windows CMD shim 进程归属修复、安装状态探针统一、回归测试、0.1.23 本地 NSIS/MSI。
- 影响范围：Rust instance registry、安装环境探针、Windows API feature、变更记录和本地 bundle。
- 非目标：不改变 macOS/Unix 的严格直属 PID 规则，不降低 token/健康校验，不创建 release tag。
- 验收：真实 `cmd.exe → 子进程` 可识别；Rust 全量测试与 clippy 通过；本地 NSIS/MSI 构建成功。
- 保守假设：Kimi 的 npm/pnpm `.cmd` shim 是受支持的 Windows 安装形态；登记 PID 必须属于本次启动器进程树且记录时间不早于本次启动。

## Checklist

- [x] 从本机 app/backend 日志确认 Kimi 0.34.0 已 ready，但登记 Node PID 与 `.CMD` 启动 PID 不同。
- [x] Windows owned candidate 接受启动器进程树内的新登记 PID，其他平台保持 PID 精确匹配。
- [x] 安装探针复用 Kimi locator，消除 canonical `\\?\` CMD 路径误判。
- [x] 增加 matcher 回归与真实 Windows `cmd.exe → 子进程` 快照测试。
- [x] 完成 Rust 264 项测试与严格 clippy。
- [x] 重新构建 0.1.23 NSIS/MSI 并核对产物。

## Review

- 0.1.23 合并后的安全加固只接受 registry PID 等于 `Command::spawn()` PID；Windows `.cmd` 通过 `cmd.exe` 派生 Node，故健康服务被拒绝并在 15 秒后清理。
- 修复仍保留三道边界：进程必须属于本次启动器进程树、registry `started_at` 必须匹配本次启动时间、HTTP health 与 bearer auth 必须通过。
- 安装页原有重复 `--version` 探针不认识 canonical 扩展路径，现直接复用已经验证 `web --help` 的 locator。
- 本地关闭 updater artifact 后，0.1.23 NSIS/MSI 均构建成功；公开 Release 的 updater 签名配置未改变。

# macOS Kimi Code 版本检测与 native 升级修复

## 任务契约

- 用户目标：macOS 正确显示 Kimi Code 可升级版本，并将 native 0.34.0 实际升级到官方 0.35.0，而不是执行 `kimi upgrade` 后虚报成功。
- 直接交付物：跨平台统一安装探针、macOS 官方 manifest 下载与 checksum 升级器、严格版本复检/回滚、文档和回归测试。
- 影响范围：Rust install manager、macOS 升级 shell、Terminal 手动命令、macOS ADR/README、变更记录。
- 非目标：不自动执行远程 `curl | bash`，不停止外部复用实例，不改变 Windows 安装/升级任务。
- 约束：只接受官方 HTTPS manifest/binary；校验 64 位 SHA-256；参数分离传递；下载文件先验证版本，替换前备份，替换原子化，复检失败自动回滚。
- 验收：0.34.0 + latest 0.35.0 返回 available；用户确认后停止 owned backend；0.35.0 binary checksum/版本通过后替换；复检必须精确为 0.35.0 才成功并重启。

## Checklist

- [x] 确认 `kimi upgrade` 对 native macOS 只打印手动 install.sh 指引并以 0 退出。
- [x] 安装探针统一复用 `kimi_locator`，让 macOS `~/.kimi-code/bin/kimi` 进入版本检查。
- [x] 按官方 latest/manifest 下载匹配架构 binary，验证 SHA-256 和 `--version`。
- [x] 备份旧 executable、同目录 staged file 原子替换、复检失败恢复 `.bak`。
- [x] 手动“复制升级命令”同步为当前官方 install.sh 命令。
- [x] 完成 Windows Rust 全量、clippy、TypeScript、前端测试、安全 gate、生产构建和 bash 语法检查。
- [ ] 在 Apple Silicon macOS 构建 `.app` 并完成 0.34.0 → 0.35.0 真实 G3。

## Review

- 检测缺失不是 latest endpoint 问题，而是 macOS 安装探针仍使用 Windows `kimi.exe` 候选；统一 locator 后无需前端特殊分支。
- 上游 native 自更新契约已变化，退出码 0 只表示提示完成，不表示升级完成；现在以官方 manifest、checksum 和精确版本复检为唯一成功依据。
- T3 “采用平台边界”：保留 macOS 用户确认、Unix 进程组取消与 owned-only 后端停止；不执行下载脚本，不引入新依赖。
# 0.1.24 双平台过渡发布

## 任务契约

- 用户目标：将 Windows/macOS Kimi 修复合并到 `main`，版本号提升到 `0.1.24`，构建 Windows NSIS/MSI，并发布明确标注的未签名 macOS 过渡版。
- 直接交付物：`main` 合并与版本提交、Windows 本地 NSIS/MSI、`v0.1.24` tag 及同时包含 Windows/macOS 资产的 GitHub Release。
- 影响范围：版本元数据、Release workflow、macOS 发布 ADR/验证门禁与发布记录。
- 非目标：不伪造 Apple Developer ID 签名或公证结论；不取消 Tauri updater 签名校验；不扩展 Intel/Universal macOS。
- 验收：三处版本与 tag 均为 `0.1.24`；本地 Windows NSIS/MSI 构建成功；Release 顶部显示“⚠️ macOS 版本未签名”；macOS job 验证产物未代码签名，两端 updater `.sig` 与唯一 `latest.json` 仍存在。

## Checklist

- [x] 快进合并修复分支到本地 `main`。
- [x] 同步 package/Cargo/Tauri 版本到 `0.1.24`。
- [x] 将 ad-hoc/未签名 macOS 例外限定为 `v0.1.24`，并保留 updater 签名门禁。
- [x] 完成必要本地 gate 与 Windows NSIS/MSI 构建。
- [x] 修复 main CI 在 macOS 暴露的 stop endpoint 异步测试竞态。
- [x] 推送 `main` 并通过 Windows/macOS CI。
- [x] 推送 `v0.1.24`，确认 GitHub Release 工作流与资产。
- [ ] 用户在 Windows 安装包和 Apple Silicon Mac 上完成 G3 手工验证。

## Review

- 版本已同步到 `0.1.24`；Rust fmt/clippy/265 项测试、TypeScript、230 项前端测试、Updater manifest 测试和安全 gate 均通过。
- 本地已生成 `kimi sidekick_0.1.24_x64-setup.exe` 与 `kimi sidekick_0.1.24_x64_en-US.msi`，主程序 ProductVersion 为 `0.1.24`。
- Tauri `--no-sign` 会同时跳过 updater `.sig`，因此 Release 不使用该参数；macOS 改用官方支持的 `signingIdentity: "-"` ad-hoc identity，既不需要 Apple Secrets，也保留 Tauri updater 签名。
- main CI 八个 jobs 全部通过；macOS Go stop endpoint 竞态修复已由 runner 复核。
- Release workflow 四个 jobs 全部通过并正式发布；线上包含 NSIS、MSI、Windows updater `.sig`、macOS app updater、macOS updater `.sig`、DMG 与唯一 `latest.json`。
- `latest.json` 版本为 `0.1.24`，包含 `windows-x86_64` 和 `darwin-aarch64`；Release 顶部显示“⚠️ macOS 版本未签名”。

# DSH 主题同步与浏览器打开

## 任务契约

- 用户目标：DSH Web 跟随壳应用切换明暗主题，并出现在标题栏“在浏览器打开”菜单。
- 直接交付物：DSH 主题契约适配、可信运行 URL 复用、标题栏菜单项、回归测试与文档记录。
- 影响范围：Workspace Grid frame bridge、DSH service、ShellTitlebar、App wiring、相关测试和 DSH 当前事实文档。
- 非目标：不修改 DSH 自身持久化主题设置，不扩 generic external allowlist，不新增 Tauri command 或 DSH 多实例。
- 验收：明暗切换向 DSH frame 发出精确 origin 消息并切换其 dark selector；仅 running 精确 loopback URL 可由菜单打开；G0/G1、安全 gate 和生产构建通过。
- 保守假设：壳内 DSH 不使用历史 pane 独立主题；“在浏览器打开”是用户显式动作，不是加载失败自动 fallback。

## Checklist

- [x] 定位 DSH rc.6 的 `body[data-ds-dark-theme]` 权威契约。
- [x] 扩展现有 all-frames 主题 bridge 并让 DSH pane 跟随壳全局主题。
- [x] 提取 running 精确 loopback URL 校验并加入标题栏浏览器菜单。
- [x] 增加主题 bridge、DSH pane、URL fail-closed 与菜单回归测试。
- [x] 更新 README、架构事实和变更记录。
- [x] 完成 TypeScript、235 项前端测试、安全 gate、生产构建、Rust fmt/277 项测试和 diff 检查。
- [ ] 在 macOS WKWebView 与 Windows WebView2 真机确认视觉切换和系统浏览器启动。

## Review

- 根因是通用 frame bridge 已接收主题消息，但只应用 Kimi 的主题字段；补充 DSH 自身 selector 后无需改第三方 CSS 或 settings.yaml。
- 浏览器菜单只消费 Rust 当前 running 状态的精确 `127.0.0.1:<port>`，启动中、停止、崩溃或带路径/非 loopback URL 均禁用或拒绝。
- 技能 T3“采用平台能力”落实为复用系统浏览器 opener，并只精确覆盖 WebView 中不匹配的 DSH 主题默认。

# DSH 手动停止与崩溃恢复

## 任务契约

- 用户目标：DSH 只在关闭应用或控制中心显式关闭/停止时结束，同时停止或崩溃后无需切换开关即可恢复。
- 直接交付物：控制中心启动/重试动作、pane 按当前会话目录恢复、动作单飞、回归测试和新 macOS 测试包。
- 影响范围：DSH 设置面板、Workspace Grid 回调边界、App wiring、测试与完成度记录。
- 非目标：不把关闭 pane 重新绑定为停止后端，不自动重启 crashed 进程，不修改 Rust ownership 或持久化 schema。
- 验收：enabled + stopped/crashed 时出现可用恢复动作；pane 的“重试后端启动”实际调用 start 并携带该 pane 的最后工作区；重复点击不重复提交；G0/G1、安全 gate 与 macOS production build 通过。

## Checklist

- [x] 区分只读状态刷新与显式恢复启动回调。
- [x] 控制中心为 stopped/crashed 增加启动/重试，并复用生命周期互斥动作状态。
- [x] pane 恢复携带最后观测的会话工作区，缺失时回退默认工作区。
- [x] 增加控制中心启动单飞与 pane 工作区传递回归测试。
- [x] 完成 TypeScript、54 文件/256 项前端测试、182-command 安全 gate、生产构建与 macOS arm64 测试包复验。
- [ ] Windows 行为由用户按 G3 清单手测，不在本机结论中代填。

## Review

- 根因是旧 pane 按钮标为“重试后端启动”，实际只调用 `get settings/status`；控制中心停止后也没有启动入口，用户只能切换开关或新建 pane。
- 现在 toolbar 刷新仍是只读状态动作，空白/失败覆盖层才调用恢复启动；二者不再共用含义错误的回调。
- 新包为 `KickSide_0.2.0_macos_arm64_dsh-p0-recovery.zip`，SHA-256 `cc9219a061dd4b7b889a61daef5eaa1e1a759d23ae64e0e301a164ff3f7fef0e`；已包含 Node 20.12 最低能力 preflight、按原始字节有界校验的 production 页面身份 readiness、canonical 私有入口约束及 E-DSH-005 崩溃日志，同名旧包移到 `/tmp`，不会与当前测试基线混淆。

# README 双语重写与 GitHub 合并

## 任务契约

- 用户目标：以视频和四张实测图重写产品 README，中文为默认入口、英文可跳转，并把当前工作区发布并合并到 `main`。
- 直接交付物：中文 `README.md`、英文 `README_EN.md`、兼容跳转、稳定媒体资源、提交、现有 PR 更新与 `main` 合并。
- 影响范围：仓库入口文档、README 媒体、当前分支中已核对但尚未提交的 DSH/Kimi Web/桌面体验改动及其测试文档。
- 非目标：不创建新 Release 或 tag，不改应用版本，不把 README 重新设计成独立营销站点。
- 验收：双语入口和相对链接有效；README 与当前代码事实一致；本地完整门禁及新一轮 GitHub checks 通过；PR 合并到 `main`。

## Checklist

- [x] 核对视频、四张截图与当前产品事实。
- [x] 整理稳定媒体文件并完成中英文 README。
- [x] 完成文档链接、隐私与完整工程门禁。
- [x] 提交并推送当前完整工作区。
- [ ] 更新 PR，等待 GitHub checks 并合并至 `main`。

# v0.2.0 未签名 macOS 预览发布

## 任务契约

- 用户目标：发布 `v0.2.0` GitHub Release 与中文更新说明；macOS 继续采用未 Developer ID 签名、未公证的 Apple Silicon 安装包。
- 直接交付物：精确 tag 发布例外、accepted ADR、`release-notes-0.2.0.md`、Windows NSIS/MSI、macOS app/DMG、两端 updater 签名和唯一 `latest.json`。
- 影响范围：Release workflow、发布说明、macOS 发布决策与架构/验证文档、GitHub tag/Release。
- 非目标：不伪造 Apple Developer ID、notarization、stapling、Gatekeeper 或 Windows Authenticode 结论；不扩展 Intel Mac/Linux；不把未签名例外永久化。
- 验收：`main` CI 全绿后推送精确 `v0.2.0`；Release 顶部明确未签名/未公证；两平台构建成功且资产完整；失败时保持 draft；发布后核对 `latest.json` 双平台条目。

## Checklist

- [x] 核对版本、现有 Release workflow、签名 Secrets、远端 tag/Release 与 main CI。
- [x] 为精确 `v0.2.0` 建立 accepted 未签名预览例外，并保持 updater 签名 fail-closed。
- [x] 编写中文更新说明并接入 Release 创建流程。
- [x] 完成本地发布配置验证。
- [x] 提交发布准备并推送 `main`。
- [x] 等待 `main` CI 全绿后创建并推送 `v0.2.0` tag。
- [x] 等待 Release Actions 完成，核验安装包、签名、`latest.json` 与更新说明。
- [ ] Windows/macOS 最终安装包 G3 由真实平台继续补验；在此之前仅称预览发布。

## Review

- 发布准备提交 `ce00e7b` 的 main CI 8 个 jobs 全绿；annotated `v0.2.0` 精确指向该提交。
- Release workflow `31950715818` 四个 jobs 全绿，Draft 已自动发布为 Latest：`https://github.com/endearqb/kickside/releases/tag/v0.2.0`。
- Release 正文首行是未签名/未公证警告；8 个资产全部 uploaded 且带 GitHub SHA-256 digest，包括 Windows NSIS/MSI 及 `.sig`、macOS app updater/DMG 及 `.sig`、唯一 `latest.json`。
- `latest.json` 版本为 `0.2.0`，同时包含 `windows-x86_64` 与 `darwin-aarch64`，URL 均指向 `v0.2.0` 且签名非空。
- 当前完成状态是“未签名 macOS 预览版已发布”；最终安装器生命周期、真实 WebView 与辅助功能 G3 仍待用户在目标平台验证，不称生产就绪。

# Windows DSH npm 启动错误 193

## 任务契约

- 用户目标：修复 Windows 安装 DeepSeek Harness 时 npm 安装进程无法启动并返回 os error 193。
- 直接交付物：修正 Windows Node/npm 同工具链入口选择，补回归测试和工程记录。
- 影响范围：`nodejs_locator.rs`、Rust 测试、变更与经验记录。
- 非目标：不修改 DSH 固定版本、npm registry、安装目录、Tauri command 契约或跨平台架构。
- 验收：Windows 官方 Node 目录同时存在 `npm` 与 `npm.cmd` 时选择 `npm.cmd`；Rust G0/G1 通过。

## Checklist

- [x] 用用户日志锁定 npm spawn 阶段，并追踪 DSH install launcher 全链路。
- [x] 在本机官方 Node 目录复现无扩展名 `npm` 被优先发现。
- [x] Windows 候选收敛为 `npm.cmd`/`npm.exe`，保留非 Windows `npm` 行为。
- [x] 增加 `npm` 与 `npm.cmd` 共存的 Windows 回归测试。
- [x] 完成 Rust fmt、check、针对性测试与 285 项完整测试。
- [x] 使用包含修复的 Windows 打包版完成一次真实 DSH npm registry 安装验证。

## Review

- 根因不在 DSH 包或 registry，而在 sibling npm 的跨平台候选顺序：Windows 先命中 POSIX shim，绕过了既有 `npm.cmd` 安全 launcher。
- 修复只触及共享定位器和一个测试；已有 `node.exe + npm-cli.js`、canonical `cmd.exe` fallback 与私有 prefix 契约均保持不变。
- 完成状态：代码已验证到 G1，打包版真实下载与固定版本安装已通过；首次启动另暴露 Node verbatim 主模块路径问题并进入后续修复。

# Windows DSH Node verbatim 入口启动失败

## 任务契约

- 用户目标：修复 DSH 安装成功后在 Windows 以 `EISDIR: lstat 'C:'` 立即异常退出。
- 直接交付物：保持 canonical 越界校验，转换 Node 主模块 argv，增加回归测试并重建测试安装包。
- 影响范围：`dsh_manager.rs`、Rust 测试、Windows 本地测试包与工程记录。
- 非目标：不放宽私有安装根校验，不修改 DSH pin、持久化 schema、端口或生命周期契约。
- 验收：verbatim 入口不再传给 Node；286 项 Rust 测试通过；真实 DSH Web 返回 HTTP 200 与 `__DSH_BOOT__`；生产打包链最终复验。

## Checklist

- [x] 复现普通路径成功、`\\?\` 路径稳定触发同一 `EISDIR`。
- [x] 安全校验后转换本地盘与 UNC 的 Node argv 表示。
- [x] 增加 Windows 路径回归测试并通过 286 项 Rust 测试。
- [x] 用真实安装入口启动 DSH Web，确认 HTTP 200 和页面身份标记后完整停止。
- [x] 重新构建包含路径修复的 Windows NSIS/MSI 测试安装包。
- [ ] 安装新测试包并通过 Tauri 生产启动链复验。

## Review

- 根因是 Node 26 主模块解析与 Windows verbatim 路径不兼容，不是工作目录、DSH 配置或安装完整性问题。
- 修复只改变 Node argv 表示；canonical target 仍是唯一安全权威，未引入 fallback 或扩大信任边界。

# Windows 退出界面稳定与后端并行停止

## 任务契约

- 用户目标：退出时只保留关闭遮罩，删除随机提示、保留毫秒计时，并并行停止 DSH/Kimi。
- 直接交付物：退出锁、精简关闭卡片、并行停止 worker、回归测试与工程记录。
- 影响范围：React 主壳退出展示、Rust graceful exit、相关测试与变更记录。
- 非目标：不改变启动 prefill 提示、托盘策略、退出确认或 fail-closed 进程所有权规则。
- 验收：后端状态轮询不能在退出期间清空遮罩；关闭卡片无随机提示且持续计时；DSH/Kimi 同时开始停止；自动化通过并由 Windows 安装版复验。

## Checklist

- [x] 用代码与日志确认三段闪屏和串行耗时根因。
- [x] 锁定关闭遮罩并删除退出随机提示。
- [x] 并行停止 DSH 与 Kimi，统一处理两个结果。
- [x] 完成前端、Rust、安全门禁与生产安装包验证。
- [ ] Windows 安装版人工确认退出只显示一个遮罩。

## Review

- 关闭遮罩消失的直接原因是普通状态轮询在 DSH 停止、Kimi 仍 running 的窗口期清空 `shutdownProgress`；显式退出锁现已把关闭 lifecycle 设为唯一状态权威。
- DSH 与 Kimi 通过独立 worker 同时停止，两个结果均回收后才退出；任一失败仍撤销退出许可并保持应用运行。
- Node 24.19 下前端 54 文件/281 项、Rust 287 项、严格 clippy、安全门禁和 NSIS 构建均通过；Node 26.4 的 jsdom 全量测试会因实验性 global localStorage 覆盖失败，不属于产品代码回归。
- 新 NSIS 为 `KickSide_0.2.0_x64-setup.exe`，SHA-256 `676624F218CC5B7426EE7ED4F9A1A1EAAEB05B9E233E9600454E93289D1256BD`；仅剩 Windows 安装版真实退出视觉与耗时复验。

# v0.2.1 未签名 macOS 预览发布

## 任务契约

- 用户目标：版本提升至 `0.2.1`，推送 `main`，创建 GitHub Release tag 并触发跨平台 Actions 构建。
- 直接交付物：版本元数据、精确未签名例外、发布说明、main 提交、`v0.2.1` tag、Windows/macOS Release 资产与 `latest.json`。
- 影响范围：Release workflow、版本文件、发布文档、GitHub main/tag/Actions/Release。
- 非目标：不伪造 Apple Developer ID、公证、Gatekeeper、Windows Authenticode 或生产就绪结论。
- 验收：本地门禁和 main CI 通过后才推 tag；Release workflow 全绿并公开包含 NSIS/MSI、macOS app/DMG、两端 `.sig` 和双平台 `latest.json`。

## Checklist

- [x] 用户明确批准 `v0.2.1` macOS 未签名、未公证预览例外。
- [x] 同步三处版本号，新增 ADR/发布说明并迁移精确 tag 门禁。
- [x] 完成本地发布前门禁。
- [x] 提交并推送 `main`，等待 main CI 全绿。
- [x] 创建并推送 `v0.2.1` tag。
- [x] 等待 Release workflow 并核验公开资产和 `latest.json`。

## Review

- 发布候选提交 `6ea8bd7` 已推送 `main`，CI `31956793911` 的 8 个 jobs 全部成功；annotated tag `v0.2.1` 精确指向该提交。
- Release workflow `31957251104` 的校验、Windows、macOS 与 updater manifest 4 个 jobs 全部成功，Release 已公开并成为 Latest。
- Release 正文首行保留 macOS 未签名、未公证警告；8 个资产全部 uploaded、非零且带 SHA-256 digest。
- `latest.json` 为 `version=0.2.1`，仅包含 `windows-x86_64` 与 `darwin-aarch64`，下载 URL 精确指向 `v0.2.1`，两端 updater 签名均非空。
# Kimi Native LAN Access

## 任务契约

- 用户目标：回退 LAN Gateway，实现仅面向 KickSide-owned Kimi Code 的原生局域网开关。
- 直接交付物：非持久开关、事务式重启/回滚、registry 安全边界、私有 IPv4、按需 URL/QR、控制中心入口和验证文档。
- 非目标：DSH、Gateway sidecar、配对/Cookie/proxy、防火墙自动规则、持久可信网络。
- 验收：自动化门通过；Windows/macOS/移动真机 G3 未回填前只声明实现和对应 G1。

## Checklist

- [x] 删除旧 Gateway 代码、CI 与验证接线。
- [x] 接受 Native LAN ADR，旧 Gateway 文档降级为未来备选。
- [x] 实现 owned-only、running-session 拒绝、失败回滚与应用启动默认关闭。
- [x] 实现 external loopback / owned wildcard registry 分界。
- [x] 实现私有 IPv4 状态、按需完整 URL/QR 与 main-only command ACL。
- [x] 实现符合 DESIGN.md 的控制中心设置行与可信网络提示。
- [x] 完成全量 Shell G1。
- [ ] 完成 macOS 实际 owned runtime 开关与回滚 smoke。
- [ ] 用户完成 Windows G3，移动设备完成 LAN browser G3。

## Review

- 当前主路径不包含 DSH；任何恢复 Gateway 的工作必须重新立项。

# LAN 切换后 KimiCode pane 白屏

## 任务契约

- 用户目标：手机端 LAN 正常时，App 内 KimiCode pane 也必须在 Kimi 重启后恢复。
- 根因：独立 LAN controller 未刷新 Shell AppStatus，且 iframe key 未包含后端启动周期。
- 验收：切换成功和失败回滚都刷新 Shell；同 URL 的新 `startCycleId` 会强制 remount；前端 gate 与新 App 构建通过。

## Checklist

- [x] 通过真实 listener 与手机成功事实排除 LAN 服务端故障。
- [x] 将 LAN 切换完成通知接入 Shell `refreshCoreState`。
- [x] 将 `startCycleId` 纳入 Kimi workspace frame identity。
- [x] 完成前端 gate。
- [x] 重新构建本机测试 App。
- [ ] 用户复验开启/关闭 LAN 后 KimiCode pane 均恢复。

# Native LAN iframe CSP 适配

## 任务契约

- 用户目标：新建 KimiCode pane 在 LAN 模式也必须可用。
- 根因：Kimi 0.36.1 wildcard HTML 固定 `frame-ancestors 'self'`，拒绝 Tauri iframe；手机顶层访问不受影响。
- 验收：App 仅通过 loopback adapter 嵌入，手机仍直连 LAN；CSP 只放行 Tauri ancestor；Bearer/WS 与敏感日志边界保持；新包 WKWebView 复验通过。

## Checklist

- [x] 从真实 wildcard Kimi 响应头确认 CSP 阻断。
- [x] 排除 stale iframe：新 pane 同样白屏。
- [x] 实现 LAN-only、generation-owned loopback adapter 与受限 CSP 改写。
- [x] 脱敏 adapter 的 Authorization/Cookie/WS subprotocol 日志。
- [x] 完成 Rust 全量 gate（296 tests）。
- [x] 构建新测试 App。
- [ ] 用户复验 pane HTML、会话列表、prompt/stream、关闭 LAN 与 adapter 端口释放。

# LAN adapter prompt 超时

## 任务契约

- 用户目标：修复 pane 可见但发送 prompt 30 秒超时。
- 根因：串行 proxy loop 被首条 WebSocket tunnel 永久占用。
- 验收：WS 有界并发且不阻塞 prompt HTTP；双 pane 可同时收 stream；全量 gate 和新包通过。

## Checklist

- [x] 用现场 socket 映射确认 adapter accept 堆积、上游连接未建立。
- [x] 将 WS tunnel 分离为最多 32 条并发 worker，并确保退出回收计数。
- [x] 完成 Rust gate并构建新 App。
- [ ] 用户复验 prompt receipt、stream 与双 pane。

# LAN adapter 流式输出锁饥饿

## 任务契约

- 用户目标：手机与 App pane 都必须实时显示同一 Kimi assistant stream。
- 根因：tiny_http upgrade stream 的共享 Mutex 在阻塞 client read 期间不释放，upstream delta 无法写回 WebKit。
- 验收：client→Kimi 与 Kimi→client 可同时推进；连接/header/body framing 有硬边界；Rust 全量 gate 与新 App 构建通过。

## Checklist

- [x] 根据手机正常、App 停滞和 tunnel 锁作用域定位根因。
- [x] 改为拥有并克隆 loopback TCP socket 的 full-duplex tunnel。
- [x] 增加同时双向复制回归测试和 HTTP framing fail-closed 边界。
- [x] 完成 Rust fmt/check/strict clippy/full 298 tests。
- [x] 构建独立、ad-hoc 签名的 arm64 测试 App。
- [ ] 用户复验长回复、双 pane、断线重连。

# macOS LAN adapter WebSocket EAGAIN

## 任务契约

- 用户目标：消除新包持续出现的 `WebSocket error`。
- 根因：macOS accepted socket 继承 nonblocking listener，空读返回 EAGAIN 后 tunnel 误关闭 upstream write。
- 验收：accepted socket 在 worker 前恢复 blocking；nonblocking-listener tunnel 回归通过；新 App 不再重复连接后立即关闭。

## Checklist

- [x] 由现场日志确认 Upgrade 成功、固定首帧后关闭与 os error 35。
- [x] accepted socket 显式恢复 blocking mode。
- [x] 双向回归覆盖 nonblocking listener 的生产形态。
- [x] 完成全量 Rust gate和新 App build。
- [ ] 用户复验 WebSocket 稳定连接与流式输出。
