# Continued From Previous Todo

- [x] 将 `apps/kimi-im-bridge` 的配置、领域模型、store 和 admin payload 从单平台单实例升级为多 connector，并补齐 legacy 配置迁移。
- [x] 将 `apps/kimi-shell/src-tauri` 的 bridge 类型、设置存储、命令和状态拼装升级为 connector 模型，并新增 connector CRUD / secret mask 命令。
- [x] 将 `apps/kimi-shell` 前端控制器和控制中心 Bridge UI 改成完整 connector 管理：列表、详情、凭证、运行态、bindings / approvals 展示 connector 归属。
- [x] 为多 connector 补充 Go / Rust / 前端构建级验证与关键回归测试。

## Validation

- [x] 运行 `go test ./...`（`apps/kimi-im-bridge`，至少覆盖 config/store/app/admin/adapters 相关多 connector 场景）。
- [x] 运行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`。
- [x] 运行 `pnpm -C apps/kimi-shell build`。

## Retrospective

- [x] 记录为什么 bridge 的运行时主身份必须从 `platform` 提升为稳定 `connectorId`，以及哪些 legacy 字段继续保留作兼容。

### Notes

- [x] sidecar 里 `platform` 只适合表达“平台语义”，一旦进入 checkpoint、binding、approval、delivery、turn 这些需要长期追踪和持久化的链路，主键必须升级成稳定 `connectorId`，否则同平台多机器人会串线。
- [x] 为了不打断现有 shell/Tauri 侧的单实例路径，这一轮在 Go 侧保留了少量兼容入口：legacy `channels` / 顶层 secrets 仍可读，store 也允许“单 connector 场景下用 platform 名命中默认 connector”。

## Control Center Overview + Bridge Robot View (2026-03-23)

### Plan

- [x] 调整控制中心概览“待处理与提醒”逻辑：有阻塞时只显示阻塞列表，无阻塞时只显示 Agent 提示卡。
- [x] 精简概览区文案与优先任务卡片：移除“当前没有阻塞项 / 可以继续推进”说明，以及“打开技能中心”卡片中的 meta 文案。
- [x] 将 IM Bridge 主卡改成标题栏 `总览 / 飞书机器人` 双视图切换，默认进入总览。
- [x] 删除 Bridge 技能跟随模式，改为 bridge-ops 首次自动安装到全局技能目录 `~/.config/agents/skills/bridge-ops`。
- [x] 为飞书 connector 增加每机器人独立的默认工作目录和“启动时新建对话”设置，并让旧全局字段迁移到飞书 connector。
- [x] 新增飞书机器人卡片视图：显示状态与错误摘要，支持机器人启用、自动审批、启动时新建对话、默认工作目录、保存并重启、连接与凭据、高级运行面板。
- [x] 将“连接与凭据”“高级运行面板”收口为按 connector 作用域的弹窗，不影响现有全局 Bridge 启停语义。

### Validation

- [x] 运行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`，确认 Bridge settings/store/manager 兼容迁移通过。
- [x] 运行 `go test ./...`（`apps/kimi-im-bridge`），确认 shell 侧启动参数调整未破坏 sidecar 契约。
- [x] 运行 `pnpm -C apps/kimi-shell build`，确认控制中心与 Bridge 双视图改动可干净构建。
- [ ] 手工检查概览页无阻塞时只显示 Agent 提示、有阻塞时不显示 Agent 提示。
- [ ] 手工检查 IM Bridge 标题栏双视图切换、飞书机器人卡片保存、connector 凭据弹窗、运行面板弹窗的基本链路。

### Retrospective

- [x] 记录本轮概览精简与 Bridge 机器人化视图暴露出的全局/connector 配置边界，以及 legacy `skillsMode` 的最终清理点。

### Notes

- [x] Bridge 的“应用启动自动拉起”继续保留在全局 `autoStart`，而机器人是否参与运行统一落在 connector 级 `enabled`；这样总览和机器人卡片的职责边界更清晰，不会再出现两个语义重复的“自动启动”开关。
- [x] legacy `skillsMode` 仍可从旧配置读取，但归一化后固定为 `Disabled` 且保存时不再回写；真正的 `bridge-ops` 目录来源已经收口到用户全局技能目录，避免默认工作目录切换带来的隐式副作用。

## Rounded App Icon Regeneration (2026-03-23)

### Plan

- [x] 新增本地图标母版生成脚本：基于 `apps/kimi-shell/src-tauri/icons/moonki.png` 产出圆角透明外轮廓的 `1024x1024` 母版 PNG。
- [x] 用新母版统一重生成 `apps/kimi-shell/src-tauri/icons` 下 Tauri/Windows 所需的多尺寸图标资源，保持现有文件名与打包入口不变。
- [x] 补充可复用的执行说明，让后续替换源图时可以重复使用同一流程。

### Validation

- [x] 运行母版生成脚本，确认输出文件存在且为 `1024x1024` PNG。
- [x] 运行 `pnpm --dir apps/kimi-shell tauri icon <master-png>`，确认 `icon.ico`、`icon.icns`、`32x32.png`、`128x128.png`、`128x128@2x.png` 与 `Square*Logo.png` 已更新。
- [x] 检查 `16/24/32/48/64/128/256` 缩略尺寸，确认图形未贴边、月牙尖端与 `K` 仍可辨识。
- [ ] 运行 `pnpm --dir apps/kimi-shell tauri build`，验证打包产物表面图标；当前被工作区里既有的 TypeScript 构建错误阻塞，未能完成。

### Retrospective

- [x] 记录本轮圆角图标方案对 Windows 多表面图标一致性和后续维护流程的约束。

### Notes

- [x] 图标维护流程固定为“两步”：先运行 `apps/kimi-shell/scripts/generate_rounded_icon.ps1` 生成 `moonki-rounded-master.png`，再运行 `pnpm --dir apps/kimi-shell tauri icon src-tauri/icons/moonki-rounded-master.png` 批量覆盖各平台图标资源。
- [x] Windows 图标一致性不能只看 `icon.ico`；本轮同步更新了 `bundle.icon` 引用的 PNG、`Square*Logo.png`、`StoreLogo.png` 以及移动端衍生资源，避免打包后不同表面出现新旧图标混用。
- [x] `pnpm --dir apps/kimi-shell tauri build` 当前被现有前端类型错误阻塞：`src/App.tsx` 缺少 `ControlCenterViewProps` 所需回调，`src/features/control-center/ControlCenterView.tsx` 仍有 `skillsMode` 类型不匹配与未使用声明，需先修复这些与本次图标无关的问题后再做安装器/快捷方式实机验收。

## IM Bridge 总览卡片化 + 运行面板裁切修复 (2026-03-24)

### Plan

- [x] 为 IM Bridge 总览补充简洁机器人卡片列表，保留全局状态与主操作。
- [x] 为机器人卡片增加即时生效的启用 switch，并在控制器中封装保存/必要重启/刷新/失败回滚。
- [x] 将 Bridge 二级弹窗改为 portal 渲染，并补齐运行面板滚动与高度链，修复遮挡裁切。
- [x] 运行 `pnpm -C apps/kimi-shell build` 做静态验证，并补充回顾记录。

### Validation

- [x] 总览可展示 0/1/多机器人卡片，且顺序稳定。
- [ ] 机器人主开关在 Bridge 停止/运行两种状态下都按预期即时生效。
- [ ] 高级运行面板在控制中心全屏与工作区 modal 两种模式下都不再被裁切，内容可滚动到底。
- [x] 运行 `pnpm -C apps/kimi-shell build`。

### Retrospective

- [x] 记录本轮对“总览即时操作”和“二级 modal portal 化”的边界经验。

### Notes

- [x] 总览里的即时开关必须拥有独立的保存/重启/回滚链路；否则它会退化成“看起来像 switch，实际上还是草稿表单”的伪即时操作。
- [x] 控制中心这种“modal 里再开 modal”的结构，不能只靠提高 `z-index` 解决遮挡；只要外层存在 `overflow`、滤镜或独立 containing block，就应优先用 portal 把二级弹窗提升到 `document.body`。

## Kimi Code 鉴权配置定位 (2026-03-24)

### Plan

- [x] 找到控制中心或运行时里与 Kimi Code / provider / config center 相关的配置入口与保存命令。
- [x] 追踪 Tauri/Rust 侧如何读取、落盘、传递这些配置，确认优先级是环境变量、配置文件还是运行时参数。
- [x] 核对当前仓库和本机默认配置目录中可能实际生效的文件位置，定位“当前 Kimi Code 实际读的是哪份鉴权配置”。
- [x] 输出结论和排查建议，并把结果记录回本节。

### Validation

- [x] 至少给出一条从 UI/命令入口到最终配置文件或环境变量的完整调用链。
- [x] 至少给出一个本机可直接检查的绝对路径或命令，帮助确认当前生效配置。

### Retrospective

- [x] 记录这次定位里发现的配置优先级或多处配置源带来的混淆点。

### Notes

- [x] 控制中心 `Provider API` 面板通过前端 `handleOpenConfigCenterModal -> invoke("load_kimi_cli_config_center")` 读取配置，保存时走 `invoke("save_kimi_cli_config_center")`；Rust 侧对应 `lib.rs -> backend_manager.rs`。
- [x] `backend_manager::resolve_kimi_config_dir()` 直接把 Kimi CLI 配置目录解析为用户主目录下的 `~/.kimi`，当前实现没有额外的“自定义 config path”旁路；配置文件固定为 `~/.kimi/config.toml`。
- [x] `spawn_backend_process()` 启动 `kimi web` 时只注入 `PYTHONIOENCODING` / `PYTHONUTF8`，没有单独注入 API key 或 base URL；因此鉴权仍由 `kimi.exe` 自己按继承环境变量 + `~/.kimi/config.toml` 决定。
- [x] 当前本机 `%APPDATA%\\com.kimi.shell\\settings.json` 中 `kimiPath` 为 `null`，所以桌面壳通过 `which::which("kimi")` / PATH 定位可执行文件；本机实际命中 `C:\\Users\\endea\\.local\\bin\\kimi.exe`。
- [x] 当前 shell 进程里 `KIMI_PROVIDER`、`KIMI_API_KEY`、`MOONSHOT_API_KEY`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`ANTHROPIC_API_KEY`、`AZURE_OPENAI_API_KEY`、`AZURE_OPENAI_ENDPOINT` 都未设置，因此没有环境变量覆盖，实际生效配置来自 `C:\\Users\\endea\\.kimi\\config.toml`。
- [x] 本机 `C:\\Users\\endea\\.kimi\\config.toml` 存在且包含顶层 `provider = "kimi-for-coding"`、`model = "kimi-for-coding"`，同时定义了 `[providers.kimi-for-coding]` 与 `[providers."managed:kimi-code"]`，两者都指向 `https://api.kimi.com/coding/v1`；若出现 `401 Invalid Authentication`，应优先检查这份文件里对应 provider/service 的 `api_key` / oauth 条目。
- [x] 这类问题最容易混淆的点不在桌面壳自己的 `settings.json`，而在“shell 只负责启动 `kimi.exe`，真正的 provider 凭证优先级由 `kimi.exe` 继承环境变量再回落到 `~/.kimi/config.toml`”。

## Bridge-ops `summary` 缺失兼容修复 (2026-03-24)

### Plan

- [x] 在 `bridge_ops.ps1` 中新增可选字符串属性读取 helper，兼容缺失 `summary` 字段。
- [x] 用 helper 替换 `Find-SessionCandidates`、`list-sessions`、`switch-session` 中对 `summary` 的直接访问。
- [x] 运行 PowerShell 严格模式最小复现和脚本加载校验，确认缺失 `summary` 时不再抛错。

### Validation

- [x] 严格模式下直接访问缺失 `summary` 成员仍会复现原始错误，helper 路径返回空字符串。
- [x] `bridge_ops.ps1` 可被 PowerShell 正常加载，修改后无语法错误。
- [x] 缺失 `summary` 的 session 对象可完成候选匹配、`list-sessions` 输出和 `switch-session` 歧义候选输出。
- [x] 使用本机真实 `bridge_auth_file` 实跑 `list-sessions`，确认 `/api/v1/sessions` 在缺失 `summary` / `sessionState` / 个别缺失 `workDir` 时脚本仍可成功返回。

### Retrospective

- [x] 记录本轮对 Bridge Admin API 可选字段兼容边界的经验。

### Notes

- [x] Bridge Admin API 的 session payload 不能假设前端展示字段恒定存在；在当前环境里，`summary` 与 `sessionState` 全量缺失，且有个别 session 连 `workDir` 也缺失，脚本层必须把这些字段当作可选值处理。
- [x] 这类 PowerShell 运维脚本在 `Set-StrictMode -Version Latest` 下会把“缺少字段”的兼容问题立刻升级成运行时异常；对外部 JSON 动态对象的可选字段读取应统一经由 helper，避免同类问题在列表、匹配、歧义输出、后续 patch body 里反复出现。

## 飞书机器人自助开通 (2026-03-24)

### Plan

- [x] 在 `apps/kimi-shell/src-tauri` 新增飞书 onboarding 状态机，覆盖 init / begin / poll、内存会话、成功写入 connector secrets、成功后重启 bridge。
- [x] 新增 Tauri 命令与前后端类型：启动、查询状态、取消飞书 onboarding。
- [x] 在控制中心现有飞书机器人“连接与凭据”区域加入自助开通 UI：二维码/链接、轮询状态、失败重试、成功摘要，并保留手动凭据输入。
- [x] 运行 Rust / 前端构建级验证，补充回顾与结果记录。

### Validation

- [x] 运行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`。
- [x] 运行 `pnpm -C apps/kimi-shell build`。
- [ ] 手工检查飞书机器人未配置凭据时可进入自助开通流，成功后掩码与 bridge 状态刷新。
- [ ] 手工检查已有凭据场景下，手动保存入口与高级运行面板不回归。

### Retrospective

- [x] 记录飞书自助开通与现有 connector/config 存储边界的经验。

### Notes

- [x] 飞书自助开通不应再引入第二套 secrets 存储；最终写回仍必须复用现有 connector secrets 文件，否则“自助创建”和“手动填写”会彼此漂移。
- [x] 手动凭据保存链路若按“有输入字段就整体覆盖 feishu secrets”处理，会误清空已有 `verificationToken/encryptKey`；这一轮已顺手收敛成“仅覆盖本次显式输入字段”的合并语义。
- [x] 这次开通流只扩展 connector onboarding，不触碰 `kimi-im-bridge` 现有 binding/session 语义；这样成功后首次飞书消息仍沿用当前自动 binding 主链路，影响面最小。

## 控制中心去套娃弹窗 (2026-03-24)

### Plan

- [x] 将控制中心深任务状态从多个 `xxxOpen` 布尔值收敛成统一的 `activeControlTask` / payload。
- [x] 把配置中心、安装流、Bridge 详情和 Skill Git 导入从二级 modal 改造成控制中心内容区内任务页。
- [x] 统一 `Esc` / 遮罩点击 / 未保存拦截逻辑，确保工作区模式下只保留一个控制中心 `dialog`。
- [x] 运行前端构建验证，并记录回顾与剩余手工验证项。

### Validation

- [x] 运行 `pnpm -C apps/kimi-shell build`。
- [ ] 手工检查工作区模式打开控制中心后，进入配置中心 / 安装与升级 / Bridge 详情 / Skill Git 导入时页面内不再出现第二层 dialog。
- [ ] 手工检查有未保存配置时，`Esc`、返回和遮罩点击不会直接丢失修改。

### Retrospective

- [x] 记录本轮关于“控制中心总览层”和“深任务承载层”边界的经验。

### Notes

- [x] 控制中心需要区分两种关闭语义：`Esc` / 返回属于“退一层任务导航”，而显式关闭按钮或遮罩点击属于“关闭整个控制中心”；如果把两者混成同一个动作，单层任务面会重新退化出 modal 套娃感。
- [x] 将二级 modal 改成内容区任务面时，最稳的做法不是把旧组件硬塞进主页面，而是先收敛 controller 的任务状态，再把原 modal body/footer 抽成可嵌入内容组件；这样焦点、遮罩和未保存拦截才有单一真相源。

## 飞书创建机器人前自动保存 connector (2026-03-24)

### Plan

- [x] 复用 `useShellController` 现有 `saveBridgeSettingsInternal()`，暴露给控制中心作为统一的 bridge settings 落盘入口。
- [x] 调整 Feishu 官方流程“创建机器人”动作：若当前 connector 未持久化或 bridge settings 有未保存改动，先自动保存，再启动 onboarding。
- [x] 区分“自动保存失败”和“onboarding 启动失败”的反馈，避免继续触发后端 `未找到 connector`。
- [x] 运行 `pnpm -C apps/kimi-shell build` 验证，并补充本节回顾与结果。

### Validation

- [ ] 默认 Feishu connector 直接点击“创建机器人”仍可正常进入 onboarding。
- [ ] 新增 Feishu connector 且未手动保存时，点击“创建机器人”会先自动保存再启动 onboarding。
- [ ] 自动保存失败时停留在当前任务面，并给出明确错误，不继续请求 onboarding。
- [x] 运行 `pnpm -C apps/kimi-shell build`。

### Retrospective

- [x] 记录这次修复里“前端草稿 connector”和“后端持久化 connector”边界的经验。

### Notes

- [x] Feishu 官方 onboarding 这类依赖后端持久化配置的动作，不能直接消费前端草稿里的 `connectorId`；只要入口允许从草稿卡片直接发起，就必须先显式落盘或先做“已持久化”校验，否则后端严格查找会稳定报 `未找到 connector`。

## 飞书机器人页保存入口与删除确认优化 (2026-03-24)

### Plan

- [x] 将飞书机器人页每张卡片内的“保存并重启 / 保存设置”收敛到 Bridge 标题栏统一入口。
- [x] 修正飞书机器人配置页在控制中心页面与 modal 场景下的横向溢出，确保不再出现横向滚动条。
- [x] 为“删除机器人”补充确认弹窗；确认后自动执行删除、保存并在 Bridge 运行中时重启。
- [x] 运行 `pnpm -C apps/kimi-shell build` 验证，并记录结果。

### Validation

- [ ] 飞书机器人页只保留标题栏统一保存入口，单卡片不再出现独立保存按钮。
- [ ] 飞书机器人配置页在窄窗口与 modal 中不再出现横向滚动条。
- [ ] 点击“删除机器人”会先确认；确认后完成删除保存，并在 Bridge 运行时自动重启。
- [x] 运行 `pnpm -C apps/kimi-shell build`。

### Retrospective

- [x] 记录这次整理里“全局保存动作”和“单机器人动作”边界的经验。

### Notes

- [x] 飞书机器人页里的“保存/重启”属于整个 `bridgeSettings` 草稿的统一提交动作，不应伪装成单卡片局部保存；真正适合留在卡片里的应该是“连接与凭据 / 高级运行 / 删除”这类明确作用于单个机器人且可独立理解的动作。
- [x] 单层控制中心并不排斥危险操作确认；像“删除机器人”这种会立即改写持久化配置的动作，保留轻量确认弹窗比继续堆卡片内次级按钮更清晰，也更符合先确认再执行保存/重启的心智模型。

