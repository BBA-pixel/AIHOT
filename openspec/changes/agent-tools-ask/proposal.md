# Proposal：只读 Agent 工具扩展 + 站内 AI 问答（agent-tools-ask）

> 状态：**GPT 评审决策已并入**；**第二轮 GPT 七项修订已同步**（整轮失效／回执身份／崩溃事务／刷新快照／流式渲染安全／冒烟隔离／测试分层）。本阶段仍只交付 OpenSpec 方案与修订增量导出，不实现业务代码、不安装依赖、不改用户环境、不跑付费模型、不提交、不推送、不开 PR、不部署。
> 「提交方案」= 交给用户审阅，不是 git commit。
> **模型安全阀**：共享 `.env` 中 `MODEL_CALLS_ENABLED` 保持关闭；真实冒烟须另开确认且仅 ask 进程级启用（不改共享 `.env`），本阶段与未获批准前不得执行。

## Why

GAMEHOT 已有 MCP / Agent REST、精选解释（`selectionExplain`）与热点 `whyHot`，但解释数据只挂在站点详情 API；站内没有基于真实工具调用与流式答案的问答页。外部 Agent 与站内读者都缺少「为何入选 / 为何上榜」的只读工具，以及可追溯引用的问答体验。

本变更目标：

1. 将已有入选、热点解释数据开放为只读 Agent 工具（MCP + Agent REST），与现有工具共享 publication 公开范围。
2. 新增站内 `/ask`「AI 问答」：单 Agent 原生工具调用循环，展示真实执行步骤、真实流式答案与可追溯引用。
3. 不换皮、不重做评分与热度算法；第一版只在本地验收，不增加登录/注册/公网运营功能。

## What Changes

### 新增工具（名称沿用站点前缀 `gamehot_`）

| 工具后缀 | 作用 | MCP | Agent REST | 站内 Agent 白名单 |
|---|---|---|---|---|
| `get_latest` | 近期精选／全部公开资讯 | 已有 | 已有 | ✅ |
| `search` | 站内关键词搜索 | 已有 | 已有 | ✅ |
| `get_hot_topics` | 当前热点 | 已有 | 已有 | ✅ |
| `get_story` | 事件进展与报道 | 已有 | 已有 | ✅ |
| `explain_selection` | **新增**：资讯入选依据 | ✅ | ✅ | ✅ |
| `explain_hot` | **新增**：事件上榜依据 | ✅ | ✅ | ✅ |
| `get_daily` / `get_weekly` / `get_monthly` | 日／周／月报 | 保留 | 保留 | ❌ 第一版不进站内白名单 |

- **不改**已有工具名称与兼容行为；**不新增**同义工具；**暂不**新增主题时间线工具。
- 工具服务只读，不修改资讯、精选、归组、热榜或发布状态。
- MCP、REST、站内 Function Calling 适配共享同一业务实现、公开范围与字段契约；站内执行器直接调共享函数，不绕本机 HTTP 假装 MCP。
- 保留 `/api/v1/agent` Markdown 接入方式。

### 站内问答

- 新页面 `/ask`，名称「AI 问答」。
- 桌面入口在「更多」；手机入口在「我的」（`/more` 工具区）。
- 不改变原有主要内容栏目（资讯、热点、AI 日报、主题）。
- `/agent` 保留为外部接入说明，并补充新能力说明。
- 真实 SSE 流式 + 持久化事件；pg-boss Worker 跑 Agent；会话／任务／事件／证据表保留 7 天。

## Capabilities

### New Capabilities

- `agent-explain-tools`：`explain_selection` / `explain_hot` 的契约、公开范围与出口。
- `agent-ask`：站内 AI 问答页、任务状态机、SSE、工具白名单循环、引用与安全。

### Modified Capabilities

- `site-navigation`：在「更多／我的」增加「AI 问答」入口，不扩大主栏目；澄清与「不做工具类产品栏目」的边界。

## Impact

| 区域 | 影响 |
|---|---|
| 模块（优先） | 新建 `modules/ask/`：工具实现、问答 API、Worker 队列、迁移、页面、测试 |
| 引擎补丁（必要、小） | Agent REST 参数化能力；侧栏「更多」允许模块挂入口；`providers/llm.ts` 扩展流式＋工具调用（不破坏 `chatJson`）；合约／MCP 名称常量可选登记 |
| 导航规格 | `site-navigation` 增量 |
| 既有 publication | 复用 `selection-explain`、`stories.whyHot`、`scope`；不改评分门槛 |

## Out of Scope（不做什么）

- 不实现本阶段业务代码（待评审批准后另开实现阶段）。
- 不重做评分、热度、归组算法；不做 B 站／贴吧热榜新产品。
- 不新增主题时间线 Agent 工具；不把日报／周报／月报放进站内第一版白名单。
- 不做历史会话侧栏、跨会话长期记忆、导出、复杂工作台。
- 不做全网搜索、任意网页抓取、攻略／通用聊天、商城／史低／战绩等产品栏目。
- 不增加登录、用户注册、公网运营访问控制（另行讨论）；不因此取消参数校验、调用上限与密钥隔离。
- 不提交、不推送、不开 PR、不部署；不自动 pull／reset／同步上游。
- 不自动打开 `COLLECT_ENABLED` / `MODEL_CALLS_ENABLED` 等安全阀；不打印或修改用户密钥。

## 需要改引擎吗？

**需要少量、通用的引擎补丁**（详见 `files.md`「引擎补丁」；业务仍在 `modules/ask/`；不做过度抽象）：

1. **AgentAbility REST 参数化**（通用插口）：现有模块 `ability.answer()` 无请求参数且 `strictQuery(req, [])`，无法承载 `article_id`／`public_id`。扩展查询／路径参数传入，保持无参 ability 兼容。
2. **侧栏「更多」挂载点**（通用插口）：`sidebar()` 把「更多」弹出后再合并模块，模块无法写入真正的「更多」区。
3. **LLM 流式＋工具调用**（能力扩展，非业务搬家）：现有仅 `chatJson` 非流式 JSON；新增路径并走 receipts／budget，身份键覆盖 tools／消息；**不破坏** `chatJson`。

**不**把 `explain_selection`／`explain_hot` 业务实现写进引擎；引擎只提供插口与 LLM／receipts 能力。

## 与现有规格／代码的冲突与处理

| 冲突 | 处理 |
|---|---|
| `openspec/config.yaml` / 导航：「不做…工具」类产品栏目 | 本变更新增的是**独立问答能力**，不是史低／商城／战绩／工具产品栏；主内容栏目仍为四＋收藏；入口只进「更多／我的」。规格增量明确写出。 |
| `selectionExplain`／`whyHot` 仅站点详情、未进 MCP／Agent | 本变更补齐只读出口；字段仍不暴露内部热度分、receipt、密钥。 |
| 模块 Agent REST 无入参 | **已定**：通用 `AgentAbility` 插口扩展；业务仍在模块。不首选把两工具直接写进引擎。 |
| 门槛可能来自**当前** `SELECTION.thresholds` 而非历史快照 | 输出标明 `thresholdSource: recorded \| current_config`；不得冒充历史决策快照。 |
| 精选最终状态还依赖归组／代表稿等 | `explain_selection` 区分「分数达门槛」与「当前是否精选」；未知部分标 `unknown`，禁止模型补造。 |

## 原有能力／新增／个人贡献边界

| 边界 | 内容 |
|---|---|
| **原有（复用）** | MCP 七工具、Agent Markdown、publication 公开层、`buildSelectionExplain`、`whyHot`、pg-boss、receipts／budget、模块插口、导航「更多／我的」结构、DeepSeek OpenAI 兼容 `chatJson` |
| **新增（本变更）** | 两解释工具出口与契约；站内 `/ask`；会话／任务／事件／证据模型；Worker Agent 循环；SSE 重放；系统提示词版本；站内六工具白名单；测试矩阵 |
| **个人贡献（简历可讲）** | 工具契约与公开范围对齐；单 Agent 循环＋限额／幂等／取消；SSE 快照续接；整轮失效与回执 task×round；lease 失败安全；流式渲染安全；提示词分层＋代码侧防注入；假模型防护与真实评测分层 |

## 当前模型兼容性（只报告、不伪造、不付费探测）

来自本机 `.env`（不打印密钥）：

- `LLM_BASE_URL=https://api.deepseek.com/v1`
- `LLM_MODEL=deepseek-flash`
- `LLM_EXTRA_JSON={"thinking":{"type":"disabled"}}`
- `MODEL_CALLS_ENABLED=false`（开发安全阀关闭）

公开文档确认（DeepSeek Tool Calls / Chat Completions，2026）：

- `deepseek-flash` 支持 `tools` 与 `stream: true`。
- 流式 `tool_calls`：首包带 id／name，后续追加 `arguments`；须按 index 累积，**完整且校验通过后再执行**。
- 当前已关闭 thinking，避免 thinking 模式下 `tool_choice=required` 等限制。
- **本阶段未做真实付费探测**（brief 禁止）。实现阶段用假服务测协议。**真实冒烟仅在评审后用户另行确认**时执行；`MODEL_CALLS_ENABLED` 在获确认前保持关闭。若不支持则停止并报告，不得偷偷换模型。

## GPT 评审已定决策（已并入本变更）

1. **模块名**：采用 `ask`（包名 `@aihot/ask`，页面路径 `/ask`，队列名 `ask.run`，表前缀 `ask_`）。
2. **引擎改动策略**：优先做**小而通用的模块插口扩展**；业务逻辑留在 `modules/ask/`。必要引擎补丁须在 `files.md` 逐条写明原因。**禁止**过度抽象；**不**把两解释工具直接写进引擎 `agent.ts`／`mcp.ts` 作为首选（除非日后插口方案被否决，再另开决策）。
3. **真实模型调用**：现在**不**打开真实模型调用。自动化一律假模型／假服务。真实 DeepSeek 工具流式冒烟 **仅**在用户**另行明确确认**后执行；共享 `.env` 保持 `MODEL_CALLS_ENABLED=false`；冒烟仅 ask 专用进程启用模型，不改共享 `.env`、不拉起其它 Worker／cron。

## GPT 第二轮修订（已并入 design／specs／tasks）

1. **撤回＝整轮失效**：依赖证据不可公开后，答案／草稿／步骤／追问上下文均占位，禁止只藏来源卡仍返回旧正文。
2. **回执身份**：logical_key＝identity 哈希＋attemptTag；identity 绑定 task×round（非 subject）；同轮恢复复用、新任务／显式重试换键。
3. **崩溃／事务**：lease 或等价 CAS；回执已成功只收尾；不明／失联则失败并释放槽；入队原子／补偿；V1 无中途自动续跑；防 stuck 与双计费。
4. **刷新恢复**：完整快照＋`snapshotSeq`；SSE 游标续接；无重复无空洞。
5. **流式渲染安全**：未登记链接不可点；禁远程图／iframe／外部资源；导航仅证据登记。
6. **冒烟隔离**：仅 ask 进程开模型；不改共享 `.env`；不启动其它 Worker／cron；另批才能跑。
7. **测试分层**：假模型执行器防护 ≠ 真实模型行为评测；最终答案不继承 chatJson 强制 JSON。

## 仍采用默认、无需再拍板的约定

- 站内问答：复用服务预算＋每任务上限；第一版无登录配额 UI。
- 引擎补丁清单以 `files.md`「引擎补丁」表为准（AgentAbility 参数化、侧栏「更多」挂载、`llm` 流式＋tools、必要时 receipts 最小扩展）。

## 评审后下一步

用户明确**开工确认**后，才进入实现阶段（仍默认不 commit／push／PR／部署、不擅自开安全阀）。本需求文档与完整导出**不是**实现批准；真实冒烟须另开确认。
