# kimi-app 代码审查与本地修复工具包

本工具包针对以下代码基线制作：

- 仓库：`endearqb/kimi-app`
- 分支：`main`
- 审查提交：`c2aaa14b9891c7de31363610d643ba70fa95c1e4`
- 应用版本：`0.1.7`
- 制作日期：`2026-07-11`

工具包只读取或修改你本地的 Git checkout。它**不会**创建分支、提交、推送、Issue 或 Pull Request，也不调用 GitHub 写接口。

## 运行条件

- Git 可在命令行使用。
- Python 3.10 或更高版本。
- 应用后完整验证需要仓库原有的 Node.js/pnpm、Rust 和 Go 工具链。

## 包含内容

- `REVIEW_REPORT.md`：问题、风险、根因和修复设计。
- `apply_fixes.py`：保守型修复器；默认只检查，不写文件。
- `Apply-KimiAppFixes.ps1`：Windows PowerShell 入口。
- `apply-kimi-app-fixes.sh`：macOS/Linux/Git Bash 入口。
- `VALIDATION.md`：已完成的验证、未完成项和本地复验命令。
- `SHA256SUMS.txt`：工具包内文件校验值。

## 推荐用法（Windows）

先解压 ZIP，然后在 PowerShell 中执行：

```powershell
# 1. 只检查：不会修改仓库
.\Apply-KimiAppFixes.ps1 -RepoPath "D:\code\kimi-app" -Mode Check

# 2. 生成补丁：仍不会修改仓库
.\Apply-KimiAppFixes.ps1 `
  -RepoPath "D:\code\kimi-app" `
  -Mode Patch `
  -PatchPath "D:\temp\kimi-app-review-fixes.patch"

# 3. 再由 Git 校验和应用

git -C "D:\code\kimi-app" apply --check --whitespace=error "D:\temp\kimi-app-review-fixes.patch"
git -C "D:\code\kimi-app" apply "D:\temp\kimi-app-review-fixes.patch"
```

也可以让修复器直接写入工作区：

```powershell
.\Apply-KimiAppFixes.ps1 -RepoPath "D:\code\kimi-app" -Mode Write
```

`Write` 只改本地文件，不执行 `git add`、`git commit`、`git push` 或创建 PR。建议先使用 `Patch` 模式审阅 diff。

## 直接调用 Python

```powershell
# 默认 check-only
py -3 .\apply_fixes.py --repo "D:\code\kimi-app"

# 生成 patch
py -3 .\apply_fixes.py `
  --repo "D:\code\kimi-app" `
  --patch-output "D:\temp\kimi-app-review-fixes.patch"

# 直接写入本地 checkout
py -3 .\apply_fixes.py --repo "D:\code\kimi-app" --write
```

## 基线保护

修复器默认要求本地 `HEAD` 等于审查提交，以避免把基于旧代码制作的替换错误应用到新版本。

本地分支已经前进时，先用 Patch 模式生成并人工审阅差异，再显式放宽版本检查：

```powershell
.\Apply-KimiAppFixes.ps1 `
  -RepoPath "D:\code\kimi-app" `
  -Mode Patch `
  -AllowOtherRevision
```

即使开启 `AllowOtherRevision`，修复器仍要求所有源代码锚点唯一匹配；代码结构变化时会拒绝继续，而不是盲目改写。

## 应用后的验证

在仓库根目录运行：

```powershell
# Desktop shell
cd apps\kimi-shell
pnpm install --frozen-lockfile
pnpm verify
pnpm build
cd ..\..

# Rust/Tauri
cargo test --manifest-path apps\kimi-shell\src-tauri\Cargo.toml

# Go IM Bridge
cd apps\kimi-im-bridge
go test ./...
go vet ./...
# 工具链支持 CGO/race detector 时再运行：
go test -race ./...
```

桌面集成层还应手工回归：

1. Prefill 启动、重试、打开日志与退出。
2. Workspace Import Picker 浏览目录、完成导入和取消。
3. Bridge 连续快速点击启动/停止/重启。
4. 外部窗格点击“在窗格内打开”后，立即关闭窗格或切换 URL。
5. `pnpm check:nfr:security` 能识别命令注册表与权限清单不一致。

## 回退

补丁尚未提交时，可按文件回退：

```powershell
git -C "D:\code\kimi-app" restore -- `
  apps/kimi-shell `
  apps/kimi-im-bridge
```

请先确认这些目录没有需要保留的其他未提交改动。更稳妥的方式是应用前保存当前 diff：

```powershell
git -C "D:\code\kimi-app" diff --binary > "D:\temp\kimi-app-before-review-fixes.patch"
```
