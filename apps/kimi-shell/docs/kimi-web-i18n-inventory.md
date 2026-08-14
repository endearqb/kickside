# Kimi Web 中文化入口盘点

基线 commit：`e32568cf2db0e95ad76878a4e6482986c8ecb180`

## 结论

- 当前 same-origin 注入适合继续承担少量高频空态、壳层桥接和紧急兜底修正。
- 会话侧栏、创建会话、消息搜索、审批对话框这类文案已经直接写在上游 React 组件里，后续应优先迁到源码级 patch，而不是继续依赖英文原文的 DOM 替换。
- 由后端返回的 question/tool 描述类文本需要单独处理，不能假设前端源码 patch 能覆盖。

## 当前注入覆盖状态（第二阶段）

- 已由注入覆盖：
  - `sessions.tsx` 主路径固定文案
  - `create-session-dialog.tsx` 固定文案
  - `message-search-dialog.tsx` 固定文案
  - `chat-workspace-header.tsx` 固定文案
  - `approval-dialog.tsx` 固定交互文案
  - `chat.tsx` 中固定 toast 标题
  - `error-boundary.tsx` 固定错误页文案
- 仍不在注入范围内：
  - `question-dialog.tsx` 的 `currentQuestion.*`
  - `approval-dialog.tsx` 的 `approval.description` / `approval.sender`
  - 服务端错误正文、模型输出正文、用户消息正文

## 当前注入覆盖状态（第三阶段）

- 在第二阶段基础上继续由注入覆盖：
  - `components/kimi-cli-brand.tsx` 中左上角品牌标题 `Kimi Code`，仅替换可见标题为 `KickSide 启伴`
  - `components/ai-elements/reasoning.tsx` 中的 `Thought`、`Thinking...`、`Thought for {n}s`
  - `components/ai-elements/tool.tsx` 中的 `Edit`、`Read`、`Search` 及同类固定工具标签
  - `features/chat/components/activity-status-indicator.tsx` 中的固定状态文案，如 `Awaiting input`、`Waiting for approval...`
  - `features/chat/components/chat-prompt-composer.tsx` 中的输入框占位、上传状态、展开/收起、排队发送等固定提示
  - `features/sessions/sessions.tsx` 中的右键菜单与批量选择条固定文案，如 `Rename`、`Archive`、`Select Multiple`
  - `features/chat/components/prompt-toolbar/toolbar-context.tsx` 中的 `% context` 与 token 用量说明
- 允许的动态句式仅限：
  - `Thought for {n}s`
  - `{percent}% context`
  - `{n} selected`
- 第三阶段仍不在注入范围内：
  - `components/kimi-cli-brand.tsx` 的 logo 图片 `/logo.png`、版本号文本和外链语义
  - `question-dialog.tsx` 的 `currentQuestion.*`
  - `approval-dialog.tsx` 的 `approval.description` / `approval.sender`
  - 服务端错误正文、模型输出正文、用户消息正文
  - 文件路径、URL、工具参数本体

## 适合优先迁到源码 patch 的文本

### 会话与侧栏

- `third_party/kimi-cli-web/upstream-web/src/features/sessions/sessions.tsx`
- 典型文本：
  - `Search sessions...`
  - `Refresh Sessions`
  - `New Session`
  - `List view`
  - `Grouped by folder`
  - `Delete Session`
  - `Are you sure you want to delete ...`
  - `Cancel` / `Delete`
- 判断：这些字符串直接位于 JSX 的 `placeholder`、`aria-label`、`title` 和对话框文案中，结构稳定，适合源码 patch。

### 创建会话

- `third_party/kimi-cli-web/upstream-web/src/features/sessions/create-session-dialog.tsx`
- 典型文本：
  - `Create New Session`
  - `Search directories or type a new path`
  - `No matching directories.`
  - `Loading directories...`
  - `Type a path to start a new session.`
  - `Directory Not Found`
  - `Create Directory`
- 判断：这部分是完整的命令面板和确认弹窗流程，继续依赖运行时文本替换没有必要，适合整体迁到源码 patch。

### 消息搜索与工作区头部

- `third_party/kimi-cli-web/upstream-web/src/features/chat/message-search-dialog.tsx`
- `third_party/kimi-cli-web/upstream-web/src/features/chat/components/chat-workspace-header.tsx`
- 典型文本：
  - `Search Messages`
  - `Search in conversation...`
  - `No messages found`
  - `Jump to message`
  - `Open sessions sidebar`
  - `Hide workspace files` / `Show workspace files`
  - `Search messages`
  - `Fold all blocks` / `Unfold all blocks`
  - `Double-click to rename`
- 判断：全部位于显式组件 props 和 tooltip 中，源码 patch 的稳定性明显高于 DOM 注入。

### 审批与错误反馈

- `third_party/kimi-cli-web/upstream-web/src/features/chat/components/approval-dialog.tsx`
- `third_party/kimi-cli-web/upstream-web/src/features/chat/chat.tsx`
- `third_party/kimi-cli-web/upstream-web/src/components/error-boundary.tsx`
- 典型文本：
  - `Approve`
  - `Approve for session`
  - `Decline`
  - `Decline with feedback`
  - `Tell the model what to do instead...`
  - `Approval action failed`
  - `Question response failed`
  - `Something went wrong`
  - `An unexpected error occurred`
  - `Copy error`
  - `Try again`
- 判断：这类错误和审批文案是高频系统交互，应该做源码级中文化，避免注入漏掉 toast、fallback 和条件分支。

## 适合继续由注入兜底的文本

- 当前增强模式新增的少量壳层文案或临时热修复文本。
- 上游 DOM 结构外、由 shell 注入补充的体验标记和轻量样式。
- 在上游升级后短期回归的高频空态文本，可先用注入兜底，等 patch 稳定后再迁回源码层。

## 需要单独处理的动态文本

- `third_party/kimi-cli-web/upstream-web/src/features/chat/components/question-dialog.tsx`
- `third_party/kimi-cli-web/upstream-web/src/features/chat/components/approval-dialog.tsx`
- 风险点：
  - `currentQuestion.question`
  - `currentQuestion.header`
  - `currentQuestion.body`
  - `currentQuestion.other_label`
  - `approval.description`
  - `approval.sender`
- 判断：这些内容主要来自后端运行时 payload。前端源码 patch 只能覆盖按钮、占位符和固定框架文案，不能替代后端侧国际化或映射层。

## 建议的下一步迁移顺序

1. 先从 `sessions.tsx` 和 `create-session-dialog.tsx` 开始，把当前注入里已经命中的会话主路径文本迁到源码 patch。
2. 再迁 `message-search-dialog.tsx`、`chat-workspace-header.tsx` 和 `approval-dialog.tsx` 的固定交互文案。
3. 最后再评估是否为 question/tool 等后端动态文本增加单独的 message 映射层，而不是继续扩大 DOM 文本替换范围。
