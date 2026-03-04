# Lessons Learned

- 救火式重试逻辑必须显式“锁存成功状态”（latch）：一旦 fallback 导航成功，后续循环只能观察，不可继续发送会覆盖目标页面的导航指令。
- 当 `tauri://localhost` 重试导航仍持续 `about:blank` 时，要尽快切换“协议绕行兜底”（直接导航 `http://127.0.0.1:<workspace_port>`），先恢复可用性再追协议根因。
- 当截图显示 DevTools 目标仅有 `about:blank` 且无资源树时，优先按“协议加载时序故障”处理：在 Rust setup 加入 about:blank 自救重试导航，而不是只在前端层继续加 fallback。
- 安装版出现“打不开/白块”时要先检查真实窗口几何（`MainWindowHandle + GetWindowRect`）；13x13 这类异常尺寸会被误判为渲染故障，应在 setup 增加窗口尺寸自愈。
- 桌面端发布包必须内置“启动可视化兜底”（index 启动 fallback + 根错误边界）；否则前端模块加载失败会表现为白窗，用户无法提供有效诊断信息。
- Windows 发布包若出现“透明窗口/空窗”反馈，优先把 `tauri.conf.json` 的窗口透明依赖降级（`transparent=false`）并为 `body/shell-root` 提供显式 sRGB 回退底色，再做深层排查。
- 视觉类改动涉及“窗口层 + Web 层”时，必须一次性核对 `tauri.conf.json`、`src-tauri` 运行时设置与 `html/body/#root` 背景，避免只改一层导致效果不完整。
- 当用户追加约束（例如“保留透明同时打开阴影”）时，应立即把新增约束并入当前实现与验收，不做半完成交付。
- `iframe` 嵌入跨域页面时，`localStorage`/DOM 主题状态天然隔离；若要实现“被嵌入页切主题后壳层跟随”，必须预留显式桥接通道（如本地代理注入 + `postMessage`），不能假设同名存储键会自动同步。
- 自建 HTTP 代理转发前端静态资源时，要么透传 `Content-Encoding`，要么强制上游 `Accept-Encoding: identity`；否则压缩 JS 被当明文返回会触发 `Invalid or unexpected token`。
- 对 iframe 的 `postMessage(targetOrigin)` 需在子页面完成导航后再发（至少等 `onLoad`/ready 状态），否则常见 origin mismatch 报错。
- 主题同步方案要优先满足“可预测可切换”；若用户明确不需要系统跟随，应保持 `light/dark` 双态，避免第三态引入反向覆盖与状态竞争。
- 代理 Kimi Web 时不能只做 HTTP 转发，`/api/sessions/:id/stream` 必须完整处理 WebSocket Upgrade（识别 Upgrade 请求、强制 `Connection/Upgrade` 头、101 回包头透传）；否则会表现为“新建 session 一直 connecting + 后端 `/stream 404`”。
- 当需求文字存在歧义或冲突时（例如“不要跳转浏览器”与“修复为可打开浏览器”），必须先锁定最终行为再实现，避免按错误方向提交变更。
- 侧栏选中项不要复用 `default` 按钮变体：其全局 hover 往往覆盖为深色背景，易出现“黑底黑字”；导航项应统一 `ghost` 变体并单独定义 active/hover 规则以保证可读性。
- 引导页文档入口要做“最小化保留”：仅保留用户明确要求的单一入口，其余文档按钮应移除，避免信息噪音和错误跳转反馈。
- 安装包多语言需求需先确认“分语种多产物”还是“同包多语言自动选择”：Tauri NSIS 可做单 `exe` 多语言自动匹配系统语言，而 WiX 在常规配置下会输出按语言拆分的多个 `msi`，应在方案阶段提前说明并对齐预期。
