# Agent Room（冻结归档）

> 类型：archive
> Canonical source：`.ai/decisions/2026-07-23-agent-room-decommission.md`

Agent Room 已从产品下线。此目录只保留短期兼容与历史审计代码，没有路由、窗口 capability、设置、标题栏或 Workspace Grid 入口；禁止新增功能或重新接线。

退出条件：支持升级的版本完成一个发布周期的 V2 layout 归一，且 release gate 证明无旧客户端依赖后，删除本目录及对应兼容命令、类型和测试。
