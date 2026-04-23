基于当前仓库，我会把“改名成 `Mooki`”分成 5 档，差别主要在于你想改“品牌显示”，还是连“系统身份”和“代码语义”一起改。

1. `仅改显示名`
- 只把用户看得到的名字改成 `Mooki`，比如窗口标题、安装包名、托盘提示、启动页文案、图标。
- 内部继续保留 `com.kimi.shell`、`appskimi-shell`、日志目录、仓库名等旧身份。
- 成本最低，几乎没有迁移风险，适合先试品牌。

2. `双品牌 / 壳层品牌改名`（最推荐）
- 应用整体叫 `Mooki` 或 `Mooki for Kimi`。
- 但涉及底层产品能力的词继续保留 `Kimi CLI`、`Kimi Code Web`、`Kimi Chat`、`IM Bridge`。
- 这是我最推荐的，因为设计系统明确说品牌名可以是英文，但像 `Kimi CLI` 这类技术名词保留是合理的。[DESIGN.md](../DESIGN.md#L13) [DESIGN.md](../DESIGN.md#L73)

3. `产品级完整改名`
- 除了界面名字，还把系统身份一起改掉：`productName`、`identifier`、日志目录、托盘 ID、安装器产物名、快捷方式名、临时文件前缀。
- 这样用户看到的会更统一，但要处理旧数据路径迁移，否则 `%LOCALAPPDATA%\\com.kimi.shell` 下的日志/状态会断层。[tauri.conf.json](../apps/kimi-shell/src-tauri/tauri.conf.json#L3) [index.html](../apps/kimi-shell/index.html#L58) [main.tsx](../apps/kimi-shell/src/main.tsx#L40)

4. `仓库级深度重命名`
- 连 repo、目录名、Cargo/npm 包名、Go module、crate 名、脚本里 exe 名都改成 `mooki-*`。
- 例如现在这些还是明显的 Kimi 身份：[package.json](../apps/kimi-shell/package.json#L2) [Cargo.toml](../apps/kimi-shell/src-tauri/Cargo.toml#L2)
- 这档最彻底，但代价最大，也最容易引入构建和路径回归。

5. `平台化方案`
- `Mooki` 作为上层产品名，同时把内部“单一 Kimi 壳”逐步抽象成“多 Provider 桌面壳”。
- 这就不只是改名了，而是产品方向升级，因为现在不少运行时语义还是硬编码为 `kimi`，包括 bridge provider、工作区名称和品牌组件。[orchestrator.go](../apps/kimi-im-bridge/internal/bridgecore/orchestrator.go#L44) [WorkspaceView.tsx](../apps/kimi-shell/src/features/workspace/WorkspaceView.tsx#L212) [kimi-cli-brand.tsx](../apps/kimi-shell/src/components/kimi-cli-brand.tsx#L20)

按你的项目现状，我建议这样选：
- 如果你只是想让这个桌面应用有自己的牌子：选 `方案 2`
- 如果你希望安装包、系统目录、托盘、快捷方式都统一成 `Mooki`：选 `方案 3`
- 如果你想让项目长期脱离 “Kimi 专属壳” 这个定位：再考虑 `方案 4` 或 `方案 5`
