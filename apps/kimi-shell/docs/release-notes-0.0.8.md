# Kimi Shell 版本更新说明

版本：`0.0.8`  
发布日期：`2026-03-06`

## 本次更新重点

本版本聚焦控制中心交互重构，完成“状态栏弹窗入口 + 按需探测触发”。

## 变更详情

1. 控制中心入口调整
- 工作区标题栏左上角不再保留控制中心按钮。
- 控制中心入口移动到底部状态栏左侧，位于运行状态标签前，使用设置图标打开。

2. 控制中心改为弹窗打开
- 在工作区中主动打开控制中心时，不再切到整页视图，而是在当前页面上方弹出控制中心弹窗。
- 弹窗支持右上角关闭、点击遮罩关闭和 `Esc` 关闭。

3. Dashboard 与 Full 形态分层
- 弹窗首次打开时默认只显示 Dashboard 主内容，不显示 sidebar。
- 点击 Dashboard 中的“进入引导配置 / 进入核心诊断 / 进入路径与菜单 / 进入最近日志”后，才切换到带 sidebar 的完整控制中心形态。

4. 探测改为点击触发
- 进入控制中心时不再自动执行 onboarding、diagnostics、context menu、install probe、config center 等探测或加载。
- 各类探测改为在用户点击对应入口、对应面板或“重新检测”按钮时再执行。
- 安装依赖与安装 Kimi 后，仅刷新安装相关状态，不再额外触发控制中心诊断刷新。

5. 兼容现有阻断态
- `missing_kimi`、`crashed`、首次 onboarding 这类阻断场景，仍保留现有全屏控制中心模式。
- `#/onboarding`、`#/diagnostics`、`#/logs_paths` 路由仍可进入全屏控制中心对应位置。

## 验证结果

- `pnpm -C apps/kimi-shell build` 通过。
- `pnpm -C apps/kimi-shell tauri build --bundles nsis` 通过。
- NSIS 安装包构建成功：
  - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.8_x64-setup.exe`

## 升级后建议

1. 在工作区页面确认状态栏左侧出现设置按钮，且点击后默认打开 Dashboard 弹窗。
2. 确认弹窗初始不显示 sidebar，点击模块入口后才切换为完整控制中心。
3. 手工确认打开弹窗本身不再触发明显卡顿，进入具体模块后才执行对应探测。
4. 验证 `missing_kimi`、`crashed`、首次 onboarding 与 `#/diagnostics` 等全屏入口行为未回归。
