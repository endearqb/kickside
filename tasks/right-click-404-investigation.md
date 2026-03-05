# 右键文档打开 404 调查与修复

更新时间：2026-03-05

## 1. 现象

- 目录右键打开（`--open-dir`）正常。
- 文档/文件右键打开（`--open-files`）在应用内 workspace 侧出现 404。
- 问题稳定出现在“文件右键链路”，而非主窗口白屏链路。

## 2. 与白屏问题分流

- 白屏文档 `tasks/white-screen-investigation.md` 关注的是主窗口启动期 `about:blank` 导航提交问题。
- 本问题属于 Explorer 右键命令 + CLI 参数解析 + 会话工作目录切换链路，已独立处理。

## 3. 根因归纳（本轮）

1. 右键菜单“已启用”判定过于宽松
- 之前只检查注册表键是否存在，不校验命令值是否仍与当前版本一致。
- 若用户机器上残留旧命令（尤其文件项 `--open-files "%1"` 旧模板），UI 仍会显示“已启用”，但实际执行链路可能偏离预期。

2. `--open-files` 参数解析鲁棒性不足
- 旧实现只做基础字符串切片，缺少对 `--` 字面量、`file:///`、Shell 噪声参数的规范化处理。
- 当没有有效文件时缺少安全回退策略与结构化错误输出，排障信息不足。

## 4. 本轮修复落地

### 4.1 右键菜单命令一致性校验

- 文件：`apps/kimi-shell/src-tauri/src/context_menu.rs`
- 变更：
  - 新增命令模板构造函数，统一三条命令：
    - 目录背景：`--open-dir "%V"`
    - 目录：`--open-dir "%1"`
    - 文件：`--open-files -- "%1"`
  - `status` 从“仅键存在”升级为“键存在 + 命令值匹配预期”。
  - 发现命令漂移时：`enabled=false`，并通过 `message` 返回“请点击启用重新写入”提示。
  - `enable` 每次全量重写命令值，确保旧值被覆盖。

### 4.2 `open_request` 解析重构（规范化 + 分类）

- 文件：`apps/kimi-shell/src-tauri/src/open_request.rs`
- 变更：
  - 解析入口增加规范化：去空、剔除常见噪声参数（`/embedding`、`/prefetch:*`）。
  - 支持 `file:///...` 路径解析。
  - 支持 `--open-files -- <path...>` 字面量模式（保留 `--` 后的参数）。
  - 显式 `--open-files` 增加安全回退：
    - 有有效文件 -> `OpenFiles`
    - 无文件且仅 1 个有效目录 -> 自动降级 `OpenDir`
    - 其余 -> 结构化错误（包含 `first_invalid_token` 等字段）
  - startup / forwarded 请求增加解析日志：记录 `args + cwd + result`，便于现场复盘。

## 5. 测试与验证（本轮）

- Rust 单测新增覆盖：
  - `open_request`：`file:///`、literal `--`、Shell 噪声参数、单目录降级、结构化错误字段。
  - `context_menu`：命令构造与匹配（空格路径、引号路径）。
- 关键回归命令：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml open_request -- --nocapture`
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml context_menu -- --nocapture`
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`

- 结果：
  - `open_request` 相关单测通过（8/8）。
  - `context_menu` 相关单测通过（3/3）。
  - 全量 Rust 单测通过（23/23）。
  - 本机命令链路抽样验证：
    - `appskimi-shell.exe --open-dir <dir>`：`app.log` 出现 `result=open_dir` 与 `received open-dir request`。
    - `appskimi-shell.exe --open-files <file>`：`app.log` 出现 `result=open_files:1` 与工作区创建日志。
    - `appskimi-shell.exe --open-files -- <file>`：`app.log` 出现新语法解析成功日志。
    - 缺失文件场景：`app.log` 出现结构化错误，包含 `first_invalid_token`。

- 待目标机手工验收：
  - 从真实 Explorer 右键触发文件/文档打开，确认应用内不再出现 404。
  - 若状态提示“命令漂移”，点击“启用右键菜单”后重试右键链路。

## 6. 预期结果

- 目录右键与文件右键都稳定进入正确工作目录/工作区，不再出现文档右键 404。
- 诊断页若检测到旧版命令漂移，会明确提示“重新启用以修复”。
- 若参数异常，`app.log` 能提供结构化解析证据，避免“看起来已执行但无可追踪信息”。

## 7. 回归修复补充（2026-03-05）

- 用户回归反馈：安装后“目录右键可触发，文件右键不触发”。
- 补充修复：
  1. 文件命令模板由 `--open-files -- "%1"` 回调为 `--open-files "%1"`（更保守的 Explorer 兼容写法）。
  2. 文件右键注册新增 `AllFilesystemObjects\\shell\\KimiWebShell` 兜底键，与 `*\\shell\\KimiWebShell` 同步写入。
  3. `open_request` 保持对 literal `--` 兼容，同时增强“不带 literal 但文件名以 `--` 开头”场景容错。
- 发布状态：已打包 `0.0.4` 安装包用于回归验证。
