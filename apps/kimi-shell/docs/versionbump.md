# 版本号 +0.0.1
pnpm -C apps/kimi-shell version:bump:patch

# 查看版本号
pnpm -C apps/kimi-shell version:bump:patch -- --dry-run

# 构建安装包
pnpm -C apps/kimi-shell tauri build

# 直接跳过签名构建 nsis
pnpm -C apps/kimi-shell tauri build --no-sign --bundles nsis