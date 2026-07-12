# Explorer 菜单行为矩阵

## 当前版本

| 操作 | 应用未打开 | 应用已打开 | 多 Pane 影响 |
|---|---|---|---|
| 目录空白处打开 | 启动 EXE；设全局 cwd；restart/start backend；不创建唯一 session | single-instance 转发；设全局 cwd；重启 backend | 全部 pane 受后端重启影响；不会新增 pane |
| 文件夹打开 | 同上，路径来自 `%1` | 同上；OpenDir 独立线程 | 多次点击可能乱序 |
| 单/多文件打开 | 复制到新生成工作区，再设全局 cwd并重启 | 350 ms 合并后复制并重启 | 全部 pane 受影响；不会新增 pane |
| 复制到默认工作区 | 复制后显示结果 | 复制后显示结果 | 不应重启；当前文案错误写成“移动” |
| 选择其他工作区 | 打开 picker queue | 打开 picker queue | queue 已使用 FIFO，设计优于 open request bootstrap |

## 目标版本

| 操作 | 应用未打开 | 应用已打开 | Pane 策略 |
|---|---|---|---|
| 目录/文件打开 | 请求排队；backend 启动一次；ready 后创建独立 session | 直接 runtime API 创建 session；backend PID 不变 | `<6`：显示新槽；`=6`：新 pane换入 active slot，旧 pane进 shelf |
| 复制到工作区 | 复制；不隐式改变当前 session | 同左 | 仅 toast/结果面板；用户可另选“复制并打开” |
| 总 pane 已达 12 | 启动后提示管理 pane | 立即提示 | 关闭 LRU / 替换当前 / 管理 / 取消 |

## 状态定义

- **可见 pane**：pane id 出现在 `slots[].paneId` 中，最多 6。
- **收纳 pane**：存在于 `panes[]` 但未分配到任何 slot。
- **active pane**：键盘/右键新请求默认交换的目标槽位。
- **active session**：后端历史全局字段；在多 pane 模型中不能再作为所有 UI 更新的唯一定位依据。
