# kimi-app：Explorer 右键菜单、Session 路由与多 Pane 审查

- 仓库：`endearqb/kimi-app`
- 审查基线：`main` 在本次读取时解析到的提交 `c2aaa14b9891c7de31363610d643ba70fa95c1e4`
- 审查日期：2026-07-11
- 范围：Windows Explorer 静态右键菜单、单实例 CLI 转发、工作区/session 创建、Workspace Grid、六窗上限与隐藏 pane UX
- 交付性质：代码审查与参考实现；未向仓库创建分支、提交或 PR

## 1. 结论

当前 Explorer 集成的基础链路是完整的：注册表静态 verb 启动同一个 EXE，冷启动由 startup CLI 解析，热启动由 Tauri single-instance 转发；文件选择支持 350 ms 合并，目录和文件最终都会把应用带到相应工作目录。

但它仍然建立在“全局唯一工作目录 + 全局唯一活跃 session”的旧模型上，与现在的多 Kimi Code pane 模型不兼容。**在应用已经打开时，从 Explorer 打开目录或文件会修改全局 session cwd、清空全局活跃 session，并重启整个后端；它不会创建新 pane，前端收到 session 导航时还会覆盖当前/第一个 Code pane。**

建议把 Explorer 的“在 Kimi 小助手中打开”定义为明确的 `new_pane` intent：

1. 应用已运行：直接调用现有 runtime API 创建独立 session，不重启后端，不修改全局 cwd。
2. 应用未运行：只启动后端一次；把请求放入 FIFO，runtime ready 后创建独立 session。
3. 少于 6 个可见 pane：在新槽位显示，新布局比当前已占满布局多一个槽位。
4. 已有 6 个可见 pane：仍创建 pane，但立即交换到当前活跃槽位；被替换的 pane 收纳到 Pane Shelf。
5. 总 pane 默认上限建议为 12，而不是把“六个可见槽位”误作“六个总 pane”。达到总上限时必须让用户选择关闭、替换或取消，不能静默丢请求。

## 2. 当前注册的 Explorer 菜单

`context_menu.rs` 在 `HKCU\Software\Classes` 下注册静态 verb：

| Explorer 对象 | 注册键 | 当前命令 | 实际语义 |
|---|---|---|---|
| 目录空白处 | `Directory\Background\shell\KimiWebShell` | `--open-dir "%V"` | 以当前目录作为工作目录打开 |
| 文件夹 | `Directory\shell\KimiWebShell` | `--open-dir "%1"` | 以该文件夹作为工作目录打开 |
| 文件 | `*\shell\KimiWebShell` | `--open-files "%1"` | 把文件复制到新生成的工作区后打开 |
| 所有文件系统对象 | `AllFilesystemObjects\shell\KimiWebShell` | `--open-files "%1"` | 与 `*`、`Directory` 重叠；对文件夹而言命令类型错误 |
| “移动到工作区”子菜单 | `Directory`、`*`、`AllFilesystemObjects` 各一套 | `--import-to-default-workspace` / `--import-with-workspace-picker` | 实际执行复制，不是移动 |

代码依据：

- 注册范围：`apps/kimi-shell/src-tauri/src/context_menu.rs:18-91`
- 命令构造：`apps/kimi-shell/src-tauri/src/context_menu.rs:142-155`
- 默认文案：`apps/kimi-shell/src-tauri/src/types.rs:1301-1310`（读取片段中的默认字段位于 `ContextMenuLabelsInput::default`）
- 导入实际调用 `copy_import_item`：`apps/kimi-shell/src-tauri/src/workspace_import.rs:474-637`

Microsoft 对关联范围的定义是：`*` 适用于全部文件，`Directory` 适用于文件夹，`Directory\Background` 适用于文件夹背景，`AllFileSystemObjects` 同时适用于文件和文件夹。因此当前 `AllFilesystemObjects` 与另外两类的重叠不是必要的；更严重的是它把文件夹也导向 `--open-files`。建议删除 Kimi 自己创建的 `AllFilesystemObjects` 两套入口，仅保留 `Directory\Background`、`Directory` 和 `*`。

## 3. 应用未打开时的当前行为

以文件夹右键“在 Kimi 小助手中打开”为例：

1. Explorer 启动 `kimi-shell.exe --open-dir <path>`。
2. 应用 setup 创建 prefill 和隐藏 main window。
3. 启动阶段无条件尝试自动修复右键菜单。
4. `apply_startup_cli_request` 解析参数并调用 `apply_open_dir_request`。
5. 请求校验目录后：
   - 写入全局 `session_work_dir`；
   - 清空全局 active session；
   - 把一个 `auto_session=false` 的 bootstrap 写入单一 `Option`；
   - 调用 `restart_backend`；
   - 显示并聚焦主窗口。
6. setup 随后又调用 `start_backend`，但后端若已处于 Starting，第二次调用通常会直接返回。
7. 后端 ready 后取出 pending bootstrap；因为 `auto_session=false`，明确跳过 session 创建，再次清空 active session。
8. 前端最终使用全局 workspace URL/cwd，而不是一个带唯一 sessionId 的新 Code pane。

文件右键路径多一步：先在配置的 workspace root 下生成目录、复制文件、写来源 manifest，然后执行相同的全局 cwd 切换与后端重启。

关键代码：

- startup CLI：`open_request.rs:65-105`
- OpenDir：`open_request.rs:424-445`
- OpenFiles：`open_request.rs:448-520`
- pending 仅是单一 `Option`：`workspace_session.rs:118-152` 与 `app_state.rs` 的 `pending_workspace_bootstrap`
- backend ready 遇到 `auto_session=false` 会跳过创建：`workspace_session.rs:198-236`
- setup 顺序：`lib.rs:1028-1038`

### 冷启动问题

- `restart_backend` 用于“还没启动”的场景语义不清晰，启动链路被分成 open request 与 setup 两处；虽有状态保护，仍增加竞态和测试复杂度。
- 多个启动期请求会覆盖 `pending_workspace_bootstrap: Option<_>`，不是排队。
- 新 pane 需要唯一 sessionId；当前冷启动没有产生它。

## 4. 应用已经打开时的当前行为

1. Explorer 再次启动 EXE。
2. single-instance 插件首先调用 `show_and_focus`，随后把参数转发给现有实例。
3. OpenDir 每次都新建独立线程并直接执行。
4. OpenFiles 会在 350 ms 内合并多个文件请求，以适配 Explorer 多选可能产生的多次进程调用。
5. OpenDir/OpenFiles 最终仍然：修改全局 cwd、清空 active session、重启整个后端。

关键代码：

- single-instance 回调：`lib.rs:974-980`
- forwarded request：`open_request.rs:114-187`
- OpenFiles 合并：`open_request.rs:189-280`

### 热启动问题

- 所有现有 Code pane 共享的后端被停止并重启；进行中的对话、流式输出、iframe 状态会被打断或重新加载。
- 多个 OpenDir 线程没有有序队列，后一次点击可能先完成；最终 cwd 与用户点击顺序不一定一致。
- single-instance 在解析/校验前就抢焦点；无效参数也会打断用户当前操作。
- 路由仍然面向全局 session，而不是具体 pane/session。

## 5. 当前多 Pane 路由到底会做什么

前端 `applySessionBridgeToGrid` 的目标选择顺序为：

1. 当前活跃且类型为 Code 的 pane；
2. 固定 id `pane-code`；
3. 第一个 Code pane；
4. 第一个任意 pane。

找到目标后调用 `configurePane` 覆盖它；只有一个 pane 都没有时才调用 `addPane`。因此当前答案是：**Explorer 的“在 Kimi 小助手中打开”不会自然落到新 pane，会改写已有 pane。**

代码：`apps/kimi-shell/src/app/useShellController.ts:625-661`。

另有两个多 session 隐患：

- 同一个 navigate payload 同时发布到 `workspace-session-bootstrap` 和 `workspace-session-bridge`。当前覆盖操作近似幂等；一旦改为“每次新增 pane”，如果不按 `requestId` 去重，一次右键会新增两个 pane。代码：`workspace_session.rs:428-439`。
- `active_session_updated` 目前按“当前活跃 Code pane”更新 workDir，而不是按 `sessionId` 找所属 pane。多 Code session 并存时会把 A session 的目录写到 B pane。修复必须要求 payload 带 sessionId，并只更新匹配 pane。

## 6. 问题与 Bug 清单

| ID | 严重度 | 问题 | 影响 | 建议 |
|---|---|---|---|---|
| CM-01 | P0 | 用户点击“禁用”后未持久化期望状态；下次启动 auto-repair 会重新启用 | 设置不可信，用户无法永久禁用 | settings schema 增加 `context_menu_desired_enabled`；repair 仅在 desired=true 时安装 |
| OR-01 | P0 | 热启动 Explorer open 会重启全局后端 | 打断全部 pane/session | runtime ready 时直接 `create_workspace_session_for_grid`，禁止 restart |
| GRID-01 | P0 | session 导航覆盖当前/第一个 pane | 丢失当前 pane 绑定，违背多窗预期 | payload 增加 `disposition: new_pane`，调用原子 `openPane` action |
| GRID-02 | P0 | 双事件发布在 new-pane 模式下会双建 pane | 一次点击出现两个 pane | 单一 canonical event，或前端 `RequestIdDeduper` |
| GRID-03 | P0 | workDir 更新不按 sessionId 定位 | pane 显示错误目录、后续动作作用错工作区 | 仅更新 `pane.sessionId === payload.sessionId` 的 pane |
| OR-02 | P1 | pending bootstrap 是单一 Option | 启动期后来的请求覆盖前一个 | 改为有界 FIFO `VecDeque` |
| OR-03 | P1 | OpenDir 每个请求独立线程，无顺序协调 | 快速多次点击结果乱序、重复 stop/start | 共用 request coordinator/FIFO；running path不重启 |
| CM-02 | P1 | `AllFilesystemObjects` 与 `*`/`Directory` 重叠，且 folder 可能命中 `--open-files` | 菜单合并/优先级不稳定，文件夹可能报“不是文件” | 删除 AllFilesystemObjects Kimi verb |
| CM-03 | P1 | 菜单写入/删除后未通知 Shell | 菜单可能延迟刷新，用户以为操作失败 | 调用 `SHChangeNotify(SHCNE_ASSOCCHANGED, ...)` |
| CM-04 | P1 | enable 是顺序写入，失败可留下半套键 | status 变成损坏态，菜单残留 | 安装失败时清理自身键；状态区分 absent/partial/healthy |
| CM-05 | P1 | save labels 先存设置，再重写注册表 | 注册表写失败时 UI 文案与实际菜单不一致 | 先验证并建立回滚；成功后提交设置，失败恢复旧注册表 |
| CM-06 | P1 | “移动到工作区”实际调用复制 | 用户可能误解源文件会消失 | 改名“复制到 Kimi 小助手工作区” |
| GRID-04 | P1 | `WORKSPACE_GRID_MAX_PANES=6` 同时限制可见和总数；load 时也截断 | 无法实现第七个隐藏 pane；未来提高上限会丢状态 | 分成 `MAX_VISIBLE=6`、`MAX_TOTAL=12` |
| GRID-05 | P1 | 没有隐藏 pane 的稳定入口 | 收纳后无法发现/切回 | titlebar 增加 Pane Shelf 按钮与计数 |
| GRID-06 | P2 | 隐藏 pane 不渲染，重新显示会重建 iframe | iframe 内未提交草稿可能丢失 | 首版明确提示；后续增加 draft bridge 或保留最近隐藏 pane |
| CM-07 | P2 | status 把“主动禁用”和“注册损坏”都表达成 enabled=false | 自动修复/引导无法作正确决策 | 暴露 desired/installed/healthy 三维状态 |
| OR-04 | P2 | 静态命令缺少显式 `--` 路径终止符 | 极端路径解析防御不足 | 写成 `--open-dir -- "%1"` 等 |
| WIN-01 | P2 | 目前 Workspace Grid 只属于 `main` window | 未来多主窗口时请求目标不明确 | 记录 last-focused workspace window，payload 带 `targetWindowLabel` |

## 7. 推荐的目标行为

### 7.1 应用未打开

1. Explorer 启动应用并传入 open intent。
2. 解析并校验路径，生成稳定 `requestId`。
3. 请求进入 FIFO；第一条路径可作为冷启动后端的初始 cwd，但**不调用 restart**。
4. 后端启动一次。
5. runtime API ready 后，依次为队列请求创建独立 session。
6. 每个 session 发布一次 `navigate_session + disposition=new_pane`。
7. 前端按 Pane Placement Policy 展示；成功后显示/聚焦窗口。
8. 失败请求逐条发 error，不阻塞后续请求。

### 7.2 应用已经打开

1. single-instance 仅转发；不要在校验前抢焦点。
2. OpenFiles 可继续做短时合并；OpenDir 也进入同一个有序 coordinator。
3. 若 runtime ready，直接调用现有 `create_workspace_session_for_grid`。
4. 不调用 `set_session_work_dir`，不清空全局 active session，不 restart backend。
5. 发送带唯一 `requestId`、`sessionId`、`workDir`、`new_pane` 的 payload。
6. 前端成功接收后再聚焦，并 toast 结果。

## 8. Pane Placement Policy

### 8.1 两个上限

- `MAX_VISIBLE_PANES = 6`：Workspace Grid 的显示/渲染槽位上限。
- `MAX_TOTAL_PANES = 12`：包含 Pane Shelf 的 pane 元数据/session 上限，建议先固定为 12，后续可配置。

### 8.2 少于六个可见 pane

- 当前布局有空槽：直接使用空槽，不强制改变用户已选择的更大布局。
- 当前布局已占满：布局按 `1 → 2 → 3 → 4 → 5 → 6` 增长一级。
- 新 pane 成为 active，并取消 maximize。
- 新 pane 必须带新建的 `sessionId`，否则多个 Code pane 仍可能落到同一全局 URL。

### 8.3 已有六个可见 pane

不建议“创建后直接隐藏”，因为用户刚点击的结果看不到，会误以为失败。推荐：

1. 创建第七个 pane。
2. 把它放进当前 active slot。
3. 被替换 pane 保留在 `panes` 数组，移出 slots，进入 shelf。
4. toast：`已在新窗格打开 <目录>；原窗格已收纳到窗格库`。
5. shelf 按钮显示 `窗格 6+1`。

这利用了现有数据结构的优势：`panes` 与 `slots` 已经分离，`setPreset` 也已有保留隐藏 pane 的逻辑；真正阻碍是总数硬上限和缺少 UI。

### 8.4 达到总上限

禁止静默替换或丢弃。显示非阻塞对话框：

- 关闭最久未使用的收纳 pane并打开；
- 替换当前 pane；
- 打开 Pane Shelf 手动管理；
- 取消。

## 9. Pane Shelf UX

建议放在 titlebar 的布局按钮旁：

- 无隐藏 pane：`窗格 4`
- 有隐藏 pane：`窗格 6+2`
- popover 分成“当前布局”和“已收纳”两组。
- 每项显示 pane 标题、workDir 最后一级、完整路径 tooltip、session 状态。
- 点击已收纳 pane：交换进 active slot；原 pane 自动收纳。
- 每项有关闭按钮；关闭必须同时清理该 session 的 pane 级资源，但不应重启 backend。
- `Esc` 关闭；后续可加 `Ctrl+Alt+[` / `Ctrl+Alt+]` 在所有 pane 间轮换。

首版应明确：收纳 pane 默认不挂载 iframe，服务端 session 仍保留，但网页内尚未提交的本地草稿可能无法保证。若该风险不可接受，可对最近一个隐藏 pane 使用短时 keep-alive，再按 LRU 卸载。

## 10. 推荐改动边界

### 后端

- `types.rs`
  - schema 9 → 10；新增 `context_menu_desired_enabled`。
  - `WorkspaceSessionBridgePayload` 新增 `disposition`、`target_window_label`。
- `context_menu.rs`
  - install/uninstall 与用户 preference 分离。
  - 删除 AllFilesystemObjects Kimi 键。
  - 文案“移动”改“复制”。
  - 写/删后 Shell notify。
- `open_request.rs`
  - 给请求保留 origin/requestId；统一队列。
  - running path 直接创建 session。
  - cold path 排队并只启动一次。
- `workspace_session.rs` / `app_state.rs`
  - pending 从 Option 改 FIFO，或使用独立 `WorkspaceOpenQueue`。
  - 发布单一 canonical navigation event。

### 前端

- `app/types.ts`：增加 disposition/targetWindowLabel。
- `gridStore.ts`
  - 分离 visible/total 上限。
  - 增加原子 `openPaneFromExplorer` 与 `showPane`，避免先 setPreset 再 addPane 的中间态。
  - sanitizer 总数上限改 12。
- `useShellController.ts`
  - `new_pane` 调用原子 action。
  - 按 requestId 去重。
  - workDir update 按 sessionId 匹配。
- `ShellTitlebar.tsx`：接入 Pane Shelf。
- `grid.test.ts`：覆盖第七 pane、shelf swap、总上限、重复事件、session workDir 定位。

## 11. 发布顺序

1. 先修 CM-01、GRID-02、GRID-03；这些是新 pane 上线前的安全前置。
2. 后端改为无重启创建 session，并加入队列和 payload disposition。
3. 前端加入原子 placement reducer与测试，暂不展示 shelf 按钮也可通过 feature flag 灰度。
4. 上线 Pane Shelf 与第七 pane。
5. 最后清理冗余注册表键、改文案并调用 Shell notify。

这样可以避免“后端已发送 new_pane，但旧前端双建/丢失”或“前端能收纳，但后端仍重启全部 session”的半上线状态。

## 12. 验收标准

- 禁用 Explorer 菜单后，重启应用仍保持禁用。
- 应用运行且已有 1–5 个可见 pane：右键目录后后端 PID 不变，现有 pane 不刷新，新 pane 出现并绑定独立 sessionId。
- 已有 6 个可见 pane：右键后仍为六个可见槽位，总 pane +1；新 pane 可见，被替换 pane 出现在 shelf。
- 同一 requestId 同时从两个事件通道到达时只产生一个 pane。
- session A 的 active update 不会修改 session B pane 的 workDir。
- 冷启动快速右键三个不同目录：最终产生三个 session/pane，顺序可预测，没有请求被覆盖。
- 右键导入菜单文案使用“复制”，源文件/文件夹保持不变。
- enable/disable 后 Explorer 菜单立即刷新，无需重启 explorer.exe。
- 达到 12 个 pane 时有清晰的用户决策，不静默关闭任何 pane。

## 参考

- Microsoft Learn, *Creating Shortcut Menu Handlers*：静态 verb、command 子键、`%1`、级联菜单与 `MultiSelectModel`。
- Microsoft Learn, *Creating Shell Extension Handlers*：`*`、`Directory`、`Directory\Background`、`AllFileSystemObjects` 的适用范围；修改关联后调用 `SHChangeNotify`。
