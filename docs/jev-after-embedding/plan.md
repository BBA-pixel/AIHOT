# Plan — Jev 最小接入实施计划

状态：已实现并完成两轮代码评审，原分支定向测试 49/49 通过；最新上游移植检查见 [Handoff](handoff.md)；完整发布验收与业务回放未完成，默认关闭。2026-10-16 用户决定暂不处理整体超时问题，先提交 PR；该决定不等于生产启用授权。文中的代码路径均相对仓库根目录。

[Intent](intent.md) · [Spec](spec.md) · [Plan](plan.md) · [Review / Handoff](../jev-after-embedding-minimal.md#review)

下表保留原实施顺序与完成条件。当前 P1–P3 已实现，P4 已完成两轮评审和定向检查，完整发布检查尚未完成；P5 未执行。超时风险及验证边界见 [第二轮评审](review-2.md)。提交 PR 不等于生产启用授权。

| 工作包 | 依赖 | 工作与限定位置 | 完成条件 |
|---|---|---|---|
| P0 范围确认 | 本文 | 用户/维护者确认“只加否决门、保留原模型、Top10 不变” | G0 通过；若意图是替换原模型，先改 Spec |
| P1 配置与适配器 | P0 | `config.ts`、`.env.example`、新增 `providers/jev.ts`；复用现有凭证/回执/预算 | 本地假服务可验证开关、协议、错误、计费回执；默认关闭 |
| P2 关系规则 | P1 | `events/relate.ts`；复用现有行业定义及版本计算 | 纯函数证明仅 UNRELATED 覆盖，其他关系不变 |
| P3 流程接入 | P2 | `events/group.ts`；完整输入、关系 map、receipt IDs | 普通路径接入，特殊路径与精选逻辑回归通过 |
| P4 验证与交付 | P3 | `tests/jev.test.ts`、`tests/grouping-reliability.test.ts`；更新 grouping/deploy 文档 | G1 通过；提交测试输出、变更清单和风险记录 |
| P5 回放与启用 | P4 | 原隔离评估方式、现有管理员预算入口和 worker 部署 | G2、G3 通过后方可开启；不新增平台能力 |

实施约束：先写对应测试再接入；TS 使用 2 空格缩进；不修改历史迁移；不提交 `.env`、密钥或 `.data/`。若实现发现必须突破最小改动清单，先记录原因、更新 Spec 并评审，不默默扩大任务。
