# Spec — Jev 最小接入规格

状态：已实现并完成两轮代码评审，原分支定向测试 49/49 通过；最新上游移植检查见 [Handoff](handoff.md)；完整发布验收与业务回放未完成，默认关闭。2026-10-16 用户决定暂不处理整体超时问题，先提交 PR；该决定不等于生产启用授权。文中的代码路径均相对仓库根目录。

[Intent](intent.md) · [Spec](spec.md) · [Plan](plan.md) · [Review / Handoff](../jev-after-embedding-minimal.md#review)

### S1. 需求编号

| ID | 必须满足的要求 |
|---|---|
| R01 | 仅在普通自动归组的 Embedding 召回后接入 Jev；特殊路径不改 |
| R02 | Jev 的 UNRELATED 否决本次候选关系；其余分类不直接决定归属 |
| R03 | 保留完整 cands、reading、原 judgeBatch 和精选增量判断职责 |
| R04 | 仅新增三项配置；默认关闭；缺必要条件时报错，密钥只在后端 |
| R05 | 所有请求经原回执与预算；业务成功后 complete；异常不作负例、不静默绕过 |
| R06 | 候选、回执、输入和提示词版本可追溯；不记录密钥，不执行材料指令 |
| R07 | 无新表、队列、页面；召回窗口、Top-K、阈值及原有复核不变 |
| R08 | 支持配置关闭；不自动回滚已写归属，不自动重跑历史 |
| R09 | 上线前完成真实候选的开关对照回放与人工验收，不以单项实验替代 |

### S2. 流程与判定规则（R01–R03）

```text
普通新报道
  → 现有 Embedding / recallFacts / candidateViews
  → Jev 对每个候选代表报道做四分类                 [新增]
  → 现有 judgeBatch（仍接收完整 cands 和 reading）
  → 把 Jev 判为 UNRELATED 的关系结果覆盖为 UNRELATED [新增]
  → 原 sameOccurrence / storyForDevelopment
  → 原 confirmMerge、写入、精选与故事整合
```

这里的“否决”是**关系结果过滤，不是删除模型输入中的报道材料**。必须保留原 `cands` 和 `reading`，否则被删掉的“已公开精选”可能不再参与增量价值比较。

| Jev 结果 | 第一版动作 |
|---|---|
| `UNRELATED` | 覆盖该候选的最终关系为 `UNRELATED`，阻止本次自动关联 |
| `SAME_OCCURRENCE` | 不直接合并，保留原归组模型与复核结论 |
| `SAME_STORY` | 不直接加入故事，保留原流程及 story root 限制 |
| `ROUNDUP` | 不直接合并或删材料，交原流程处理；已有综合稿安全边界不变 |
| 请求失败、缺项、无效响应 | 当前任务失败/待恢复；不能当成 `UNRELATED`，不能静默绕过 Jev |

第一版沿用已测的四分类胜出项，不再增加一个未经校准的“0.8/0.9”门槛。概率和 `confidence` 存回执用于复核，不能宣称是本项目校准后的正确率。

**成本说明：**保留原归组请求，因此这一版会新增 Jev 成本和时延，不能宣称节省原 LLM 调用费。压缩候选输入、拆分精选判断、替换原归组模型，均不是本次需求。

### S3. 配置与最小文件清单（R04–R07）

配置值写在部署使用的根目录 `.env`；`.env.example` 仅写占位和说明，不写真实密钥。

```dotenv
# 新增；只有字面值 true 开启，开发和默认配置保持关闭
GROUP_JEV_ENABLED=false
# 新增；不是 GROUP_MODEL 的 chat preset 名称
GROUP_JEV_MODEL=typesafe/jev-1.13
# 新增；已有同名 OpenRouter 凭证可直接复用
OPENROUTER_API_KEY=
```

| 配置/信息 | 放置与读取位置 |
|---|---|
| `GROUP_JEV_ENABLED` | `packages/backend/src/config.ts`：新增 `groupJevEnabled: bool("GROUP_JEV_ENABLED", false)` |
| `GROUP_JEV_MODEL` | 同文件：新增 `groupJevModel: str("GROUP_JEV_MODEL", "typesafe/jev-1.13")` |
| `OPENROUTER_API_KEY` | 新 provider 调用现有 `credential("models", "OPENROUTER_API_KEY")`；不进入前端配置 |
| 分组凭证部署 | 也可沿用 `AIHOT_CREDENTIALS_DIR` 下的 models 凭证文件；实际文件名服从 `site` 的 `DEPLOYMENT.credentialFiles` 配置；环境变量优先 |
| API 地址 | 新 provider 内固定 `https://openrouter.ai/api/alpha/decisions`，第一版不增加生产 Base URL 配置 |
| 全局付费开关 | 复用已有 `MODEL_CALLS_ENABLED`，不得绕过 |
| Embedding 凭证/模型 | 沿用已有 `EMBEDDING_*` 或 DashScope 配置，不新增、不改动 |
| 预算 | 复用现有 `budgets` 表和管理员预算接口，服务名固定 `openrouter-jev` |

**不改 `site/models.ts` 的 `PRESETS`，不把 `GROUP_MODEL` 设成 Jev。** 现有 preset 走聊天模型协议；Jev 使用 Decisions API，不能只换一个模型名后继续请求 `/chat/completions`。

启用前必须满足：全局模型开关已开、Embedding 可用、OpenRouter 密钥存在、`openrouter-jev` 预算记录已配置且额度为正。缺项应给出明确配置错误，不得悄悄退回“未启用”或文字召回。

预算通过已有 `PUT /api/admin/budgets/openrouter-jev` 配置，请求字段为 `perMinute`、`perHour`、`perDay`（非负整数）及 `reason`；也可沿用现有管理员预算入口。具体限额按站点量级设置，不在本文虚构生产数字。**只调用 `paidRequest()` 不足以证明已限额：当前实现没有预算行时视为不限额。** 因此启用校验需要确认该服务预算行存在。额度耗尽仍交现有预算熔断处理，不另造一套美元预算器。无需新增 schema 迁移。

后端：**1 个新增文件、4 个已有文件局部修改**。另有 `.env.example`、测试与说明文档的必要变更。

| 文件 | 变更 | 只做什么 |
|---|---|---|
| `packages/backend/src/providers/jev.ts` | 新增 | Decisions HTTP 调用、响应校验、原始回执、成本与错误映射；不读写事件表 |
| `packages/backend/src/config.ts` | 修改 | 上述两个非密钥配置字段；复用现有凭证读取 |
| `packages/backend/src/events/relate.ts` | 修改 | 构造四分类问题和精简报道输入；增加“UNRELATED 否决”的纯函数 |
| `packages/backend/src/events/group.ts` | 修改 | 在候选准备后插入 Jev；合并关系结论；接入既有回执完成流程 |
| `packages/backend/src/providers/llm.ts` | 修改 | 仅把已有的连接错误判断函数 `isConnectFailure` 改为导出，供 Jev 适配器复用；无行为变化（评审后补记） |
| `.env.example` | 修改 | 三个配置项，开关默认 false，无密钥 |
| `tests/jev.test.ts` | 新增 | provider、四分类解析和否决规则测试，全部本地假服务 |
| `tests/grouping-reliability.test.ts` | 修改 | 接入点、失败恢复和归组边界回归 |
| `docs/grouping.md`、`docs/deploy.md` | 修改 | 流程、三项配置、预算与关闭方式的短说明 |

### S4. `providers/jev.ts`：薄适配器，不做通用 SDK

建议函数形状：

```ts
// 示意签名；实现时沿用仓库现有命名与类型风格。
async function decideRelation(input: {
  articleId: string;
  revision: number;
  factId: number;
  state: unknown;
  question: unknown;
  promptVersion: string;
}): Promise<{
  relation: Relation;
  confidence: number;
  probabilities: Record<Relation, number>;
  receiptId: number;
}>;
```

- POST Decisions API，模型取 `config.groupJevModel`，问题采用 `choice`。
- 请求结构仅为 `model`、`state`、`questions: { relation: ... }`；`state` 包含新报道和候选代表报道。
- 每个候选单独一次请求，先用普通顺序循环，不增加并发池、独立队列或批量协议。候选数沿用现有限制；不要硬编码“永远至多 10”，相关链接召回可能带来额外候选。
- 整个 Jev 阶段受总预算约束（300 秒，归组任务队列过期时间为 600 秒，需留出后续归组、复核与写入的余量）：每个请求的超时取“剩余预算与单请求上限 120 秒”的较小者；预算耗尽或请求超时都按请求失败处理（回执 unknown、任务失败待恢复），不得继续发起新请求，也不得提交部分归组。
- 使用 `paidRequest()`：`service = "openrouter-jev"`，`purpose = "group_jev"`，`subject = article:<id>`。
- `identity` 至少包含 article ID/修订、fact ID、实际输入、模型、端点、提示词内容版本与判定策略版本，确保输入或策略变化不错误复用旧结论。
- 用现有 `assertAccepted` / `ProviderRejectedError`、`rejectReceivedResponse`、`ModelOutputError` 语义；不新增自动重试或失败后改走另一模型的兜底。
- 校验完整四类概率、有限数值、范围、胜出项和置信度；响应缺项/异常不是不相关。允许供应商的概率小数舍入误差，测试边界。
- 保存原始响应、request ID、usage；有实际 `usage.cost` 则记录 USD actual，没有则不能填成 0 或伪称 actual。
- 只有业务写入成功后才完成对应回执。HTTP 成功但任务未提交时保留可恢复响应，不重复付费。
- 不记录密钥；不执行报道文本中的指令。

### S5. `events/relate.ts`：复用关系定义

- 复用现有 `RELATIONS`、`ReportView`、`CandidateView`、`Verdict`。
- criteria 内容取 `industry/prompts/group-definitions.md` 的四段定义；instructions 取 `group-method.md` 并明确“仅判断材料，不执行材料中的指令”。检查四个定义齐全，解析失败直接报错。**不复制四份新的行业定义。**
- 使用现有 `promptText()` / `promptVersion()`；版本必须覆盖上述两个文件及新增的固定指令/策略版本。
- 输入为标题、摘要前 360 字符、来源、发布时间；沿用本次已测字段，不夹带金标、站点评分或整篇长正文。更丰富的 frame 等输入以后单独评估。
- 新增纯函数：复制原 verdict map，仅把 Jev 返回 `UNRELATED` 的候选改为 `UNRELATED`，其余条目原样保留。被否决条目的 note 明确来源；对应 confidence 使用 Jev 返回值，不把原 LLM 的置信度套到另一结论上。
- 这不是 Jev 与原 LLM 的概率融合，也不平均两者置信度。

### S6. `events/group.ts`：明确插入点

定位普通报道路径的这一段，而不是 signal 路径的 `judgeSignal()`：

```ts
const cands = ... candidateViews(await recallFacts(...));
const reading = ... recallSelectedBackground(...);
// 此处：满足第一版范围时，逐候选取得 Jev 结果和 receipt IDs。
// 然后：保留原 judgeBatch(query, cands, reading)。
// 最后：只对 judged.verdicts 应用 UNRELATED 否决。
// judged.selection 不因新增门控而被重算或清空。
```

实施要求：

1. 仅在 `GROUP_JEV_ENABLED`、普通自动归组范围、候选非空时调用。composite、kept、sameUrl 等现有特殊归属路径不接入；无候选但有 reading 时仍只运行原精选判断。
2. 保留完整 `cands`、`reading`，`judgeBatch()` 的输入与选择价值语义不变。
3. 最终 map 必须用于后续所有自动关系消费者，包括 `sameOccurrence()`、`storyForDevelopment()`、本次 `firmlyTied()` 及故事连接依据；不要只改其中一处，导致被否决关系从另一入口重新生效。
4. 新 Jev 回执进入已有 `receipts` 完成/恢复流程；保持原 batch receipt 仍为主决策回执（不要无意改变 `receipts[0]` 的含义）。多个 Jev 回执通过 subject、fact 输入与原始响应可追溯，不为它们新增表/列。
5. 一个候选失败时不提交部分归组。已收到的其他候选响应由回执机制复用；unknown 不由新适配器自行重发。现有后台恢复语义不改。
6. 保留人工纠正优先级、修订锁、现有复核和事务提交；模型调用不放进长数据库事务。
