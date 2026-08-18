# Windows 用户验收清单

> **状态：已由 Native LAN 验收范围取代。** Gateway sidecar、三端口和配对项不再执行；当前 Windows 验收以 `09-native-lan-plan.md` 的 G3 清单为准。

> 执行人：用户（Windows 系统）
> Agent 当前目标：维护实现、Windows 编译/CI 静态契约与本清单；不代替 Windows 真机运行证据。
> 判定边界：清单未回填前，不宣称 Windows G3、双平台发布完成或防火墙规则可发布。

## 1. 证据元数据

每轮记录：

- Windows 10/11 版本与 build；
- KickSide commit、应用版本、NSIS/MSI 安装包 SHA-256；
- 浏览器与版本（Edge、Chrome）；
- 安装类型（NSIS/MSI）、全新安装/覆盖升级/卸载；
- 当前网络类别（Private/Public）及测试网卡类型；
- 另一台访问设备类型与浏览器；
- 结果、失败阶段、非敏感错误码、端口是否释放。

截图、终端输出和压缩日志必须先确认不含 QR secret、手动码、Cookie、Authorization、Kimi token、完整 WebSocket subprotocol、token-file 路径或用户 prompt/session 内容。

## 2. Private 网络

- [ ] 全新安装后，LAN 功能仍默认关闭且没有 Gateway listener/firewall rule 副作用。
- [ ] 用户主动开启后，只监听选中的 Private IPv4；不得监听 `0.0.0.0`、Public/虚拟/隧道网卡或 Kimi/DSH upstream 端口。
- [ ] Windows Defender Firewall 允许规则仅限应用/sidecar所需 executable、Private profile 与 LocalSubnet；Public profile 不启用。
- [ ] 同网段第二设备能打开 Portal，完成 QR 与手动码各一次；secret replay 被拒绝。
- [ ] Edge 与 Chrome 分别完成 Portal → Kimi top-level bootstrap、刷新、REST/stream/WebSocket、文件 upload/download/range。
- [ ] revoke 当前 Client 后页面请求失效，active WebSocket 关闭；重新配对后恢复。
- [ ] 防火墙拒绝或禁用规则时，另一设备不可达且 KickSide 显示可操作诊断；恢复规则后无需重装即可恢复。

## 3. Public/未知网络

- [ ] 将同一网卡切为 Public 后，开启请求 fail closed，不创建 Public allow rule。
- [ ] 若切换发生在运行中，Gateway 立即 revoke Session、关闭 active WebSocket/listener并进入明确状态。
- [ ] 另一设备不可通过旧 URL、Cookie 或 ticket 继续访问。
- [ ] 切回 Private 不自动暴露；必须由用户显式重新开启并重新配对。

## 4. 安装、升级与卸载

NSIS 与 MSI 分别执行：

- [ ] 全新安装创建的规则名称、程序路径、profile、remote address 与协议/端口范围精确。
- [ ] 覆盖升级不产生重复或陈旧规则；sidecar路径变化时旧规则被替换。
- [ ] 从旧版本升级时，退出顺序为 Gateway → Bridge → DSH → Kimi，升级前端口和 descendant 已清零。
- [ ] 卸载删除本产品创建的 firewall rule，不删除用户规则、应用数据或其他产品规则。
- [ ] 用户取消安装/升级或安装失败时，旧版本与既有规则保持一致、可恢复。

## 5. 生命周期与故障

- [ ] Control Center 停止、App Quit、updater 三条路径均关闭 Gateway parent/descendant、三 public ports 与 admin loopback port。
- [ ] Task Manager/PowerShell 检查不存在 orphan sidecar；旧 PID/port不能被新 generation 误认。
- [ ] sleep/wake、Wi-Fi断开/重连、IP变化、网卡优先级变化均触发 stop/revoke；旧 URL 与 ticket 永久失效。
- [ ] 端口冲突、Kimi停止、token rotate、DSH停止时 fail closed，错误不泄露 target/token/body。
- [ ] 连续启停 20 次、两客户端至少 30 分钟 soak 后无端口、进程、Session 或 firewall rule 漂移。

## 6. 建议的非敏感核对命令

```powershell
Get-NetConnectionProfile | Select-Object InterfaceAlias, NetworkCategory, IPv4Connectivity
Get-NetTCPConnection -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess
Get-NetFirewallRule | Where-Object DisplayName -Like '*KickSide*' |
  Select-Object DisplayName, Enabled, Profile, Direction, Action
Get-Process | Where-Object ProcessName -Like '*kickside*' |
  Select-Object ProcessName, Id, Path
```

仅提交与 KickSide 相关的裁剪结果；不要导出完整系统 firewall policy、环境变量、用户目录或进程命令行。

## 7. 回填格式

```text
Run ID:
Windows/build:
KickSide commit/version:
Installer + SHA-256:
Browser/device matrix:
Private allow/block:
Public fail-closed:
NSIS install/upgrade/uninstall:
MSI install/upgrade/uninstall:
Quit/updater/sleep/network cleanup:
Residual process/port/rule:
Result: PASS / FAIL
Non-sensitive notes/evidence path:
```
