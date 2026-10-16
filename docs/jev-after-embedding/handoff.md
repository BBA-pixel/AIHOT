# Handoff — 上游 PR 提交记录

日期：2026-10-16。目标：`KKKKhazix/AIHOT:main`。关联功能讨论：[Issue #210](https://github.com/KKKKhazix/AIHOT/issues/210)。

## 范围和基线

从上游 `c8704e5` 建立独立分支，只移植 Jev 代码、测试和文档。没有带入 fork 的 wiki、召回窗口原型或其他未提交文件。之前两份 Review 的基线为 `8130030`，保留作为历史记录；本文件记录移植后的检查。

移植时保留上游已有的预算等待语义：`BudgetExceededError` 使归组维持 `pending`，而不是永久标为 `failed`；Jev 的预算耗尽测试随之改为断言 `pending`，仍验证异常可见且未写入归属。其余上游逻辑没有回退。

## 最新验证

Node v24.21.0，独立 `*_test` 数据库和本地供应商假服务，未使用真实模型凭证。

| 检查 | 结果 |
|---|---|
| Typecheck | 通过 |
| 完整后端 `npm test` | 800/800 通过 |
| Web production build | 通过 |
| 完整 Web tests | 55/56 通过；1 项失败，见下文 |
| 构建后站点 smoke | 全部通过，包括 MCP initialize |
| `git diff --check` | 通过 |

Web 失败：`apps/web/tests/article-outline.test.ts:55`，`the scrollbar must wrap the first heading`。本 PR 未修改前端及该测试；测试使用本地假 API。保留失败事实，不宣称完整检查全绿，也没有为通过测试修改滚动条行为或跳过断言。Docker 验证未执行。

## 暂缓和未完成

- 用户决定暂不处理整体任务超时问题，先提交 PR；[第二轮评审 F1](review-2.md) 仍未关闭，不伪称已修复。
- 未完成最新上游公开真实数据的改动前后全流程对照；历史实验不替代这项验收。不主张接入后准确率或召回率已有提升。
- 上游要求新配置/功能先讨论。因此先开功能 Issue，并以草稿 PR 展示实现，等待维护者确认是否适合框架。
- 保持 `GROUP_JEV_ENABLED=false`；没有生产启用或合并授权。

## Key Learnings:

1. 向上游提交应基于最新主分支，只移植当前功能；预算等待等上游行为需要保留并同步测试断言。
