# 开发 Spec（Technical Specification）

## 1\. 总体架构

### 1.1 架构原则

-   **壳不实现业务**：不对接 Kimi 的 API/协议，只负责“启动 + 展示 + 管理”
    
-   **强依赖 CLI 的稳定接口**：只依赖 `kimi web` 参数与本地 URL
    
-   **安全优先**：默认只绑定 `127.0.0.1`，避免远程内容拿到 Tauri 能力
    

### 1.2 模块图（逻辑）

-   Rust Backend（Tauri）
    
    -   `KimiLocator`：定位 `kimi` 可执行文件
        
    -   `BackendManager`：启动/监控/停止 `kimi web`
        
    -   `PortManager`：端口选择与探活
        
    -   `WindowManager`：主窗口、聚焦、toggle
        
    -   `TrayManager`：托盘菜单
        
    -   `ShortcutManager`：全局快捷键
        
    -   `SettingsStore`：保存用户配置（可执行路径、热键、工作目录）
        
    -   `LogManager`：stdout/stderr 收集与日志路径管理
        
-   UI（Tauri 内置静态页）
    
    -   `loading.html`：启动中
        
    -   `missing-kimi.html`：未检测到 `kimi` 的引导
        
    -   `error.html`：失败/崩溃恢复入口
        
-   外部依赖
    
    -   用户安装的 `kimi`（Kimi Code CLI）
        
    -   `kimi web` 本地服务（FastAPI + WebSocket + React UI）
        

* * *

## 2\. 关键依赖与命令调用

### 2.1 启动命令（MVP）

使用上游明确支持的参数：

```
kimi web --no-open --host 127.0.0.1 --port <PORT>
```

说明：

-   `--no-open`：防止弹系统浏览器（GUI 壳必须）
    
-   `--host 127.0.0.1`：明确绑定本机回环，避免外网访问风险
    
-   `--port <PORT>`：由壳决定起始端口（可默认 5494 或随机高端口）
    

> 备注：上游会在端口占用时自动尝试最多 10 个端口（起始端口到起始端口+9）。

### 2.2 可选安全参数（暂不建议 MVP 默认开启）

-   `--auth-token`：API Bearer Token 保护（适合 `--network/--public` 场景）
    
-   `--allowed-origins`：限制 Origin，防 CSRF（更偏网络暴露场景）
    
-   `--restrict-sensitive-apis`：限制敏感 API（配置写入、open-in、文件访问限制）
    

对壳来说：默认不暴露网络（不启用 `--network`），因此 MVP 可以不强依赖这些选项。

* * *

## 3\. 端口选择与服务就绪判定

### 3.1 端口策略（推荐）

**策略 A（推荐）**：随机起始端口（例如 55000–59999），降低冲突概率

-   壳选择 `PORT0`
    
-   启动 `kimi web --port PORT0`
    
-   探活 `PORT0..PORT0+9`
    

**策略 B（兼容上游默认习惯）**：从 5494 开始

-   与文档一致（用户更熟悉）
    
-   但冲突概率更高（开发者机器常驻服务多）
    

MVP 建议用 A；但诊断页可以展示“实际端口”。

### 3.2 探活接口

-   使用 `GET http://127.0.0.1:<port>/healthz`
    
    -   上游 Auth 中对 `/healthz` 有明确放行逻辑，说明其作为健康检查端点存在且可匿名访问。
        

探活流程：

1.  启动子进程后开始轮询（例如每 200ms）
    
2.  对 `PORT0..PORT0+9` 做探活
    
3.  任一端口返回 200 则认为 ready，记录实际端口
    

> 额外优化：也可以同时读取子进程 stdout 解析“Port X is in use, using port Y instead.”的提示，但不应作为唯一依据（日志格式可能变动）。

* * *

## 4\. WebView 加载与导航

### 4.1 UX 策略

-   主窗口先加载本地 `loading.html`
    
-   探活成功后，Rust 侧调用 `WebviewWindow::navigate(url)` 跳转到 `http://127.0.0.1:<port>`
    

这样可以：

-   秒开壳窗口（用户有反馈）
    
-   避免“白屏等待”
    
-   启动失败时可直接切换到错误页
    

### 4.2 导航实现要点

-   `navigate` 使用 `Url`（http/https）跳转
    
-   若 `kimi web` 需要一段启动时间，Loading 页面保持显示
    
-   若失败：
    
    -   留在错误页（内部静态页面）
        
    -   提供“重试”触发重新启动后台
        

* * *

## 5\. 进程管理（避免僵尸/端口占用）

### 5.1 进程生命周期状态机

-   `Stopped`：未启动
    
-   `Starting`：已 spawn，探活中
    
-   `Running`：探活成功
    
-   `Crashed`：进程退出/探活超时/连续失败
    
-   `Stopping`：发送终止信号中
    

### 5.2 启动（spawn）

Rust 侧：

-   `Command::new(kimi_path)`
    
-   `.arg("web") ...`
    
-   `.current_dir(work_dir)`（默认：上次目录/用户 home）
    
-   `stdout/stderr` 重定向到 log 文件（便于排障）
    

### 5.3 停止（graceful → force）

-   优雅终止：发送 SIGTERM（Unix）/ TerminateProcess（Windows 的默认 kill）
    
-   等待超时（例如 3–5s）后强杀
    
-   退出前必须执行 stop，避免端口残留
    

> 上游 `kimi web` 内部还会管理 worker 子进程（会话进程），但如果父进程被粗暴杀死，仍可能遗留；因此建议**尽量优雅终止**，并在 Windows 上考虑“杀进程树”的实现（Job Object / taskkill / 额外 crate）。

* * *

## 6\. 桌面交互：托盘与全局快捷键

### 6.1 系统托盘

使用 Tauri v2 的 tray API（Cargo feature `tray-icon`）。

托盘菜单（与 PRD 对齐）：

-   Toggle Window（显示/隐藏）
    
-   Restart Backend
    
-   Open Logs Folder
    
-   Quit
    

### 6.2 全局快捷键

使用 Tauri v2 global-shortcut 插件，并在 Rust 侧注册热键。

默认热键：

-   `CmdOrCtrl+Shift+K`
    

行为：

-   如果窗口不可见：show + focus
    
-   如果窗口可见：hide
    

### 6.3 单实例

使用 single-instance 插件保证只运行一个实例；二次启动则聚焦已有窗口。

* * *

## 7\. 配置与存储

### 7.1 配置项

-   `kimi_path`（可选）：用户手动指定的 `kimi` 可执行文件路径
    
-   `work_dir`（可选）：启动 `kimi web` 的默认目录
    
-   `hotkey`：全局快捷键字符串
    
-   `start_minimized_to_tray`：是否启动后隐藏到托盘（可选）
    
-   `auto_restart_on_crash`：后台崩溃是否自动重启（可选）
    

### 7.2 配置存储实现

-   建议使用应用配置目录中的 JSON 文件（简单、跨平台）
    
-   修改配置后：
    
    -   热键立刻生效（注销旧热键，注册新热键）
        
    -   工作目录变更后提示“需重启后台”并提供一键重启
        

* * *

## 8\. 安全设计

### 8.1 默认安全策略

-   始终使用 `--host 127.0.0.1`，不允许网络访问（不启用 `--network`）
    
-   不默认开启 `--dangerously-omit-auth`（该选项文档明确危险）
    

### 8.2 Tauri 权限暴露策略（重要）

由于主窗口最终加载的是 `http://127.0.0.1:<port>` 的“远程内容”（即便是本机），仍需假设存在：

-   端口被抢占/内容被替换的极端风险
    

原则：

-   **不给 Web UI 页面任何 Tauri 命令权限**
    
-   托盘/快捷键/进程管理全部由 Rust backend 完成
    

> 在 Tauri v2 里，ACL/Capabilities 用于限制插件命令对 JS 层的暴露，默认即“全部禁止”，你只需确保不要给主窗口配置不必要权限。

* * *

## 9\. 平台差异与兼容性声明

### 9.1 `open-in` 能力

上游 `open-in` API 当前只支持 macOS（实现里直接判断 `sys.platform != "darwin"` 就拒绝）。  
  
因此：

-   壳不应承诺 Windows/Linux 的 open-in 体验
    
-   macOS 上可作为卖点，但也要声明“由 Kimi CLI 决定可用性”
    

### 9.2 `kimi` 安装与支持范围

-   CLI 官方文档提供安装脚本与 uv 安装方式；壳只做引导，不做代装。
    
-   文档与平台说明存在“平台支持进度差异”的可能（部分平台文档仍提示 macOS/Linux 为主），因此壳应把 Windows 标记为“依赖你本机 `kimi` 是否可运行”。
    

* * *

## 10\. 测试计划（MVP）

### 10.1 冒烟测试

-   ✅ 已安装 `kimi`：启动 → Loading → Web UI 出现；无外部浏览器弹出
    
-   ✅ 快捷键：任意前台应用下 toggle 主窗口
    
-   ✅ 托盘：菜单可操作；Quit 正常退出
    

### 10.2 端口冲突测试

-   先占用起始端口（如 5494 或随机 port）
    
-   启动壳 → 自动换端口并成功加载
    

### 10.3 进程回收测试

-   启动壳 → Quit → 验证端口不再监听
    
-   强制 kill 后重启壳 → 仍能恢复（必要时自动改端口）
    

### 10.4 缺失依赖测试

-   PATH 无 `kimi`：
    
    -   显示 missing-kimi 页面
        
    -   安装指引与“重新检测”按钮可用
        

* * *

## 11\. 失败模式与恢复策略

<table style="min-width: 100px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>失败类型</p></th><th colspan="1" rowspan="1"><p>可能原因</p></th><th colspan="1" rowspan="1"><p>用户可见表现</p></th><th colspan="1" rowspan="1"><p>恢复策略</p></th></tr><tr><td colspan="1" rowspan="1"><p>找不到 <code>kimi</code></p></td><td colspan="1" rowspan="1"><p>PATH 不含；GUI 环境变量不同</p></td><td colspan="1" rowspan="1"><p>missing 页面</p></td><td colspan="1" rowspan="1"><p>提供安装指引 + 手动选择路径 + 重新检测</p></td></tr><tr><td colspan="1" rowspan="1"><p>启动超时</p></td><td colspan="1" rowspan="1"><p><code>kimi web</code> 崩溃；依赖缺失；权限问题</p></td><td colspan="1" rowspan="1"><p>一直 loading / error</p></td><td colspan="1" rowspan="1"><p>展示错误 + 打开日志 + 一键重启</p></td></tr><tr><td colspan="1" rowspan="1"><p>端口冲突</p></td><td colspan="1" rowspan="1"><p>端口被占用</p></td><td colspan="1" rowspan="1"><p>白屏/连接失败</p></td><td colspan="1" rowspan="1"><p>探活扫描 + 自动切换到实际端口</p></td></tr><tr><td colspan="1" rowspan="1"><p>后台崩溃</p></td><td colspan="1" rowspan="1"><p>CLI 内部异常</p></td><td colspan="1" rowspan="1"><p>UI 断连</p></td><td colspan="1" rowspan="1"><p>监听子进程退出，提示并提供重启</p></td></tr></tbody></table>

* * *

## 12\. 版本兼容策略（强烈建议写进 Spec）

因为上游是 Technical Preview，参数/行为可能更新：

建议：

-   启动前执行 `kimi web --help` 或直接尝试启动并捕获错误
    
-   若检测到不支持 `--no-open` / `--port`（理论上当前支持），提示用户升级 `kimi-cli`
    
-   诊断页显示 `kimi --version`（便于反馈 issue）