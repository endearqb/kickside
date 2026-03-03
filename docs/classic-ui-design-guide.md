# MDPad Classic UI 设计规范（配色 + UI/UX 理念）

> 版本基线：MDPad `0.1.8`  
> 更新时间：2026-03-02  
> 目标：为“同风格桌面应用”提供可复用的视觉与交互规范

---

## 1. 设计定位

Classic UI 的核心不是“复古皮肤”，而是三件事：

- 桌面工具感：界面像稳定、克制、可预期的系统工具。
- 低干扰写作：背景与容器噪音最低，强调内容本身。
- 功能可见但不喧宾：常用动作可达，次要动作折叠。

一句话定义：

> 用系统化的中性灰阶做骨架，用单一蓝色强调动作与状态，不靠重阴影和高饱和来吸引注意力。

---

## 2. 配色系统（Design Tokens）

Classic UI 在 MDPad 中是 `themeMode(light/dark) x uiTheme(classic)` 的二维组合。  
也就是说：Classic 不是单色主题，而是同一套语义 token 的浅色/深色双版本。

### 2.1 Classic Light（`theme-light.ui-classic`）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--app-shell` | `#f1f5f9` | 应用壳层背景 |
| `--app-shell-border` | `#cbd5e1` | 壳层边界语义 |
| `--chrome-bg` | `#e2e8f0` | 顶部/系统条语义背景 |
| `--chrome-border` | `#94a3b8` | 顶部/面板边界语义 |
| `--text-primary` | `#334155` | 主文本 |
| `--text-secondary` | `#64748b` | 次文本/图标 |
| `--accent` | `#0a64ad` | 主强调色（交互） |
| `--accent-soft` | `#cfe8ff` | 选中/弱强调背景 |
| `--hover-soft` | `#e2e8f0` | 悬停背景 |
| `--hover-strong` | `#cbd5e1` | 按下背景 |
| `--editor-bg` | `#ffffff` | 编辑内容底色 |
| `--editor-container-border` | `#e2e8f0` | 编辑容器边界 |
| `--link-color` | `#0b63b5` | 链接颜色 |
| `--link-hover` | `#084f90` | 链接悬停 |

### 2.2 Classic Dark（`theme-dark.ui-classic`）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--app-shell` | `#0f172a` | 应用壳层背景 |
| `--app-shell-border` | `#475569` | 壳层边界语义 |
| `--chrome-bg` | `#1e293b` | 顶部/系统条语义背景 |
| `--chrome-border` | `#334155` | 顶部/面板边界语义 |
| `--text-primary` | `#e2e8f0` | 主文本 |
| `--text-secondary` | `#94a3b8` | 次文本/图标 |
| `--accent` | `#69a8ff` | 主强调色（交互） |
| `--accent-soft` | `rgba(105,168,255,0.35)` | 选中/弱强调背景 |
| `--hover-soft` | `#1e293b` | 悬停背景 |
| `--hover-strong` | `#334155` | 按下背景 |
| `--editor-bg` | `#020617` | 编辑内容底色 |
| `--editor-container-border` | `#334155` | 编辑容器边界 |
| `--link-color` | `#8fc1ff` | 链接颜色 |
| `--link-hover` | `#c8e1ff` | 链接悬停 |

### 2.3 状态色（与主题无关）

| 语义 | 值 | 场景 |
| --- | --- | --- |
| Saved | `#22c55e` | 状态栏已保存 |
| Unsaved | `#f59e0b` | 状态栏未保存 |
| Error | `#ef4444` | 状态栏错误 / 关闭按钮 hover |

### 2.4 用色原则

- 大面积只用中性灰阶（slate），避免彩色背景泛滥。
- 强调色只承担“动作反馈”和“当前态”。
- 视觉层级优先靠明度/对比，不靠厚重阴影。

---

## 3. 视觉骨架与空间节奏

### 3.1 容器结构

- `app-root`：Classic 下圆角收敛到 `8px`，去掉外层毛玻璃和重阴影。
- `workspace-shell`：`gap: 0`、`padding: 0`，让顶部/内容/底部形成连续工作区。
- `editor-surface`：保留 1px 边界，作为核心内容容器；其余容器尽量无边界。

### 3.2 关键尺寸

| 元素 | 规格 |
| --- | --- |
| Titlebar 高度 | `40px` |
| 标题栏图标按钮 | `30 x 28px` |
| 窗口控制按钮 | 宽 `44px`，高 `100%` |
| 文档名字体 | `12px / 600` |
| StatusBar 高度 | `26px` |
| StatusBar 字体 | `11px` |
| 编辑区最大宽度 | `920px` |

### 3.3 形状语言

- 统一小圆角：`4px/6px/8px` 为主，不使用夸张圆角。
- 控件轮廓扁平化：边框稀疏、阴影轻量。
- 模块边界由“背景明度差 + 少量边线”共同表达。

---

## 4. 信息架构与交互模型（UI/UX）

### 4.1 顶栏（TopBar）原则

- 左侧是“动作区”：File 聚合入口 + Save + 模式切换 + 明暗切换。
- 中间是“文档身份区”：文件名居中、双击重命名、dirty 点提示。
- 右侧是“窗口控制区”：最小化 / 预设缩放 / 关闭，顺序固定。

交互规则：

- 拖拽层全覆盖标题栏，但交互控件通过更高层级可点击。
- 双击标题栏空白区触发窗口预设缩放（40% x 90%）与恢复。
- 关闭按钮 hover 固定红色，建立桌面端肌肉记忆。

### 4.2 底栏（StatusBar）原则

- 左侧放“文档健康状态”：编码、保存态、帮助入口。
- 右侧放“偏好与统计”：语言、Markdown 主题、UI 主题、字数。
- 文本按钮默认低对比，hover 才提升可见性，减少常驻噪音。

### 4.3 编辑器交互原则

- 编辑区永远是视觉主角：白底（或深色纯底）+ 稳定排版宽度。
- 浮层菜单（slash/bubble）用统一 token，避免每个浮层各自一套风格。
- 只读模式必须“有反馈”：图标切换 + 交互尝试时闪烁提示。

---

## 5. 组件级规范（可直接复用）

### 5.1 按钮状态

- 默认：透明底 + 次文本色
- Hover：`--hover-soft` + 主文本色
- Active：`--hover-strong`
- Disabled：`opacity` 降低 + `not-allowed`

### 5.2 输入态（以重命名输入框为例）

- 正常边框：`accent` 与 `chrome-border` 混合
- 聚焦：边框切 `accent`，并给 2px 低透明描边
- 文本密度：`12px~13px`，偏紧凑

### 5.3 弹出层（File 菜单 / 主题菜单 / Bubble / Slash）

- 基础色：`--slash-menu-bg`
- 边线：`--slash-menu-border`
- 阴影：`--slash-menu-shadow`
- 圆角：Classic 下收敛到 `6px~8px`

---

## 6. 设计理念总结（可迁移）

为同风格 app 设计时，建议始终遵守：

1. 单一视觉重心：内容容器优先，工具条只做“薄框架”。
2. 单一强调色：全局只保留一组蓝色语义，其他颜色只用于状态警示。
3. 双层密度控制：结构层紧凑（标题栏、状态栏、按钮），内容层舒展（正文行高、页边距、阅读宽度）。
4. 桌面心智优先：窗口控制规则、关闭风险提示、快捷键提示要接近系统习惯。

---

## 7. 快速落地清单（设计同风格 App）

- [ ] 先建立语义 token，而不是直接写具体颜色到组件。
- [ ] 先做 Light/Dark 两套 Classic token，再做组件皮肤。
- [ ] 顶栏/编辑区/状态栏使用同一套间距与圆角节奏。
- [ ] 所有浮层（菜单/气泡）复用同一组 surface token。
- [ ] 明确“高频动作上移、低频动作折叠”的信息架构。
- [ ] 关闭按钮、保存状态、未保存提示等关键反馈必须显性。

---

## 8. 代码映射（MDPad 参考）

- 主题 token 定义：`src/styles.css`
- Classic 覆盖层：`src/styles.css`
- 顶栏交互实现：`src/features/window/TopBar.tsx`
- 状态栏交互实现：`src/features/window/StatusBar.tsx`
- 主题组合入口：`src/App.tsx`
