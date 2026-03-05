# Kimi Shell 版本更新说明

版本：`0.0.5`  
发布日期：`2026-03-05`

## 本次更新重点

本版本聚焦 `task0305-1` 的两期交付，完成“右键稳定性 + Session 自动化 + 关闭体验与外链桥接”。

## 变更详情

1. 右键链路稳定性与自愈
- 启动时自动检测并修复右键注册表缺失/漂移（无需手动先点“启用”）。
- 文件与目录右键命令模板统一校验，状态提示可明确到“缺少哪个键/哪条命令漂移”。

2. 打开请求解析与可观测性增强
- `open_request` 增加“参数非空但无可执行请求”的诊断日志。
- `open-dir/open-files` 成功后会写入 workspace bootstrap 队列，供后续 session 自动化使用。

3. iframe 外链桥接
- 在嵌入的 Kimi Web 中拦截 `<a>` 点击与 `window.open` 外链。
- 外链通过壳层转交系统默认浏览器打开，避免应用内阻塞或白屏感知。

4. Session/工作区自动化（Phase 2）
- 新增 `workspace_session` 服务：轮询 `/api/sessions/`，维护 active session 快照。
- `open-dir/open-files` 后自动 bootstrap 目标工作区对应 session（创建/选择）。
- 注入会话桥接逻辑：捕获 session stream 路由模板，并支持 `navigate_session` 指令跳转。
- prefill 发送时机优化为“等待 session 导航完成后优先发送”，超时会给出可诊断反馈。

5. 关闭体验优化
- Windows 下系统命令改为无窗执行，关闭时不再出现终端闪窗。
- 新增 `shutdown-progress` 事件与前端关闭进度覆盖层，关闭过程可视化。

6. 状态模型扩展
- `AppStatus` / 前端 TS 类型新增：
  - `activeSessionId`
  - `activeSessionWorkDir`
  - `sessionSource`
- 标题栏在 workspace 页面优先显示 `activeSessionWorkDir`，无值时回退 `effectiveWorkDir`。

## 验证结果

- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（27/27）。
- `pnpm -C apps/kimi-shell build` 通过。
- NSIS 安装包构建成功：
  - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.5_x64-setup.exe`

## 升级后建议

1. 安装 `0.0.5` 后优先验证：目录右键、文件右键、重复右键文件三种场景。
2. 在 Kimi Web 内点击外链确认会拉起系统浏览器。
3. 关闭应用确认出现关闭进度提示且无终端闪现。
4. 切换 sidebar session，确认标题栏工作区可跟随更新。
