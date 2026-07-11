# 验证记录

## 审查基线

```text
repository: endearqb/kimi-app
branch: main
commit: c2aaa14b9891c7de31363610d643ba70fa95c1e4
version: 0.1.7
```

## 已执行的工具包验证

| 验证项 | 结果 |
|---|---|
| `python -m py_compile apply_fixes.py` | 通过 |
| check-only 模式不修改 checkout | 通过 |
| 合成 fixture 上生成 15 文件 patch | 通过 |
| `git apply --check --whitespace=error` | 通过 |
| patch 应用 | 通过 |
| 应用后二次运行幂等 | 通过，输出 `All reviewed fixes are already present.` |
| capability JSON 解析 | 通过 |
| command permission TOML 解析 | 通过 |
| 生成的 Node 权限同步检查器 | 通过 |
| 使用真实注册表的 135 个 command 名称生成 ACL | 通过：Main 135、Prefill 6、Picker 4 |
| Go 变更 `gofmt` | 通过 |
| 非审查提交默认被拒绝 | 通过 |

## 修复器的安全属性

- 默认是 check-only。
- 默认验证精确 Git `HEAD`。
- 每个源代码替换要求唯一锚点；缺失或多重匹配会终止。
- 对已存在但内容未知的生成文件拒绝覆盖。
- 支持先输出动态 unified patch，再用 Git 单独校验。
- 不调用 GitHub API，不创建 commit、branch、push 或 PR。

## 需要在完整仓库执行的验证

当前环境没有完整 checkout，因此下列验证必须在本地仓库执行：

```powershell
# 1. 前端、单元测试和安全门
cd apps\kimi-shell
pnpm install --frozen-lockfile
pnpm verify
pnpm build

# 2. Rust/Tauri
cd ..\..
cargo test --manifest-path apps\kimi-shell\src-tauri\Cargo.toml

# 3. Go Bridge
cd apps\kimi-im-bridge
go test ./...
go vet ./...
go test -race ./...  # 需要支持 race detector 的工具链
```

## 建议的手工回归矩阵

| 场景 | 操作 | 预期结果 |
|---|---|---|
| Prefill | 启动、失败后重试、打开日志、退出 | 6 个白名单 command 正常，其他 command 不被调用 |
| Import Picker | 浏览目录 | 系统目录对话框正常打开 |
| Import Picker | 完成或取消请求 | 后端发布结果；窗口隐藏或展示队列下一项；无后台权限错误 |
| Bridge | 快速重复点击启动 | 只建立一个监听器，状态保持 `running` |
| Bridge | 启动过程中请求停止 | 生命周期串行执行，不出现伪 `crashed` |
| External pane | 点击嵌入后立即关闭窗格 | 延迟完成的 Webview controller 被自动关闭 |
| External pane | 创建中切换 URL/挂起 | 旧 controller 被判定过期并关闭 |
| Admin API | 单一合法 JSON | 正常处理 |
| Admin API | 两个拼接 JSON 值 | 400，业务 Service 不被调用 |
| 权限漂移 | 在 `commands.rs` 新增 command 但不更新权限 | `pnpm check:nfr:security` 失败 |

## 已知限制

本交付不是对所有业务逻辑的形式化证明，也不是动态渗透测试。重点结论来自对权限边界、并发时序、异步资源生命周期和请求解析路径的静态审查。完整构建、操作系统级 Webview 行为以及真实 IM 平台适配器仍需在目标 Windows 环境验证。
