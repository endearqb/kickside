# task0305-1 调查与修复记录

更新时间：2026-03-05

## 1. 问题范围

- 文件右键打开链路不稳定（目录右键可触发，文件右键不触发或失败）。
- 进入 Kimi Web 后 session / 工作区联动不足（标题栏与实际 session 工作区不一致）。
- iframe 内外链跳转被拦截（未稳定外开系统浏览器）。
- 关闭应用存在终端闪现且缺少关闭进度可视化。
- prefill 文本与“新 session 首条 prompt”链路未完全对齐。

## 2. 现场事实（本机）

- 注册表存在：
  - `HKCU\\Software\\Classes\\*\\shell\\KimiWebShell\\command = "... --open-files -- \"%1\""`
  - `HKCU\\Software\\Classes\\Directory\\shell\\KimiWebShell\\command = "... --open-dir \"%1\""`
  - `HKCU\\Software\\Classes\\Directory\\Background\\shell\\KimiWebShell\\command = "... --open-dir \"%V\""`
- 注册表缺失：
  - `HKCU\\Software\\Classes\\AllFilesystemObjects\\shell\\KimiWebShell\\command`
- `app.log` 可见 `open-dir` 解析日志，但同批次未见稳定 `open-files` 解析日志。

## 3. 根因假设

1. 文件右键入口对象类型覆盖不完整（缺 `AllFilesystemObjects`）。
2. 文件命令模板与状态检测/修复策略之间存在漂移，导致“看似启用、实际未命中”。
3. iframe 内未统一接管外链行为（`<a>` 与 `window.open`）。
4. 关闭流程使用 `taskkill` 时未强制无窗，且前端无关闭阶段反馈。
5. session 自动化链路缺失，导致工作区与会话状态分离。

## 4. 修复策略

- Phase 1：稳定性优先（右键自愈、外链外开、关闭体验、诊断日志）。
- Phase 2：自动化增强（session 轮询、工作区 bootstrap、session 导航桥、prefill 首条 prompt 协同）。

## 5. 验证清单

- Rust：`context_menu` / `open_request` / `workspace_session` 单测。
- 回归：`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`。
- 前端：`pnpm -C apps/kimi-shell build`。
- 手工：目录/文件右键、外链外开、关闭可视化、session 工作区跟随。

## 6. 结论

- 待本轮代码实施与验证后回填。
