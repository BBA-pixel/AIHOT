# Tasks：agent-tools-ask

> 实现阶段才勾选。本阶段（Phase 1）只完成 0.x 方案交付与完整导出。每个任务目标 ≤2 小时。
>
> **已定**：模块名 `ask`；小通用引擎插口＋业务在模块；不打开真实模型调用；冒烟须另行确认。

## 0. 前置与方案（本阶段）

- [x] 0.1 核对仓库 remote／HEAD／工作区（Skongy/AIHOT，clean → 建 `feature/agent-tools`）
- [x] 0.2 阅读 AGENTS.md、architecture、MCP／Agent／publication／selection-explain／stories、modules、queue、llm／receipts、导航规格
- [x] 0.3 编写 OpenSpec：proposal／design／specs／tasks／files；记录冲突与 DeepSeek 文档兼容性（未付费探测）
- [x] 0.4 写用户向中文摘要至 `/workspace/aihot-plan/agent-tools-openspec-summary.md`
- [x] 0.5 并入 GPT 评审三决策；扩充 design 薄点；导出 `/workspace/aihot-plan/agent-tools-ask-full-spec.md`；`openspec validate --strict`
- [x] 0.6 并入 GPT 第二轮七项修订（整轮失效／回执身份／崩溃事务／刷新快照／渲染安全／冒烟隔离／测试分层）；同步 specs／tasks／files；导出 `/workspace/aihot-plan/agent-tools-ask-revision-delta.md`；`openspec validate --strict`
- [x] 0.7 **停止**（不实现业务代码、不 commit／push／PR、不付费调用、不改共享 `.env`、`MODEL_CALLS_ENABLED` 保持 off）

## 1. 基线与脚手架（实现阶段）

- [x] 1.1 确认工作区干净或仅含本变更；检出／继续 `feature/agent-tools`
- [x] 1.2 创建 `modules/ask` 包骨架（module／server／web／package.json）并挂入 `site/modules/*`、Dockerfile COPY、workspace
- [x] 1.3 跑通基线：`npm run typecheck`；测试库 `npm test` 子集；记录结果（不改安全阀）

## 2. 引擎补丁（小、可合并）

- [x] 2.1 扩展 `AgentAbility`：支持 query／path 参数；`agent.ts` 传入并校验；补测试（通用插口，业务仍在模块）
- [x] 2.2 侧栏「更多」允许模块追加入口（或等价最小改动）；更新导航相关测试／截图预期若有
- [x] 2.3 `providers/llm.ts` 新增流式＋tools 路径；identity 含 taskId／roundIndex／tools／messages（非 subject）；不破坏 `chatJson`；最终答案路径无强制 JSON mode；假服务单测（完成序：回执成功前不标任务完成）

## 3. 解释工具

- [x] 3.1 实现共享 `explainSelection`／`explainHot`（走 publication／scope；完整 schema／错误语义）
- [x] 3.2 经模块 `agent.abilities` 注册 MCP＋Agent REST；更新 guide／llms 说明
- [x] 3.3 契约／集成测试：公开／撤回／合并／缺轴／未在榜／门槛来源标记

## 4. 问答数据面与 API

- [x] 4.1 模块迁移：sessions／messages／tasks／events／evidence；7 日 retention 挂接
- [x] 4.2 API：建会话、发消息（幂等，创建＋enqueue 原子／补偿）、查会话／任务完整快照（含 snapshotSeq）、取消；打开／查询不调模型
- [x] 4.3 SSE：单调 seq、批量落库、Last-Event-ID 重放、断线不取消；快照＋后续事件无重复无空洞；整轮失效透视图

## 5. Worker Agent 循环

- [x] 5.1 `ask.run` 队列与状态机；lease／CAS；单会话单 running；取消与超时；崩溃收尾（有回执只收尾、不明则 failed、释放槽）；V1 无中途自动续跑
- [x] 5.2 六工具白名单执行器；完整 tool_call 校验；证据登记与裁剪回灌
- [x] 5.3 限额（6／8／180）与最终回答预留；超限降级无追加付费
- [x] 5.4 系统提示词 `ask-system-v1`；引用校验；撤回后整轮失效（答案／草稿／步骤／上下文占位）

## 6. Web `/ask`

- [x] 6.1 页面：说明、示例、消息、输入／发送／停止／新对话、步骤、来源卡、状态
- [x] 6.2 SSE 客户端：snapshotSeq 游标、去重、恢复、停止确认；流式渲染安全（未登记链接不可点、禁远程图／iframe／外部资源）；Markdown 消毒
- [x] 6.3 入口：更多＋我的；`/agent` 补充新能力说明；视觉贴合现有组件

## 7. 验证与交付（实现阶段；仍默认不 push）

- [x] 7.1 ≥15 假模型**执行器防护**用例（含整轮失效、snapshotSeq、回执 identity、lease／崩溃、入队失败、渲染安全、非 JSON mode；与真实模型评测分开）
- [ ] 7.2 手动演示／真实模型行为评测清单（**仅用户另行明确确认**后；按 design §12.3：仅 ask 进程开模型、**不改共享 `.env`**、不启动其它 Worker／cron；结束后杀进程即可）
- [x] 7.3 `typecheck`；后端测试；`npm run build -w @aihot/web`＋web tests；可跑则仓库 HTTP smoke；不能跑的列明
- [x] 7.4 更新 OpenSpec 勾选；交付完成／未完成清单、调用链简图、关键决策说明
- [x] 7.5 **不**擅自 commit／push／开 PR／部署（除非用户另行明确批准）
