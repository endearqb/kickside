# Windows 11 G3 Checklist · KickSide 0.2.0 + DSH

> 目标：补齐自动测试无法证明的 Windows x86_64 / WebView2 真机行为。建议使用测试机或新的 Windows 用户，不要先手改 `settings.json`。每一节记录“通过/失败 + 截图或错误文本”；失败时不要删除日志。

## A. 环境与安装

- [ ] Windows 11 x86_64，系统 WebView2 可用；记录系统版本与 KickSide `0.2.0`。
- [ ] 若机器仍装有 `Kimi Sidekick`，运行修复后的 KickSide NSIS：必须先出现“检测到旧版”提示；取消应停止安装，确认应调用旧卸载器、保留设置/应用数据，安装完成后“已安装的应用”中不再有两份产品。若旧版已被手动卸载，请注明本项无法复测，不要伪填通过。
- [ ] 若旧版和新包都使用 MSI，确认安装后只剩 KickSide 一项且设置仍在；新 MSI 必须显示/记录沿用 UpgradeCode `dfa197f9-0e61-5393-a612-7e4ca38701cc`，不得使用随 KickSide 名称新派生的 GUID。
- [ ] 从开始菜单直接启动 KickSide（不是从 PowerShell 启动），进入“KickSide 设置 → DeepSeek Harness”。
- [ ] 能识别本机 Node/npm；记录界面显示的 Node 版本。若未识别，点击“重新检测”后仍应给 E-DSH-001 与 Node.js LTS 指引，不应只显示不可点击按钮。
- [ ] 点击“安装固定版本”，最终显示 `DSH 0.1.0-rc.6` 已就绪；安装期间 UI 不假死，可查看日志尾部。
- [ ] 打开 DSH 开关后自动以默认工作目录启动，状态变为“运行中”，无需再点 pane 才启动后端。

> 2026-08-14 首轮结果：开始菜单启动已能识别 Node/npm，但固定版本安装在真正访问 registry 前因 `npm.cmd` 被直接交给 CreateProcess 而报 E-DSH-002；同一安装包也未跨产品名提示旧 Kimi Sidekick。源码已改为 `node.exe + npm-cli.js` 并加入品牌迁移 hook，本节所有勾选必须来自修复后新包。

## B. WebView2 与窗格体验

- [ ] 标题栏 `+` 菜单纵向显示 KimiCode、KimiChat、DeepSeek Harness 及各自图标。
- [ ] 连续点击两次 DeepSeek Harness，新增两个不同 pane，而不是只聚焦旧 pane；两个 pane 都能加载 DSH Web UI。
- [ ] 在 DSH UI 新建会话并发送一条最小消息，响应正常；KimiCode pane 同时可交互。
- [ ] 在其中一个 DSH pane 切换工作区/会话后，该 pane 的“打开当前会话目录”按钮打开正确目录，Pane Shelf 标题随目录 basename 更新；另一个 DSH pane 不被错误同步。
- [ ] 暗色模式下控制中心 rail、内容卡、按钮、开关与文字均可读；KimiCode 与 DSH 设置行只允许一个展开，右侧按钮/开关不会误触发展开。
- [ ] KimiCode pane 不再重复进入语言/外观欢迎页。

## C. 生命周期（关键）

- [ ] 关闭第一个 DSH pane，后端仍运行；关闭最后一个 DSH pane，后端仍运行。
- [ ] 在控制中心点击“停止实例”，8 秒内状态变为已停止，DSH 进程树消失；开关仍保持启用，详情中出现“启动实例”。
- [ ] 点击“启动实例”后使用默认工作区恢复 running；完全退出 KickSide 后，DSH 进程树消失。
- [ ] 再次启动后执行一次 KickSide 更新退出流程，DSH 进程树消失；若当前没有可安装更新，记录“待带版本差的 RC 复测”，不要伪填通过。
- [ ] 重新启动 KickSide 不会恢复旧 PID，也不会杀掉测试者另行启动的无关 Node 进程。

只读残留检查（PowerShell）：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match '@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

预期：pane 全关时仍有一条；控制中心停止、完全退出、更新退出后无输出。不要使用 `Stop-Process -Name node`，它会误杀其他 Node 工具。

## D. 故障与恢复

- [ ] 先占用 3080，再启动 DSH；KickSide 应选择后续空闲端口并正常加载，而不是信任 stdout 中的其他 URL。
- [ ] 在任务管理器中只结束当前 DSH 的 Node PID；2 秒内 pane/控制中心显示 crashed、E-DSH-005、退出信息与重试/日志入口，不出现白屏。
- [ ] 控制中心显示“重试启动”，pane 显示“重试后端启动”；点击任一恢复入口后重新进入 running，旧端口和旧 PID 不再被当作权威状态。
- [ ] 断网时已安装 DSH 仍能启动本地 Web；重新安装失败应显示 E-DSH-002 和 registry/网络/代理提示，原已验证安装不能被半成品替换。

占用单端口的 PowerShell 示例（测试结束用 `Ctrl+C` 关闭）：

```powershell
$listener = [System.Net.Sockets.TcpListener]::new(
  [System.Net.IPAddress]::Loopback,
  3080
)
$listener.Start()
Write-Host 'Port 3080 occupied; press Ctrl+C after the DSH start check.'
while ($true) { Start-Sleep -Seconds 1 }
```

## E. 结果回填

请回传以下任一形式：

1. 直接在本文件勾选并补充 Windows/Node/WebView2 版本；或
2. 发四张截图：安装就绪、双 DSH pane、最后 pane 关闭但进程仍在、控制中心停止后 PowerShell 无残留；失败项附可见错误和 DSH 日志尾部。

回填后仍需关注：双 pane 与 Kimi 并排 2 小时长稳、更新退出需要真实版本差。其他自动化证据由 `dsh-runtime-canary.yml` 和 Rust Windows descendant test 提供。
