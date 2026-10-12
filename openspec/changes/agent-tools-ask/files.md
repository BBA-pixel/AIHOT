# Files：agent-tools-ask（拟改；实现阶段）

> 模块名已定：`ask`（`@aihot/ask`）。引擎补丁仅限下表通用插口；业务代码不进引擎。

## OpenSpec（本阶段已写）

- `openspec/changes/agent-tools-ask/.openspec.yaml`
- `openspec/changes/agent-tools-ask/proposal.md`
- `openspec/changes/agent-tools-ask/design.md`
- `openspec/changes/agent-tools-ask/tasks.md`
- `openspec/changes/agent-tools-ask/files.md`
- `openspec/changes/agent-tools-ask/specs/agent-explain-tools/spec.md`
- `openspec/changes/agent-tools-ask/specs/agent-ask/spec.md`
- `openspec/changes/agent-tools-ask/specs/site-navigation/spec.md`

## 模块（优先，新建）

- `modules/ask/package.json` — `@aihot/ask`
- `modules/ask/module.ts` — 页面 `/ask`、apiPaths
- `modules/ask/server.ts` — HTTP、队列、abilities、retention、llms
- `modules/ask/web.tsx` — 导航 tools／sidebar、可选 agent 页部件
- `modules/ask/web/ask.tsx` — 问答页
- `modules/ask/src/tools/explain-selection.ts`
- `modules/ask/src/tools/explain-hot.ts`
- `modules/ask/src/tools/whitelist.ts` — 六工具适配
- `modules/ask/src/agent/loop.ts` — Worker 循环
- `modules/ask/src/agent/prompt.ts` + `prompts/system-v1.md`
- `modules/ask/src/http/routes.ts` — `/api/ask/*`
- `modules/ask/src/http/sse.ts`
- `modules/ask/src/db/*` — 会话任务事件证据访问（含 lease、round、receipt 关联、整轮失效）
- `modules/ask/migrations/*` — 新迁移（不改历史文件）
- `modules/ask/tests/*` — 假模型防护用例与（另册）真实评测清单分离
- `modules/ask/scripts/smoke-ask.ts`（或等价）— 可选：进程级开模型的一次性 runner（不改共享 `.env`；默认不提交为常开）

## 站点挂载

- `site/modules/index.ts` / `server.ts` / `web.ts` — 列入 ask 模块
- `site/package.json` — dependency
- `Dockerfile` — COPY modules/ask/package.json（若现有模式需要）
- `site/site.ts` — 可选 CARDS.ask 分享文案
- `apps/web/app/routes/agent.tsx` 或模块 AgentPart — 补充 explain 工具说明（尽量模块）

## 引擎补丁（单独列出，便于合并上游）

| 文件 | 原因 |
|---|---|
| `packages/backend/src/modules.ts` | 扩展 `AgentAbility`：query／args 传入 `answer`；保持无参能力兼容 |
| `apps/api/src/routes/agent.ts` | 解析模块 ability 的 query／path，转交 args；仍 Markdown |
| `apps/web/app/components/shell/nav.ts` | 让模块能写入真正的「更多」区（当前 more 被 pop 后模块挂不上） |
| `packages/backend/src/providers/llm.ts` | 新增流式＋tools 调用；identity 含 taskId／roundIndex／messages／tools；**不改** `chatJson`；答案路径无强制 JSON mode |
| `packages/backend/src/providers/receipts.ts` | 若 stream 完成态需要最小扩展（保持不明结果语义）；logical_key 仍为 identity 哈希＋attemptTag |
| `packages/contracts/src/mcp.ts` | 可选：登记 `explainSelection`／`explainHot` 名称常量（模块亦可用 `mcpToolName`） |
| `tests/*` | 覆盖上述插口与 llm 假服务；architecture 边界若有新允许依赖则同步 |

**已定策略**：通用模块插口扩展；业务留在 `modules/ask/`；不把两解释工具直接写进引擎作为实现路径。禁止借机过度抽象（不新增通用「插件框架」；只补当前缺口：ability args、「更多」挂载、llm 流式＋tools／receipts）。

## 预期不改

- `industry/selection.ts` 门槛数字
- 热度／归组核心算法
- 既有 MCP 工具名与语义
- 历史 `database/migrations/*` 文件内容
- 共享 `.env` 密钥与安全阀（**真实冒烟不得改写共享 `.env`**；仅 ask 专用进程 env／内存覆盖；另批才能跑）

## 导出与摘要（计划目录，非仓库）

- `/workspace/aihot-plan/agent-tools-openspec-summary.md` — 用户向摘要
- `/workspace/aihot-plan/agent-tools-ask-full-spec.md` — Phase 1 完整方案导出（历史全文；以 change 目录为准）
- `/workspace/aihot-plan/agent-tools-ask-revision-delta.md` — 第二轮七项修订增量（仅修订节＋变更摘要）
