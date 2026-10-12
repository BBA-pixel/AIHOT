# agent-explain-tools Specification（增量）

## Purpose

将 GAMEHOT 已有的精选解释与热点解释，以只读 Agent 工具形式通过 MCP 与 Agent REST 暴露；与站内详情字段同源，遵守 publication 公开范围，不暴露内部热度分与回执。

## ADDED Requirements

### Requirement: 新增 explain_selection 工具

系统 SHALL 提供 MCP 工具 `gamehot_explain_selection` 与 Agent REST `GET /api/v1/agent/explain-selection`，查询可公开资讯的入选相关解释。输入 MUST 使用有效 `article_id`（来自既有工具或经验证站内链接）。输出 MUST 同时提供结构化字段与简明文本，包含：是否精选、分数、门槛、是否达门槛、门槛来源（recorded｜current_config｜unknown）、信源分级与标签、内容类型、评分轴（缺失为 null，不得重评）、通稿去重信息、站内与原文链接、asOf 时间，以及无法解释部分的 `unknowns`。系统 MUST NOT 将「分数达标」表述为完整入选原因；MUST NOT 在门槛取自当前配置时冒充历史决策快照；MUST NOT 暴露模型名、receipt 或预筛内部字段。

#### Scenario: 公开资讯返回解释

- **WHEN** Agent 传入一篇当前可公开资讯的 `article_id`，且存在分数或精选状态
- **THEN** 工具返回 structured.explain 与可读 text，且 `selected` 与 `metThreshold` 分列

#### Scenario: 轴缺失不重评

- **WHEN** 历史分析没有评分轴
- **THEN** `axes` 为 null，其它可得字段仍返回，且不触发评分模型

#### Scenario: 不可公开

- **WHEN** 资讯已撤回或不可公开
- **THEN** 返回 not_found 或 not_public，不泄露内部细节

### Requirement: 新增 explain_hot 工具

系统 SHALL 提供 MCP 工具 `gamehot_explain_hot` 与 Agent REST `GET /api/v1/agent/explain-hot`，查询可公开事件的上榜相关解释。输入 MUST 使用有效事件 `public_id`。输出 MUST 包含：是否在榜、排名（未在榜时明确 onList=false 且 rank=null）、**排名快照时间**（`rankingComputedAt`）、统计窗口与**统计截止时间**（`statsAsOf`）、近 48h 参与方数、近 6h 新增参与方数、近 24h 报道数、通稿合并提示、观察是否完整、相关公开报道与链接。系统 MUST 区分参与方数、独立报道源与报道篇数；MUST 区分榜单快照时间与统计数据时间，不得在文案中混用为同一「实时」时刻；MUST 说明独立参与方不等于事实已核实；MUST NOT 返回内部热度分、后台字段、密钥或模型回执。

#### Scenario: 在榜事件

- **WHEN** 事件在当前热榜中
- **THEN** onList=true 且 rank 为榜上名次，并带 rankingComputedAt（榜单快照）与 statsAsOf（统计截止）及 whyHot 同源统计，且二者语义在响应中可区分

#### Scenario: 未在榜

- **WHEN** 事件可公开但不在当前榜
- **THEN** onList=false、rank=null，仍可返回统计字段与相关报道（若公开可读）

#### Scenario: 合并事件

- **WHEN** public_id 指向已合并事件
- **THEN** 系统按现有 resolveStory 跟随目标一次，或返回明确 merged 语义，不得让调用方猜 ID

### Requirement: 共享实现与公开范围

`explain_selection` 与 `explain_hot` 的 MCP、Agent REST 与站内 Function Calling 适配 MUST 共享同一业务实现与字段契约，并 MUST 复用 publication 的公开范围、撤回与全文许可。系统 SHALL NOT 用直接 SQL 绕过该读取层。已有工具名称与行为 MUST NOT 因本能力被破坏。日报／周报／月报 MCP 工具 SHALL 继续保留。

#### Scenario: 与详情同源

- **WHEN** 同一公开资讯在站点详情有 selectionExplain
- **THEN** explain_selection 的核心字段与其一致（允许增加 Agent 友好的 note／unknowns／thresholdSource）

### Requirement: 不新增同义或时间线工具

本能力 SHALL NOT 新增与 get_latest／search／get_hot_topics／get_story 同义的工具，SHALL NOT 新增主题时间线工具。

#### Scenario: 工具清单

- **WHEN** 客户端列出 MCP 工具
- **THEN** 可见既有七工具加 explain_selection 与 explain_hot（及既有模块工具），无 search_featured／list_hot 等同义词
