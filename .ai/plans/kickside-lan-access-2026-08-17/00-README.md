# KickSide 局域网访问文档包

| 项 | 值 |
|---|---|
| 日期 | 2026-08-17；2026-08-18 改线 |
| 当前主路径 | Kimi Native LAN Access |
| 状态 | 已实现核心代码与 G1 定向验证；G3 尚未完成 |
| 非目标 | DSH、Gateway、配对、代理、防火墙自动修改、持久化开关 |

## 当前权威阅读顺序

1. [`07-native-lan-prd.md`](07-native-lan-prd.md)：MVP 产品范围与验收。
2. [`08-native-lan-spec.md`](08-native-lan-spec.md)：owned runtime、事务重启、registry、token 与 UI 契约。
3. [`09-native-lan-plan.md`](09-native-lan-plan.md)：实施进度与 G3 清单。
4. [`../../decisions/2026-08-18-kimi-native-lan-access.md`](../../decisions/2026-08-18-kimi-native-lan-access.md)：当前 accepted ADR。

## 未来备选档案

`01-research.md` 至 `06-windows-user-validation.md` 对应旧 LAN Gateway / Kimi + DSH 扩大方案，现已回退并降级为档案。只有 DSH 必须远程访问或产品需要设备级配对/权限控制时才重新评审；不得从这些文档恢复代码或 CI 接线。
