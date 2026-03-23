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
