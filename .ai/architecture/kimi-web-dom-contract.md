# Kimi Web DOM Contract

> 类型：contract
> Canonical sources：Kimi Code `0.36.1` 生产二进制内嵌 Web bundle、`apps/kimi-shell/src-tauri/src/frame_workspace_bridge.js`

## 适用范围

- 只约束 KickSide 对内嵌 Kimi Code Web 的响应式布局增强；不约束 Kimi Chat、DSH 或 generic external pane。
- 生产工作区在默认 local 模式直接加载 Kimi runtime URL。owned LAN 模式因上游 `frame-ancestors 'self'` 改走仅 loopback 的 CSP/传输 adapter；布局、主题和 session bridge 仍只通过主窗口的 `initialization_script_for_all_frames` 注入，不恢复旧 workspace HTML 产品注入。
- `third_party/kimi-cli-web/upstream-web/` 是只读审查快照，不是当前运行时 DOM 的事实权威；它与生产 bundle 冲突时，以当前安装版本的生产 bundle 和实测行为为准。

## 2026-08-16 审计基线

- 真实运行时：Kimi Code `0.36.1`。当前安装二进制内嵌 Vue 生产资源 `assets/index-CgXirkUy.js` 与 `assets/index-BkulrdXm.css`。
- 左侧 Sessions sidebar 是 `aside.side`；它不是消息 TOC。KickSide 不得给它增加 `data-*`、`id`、`tabIndex`、子节点或定位/宽度/动画覆盖。
- 红框消息 TOC 是原生 `ConversationToc`：`section.con > nav.conversation-toc > .toc-scroll > button.toc-row > .toc-bar + .toc-label`。中文 aria-label 为“对话目录”，英文为 “Conversation outline”。
- 原生 TOC 仅在非 mobile、session 非 loading 且至少有两个用户 turn 时渲染；右侧空间不足或被表格遮挡时，上游添加 `.toc-clipped` 与 `aria-hidden=true`。
- 原生 TOC 通过用户消息 `.u-bub.turn-anchor[data-turn-id]` 定位消息。KickSide 必须复用原生 `button.toc-row`；上游 mobile 不渲染 TOC 时，才允许从同一稳定锚点生成不持久化、不记录正文的有界 projection。
- `section.con` 是 TOC 的 positioned/container ancestor，正文最大宽度为 `760px`。KickSide 只固定左侧短条的起点，不移动 Vue 管理的节点；label 保持折叠，仅在 hover / focus-within 时向右展开。

## 稳定识别顺序

| 对象 | 首选契约 | 有界 fallback |
|---|---|---|
| 左 Sessions sidebar | `aside.side` | 展开/收起 sidebar 按钮的最近 `aside`；只用于排除和 pane 形态判断 |
| 消息 TOC | `nav.conversation-toc[aria-label="对话目录"]` / 英文 aria | `section.con > nav.conversation-toc`，且必须验证 `.toc-scroll > button.toc-row > .toc-bar + .toc-label` |
| 用户 turn 锚点 | `.u-bub.turn-anchor[data-turn-id]` | 无；不足两个时不生成 projection |
| 桌面 Header | `header.chat-header` | 无 |
| 移动 Header | 中/英文“切换会话 / 工作区”按钮的 `.topbar` | 无 |
| Composer | 中文/英文消息 `textarea` 的 `.composer` | 最近 `form` |
| 移动工作区图标 | `.topbar .wsq` | 无 |
| Kimi 蓝色 | `--logo` → `--blue` | `--sidebar-accent` → `--color-primary` → host accent → `#1783ff` |

禁止使用用户消息正文、目录标题、DOM 序号或全页尺寸识别原生 TOC。projection 只在原生 mobile 组件不存在时读取当前 DOM 锚点文字作为临时可见 label；文字不得进入日志、持久化、诊断或宿主消息。

## 宿主消息契约

现有消息只做 additive 扩展：

```json
{
  "source": "kimi-shell-theme-sync",
  "theme": "light | dark",
  "accent": "<host CSS color fallback>",
  "surface": "kimi-code",
  "layoutEnhancement": "v2",
  "bridgeNonce": "<当前主窗口随机 nonce>"
}
```

- `postMessage` target 必须是 iframe URL 的精确 origin，不允许改为 `*`。
- 只有消息来自当前 parent，且 `surface=kimi-code`、`layoutEnhancement=v2` 时才启动 DOM 适配；其他 frame 只消费既有主题字段。
- Shell origin 与 frame origin 均可用 `localStorage["kimi-web-layout-v2"]="off"` 关闭增强。关闭后仍同步主题，但不注入布局 style、标记、按钮或 observer。

## 响应式与可访问性

- 所有宽度：Header 完全使用 Kimi 原生高度，不注入目录按钮、抽屉或遮罩；若原生消息 TOC 存在，只把短竖条定位到正文左侧，label 默认折叠并在 hover / focus-within 时向右展开。展开态统一使用最大 `220px` 的面板宽度和明暗主题自适应的 58% 不透明模糊浮层，长标题省略；折叠态不显示背景，不支持 `backdrop-filter` 时保留半透明实色降级。原生条目、active 状态和点击滚动保持不变。
- `960–1179px` 与 `<960px`：只有不带 Sessions sidebar 的 pane 才保留 composer 底距与蓝色 `.wsq` 增强；Sessions sidebar 本身在所有宽度均保持原生 DOM 与布局。
- 原生 TOC 存在时复用其 DOM；真正 mobile 导致原生组件不渲染时，只有当前 DOM 至少存在两个唯一 `.turn-anchor[data-turn-id]` 才创建 body-level projection，否则 fail-open。
- 常驻 TOC 不得设置 `inert` / `aria-hidden`；触屏点击或键盘聚焦条目时通过 `:focus-within` 展开 label，不另造一套菜单状态机。
- 宽窄切换、原生 TOC 重新挂载或 projection 被原生 TOC 替代时，不得重复生成节点或污染可访问性状态。
- MutationObserver 只观察 child-list 并以 `requestAnimationFrame` 合并刷新，不做周期扫描。

## Finder 文件拖放兼容

- Windows 继续使用基础配置 `main.dragDropEnabled=false`，由 WebView2 将真实 HTML5 `FileList` 直接交给 Kimi。受保护 WebKit file-item 的 capture 兼容仍保留为 fail-open fallback，但不再承担 macOS Finder 主路径。
- macOS 平台配置单独设置 `main.dragDropEnabled=true`。实机证据表明 Tao `NSWindow` 收到完整 `Enter/Over/Drop`，而顶层与真实 Kimi iframe 均没有 DOM `dragenter`；因此正式入口是 `RunEvent::WindowEvent::DragDrop`，不得再把纯 DOM workaround 宣称为 macOS 修复。
- Rust 仅对用户本次 Drop 交付的普通文件创建最多 8 个随机、30 秒、single-use grant：打开时使用 `O_NOFOLLOW`，拒绝目录、符号链接与特殊文件，限制单文件 25 MiB、总计 50 MiB。grant 持有已打开文件句柄，不向 Shell/iframe/日志发送路径，也不提供接受任意 path 的读取命令。
- Shell 只在 drop 坐标命中 `[data-workspace-pane-id]` 且 pane kind 为 `code` 时消费 grant；物理坐标先按原值命中，Retina 场景再以 `devicePixelRatio` 回退。Chat、DSH、external、header 或窗口外落点不读取授权内容。
- Shell 通过 iframe URL 的精确 origin、当前 `bridgeNonce` 与 transferable `ArrayBuffer` 发送 `kimi-shell-native-file-drop/attach_files`。all-frame bridge 还必须验证 `event.source===window.parent`、已建立的可信 Kimi surface 与相同非空 nonce，随后构造真实 `File` 并赋给 Kimi 0.36.1 自有的隐藏多选 file input，触发其原生 `change` 上传链路；不得遍历 Vue 私有实例、直接 POST `/files` 或暴露通用 fs API。
- 当前 macOS 原生路径在松开后显示 Kimi 附件条目，但不会把 Chrome 的 pre-drop `dragover` 提示伪装到 Shell；若未来增加 hover UX，必须由原生 Enter/Leave 驱动，并遵循 `DESIGN.md`，不能改变授权与数据面边界。

## 上游升级检查

1. 从当前安装 Kimi 二进制的生产 bundle 或 live DOM 重新确认 `ConversationToc` 选择器、渲染条件与锚点契约；不得仅凭 vendored snapshot 下结论。
2. 验证 `aside.side` 在初始化前后 `outerHTML` 和计算布局不变。
3. 在 480/800/959/960/1179/1180/1280/1440 CSS px 核对原生 TOC、projection、左侧短条和向右展开状态。
4. 验证只有一个用户 turn、loading、mobile、长标题、重复标题、TOC 重挂载和 sidebar 显隐场景。
5. 核对 `.con` container、`--p-content-max` / `--toc-content-max` 和正文 gutter；不得让左置 TOC 覆盖正文或 sidebar。
6. 验证关闭开关后页面完整恢复原生布局，console 不输出 DOM、URL、路径、turn label 或 token。
7. 在 Finder→Kimi composer 实测单文件、多文件与第二个 Code pane；确认附件进入 Kimi 原生上传链路，DSH/Chat/普通文本拖动不受影响，日志不出现文件名、路径或内容。

## 验证

```bash
cd apps/kimi-shell
pnpm exec vitest run src/app/linkBridge.test.ts src/features/workspace-grid/WorkspaceGridView.test.tsx
pnpm exec tsc --noEmit
pnpm check:kimi-web:visual
```

视觉 gate 使用脱敏 fixture 和 10 张 Chrome 基线，覆盖 480px mobile projection、800/959/960/1179 compact/narrow、1179px 带-sidebar 原状、1180/1280/1440 wide、明暗主题、短条折叠态与 focus 展开态。真实 WKWebView/WebView2、3:2 显示器、125%/150% 缩放、IME、触控和屏幕阅读器仍属于发布前 G3。
