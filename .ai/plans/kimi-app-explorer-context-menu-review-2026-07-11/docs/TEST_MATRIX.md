# 测试矩阵

## 单元测试

### Grid reducer

- 1→2、2→3、3→4、4→5、5→6 布局增长。
- 当前 preset 已有空槽时不缩小/重排布局。
- 六个可见 pane 时新 pane换入 active slot，旧 pane进入 shelf。
- 选择 shelf pane 时反向交换。
- 同 sessionId 重复事件复用 pane。
- 12 个总 pane 拒绝第 13 个，但允许复用已有 session。
- 持久化/恢复保留 7–12 个 pane，不再截断到 6。

### Event routing

- bootstrap + bridge 同 requestId 只处理一次。
- requestId TTL 后可再次接收。
- workDir update 只命中相同 sessionId。
- `new_pane` 与 `replace_active` 兼容旧 payload。

### Context menu state

- desired=false + absent => healthy，不 repair。
- desired=true + absent => install。
- desired=false + partial => cleanup。
- desired=true + stale executable => reinstall。

## Windows 集成测试

至少在 Windows 10 与 Windows 11 各执行：

1. 安装、启用、禁用、重启应用，检查注册表和菜单即时刷新。
2. 文件、文件夹、目录背景各点击一次。
3. 多选 2、20、100 个文件，验证合并、复制、错误反馈。
4. 应用关闭、运行、最小化到 tray、后端 starting 四种状态。
5. 运行中打开目录时记录 backend PID，必须不变。
6. 六个 pane 满载时打开第七个，验证 shelf。
7. 快速连续打开三个目录，验证 FIFO 和三个唯一 sessionId。
8. 目录无权限、文件被占用、workspace root 不可写、runtime auth 失效。
9. 更新安装后旧 `AllFilesystemObjects` 键被清理。
10. 卸载后 Kimi 创建的所有键被删除，不影响其他应用 verb。

## 回归测试

- 普通启动仍恢复默认/最近 session。
- 手动从 Grid 添加 Code/Chat/External pane 的行为不变。
- 布局保存/恢复、最大化、拖拽、resize 不受影响。
- IM Bridge 的 session 切换继续采用原有 replace/activate 语义，除非显式 new_pane。
- Explorer “复制到工作区”不意外打开 session，除非产品新增独立“复制并打开”命令。

## 性能与稳定性

- 12 个 pane 中仅 6 个可见 iframe；检查内存和 CPU。
- shelf 交换 100 次无 pane/session 泄漏。
- 50 次快速右键请求队列有界，错误可观测，不死锁。
- 后端 crash/restart 后 pending request 可恢复或明确失败，不无限重试。
