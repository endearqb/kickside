# 版本号 +0.0.1
pnpm -C apps/kimi-shell version:bump:patch

# 查看版本号
pnpm -C apps/kimi-shell version:bump:patch -- --dry-run

# 构建安装包
pnpm -C apps/kimi-shell tauri build