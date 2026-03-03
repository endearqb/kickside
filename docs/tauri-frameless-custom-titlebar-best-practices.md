# Tauri v2 无系统标题栏（Frameless / Undecorated）最佳实践与避坑指南

> 更新时间：2026-03-02  
> 适用范围：Tauri v2（Windows 优先），前端框架不限（React/Vue/Svelte 等）

## 1. 目标与术语

在 Tauri 中做“无系统标题栏”通常指：

- 窗口配置使用 `decorations: false`，去掉系统原生标题栏。
- 在前端自绘标题栏（Titlebar），自己实现拖拽区、最小化、最大化/还原、关闭按钮。

这套方案可以获得更统一的 UI，但你会同时接管：

- 窗口交互行为（拖拽、双击、按钮事件）
- 窗口权限（capabilities）
- 平台差异（尤其是 Windows 的阴影、圆角、边线表现）

---

## 2. 最小可用实现（MVP）

### 2.1 `tauri.conf.json`（窗口配置）

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "My App",
        "width": 960,
        "height": 780,
        "minWidth": 420,
        "resizable": true,
        "decorations": false,
        "shadow": false,
        "transparent": true
      }
    ]
  }
}
```

建议说明：

- `decorations: false` 是 frameless 的核心开关。
- `shadow`、`transparent` 与视觉效果强相关，建议后文“取舍表”一起看，不要单独试。

### 2.2 `capabilities`（窗口 API 权限）

Tauri v2 默认并不放开全部窗口命令，标题栏按钮常用命令需要显式授权。

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:window:default",
    "core:window:allow-start-dragging",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close"
  ]
}
```

如果你有这些需求，再按需加：

- `core:window:allow-set-shadow`：运行时切换阴影。
- `core:window:allow-start-resize-dragging`：自定义边缘 resize 热区。
- `core:window:allow-set-size` / `allow-set-position`：做伪最大化或自定义窗口预设。

### 2.3 前端标题栏基础模板

```tsx
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

export function Titlebar() {
  return (
    <header className="titlebar">
      <div className="drag-region" data-tauri-drag-region />

      <button type="button" onClick={() => void appWindow.minimize()}>
        _
      </button>
      <button type="button" onClick={() => void appWindow.toggleMaximize()}>
        []
      </button>
      <button type="button" onClick={() => void appWindow.close()}>
        X
      </button>
    </header>
  );
}
```

---

## 3. 复杂标题栏推荐实现（实战可用）

当标题栏里有菜单、输入框、Tab、图标按钮时，建议采用“分层模型”：

- 一层全覆盖 `drag layer`（只负责拖拽）
- 一层交互控件层（按钮、输入框、菜单，`z-index` 更高）

这能同时保证：

- 空白区域可拖动
- 控件区域不被拖拽劫持

Windows 下常用强化点：

- 双击拖拽区切换最大化/还原
- 显式“最大化/还原”按钮，不只依赖系统双击
- 边缘缩放有异常时，增加手动 resize 热区并调用 `startResizeDragging(...)`

---

## 4. 官方最佳实践（提炼）

### 4.1 `data-tauri-drag-region` 不继承

官方文档明确说明：该属性只对“直接挂载”的元素生效，不会自动让子元素都可拖拽。  
结论：复杂标题栏不要把它当作“父容器一挂全生效”。

### 4.2 复杂交互建议手动 `startDragging()`

官方给了“手动实现 drag-region”的模式：在 `mousedown` 中自行判断左键/双击，再调用 `startDragging()` 或 `toggleMaximize()`。  
结论：当你需要精细控制拖拽行为，这是更稳定的方案。

### 4.3 `close()` 与 `destroy()` 语义不同

Window API 文档说明：

- `close()` 会触发 `closeRequested`，可被拦截（例如未保存弹窗）
- `destroy()` 是强制关闭，不走 `closeRequested`

结论：常规关闭用 `close()`；确认后强制退出才考虑 `destroy()`。

### 4.4 Capability 要按窗口标签最小授权

Capability 文档强调窗口/能力边界按 `window label` 生效，且多个 capability 会合并权限。  
结论：对多窗口应用，建议用 `windows: ["main", "doc-*"]` 这种显式范围，不要一开始就全局放大权限。

---

## 5. 社区常见坑（含状态）

### 5.1 `decorations: false` 后“可调整大小失效”历史问题

- 案例：Issue #8519（已关闭）
- 现象：`resizable: true` 但边缘拉伸失效
- 建议：
  - 先在你的 Tauri/WebView2 组合版本上实测
  - 失败时用显式 resize 热区 + `startResizeDragging(...)` 兜底

### 5.2 双击 `data-tauri-drag-region` 还原尺寸异常

- 案例：Issue #11945（已关闭）
- 现象：状态变为 unmaximized，但窗口大小/位置未恢复
- 建议：
  - 不把“系统双击拖拽区还原”当唯一路径
  - 提供显式“还原”按钮，并保留自定义 restore bounds

### 5.3 圆角/阴影/边线观感不一致

- 案例：Issue #9287（当前 Open）
- 典型组合：`transparent + decorations:false + shadow:true`
- 官方配置/API文档也提示：Windows 下 undecorated + `shadow:true` 可能出现 1px 白边，Windows 11 还会出现圆角
- 建议：
  - 追求“干净无白边”优先：`shadow:false` + 自绘阴影
  - 追求“更接近系统圆角”优先：接受 `shadow:true` 带来的边线副作用

---

## 6. `app-region: drag` 的使用边界（Windows）

官方 Window Customization 页面建议：如果标题栏不需要复杂交互，可以用 `app-region: drag` 改善触控/笔输入拖拽。  
但 Tauri `2.0.0-beta.22` 的 release note 也记录过回退原因：整块 `app-region: drag` 会影响右键和按钮点击行为。

实践建议：

- 简单纯拖拽头部：可考虑 `app-region: drag`
- 有按钮/输入框/菜单：优先 `data-tauri-drag-region` 或手动 `startDragging()`，避免整块 `app-region: drag`

---

## 7. 参数取舍速查（Windows）

| 目标 | 推荐组合 | 代价 |
| --- | --- | --- |
| 纯自绘、观感可控 | `decorations:false, transparent:true, shadow:false` | 需要自己实现阴影与边框层次 |
| 更接近系统窗口观感 | `decorations:false, shadow:true` | 可能出现 1px 白边/圆角差异 |
| 最少自定义风险 | `decorations:true` | 无法完全自定义标题栏 |

---

## 8. Do / Don’t

### Do

- 只把拖拽能力放在“空白区域”，把按钮区从拖拽区隔离。
- 为标题栏按钮显式加 `aria-label` 和 `title`。
- 把 capability 当作运行时的一部分测试（不是只看前端逻辑）。
- 为“首次启动”“多显示器”“窗口从最大化恢复”做专门回归。

### Don’t

- 不要假设 `data-tauri-drag-region` 会自动覆盖子元素。
- 不要把 `close()` 当成“强制关闭”。
- 不要在复杂标题栏直接整块上 `app-region: drag`。
- 不要把阴影/白边/圆角问题只当 CSS 问题；先看窗口参数组合。

---

## 9. 上线前检查清单

- [ ] `decorations:false` 与 UI 方案一致（确认不是误配）。
- [ ] capability 包含实际调用到的窗口权限（拖拽/最小化/最大化/关闭/阴影等）。
- [ ] 标题栏拖拽区与按钮区层级分离，无点击冲突。
- [ ] 双击拖拽区、显式最大化按钮、还原行为一致。
- [ ] 含未保存内容时，`closeRequested` 流程符合预期。
- [ ] Windows 10/11 都验证过边线、圆角、阴影观感。
- [ ] 触摸/触控笔设备（若是目标用户）至少完成一次拖拽验证。

---

## 10. 与 MDPad 的对照（当前项目）

可直接参考本仓库现有实现：

- 窗口配置：`src-tauri/tauri.conf.json`
- 窗口权限：`src-tauri/capabilities/default.json`
- 自绘标题栏组件：`src/features/window/TopBar.tsx`
- 标题栏视觉与层级：`src/styles.css`
- 窗口预设计算（伪最大化）：`src/shared/utils/windowPreset.ts`
- 运行时阴影切换：`src/App.tsx`（`setShadow(uiTheme === "classic")`）

---

## 11. 参考资料（官方与社区）

### 官方文档

- Window Customization（含 custom titlebar、drag region、手动拖拽）  
  https://v2.tauri.app/learn/window-customization/
- JavaScript Window API（`minimize / toggleMaximize / close / destroy / startDragging / startResizeDragging / setShadow`）  
  https://v2.tauri.app/reference/javascript/api/namespacewindow/
- Capabilities（能力模型、窗口标签边界、权限合并）  
  https://v2.tauri.app/security/capabilities/
- Core Permissions（窗口权限标识）  
  https://v2.tauri.app/reference/acl/core-permissions/
- Config / WindowConfig（`decorations` / `shadow` / `transparent` 等）  
  https://v2.tauri.app/reference/config/#windowconfig
- Release: tauri@2.5.1（`data-tauri-drag-region="false"` 行为）  
  https://tauri.app/release/tauri/v2.5.1/
- Release: tauri@2.0.0-beta.20（Windows 上 `app-region: drag` 触摸增强）  
  https://tauri.app/release/tauri/v2.0.0-beta.20/
- Release: tauri@2.0.0-beta.22（回退该行为并说明交互副作用）  
  https://tauri.app/release/tauri/v2.0.0-beta.22/

### 社区案例（GitHub Issues）

- #8519: V2 custom titlebar unable to resize when `decorations=false`（Closed）  
  https://github.com/tauri-apps/tauri/issues/8519
- #11945: Double-click drag-region unmaximize restore issue（Closed）  
  https://github.com/tauri-apps/tauri/issues/11945
- #9287: Rounded corners and shadows problems（Open）  
  https://github.com/tauri-apps/tauri/issues/9287
