# Kimi App / Kimi Code Web 侧栏与响应式一致性改造计划

> 实施状态（2026-08-16）：已按当前生产路径完成。运行时目标已纠正为原生 `nav.conversation-toc`；左侧 `aside.side` Sessions sidebar 保持上游原样。生产实现位于 `apps/kimi-shell/src-tauri/src/frame_workspace_bridge.js`，不使用本文早期草案中的 retired `workspace_injection.rs` 路径。真实 DOM 契约与验证入口见 `.ai/architecture/kimi-web-dom-contract.md`。

> 验收修订（2026-08-16）：最终实现不覆盖 Header 高度，也不注入窄屏 TOC toggle/drawer。消息 TOC 在所有目标宽度表现为正文左侧常驻短竖条，label 默认折叠，仅在 hover 或键盘 focus 时向右展开；mobile 缺少原生 TOC 时才使用有界 projection。本文后续早期 52px/drawer 伪代码仅保留为历史设计过程，不再是实现契约。

> 目标：解决 Kimi Code Web 会话目录在 3:2 笔记本最大化时仍不显示、目录只能出现在右侧，以及有/无 Sidebar 两种布局下输入框底部间距、顶部 Header 高度和工作区图标主题色不一致的问题。
>
> 审查基线：`endearqb/kimi-app` 已重定向到 `endearqb/kickside`；本文以 `codex/macos-v1` 分支为实现基线。官方上游以 `MoonshotAI/kimi-code` 的 `main` 分支为参考。
>
> 文档状态：实施方案，可直接交给 Code Agent 执行；其中对 Kimi Web 内部 DOM 的选择器属于运行时适配层，合并前必须通过 DevTools 在当前内置版本上确认。

---

## 1. 结论

### 1.1 会话目录可以放到左侧，也可以在宽屏模式下持续显示

技术上可行，但不建议在所有宽度下无条件常驻。推荐按 **Kimi Web iframe 的实际内容宽度**，而不是按物理屏幕比例或外层窗口宽度，切换三种状态：

| 模式 | iframe 实际宽度 | 会话目录策略 |
|---|---:|---|
| Wide | `>= 1180px` | 放到左侧并持续显示 |
| Compact | `960–1179px` | 默认收起，通过按钮打开抽屉 |
| Narrow | `< 960px` | 不占用常驻宽度，仅提供抽屉 |

初始阈值用于第一轮实现，最终值应根据 3:2 笔记本、系统缩放比例、Sidebar 宽度和双 Pane 场景实测校准。

### 1.2 3:2 笔记本窗口最大化仍不显示的根因

Kimi Code Web 运行在 Kimi App 的 `iframe` 中。上游响应式规则读取的是 iframe 自身的 CSS viewport，而不是显示器比例，也不是外层 Tauri 窗口的总宽度。

外层窗口即使最大化，以下空间仍会从可用宽度中扣除：

- Kimi App 左侧 Sidebar；
- Pane 分栏和分隔条；
- 窗口边框、标题栏和系统缩放；
- Kimi Code Web 自身的导航区域和内容最大宽度；
- 125% 或 150% 显示缩放导致的 CSS 像素减少。

因此，3:2 只代表屏幕比例，不保证 iframe 达到上游目录组件的显示断点。

### 1.3 不应直接修改官方 `dist-web/assets/index-*.js` 或 `index-*.css`

当前官方仓库公开的是构建后的 Web 资源，未提供与该界面一一对应的可维护前端源码。直接改哈希构建产物会产生以下问题：

- 上游升级后文件名和压缩结构变化；
- 无法进行稳定的代码审查；
- 选择器和模块编号容易失效；
- 构建产物可能在安装或更新时被覆盖。

当前 Kimi App 已经在 Tauri 侧实现 `KIMI_WEB_ENHANCEMENTS_SCRIPT` 注入层，因此本次改造应继续放在这个适配层中完成。

---

## 2. 相关代码位置

### 2.1 Kimi Code Web 容器与主题消息

文件：

```text
apps/kimi-shell/src/features/workspace-grid/PaneFrame.tsx
```

职责：

- 创建 Kimi Code Web `iframe`；
- 在 iframe 加载后发送宿主主题；
- 在主题变化时再次同步；
- 控制 Pane 的聚焦、固定、刷新、浏览器打开等行为。

当前主题消息只包含：

```ts
{
  source: 'kimi-shell',
  type: 'host-theme',
  theme: nativeTheme(),
}
```

它只同步浅色/深色模式，没有同步强调色，也没有告诉内嵌页面当前 Pane 的实际宽度模式。

### 2.2 Kimi Web 运行时增强脚本

文件：

```text
apps/kimi-shell/src-tauri/src/backend_manager/workspace_injection.rs
```

职责：

- 在本地 Kimi Web 页面中注入 JavaScript 和 CSS；
- 标记 Sidebar 和应用壳层；
- 清理不需要的页面元素；
- 处理弹窗和快捷键；
- 接收 `host-theme` 消息。

这是本次改造的主要落点。

### 2.3 宿主 Pane 布局和 Header

文件：

```text
apps/kimi-shell/src/features/workspace-grid/WorkspaceGridView.tsx
apps/kimi-shell/src/features/workspace-grid/WorkspaceChrome.tsx
apps/kimi-shell/src/features/workspace-grid/PaneFrame.tsx
apps/kimi-shell/src/features/window/ShellTitlebar.tsx
apps/kimi-shell/src/App.css
```

宿主 WebView Pane 的 Header 当前被压缩为 `height: 0`，截图中的聊天 Header 主要来自 Kimi Web 页面内部。因此，图 2 的 Header 高度差异不能只改宿主 `App.css`，必须同时规范 iframe 内部 Header。

### 2.4 宿主主题变量

文件：

```text
apps/kimi-shell/src/app/theme.ts
apps/kimi-shell/src/index.css
```

`THEME_SYNC_SOURCE` 当前只同步 `color-scheme` 和背景色，没有同步 Kimi Web 的主题强调色。

---

## 3. 问题分析

## 3.1 会话目录只在右侧出现，且最大化时不出现

### 当前表现

- 上游 Kimi Code Web 在满足自身断点时，把消息/任务目录放在内容右侧；
- 当 iframe 宽度未达到上游断点时，目录被隐藏；
- 用户看到的外层最大化状态，并不能代表 iframe 宽度满足断点。

### 目标表现

- Wide 模式：目录位于聊天内容左侧，并持续可见；
- Compact/Narrow 模式：目录不常驻，使用抽屉或浮层；
- 切换 Sidebar、改变窗口大小、进入双 Pane 后，布局能立即重算；
- 不通过直接搬移 React 管理的 DOM 节点实现，以避免 React reconciliation 冲突。

### 推荐实现

1. 在注入脚本中用 `ResizeObserver` 读取 `document.documentElement.clientWidth`；
2. 把模式写到根节点：

```html
<html data-kimi-shell-layout="wide">
```

3. 识别并标记目录节点及其父布局容器；
4. Wide 模式下通过 `order: -1` 或 CSS Grid 把目录放到左侧；
5. Compact/Narrow 模式下隐藏常驻目录，后续增加抽屉开关；
6. 不直接使用 `appendChild()` 把节点搬家。

---

## 3.2 Sidebar 模式和窄屏模式下输入框底部间距不一致

### 可能根因

- Kimi Web 在不同断点下使用了不同的容器层级；
- 一种模式由外层容器 `padding-bottom` 控制，另一种由输入框自身 `margin-bottom` 控制；
- 绝对定位、`100vh`、`100dvh` 或安全区变量处理不一致；
- Sidebar 展开导致 iframe 宽度进入另一套响应式 CSS，而不是单纯减少横向空间。

### 目标表现

- Sidebar 展开、关闭及窄屏模式下，输入框底边与 Pane 底边的视觉间距一致；
- macOS、Windows 和不同显示缩放下不出现贴底或过大空隙；
- 不用固定大像素值补偿某一个截图尺寸。

### 推荐实现

统一为一个注入变量：

```css
--kimi-enhanced-composer-bottom-gap: 12px;
```

优先设置输入区域直接布局容器的 `padding-bottom`；若运行时 DOM 结构表明输入框容器本身是普通流布局，再使用 `margin-bottom`。

建议值：

```css
max(12px, env(safe-area-inset-bottom, 0px))
```

---

## 3.3 顶部 Header 高度不一致

### 当前结构

存在两层 Header：

1. Kimi App 的 Pane Header；
2. iframe 中 Kimi Code Web 的聊天 Header。

WebView Pane 的宿主 Header 当前被设为零高度，所以截图中的差异主要来自第二层。

### 目标表现

- 有 Sidebar 和无 Sidebar 模式使用同一 Header 高度；
- Header 内标题、图标和操作按钮垂直居中；
- 不因目录从右侧移到左侧而改变 Header 高度；
- 全屏、分栏和窄屏切换时不发生 1–2 px 跳动。

### 推荐值

```css
--kimi-enhanced-chat-header-height: 52px;
```

必须同时设置 `height`、`min-height` 和 `box-sizing`，避免内部样式只覆盖其中一个属性。

---

## 3.4 默认蓝色主题下，窄屏工作区图标仍为黑色

### 根因

当前宿主只把浅色/深色模式发送给 iframe，注入脚本中的强调色还是固定值，且没有对窄屏工作区图标进行语义标记和主题覆盖。

需要注意：Kimi App 宿主当前默认 `--accent` 在部分分支中是琥珀色，而截图中的“默认蓝色”更可能是 Kimi Code Web 自身主题色。因此不能简单地强制让图标跟随宿主 `--accent`，否则可能从黑色变成错误的琥珀色。

### 推荐的强调色解析顺序

1. Kimi Web 当前页面暴露的原生主题变量；
2. Kimi Web 主要操作按钮的计算样式；
3. 宿主通过消息传入的强调色；
4. 默认蓝色回退值 `#1677ff`。

### 目标表现

- 默认蓝色主题：工作区图标为蓝底白字/白图标；
- 深色模式仍保持足够对比度；
- 主题变化后不需要刷新页面；
- 图标中的 SVG 使用 `currentColor`，不会继续保留黑色 `fill`。

---

## 4. 响应式状态机

```text
                           iframe clientWidth
                                  │
             ┌────────────────────┼────────────────────┐
             │                    │                    │
          < 960px            960–1179px            >= 1180px
             │                    │                    │
          NARROW               COMPACT                WIDE
             │                    │                    │
  目录仅抽屉/浮层      目录按钮 + 抽屉        左侧目录持续显示
  Header 52px          Header 52px          Header 52px
  Bottom gap 12px      Bottom gap 12px      Bottom gap 12px
```

### 状态属性

```html
<html data-kimi-shell-layout="narrow|compact|wide">
```

### 为什么使用根节点数据属性

- CSS 可以直接按状态切换；
- DevTools 中容易诊断；
- 避免多个组件分别监听窗口宽度；
- 后续可用于埋点和视觉回归测试。

---

## 5. 代码修改方案

## 5.1 `PaneFrame.tsx`：扩展宿主消息

文件：

```text
apps/kimi-shell/src/features/workspace-grid/PaneFrame.tsx
```

增加统一的消息构造函数：

```tsx
function readHostAccentColor() {
  const styles = getComputedStyle(document.documentElement)
  return styles.getPropertyValue('--accent').trim() || '#1677ff'
}

function buildHostThemePayload() {
  return {
    source: 'kimi-shell',
    type: 'host-theme',
    theme: nativeTheme(),
    accent: readHostAccentColor(),
  } as const
}
```

把 iframe `onLoad` 中原来的消息改为：

```tsx
onLoad={() => {
  setIframeReady(true)
  const iframe = iframeRef.current

  try {
    iframe?.contentWindow?.postMessage(buildHostThemePayload(), '*')
  } catch {
    // iframe 在跨域或初始化阶段不可访问时忽略，后续 effect 会重试。
  }
}}
```

把主题同步 effect 中的 payload 改为：

```tsx
useEffect(() => {
  document.documentElement.dataset.theme = theme
  localStorage.setItem('theme', theme)

  const payload = buildHostThemePayload()

  try {
    iframeRef.current?.contentWindow?.postMessage(payload, '*')
  } catch {
    // cross-origin
  }

  if (
    getPanePresentationMode(pane.kind) === 'webview' &&
    iframeReady &&
    externalPaneController
  ) {
    externalPaneController.eval(THEME_SYNC_SOURCE).catch(() => {})
  }
}, [theme, iframeReady, externalPaneController, pane.kind])
```

### 可选强化

若应用以后支持单独的强调色设置，应把 `accent` 作为显式状态传入 `PaneFrame`，不要只依赖 `getComputedStyle()`。

---

## 5.2 `workspace_injection.rs`：添加布局模式监听

文件：

```text
apps/kimi-shell/src-tauri/src/backend_manager/workspace_injection.rs
```

在 `KIMI_WEB_ENHANCEMENTS_SCRIPT` 中增加：

```js
var LAYOUT_ATTR = "data-kimi-shell-layout";
var WIDE_OUTLINE_MIN = 1180;
var COMPACT_MIN = 960;

function getViewportWidth() {
  return Math.round(
    (document.documentElement && document.documentElement.clientWidth) ||
    window.innerWidth ||
    0
  );
}

function updateLayoutMode() {
  var width = getViewportWidth();
  var mode =
    width >= WIDE_OUTLINE_MIN
      ? "wide"
      : width >= COMPACT_MIN
        ? "compact"
        : "narrow";

  document.documentElement.setAttribute(LAYOUT_ATTR, mode);
  document.documentElement.style.setProperty(
    "--kimi-shell-viewport-width",
    width + "px"
  );
}

var layoutObserver = new ResizeObserver(updateLayoutMode);
layoutObserver.observe(document.documentElement);
window.addEventListener("resize", updateLayoutMode, { passive: true });
updateLayoutMode();
```

### 兼容性回退

Tauri WebView 版本理论上支持 `ResizeObserver`，仍建议保留回退：

```js
if (typeof ResizeObserver === "function") {
  var layoutObserver = new ResizeObserver(updateLayoutMode);
  layoutObserver.observe(document.documentElement);
} else {
  window.addEventListener("resize", updateLayoutMode, { passive: true });
}
```

---

## 5.3 为 Header、输入框、目录和工作区图标添加语义标记

### 共用可见性工具

```js
function isVisible(element) {
  if (!element || !(element instanceof HTMLElement)) return false;

  var style = window.getComputedStyle(element);
  var rect = element.getBoundingClientRect();

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity || "1") > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}
```

### Header 标记

```js
function markChatHeader() {
  var candidates = Array.from(
    document.querySelectorAll("header,[role='banner']")
  );

  var header = candidates.find(function (element) {
    if (!isVisible(element)) return false;

    var rect = element.getBoundingClientRect();
    return (
      rect.top <= 8 &&
      rect.height >= 36 &&
      rect.height <= 80 &&
      rect.width >= 280
    );
  });

  if (header) {
    header.dataset.kimiEnhancedChatHeader = "true";
  }
}
```

### 输入框容器标记

```js
function markComposer() {
  var input = document.querySelector(
    "textarea," +
    "[contenteditable='true']," +
    "input[placeholder*='消息']," +
    "input[placeholder*='message' i]"
  );

  if (!input) return;

  var node = input;
  for (var depth = 0; depth < 6 && node; depth += 1) {
    var rect = node.getBoundingClientRect();

    if (
      rect.width > 260 &&
      rect.height >= 48 &&
      rect.height <= 220
    ) {
      node.dataset.kimiEnhancedComposer = "true";
      break;
    }

    node = node.parentElement;
  }
}
```

> 合并前需要确认标记的是输入区域的布局容器，而不是内部 `textarea`。若容器使用绝对定位，应把底部间距加到它的父滚动容器，而不是直接加 `margin-bottom`。

### 会话目录标记

```js
function findConversationOutline() {
  var candidates = Array.from(
    document.querySelectorAll(
      "aside,nav,[role='navigation'],[role='list']"
    )
  );

  return candidates.find(function (element) {
    if (!isVisible(element)) return false;

    var rect = element.getBoundingClientRect();
    var itemCount = element.querySelectorAll(
      "a,button,li,[role='listitem']"
    ).length;
    var text = textOf(element);

    return (
      rect.width >= 140 &&
      rect.width <= 360 &&
      itemCount >= 3 &&
      /(任务 ID|关闭任务|帮我|task|restart)/i.test(text)
    );
  }) || null;
}

function markConversationOutline() {
  var outline = findConversationOutline();
  if (!outline) return;

  outline.dataset.kimiEnhancedConversationOutline = "true";

  var host = outline.parentElement;
  if (host) {
    host.dataset.kimiEnhancedOutlineHost = "true";
  }
}
```

### 工作区图标标记

优先使用稳定的 `aria-label`、`data-testid` 或上游已有属性。只有在当前构建没有稳定属性时，才使用尺寸和文本启发式：

```js
function markWorkspaceIcon() {
  var header = document.querySelector(
    "[data-kimi-enhanced-chat-header='true']"
  );
  if (!header) return;

  var explicit = header.querySelector(
    "[data-testid*='workspace' i]," +
    "[aria-label*='workspace' i]," +
    "[aria-label*='工作区']"
  );

  if (explicit) {
    explicit.dataset.kimiEnhancedWorkspaceIcon = "true";
    return;
  }

  var candidates = Array.from(
    header.querySelectorAll("button,[role='button'],div")
  );

  var icon = candidates.find(function (element) {
    if (!isVisible(element)) return false;

    var rect = element.getBoundingClientRect();
    var text = textOf(element);

    return (
      rect.width >= 28 &&
      rect.width <= 44 &&
      rect.height >= 28 &&
      rect.height <= 44 &&
      text.length >= 1 &&
      text.length <= 2
    );
  });

  if (icon) {
    icon.dataset.kimiEnhancedWorkspaceIcon = "true";
  }
}
```

### 合并刷新入口

```js
var refreshPending = false;

function refreshUiHooks() {
  markChatHeader();
  markComposer();
  markConversationOutline();
  markWorkspaceIcon();
}

function scheduleUiRefresh() {
  if (refreshPending) return;
  refreshPending = true;

  requestAnimationFrame(function () {
    refreshPending = false;
    refreshUiHooks();
  });
}
```

把现有 `MutationObserver` 改为：

```js
var observer = new MutationObserver(function () {
  hideArtifacts();
  ensureSidebarEnhanced();
  scheduleUiRefresh();
  scheduleDismissModal(80);
});

observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
});

scheduleUiRefresh();
```

避免在每一个 DOM mutation 中立即执行多次全页面查询。

---

## 5.4 主题强调色解析

增加颜色合法性判断：

```js
function normalizeCssColor(value) {
  if (typeof value !== "string") return "";

  var color = value.trim();
  if (!color) return "";

  if (window.CSS && CSS.supports("color", color)) {
    return color;
  }

  if (window.CSS && CSS.supports("color", "hsl(" + color + ")")) {
    return "hsl(" + color + ")";
  }

  return "";
}
```

尝试读取 Kimi Web 原生变量：

```js
function readNativeAccent() {
  var styles = getComputedStyle(document.documentElement);
  var names = [
    "--color-primary",
    "--brand-color",
    "--primary-color",
    "--primary"
  ];

  for (var index = 0; index < names.length; index += 1) {
    var value = normalizeCssColor(
      styles.getPropertyValue(names[index])
    );
    if (value) return value;
  }

  return "";
}
```

可选地从主要提交按钮读取计算样式：

```js
function readActionButtonAccent() {
  var candidate = document.querySelector(
    "button[type='submit']," +
    "[data-testid*='send' i]," +
    "[aria-label*='send' i]," +
    "[aria-label*='发送']"
  );

  if (!candidate || !isVisible(candidate)) return "";

  var color = getComputedStyle(candidate).backgroundColor;
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") {
    return "";
  }

  return color;
}
```

最终解析：

```js
var hostAccent = "";

function applyResolvedAccent() {
  var accent =
    readNativeAccent() ||
    readActionButtonAccent() ||
    normalizeCssColor(hostAccent) ||
    "#1677ff";

  document.documentElement.style.setProperty(
    "--kimi-enhanced-accent",
    accent,
    "important"
  );
}
```

更新消息监听器：

```js
window.addEventListener("message", function (event) {
  var data = event && event.data;
  if (
    !data ||
    data.source !== "kimi-shell" ||
    data.type !== "host-theme"
  ) {
    return;
  }

  setTheme(data.theme === "dark");
  hostAccent = typeof data.accent === "string" ? data.accent : "";
  applyResolvedAccent();
});
```

在 `refreshUiHooks()` 末尾增加：

```js
applyResolvedAccent();
```

这样即使 Kimi Web 主题在运行时变化，DOM 更新后也会重新解析强调色。

---

## 5.5 注入 CSS

在现有 `style.textContent` 中增加以下规则。

### 统一变量

```css
:root {
  --kimi-enhanced-chat-header-height: 52px;
  --kimi-enhanced-composer-bottom-gap: 12px;
  --kimi-enhanced-outline-width: 232px;
  --kimi-enhanced-accent: #1677ff;
}
```

### Header 高度

```css
[data-kimi-enhanced-chat-header="true"] {
  height: var(--kimi-enhanced-chat-header-height) !important;
  min-height: var(--kimi-enhanced-chat-header-height) !important;
  box-sizing: border-box !important;
}
```

若 Header 子容器本身有高度规则，补充：

```css
[data-kimi-enhanced-chat-header="true"] > * {
  min-height: 0;
}
```

不要无条件把所有子节点都设为 `height: 100%`，否则可能扩大下拉菜单或弹出层触发器。

### 输入框底部间距

第一选择：标记到输入区域布局容器后使用：

```css
[data-kimi-enhanced-composer="true"] {
  margin-bottom: max(
    var(--kimi-enhanced-composer-bottom-gap),
    env(safe-area-inset-bottom, 0px)
  ) !important;
}
```

若运行时确认该容器是 `position: absolute/fixed`，改用：

```css
[data-kimi-enhanced-composer="true"] {
  bottom: max(
    var(--kimi-enhanced-composer-bottom-gap),
    env(safe-area-inset-bottom, 0px)
  ) !important;
}
```

两种方案不能同时启用。

### Wide 模式目录移到左侧

若父容器的计算样式是 Flex：

```css
:root[data-kimi-shell-layout="wide"]
[data-kimi-enhanced-outline-host="true"] {
  display: flex !important;
  align-items: stretch !important;
}

:root[data-kimi-shell-layout="wide"]
[data-kimi-enhanced-conversation-outline="true"] {
  order: -1 !important;
  flex: 0 0 var(--kimi-enhanced-outline-width) !important;
  width: var(--kimi-enhanced-outline-width) !important;
  max-width: var(--kimi-enhanced-outline-width) !important;
  position: sticky !important;
  top: var(--kimi-enhanced-chat-header-height) !important;
  align-self: flex-start !important;
  max-height: calc(
    100dvh - var(--kimi-enhanced-chat-header-height)
  ) !important;
  overflow: auto !important;
}
```

若父容器的计算样式是 Grid，改用：

```css
:root[data-kimi-shell-layout="wide"]
[data-kimi-enhanced-outline-host="true"] {
  display: grid !important;
  grid-template-columns:
    var(--kimi-enhanced-outline-width) minmax(0, 1fr) !important;
}

:root[data-kimi-shell-layout="wide"]
[data-kimi-enhanced-conversation-outline="true"] {
  grid-column: 1 !important;
  grid-row: 1 !important;
}
```

只保留与运行时结构匹配的一组规则。

### Compact/Narrow 模式

第一阶段先隐藏常驻目录：

```css
:root[data-kimi-shell-layout="compact"]
[data-kimi-enhanced-conversation-outline="true"],
:root[data-kimi-shell-layout="narrow"]
[data-kimi-enhanced-conversation-outline="true"] {
  display: none !important;
}
```

第二阶段实现抽屉后，不再使用 `display: none`，而是通过状态属性控制：

```html
<html data-kimi-shell-outline-open="true">
```

抽屉样式示例：

```css
:root:not([data-kimi-shell-layout="wide"])
[data-kimi-enhanced-conversation-outline="true"] {
  display: block !important;
  position: fixed !important;
  inset:
    var(--kimi-enhanced-chat-header-height)
    auto
    0
    0 !important;
  width: min(82vw, 320px) !important;
  z-index: 70 !important;
  transform: translateX(-104%) !important;
  transition: transform 160ms ease !important;
  box-shadow: 14px 0 36px rgb(0 0 0 / 16%) !important;
}

:root[data-kimi-shell-outline-open="true"]
[data-kimi-enhanced-conversation-outline="true"] {
  transform: translateX(0) !important;
}
```

### 工作区图标主题色

```css
[data-kimi-enhanced-workspace-icon="true"] {
  background: var(--kimi-enhanced-accent) !important;
  color: #fff !important;
  border-color: transparent !important;
}

[data-kimi-enhanced-workspace-icon="true"] svg {
  color: currentColor !important;
  fill: currentColor !important;
  stroke: currentColor !important;
}
```

若图标使用伪元素，还需要：

```css
[data-kimi-enhanced-workspace-icon="true"]::before,
[data-kimi-enhanced-workspace-icon="true"]::after {
  color: currentColor !important;
}
```

---

## 6. Compact/Narrow 模式目录按钮

### 推荐交互

- 按钮放在 Kimi Web Header 左侧，靠近工作区图标；
- 图标使用 `ListTree`、`PanelLeftOpen` 或三条横线；
- 点击后打开左侧抽屉；
- 点击遮罩、按 `Esc`、切换会话后关闭；
- Wide 模式不显示按钮，因为目录已经常驻；
- 按钮至少具有 `aria-label="打开会话目录"`。

### 注入按钮示例

```js
function ensureOutlineToggle() {
  var header = document.querySelector(
    "[data-kimi-enhanced-chat-header='true']"
  );
  if (!header) return;

  var existing = header.querySelector(
    "[data-kimi-enhanced-outline-toggle='true']"
  );
  if (existing) return;

  var button = document.createElement("button");
  button.type = "button";
  button.dataset.kimiEnhancedOutlineToggle = "true";
  button.setAttribute("aria-label", "打开会话目录");
  button.innerHTML =
    '<span aria-hidden="true">☰</span>';

  button.addEventListener("click", function () {
    var root = document.documentElement;
    var next =
      root.getAttribute("data-kimi-shell-outline-open") !== "true";

    root.setAttribute(
      "data-kimi-shell-outline-open",
      next ? "true" : "false"
    );
    button.setAttribute("aria-expanded", next ? "true" : "false");
  });

  header.insertBefore(button, header.firstChild);
}
```

生产实现应使用内联 SVG，而不是字符 `☰`，确保字体和平台一致。

---

## 7. 功能开关与回滚

由于上游 Kimi Web DOM 结构不属于本仓库控制范围，必须提供快速关闭机制。

### 推荐开关

```js
var enhancementEnabled =
  localStorage.getItem("kimi-web-layout-v2") !== "off";

if (!enhancementEnabled) return;
```

也可以由 Rust 配置或 Kimi App 设置页控制：

```text
设置 → Kimi Code → 实验性 Web 布局增强
```

### 回滚策略

- 关闭开关后，不注入新增标记和 CSS；
- 保留现有主题同步和基础快捷键；
- 不要求回滚整个 `codex/macos-v1` 分支；
- 上游 DOM 变动导致异常时，可通过远程配置或本地设置立即关闭。

---

## 8. 实施阶段

## 阶段 0：运行时 DOM 审计

### 任务

1. 在 macOS 和 Windows 内置 Kimi Code Web 打开 DevTools；
2. 记录以下节点的稳定属性和父子关系：
   - 聊天 Header；
   - 工作区图标；
   - 输入框和其布局容器；
   - 右侧会话目录；
   - 目录与正文的共同父容器；
3. 记录父容器的 `display` 类型：Flex 或 Grid；
4. 记录页面公开的主题 CSS 变量；
5. 记录上游目录当前出现/消失的真实宽度；
6. 保存 DOM 快照和截图到开发文档或测试夹具。

### 交付物

```text
architecture/kimi-web-dom-contract.md
```

内容包括选择器优先级、DOM 截图、计算样式和已知版本信息。

### 完成标准

- 不再依赖“第几个 div”之类脆弱选择器；
- 至少找到一个稳定属性，或明确记录启发式识别规则；
- 确认目录父容器是 Flex 还是 Grid。

---

## 阶段 1：统一 Header、输入框底部间距和主题色

### 任务

1. 扩展 `PaneFrame.tsx` 的主题消息；
2. 在注入脚本中实现语义标记；
3. 统一 Header 为 52 px；
4. 统一输入框底部间距为 12 px + 安全区；
5. 实现 Kimi 原生主题色优先的强调色解析；
6. 修复工作区图标背景和 SVG 颜色；
7. 对 MutationObserver 做 `requestAnimationFrame` 合并调度。

### 完成标准

- Sidebar 展开和关闭时 Header 视觉高度一致；
- 输入框到底部间距误差不超过 1 px；
- 默认蓝色主题下工作区图标不再是黑色；
- 主题切换后 200 ms 内更新；
- 页面长对话滚动性能无明显下降。

---

## 阶段 2：会话目录左置和宽屏常驻

### 任务

1. 增加 iframe 宽度状态机；
2. 标记目录和其父容器；
3. Wide 模式通过 CSS `order` 或 Grid 重排到左侧；
4. 设置目录宽度和独立滚动；
5. 验证目录不会覆盖输入框和 Header；
6. 验证点击目录项仍能正常滚动到消息位置；
7. 验证 React 重渲染后标记能够恢复。

### 完成标准

- 宽度 `>= 1180px` 时目录持续位于左侧；
- 目录滚动不带动正文；
- 正文最小宽度仍满足正常阅读；
- 切换 Sidebar 后模式能在一个动画帧内重算；
- 不出现 DOM 节点重复、点击失效或 React 警告。

---

## 阶段 3：Compact/Narrow 抽屉

### 任务

1. 在 Header 注入目录按钮；
2. 添加抽屉开关状态；
3. 添加遮罩、Esc 关闭、会话切换关闭；
4. 完成键盘焦点管理；
5. 添加 `aria-expanded`、`aria-controls` 和可访问名称；
6. 处理触控拖动或至少保证触控点击可用。

### 完成标准

- `< 1180px` 时不压缩正文；
- 按钮可打开左侧目录抽屉；
- Esc、遮罩和选择目录项均能关闭；
- 键盘焦点不会落在抽屉后方；
- Wide/Compact/Narrow 切换时开关状态正确复位。

---

## 阶段 4：测试、文档和上游适配

### 任务

1. 添加注入脚本单元测试或字符串快照测试；
2. 添加 Playwright/E2E 视觉回归测试；
3. 添加 DOM 适配失败的诊断日志；
4. 增加功能开关；
5. 编写上游升级检查清单；
6. 更新 README 和发布说明。

### 完成标准

- 关键宽度有截图基线；
- 注入失败时不破坏原生页面；
- 上游 Kimi Code 升级后有明确复核流程；
- 功能可独立关闭。

---

## 9. 测试矩阵

## 9.1 布局宽度

| iframe CSS 宽度 | 预期模式 | 目录 |
|---:|---|---|
| 800 | Narrow | 抽屉 |
| 959 | Narrow | 抽屉 |
| 960 | Compact | 抽屉 |
| 1024 | Compact | 抽屉 |
| 1179 | Compact | 抽屉 |
| 1180 | Wide | 左侧常驻 |
| 1280 | Wide | 左侧常驻 |
| 1440 | Wide | 左侧常驻 |
| 1728 | Wide | 左侧常驻 |

必须分别测试断点前后 1 px，避免抖动和双重样式。

## 9.2 宿主布局

- Sidebar 展开；
- Sidebar 收起；
- 单 Pane；
- 1:1 双 Pane；
- 3:2 双 Pane；
- Pane 固定；
- Pane 聚焦；
- 窗口最大化；
- 非最大化拖动缩放。

## 9.3 显示器与缩放

- 3:2 笔记本，100%；
- 3:2 笔记本，125%；
- 3:2 笔记本，150%；
- 16:9 外接屏，100%；
- macOS Retina 默认缩放；
- Windows 125% 和 150%。

## 9.4 主题

- 浅色；
- 深色；
- 跟随系统；
- Kimi 默认蓝色；
- 宿主强调色与 Kimi 强调色不一致；
- 运行时切换主题，无刷新。

## 9.5 内容状态

- 新对话空白页；
- 只有一条消息；
- 长对话；
- 多个工具调用；
- 目录包含重复标题；
- 目录滚动到末尾；
- 后台 Bash 状态显示；
- 页面出现弹窗和下拉菜单。

## 9.6 交互和可访问性

- Tab 键遍历；
- Enter/Space 激活目录按钮；
- Esc 关闭抽屉；
- 屏幕阅读器可读取按钮名称；
- 200% 浏览器缩放；
- `prefers-reduced-motion` 下关闭抽屉动画。

---

## 10. 验收标准

### AC-01：宽屏目录

```gherkin
Given Kimi Code iframe 宽度大于等于 1180px
When 页面加载完成或窗口从窄变宽
Then 会话目录显示在正文左侧
And 目录持续可见
And 目录不覆盖正文、Header 或输入框
```

### AC-02：窄屏目录

```gherkin
Given Kimi Code iframe 宽度小于 1180px
When 页面加载完成
Then 会话目录不占用正文固定宽度
And Header 提供目录按钮
And 点击按钮后从左侧打开目录抽屉
```

### AC-03：输入框底部间距

```gherkin
Given Sidebar 展开或关闭
When 输入框处于默认非展开状态
Then 输入框底边到 Pane 内容底边的视觉间距为 12px ± 1px
```

### AC-04：Header 高度

```gherkin
Given Wide、Compact 或 Narrow 任一模式
Then 聊天 Header 的计算高度为 52px
And Header 内容垂直居中
```

### AC-05：工作区图标主题色

```gherkin
Given Kimi Web 选择默认蓝色主题
When 页面进入窄屏模式
Then 工作区图标为当前主题蓝色背景
And 图标或文字为白色
And 不再显示黑色背景
```

### AC-06：上游兼容失败

```gherkin
Given 上游 Kimi Web DOM 结构变化导致目录未被识别
Then 原生 Kimi 页面仍可正常使用
And 不产生遮挡、空白页或无限 MutationObserver 循环
And 用户可以关闭实验性布局增强
```

---

## 11. 风险与缓解措施

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 上游 DOM 结构变化 | 标记失效 | 稳定属性优先、功能开关、升级检查清单 |
| 启发式选择器误选节点 | Header/图标样式错位 | 尺寸、位置、可见性和文本多条件校验 |
| MutationObserver 频繁扫描 | 长对话性能下降 | `requestAnimationFrame` 合并、缓存节点、仅在节点失效时重查 |
| React reconciliation 与 DOM 改动冲突 | 节点闪烁或交互失效 | 不搬移 React 节点，只加属性和 CSS 重排 |
| 强调色取值格式不同 | CSS 颜色无效 | `CSS.supports()` 校验和多级回退 |
| 目录左置后正文过窄 | 可读性下降 | 只在 iframe `>= 1180px` 时常驻 |
| 安全区和固定定位冲突 | 输入框贴底或漂浮 | 先确认布局方式，只启用 `margin-bottom` 或 `bottom` 其中一种 |
| 上游更新覆盖构建产物 | 补丁丢失 | 不直接修改 `dist-web`，继续使用注入层 |

---

## 12. 性能要求

- MutationObserver 回调本身不做同步全量重复扫描；
- 每个动画帧最多执行一次 `refreshUiHooks()`；
- 已识别且仍连接到 DOM 的节点应缓存复用；
- 页面滚动不触发布局模式重算；
- 只有根节点尺寸变化才运行 `updateLayoutMode()`；
- 长对话中注入层平均脚本开销目标小于 2 ms/次刷新；
- 不引入周期性 `setInterval()` DOM 扫描。

可进一步使用：

```js
if (cachedHeader && cachedHeader.isConnected) {
  // 直接复用，不重新扫描。
}
```

---

## 13. 建议提交拆分

```text
1. feat(kimi-web): add semantic DOM hooks and responsive layout state
2. fix(kimi-web): normalize chat header and composer spacing
3. fix(kimi-web): sync native accent to compact workspace icon
4. feat(kimi-web): move conversation outline to persistent left rail on wide panes
5. feat(kimi-web): add compact outline drawer and accessibility behavior
6. test(kimi-web): add viewport and theme regression coverage
7. docs(kimi-web): document DOM contract and upstream upgrade checklist
```

不要把所有改动压到一个提交里。这样上游 DOM 适配失败时，可以单独回滚目录左置，不影响 Header 和主题修复。

---

## 14. 工作量估算

| 阶段 | 估算 |
|---|---:|
| DOM 审计与选择器契约 | 0.5–1 人日 |
| Header、间距和主题色修复 | 1–1.5 人日 |
| Wide 左侧常驻目录 | 1–1.5 人日 |
| Compact/Narrow 抽屉 | 1–2 人日 |
| 多平台测试与视觉回归 | 1.5–2 人日 |
| 文档、开关和发布收尾 | 0.5–1 人日 |
| 合计 | 5.5–9 人日 |

估算不包括对官方 Kimi Code Web 前端进行源码级 fork。若上游后续公开可维护前端源码，应优先把本方案从运行时注入迁移到上游组件层。

---

## 15. 上游升级检查清单

每次更新 Kimi Code Web 构建后，至少检查：

1. `header` 或 `role="banner"` 是否仍能识别；
2. 输入框是否仍使用 `textarea`、`contenteditable` 或稳定占位符；
3. 会话目录是否仍有 `aside/nav/list` 语义；
4. 目录父容器是 Flex 还是 Grid；
5. 主题变量名是否变化；
6. 发送按钮的背景色是否仍可作为强调色回退；
7. 上游是否已经原生提供目录左置或常驻设置；
8. 上游断点是否变化；
9. MutationObserver 是否产生明显增加；
10. 功能开关关闭后是否完整恢复原生布局。

---

## 16. 不建议做的修改

### 16.1 不直接修改官方哈希构建文件

```text
apps/kimi-code/dist-web/assets/index-*.js
apps/kimi-code/dist-web/assets/index-*.css
```

原因：不可维护、不可审查、升级必然脆弱。

### 16.2 不用外层窗口宽度代替 iframe 宽度

错误示例：

```ts
window.innerWidth >= 1180
```

若代码运行在宿主窗口中，它得到的是 Tauri 窗口宽度，不是 Kimi Code iframe 的内容宽度。

### 16.3 不直接搬移 React 管理的目录节点

错误示例：

```js
leftColumn.appendChild(outline)
```

这可能在 React 更新时被移回、重复创建或导致事件绑定异常。应使用 CSS `order` 或 Grid placement。

### 16.4 不用一个固定蓝色覆盖所有主题

`#1677ff` 只作为最后回退值。正常情况下应优先跟随 Kimi Web 当前原生强调色。

---

## 17. 最终推荐架构

```text
Kimi App / Tauri Host
├── PaneFrame.tsx
│   └── 发送 light/dark + host accent fallback
│
├── workspace_injection.rs
│   ├── Runtime DOM semantic adapter
│   ├── ResizeObserver responsive state
│   ├── Native Kimi accent resolver
│   ├── Header/composer/icon normalization
│   ├── Wide left outline layout
│   └── Compact/Narrow outline drawer
│
└── Tests
    ├── DOM contract fixture
    ├── viewport matrix
    ├── theme matrix
    └── visual regression snapshots
```

这套架构把上游不可控 DOM 的脆弱性集中在单一适配层中，宿主 React 代码只负责发送稳定的主题上下文，避免将上游页面内部实现扩散到多个组件。
