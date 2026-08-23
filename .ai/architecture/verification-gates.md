# Verification Gates

## Shell

```bash
cd apps/kimi-shell
node scripts/build_bridge_sidecar.mjs
cd src-tauri
cargo fmt --all -- --check
cargo check --locked
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

```bash
cd apps/kimi-shell
pnpm exec tsc --noEmit
pnpm test
pnpm check:nfr:security
pnpm check:kimi-web:visual
node --test scripts/generate_updater_manifest.test.mjs
node --test scripts/publish_gitee_release.test.mjs
```

`pnpm check:kimi-web:visual` 使用本机 Chrome 对比脱敏 Kimi 0.36.1 fixture 的 10 张断点/主题/原生 TOC 左侧短条/mobile projection/focus 展开/sidebar 原状截图；Chrome 不在标准路径时设置 `CHROME_PATH`。它是 DOM 注入的本地视觉回归 gate，不替代 WKWebView/WebView2 G3。

Kimi Native LAN 由 Shell gate 覆盖：Rust 测试必须固定 local/LAN argv、external wildcard 拒绝与 owned wildcard loopback probe；React 测试覆盖 external disabled、可信网络确认、按需 QR 与内存清理。真实 Windows/macOS listener、防火墙与移动设备访问仍属于 G3。

真实 DSH runtime canary 在 `.github/workflows/dsh-runtime-canary.yml` 运行：PR 必须通过 Windows/macOS × Node 22.19/24 的 `0.1.1-rc.2` tested baseline smoke 与稳定汇总检查 `DSH runtime gate`；Rust 定向测试守护最低 `0.1.0-rc.6`、未来更高 SemVer 的运行资格，以及 npm latest 只能先冻结为精确目标、再按同一版本和官方 sha512 integrity 安装。每周/手动运行时每腿连续采样 5 次，并额外观察 Node 20.12 与官方 latest breaking；latest 告警不自动静默安装。仓库外仍需在 GitHub ruleset/branch protection 将 `DSH runtime gate` 配为 required，才具备不可绕过的远端合并权限。单机可运行 `pnpm check:dsh:runtime` 验证 tested baseline，或运行 `pnpm check:dsh:latest` 验证当时官方 latest；两者都使用隔离临时前缀/`DSH_HOME` 验证 npm 安装、固定入口、精确 loopback HTTP 状态、有界 `__DSH_BOOT__` 页面身份、整树停止和端口释放，但不经过 Rust 生产 npm launcher。需要重复采样时运行 `node scripts/dsh_runtime_smoke.mjs --version latest --samples 5`。

## IM Bridge

```bash
cd apps/kimi-im-bridge
go vet ./...
go test ./...
go test -race ./...
```

## Notes
- 当前 Windows 环境中 Rust test binary 运行阶段可能报既有 `STATUS_ENTRYPOINT_NOT_FOUND`；能运行时优先执行完整 `cargo test`。
- `pnpm exec` 可能触发非交互 install/purge 防护；本地已有 `node_modules` 时优先调用 `.\node_modules\.bin\tsc.cmd`。
- Apple Silicon 本机开发包使用 `pnpm tauri:build:macos:local`；该命令只验证可构建/可启动 `.app`，不授权 Developer ID、notarization 或 updater 发布结论。
- PR CI 必须实际执行 `cargo test --locked`，不能以 `--no-run` 代替；macOS PR job 必须上传经过 `plutil`/`lipo` 校验的 unsigned `.app` artifact，但该 artifact 不代表签名或公证通过。

## Manual Release Gates

- Gitee 镜像必须包含与 GitHub canonical Release 同名、同 SHA-256 的 NSIS/MSI、macOS app archive/DMG 和 `.sig`；Gitee `latest.json` 必须最后上传，并在 prerelease 提升 stable 前完成匿名回下载校验。
- 分别选择 Gitee、GitHub 与自动更新源验证检查/下载；自动模式覆盖单源不可达、两端版本不同和同版本优先 Gitee。每次发布监控 Gitee `/releases/download/latest/latest.json` 匿名入口、单文件 100MB 与仓库附件容量。
- 当前 GitHub-hosted runner 到 Gitee 的首个约 21MB 附件上传已实测在 15 分钟有界等待后失败；在迁移到可达 Gitee 的受控 runner 前，每次发布必须显式确认镜像 job 结果，失败时保持 prerelease，并按同一资产矩阵执行受控本机上传、公开回下载 SHA-256、manifest-last 与 stable promotion，不得把 job 触发成功当作镜像成功。

P5 发布前仍需要人工或专用环境验证：

- Windows 未登录状态启动或在 Kimi Code Web 触发 OAuth，系统默认浏览器必须打开验证页；完成验证并刷新后，控制中心仍能展示 `authMode`、Kimi 登录健康、Provider API 健康及诊断摘要。
- Telegram 私聊/群聊 prompt、stream、approval 与 Bridge 重启后的 pending approval 恢复。
- Feishu DM/group/thread prompt、streaming card、approval card 与 Bridge 重启后的 pending approval 恢复。
- Weixin 若继续保留在发布范围内，至少验证最小 inbound/outbound 链路；当前不提供 in-chat approval callback。
- NSIS/MSI 安装版 Bridge lifecycle buttons、bundled sidecar 路径、token-file 启动和日志脱敏。
- 日志与诊断脱敏：`backend.log`、`app.log`、诊断页复制内容和诊断包中，server token（含 URL 编码形式）、Bridge admin/host-control token、平台密钥和 API key 均不可见。
- OpenAPI/AsyncAPI 快照与回退路径在 CI 或发布脚本中固定。
- 从旧 NSIS 安装版验证：检测新版本、下载进度、签名校验、Kimi 后端/IM Bridge 停止、`passive` 安装和新版本启动。
- 从旧 MSI 安装版重复同一链路，确认 installer-specific `latest.json` 条目沿用 MSI；缺少专用条目时 legacy Windows 回退指向 NSIS。
- 断网、下载失败或损坏签名必须保留当前安装，且检查/下载失败前不得停止后端或 Bridge。
- GitHub Release 必须同时包含 NSIS/MSI、对应 `.sig` 和可解析的 `latest.json`；tag 必须与 `apps/kimi-shell/package.json` 版本一致。
- `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 只在仓库 Actions Secrets 中配置；发布日志和资产不得泄露密钥内容。
- macOS arm64 `.app` / DMG 必须在干净账户验证 traffic lights、App/Edit/Window 菜单、关闭隐藏、Dock reopen、Cmd+Q owned runtime 收口、OAuth 跳转、WebSocket、下载、文件选择和中文 IME。
- DSH 发布前必须在 Windows/macOS 各验证：Node/npm preflight、官方 latest 解析为精确版本、私有精确版本安装与 integrity/入口校验、默认工作区启动与 DSH UI 内会话目录切换、精确 loopback iframe 完整交互、端口占用错误、控制中心关闭/停止、应用退出、更新退出三条整树停止路径、最后一个 pane 关闭后进程仍存活、日志脱敏和无陈旧状态恢复；Windows 需 WebView2 + descendant taskkill 证据，macOS 需 WKWebView + process-group 证据。未完成任一平台时不得称为双平台发布完成。
- Kimi Web 布局发布前必须在 macOS WKWebView 与 Windows WebView2 各验证：480/800/959/960/1179/1180/1280/1440 CSS px、3:2 屏幕、125%/150% 缩放、明暗主题、长对话、空/多会话、中文 IME、触控与键盘/屏幕阅读器；确认 Sessions sidebar 与 Header 原样、所有宽度左侧 TOC 短条常驻且只在 hover/focus 时向右展开、mobile projection、无-sidebar 窄 pane 的 12px±1 composer 底距和蓝色工作区图标。任一真实引擎未完成时只可声明自动化完成，不得声明双平台视觉发布完成。
- 常规 macOS 公开发布必须针对最终 DMG 内的 app 通过 `codesign --verify --deep --strict`、`spctl --assess`、notarization 与 stapling；Developer ID certificate、Apple ID app-specific password 与 Team ID 只存 Actions Secrets。`0.1.24`、`0.2.0`、`0.2.1`、`0.2.2`、`0.2.3` 与 Accepted 决策精确批准的 `0.2.4` 临时未签名例外，改由 CI 验证 `.app` 仅含 ad-hoc signature 且无 Apple signing authority，并要求对应 Release 顶部标注未签名/未公证警告；例外不授权任何 Gatekeeper、双平台 G3 或生产就绪结论，后续版本不得自动沿用。
- GitHub Release 必须同时包含 Windows updater、macOS `.app.tar.gz`、两端 `.sig`、DMG 及同时含 `windows-x86_64`/`darwin-aarch64` 的唯一 `latest.json`；任一 build job 失败时 draft 不得发布。
