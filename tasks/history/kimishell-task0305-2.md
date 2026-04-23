为什么切到配置中心会卡一卡，是因为有什么具体的行为吗

---

是的，有具体行为触发这个“卡一下”，不是纯视觉问题。

主要在切到配置中心时会立刻触发这些调用：

1. 前端进入 `control_center` 时并发刷新  
[useShellController.ts](../../apps/kimi-shell/src/app/useShellController.ts#L934) 会同时调用 `refreshOnboarding`、`refreshContextMenuStatus`、`refreshInstallProbe`。

2. `refreshInstallProbe` 会跑外部命令探测  
[get_install_probe_status](../../apps/kimi-shell/src-tauri/src/backend_manager.rs#L662) 里会依次执行 `git --version`、`uv --version`、Python 3.13 检测、`kimi -v`。这些进程启动本身就可能带来顿挫。

3. `refreshOnboarding` 里也有同步检查  
[get_onboarding_status](../../apps/kimi-shell/src-tauri/src/lib.rs#L688) 会做 `context_menu::status` + `kimi_locator::locate`（PATH 搜索），而 `context_menu::status` 会读多项注册表键
[context_menu.rs](../../apps/kimi-shell/src-tauri/src/context_menu.rs#L226)。

4. 还有一次重复的右键状态读取  
`refreshContextMenuStatus` 又单独调用一次 `get_context_menu_status`  
[lib.rs](../../apps/kimi-shell/src-tauri/src/lib.rs#L420)，所以注册表检查会重复一遍。

如果你切到的是 runtime 面板，还会额外触发诊断：`kimi --version` + 读日志尾部，会更明显。  
如果你要，我可以下一步直接把这几项改成“首屏先渲染、后台增量刷新 + 短期缓存 + 去重调用”。

---

1. 是否可以不用每次都走 2-4 的探测和检查读取

---

可以，不必每次都走 2-4。

可以改成“缓存 + 失效触发”模式，卡顿会明显下降：

1. `install probe` 加 TTL 缓存（比如 60s），只在以下时机强制刷新：执行安装后、点击“手动刷新”。  
2. `onboarding` 状态加短 TTL（比如 5-10s），避免每次切屏都重新做 `kimi_locator` 和右键状态读取。  
3. 去掉重复调用：进入控制中心时不再同时调 `get_onboarding_status` 和 `get_context_menu_status`，保留一个主来源即可。  
4. `runtime_center` 的重诊断（含版本探测/日志读取）只在进入该面板或手动刷新时执行。  
5. 先渲染页面，再后台刷新（异步更新卡片），避免“切屏先卡一下”。

代价是状态会有几秒到几十秒的“非实时”，但对这个场景通常可接受。  
如果你同意，我可以直接按这个策略改一版（带可配置 TTL）。
