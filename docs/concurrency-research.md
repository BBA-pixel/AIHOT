# AIHOT 后台并发配置：Issue / PR 调研

核查日期：2026-10-20（北京时间）。任务：为自建站在后台提供任务并发配置，确认上游是否已有相同需求、实现或明确的设计限制。

> 本文核查的是开发前的 `5633b64`，不包含本次新增的本地实现。使用说明见 [部署文档](deploy.md#更新)。

## 结论

- 可以在当前自建站实现，但现有代码没有后台任务并发配置，也没有查到能直接合入的相同 Issue / PR。
- `hncboy/AIHOT` 是 `KKKKhazix/AIHOT` 的 fork。查询时 fork 的公开 Issue / PR 列表为空；上游共 220 条公开 open / closed Issue / PR。
- 旧版的 `ANALYZE_CONCURRENCY`、`FETCH_CONCURRENCY` 确实存在，后来在已合并的 #89 中被移除，分别改为 `localConcurrency: 6`、`localConcurrency: 8`。不能假设恢复 `.env` 字段就已恢复配置能力。
- 任务并发与模型请求并发不同。若目标是降低中转站的瞬时模型请求数，仅把文章分析任务限制为 1 仍未必等于模型请求并发为 1；同一任务内可以有并行调用，其他队列也可能同时调用模型。
- 不建议把归组队列 `events.group` 的并发也开放调大。它目前串行运行，相关讨论表明这是现有设计的一部分。
- 后台保存后自动生效需要额外的运行时同步机制。当前各 `localConcurrency` 在 worker 启动注册 handler 时传给 pg-boss，只保存数据库设置不会改变已经注册的 worker。可以实现无需重启，但不能宣称现有代码自然支持。

来源：GitHub 官方仓库 API [fork](https://api.github.com/repos/hncboy/AIHOT)、[上游](https://api.github.com/repos/KKKKhazix/AIHOT)；[本地对应 upstream content jobs](https://github.com/KKKKhazix/AIHOT/blob/6d82afb/packages/backend/src/jobs/content.ts)、[source jobs](https://github.com/KKKKhazix/AIHOT/blob/6d82afb/packages/backend/src/jobs/sources.ts)、[event jobs](https://github.com/KKKKhazix/AIHOT/blob/6d82afb/packages/backend/src/jobs/events.ts)、[queue wrapper](https://github.com/KKKKhazix/AIHOT/blob/6d82afb/packages/backend/src/jobs/queue.ts)、[worker 启动](https://github.com/KKKKhazix/AIHOT/blob/6d82afb/apps/worker/src/main.ts)。

## 相关讨论及匹配程度

| 条目 | 状态 | 匹配程度 | 已核实内容 / 对本任务的意义 |
|---|---|---|---|
| [#89 同步主站、清掉冗余](https://github.com/KKKKhazix/AIHOT/pull/89) | 已合并，2026-10-03 | 高：配置历史，但不是新增配置需求 | 提交 `57943276cfb93e3ef200332340bc04140887dfbc` 删除 `ANALYZE_CONCURRENCY` / `FETCH_CONCURRENCY` 读取，改为代码默认 6 / 8。未找到维护者专门说明“永远不能配置并发”的话，不能把删除推断成政策拒绝。 |
| [#213 归组队列等待和饥饿问题](https://github.com/KKKKhazix/AIHOT/issues/213) | 已关闭 | 中高：真实队列吞吐问题 | 一天约 6,000 篇的站点出现 6–10 小时延迟。说明串行归组和任务优先级会影响发布；没有提出或实现后台可调并发。 |
| [#222 归组优先级和预算延期](https://github.com/KKKKhazix/AIHOT/pull/222) | 已合并，2026-10-17 | 中：队列可靠性 | 修正补排队优先级，预算不足时延后重新入队。没有增加并发入口。当前本地历史已包含这项修复，无需重复移植。 |
| [#76 模型 API 可视化配置与中转站支持](https://github.com/KKKKhazix/AIHOT/pull/76) | 已关闭，未合并 | 中：后台运行时配置的先例，功能不同 | 提案包括保存后自动生效、密钥入库。维护者因模型配置来源、密钥轮换与回执身份问题拒绝，不是对所有后台运营配置一概拒绝。不能直接复用其密钥持久化方案。 |
| [#211 optional Jev relation veto](https://github.com/KKKKhazix/AIHOT/pull/211) | 已关闭，未合并 | 低中：串行队列与新增开关的约束 | 维护者明确提到归组串行，新增串行模型调用会延长精选上线时间；单一厂商开关给所有站增加维护负担。无并发配置实现。 |
| [#205 额度用尽停止而非限流](https://github.com/KKKKhazix/AIHOT/pull/205) | 已关闭；按维护者说明已合并 | 低：模型压力的相邻问题 | 额度/账户拒绝与 TPM / RPM 限流应分开；模型冷却解决额度耗尽，不解决正常调用并发过高。不应复用冷却代替并发控制。 |

## 维护者原话与边界

### 串行归组

[#213 维护者回复](https://github.com/KKKKhazix/AIHOT/issues/213#issuecomment-6230697764)：

> 你们的根本问题是串行队列的处理能力跟不上：约 94% 的归组任务不调用模型，却占着同一个串行槽位。如果想把“落库发布”拆到收集阶段，欢迎带上测试提 PR 来讨论，注意带 X 长文链接的帖子要先抓正文。

这证明维护者接受有证据的吞吐改进讨论，也说明其建议方向是拆分工作，不是直接提高归组并发。不能据此声称提高归组并发已获认可。

### 后台模型配置

[#76 维护者回复](https://github.com/KKKKhazix/AIHOT/pull/76#issuecomment-5977791700)：

> 把密钥存进数据库，会让模型配置多出一个来源；加密用的是会话密钥，轮换会话密钥会让模型调用失效；它还改变了所有付费调用的回执身份，升级时进行中的调用可能重复付费。
>
> 框架希望模型配置只在 `.env` 和 `site/models.ts` 两处。

本任务不需要更改模型凭证或付费请求回执身份。后台任务并发可以使用现有管理员设置与审计方式，但若贡献回上游，仍须先讨论新增配置入口的通用场景。

### 新功能和开关的维护成本

[#211 维护者回复](https://github.com/KKKKhazix/AIHOT/pull/211#issuecomment-6230478393)：

> 每个候选都要串行请求一次，而归组是串行队列，精选又要等归组确认后才放出，这段时延会直接加到精选上线的时间上。

这项提案的拒绝原因还包括单一服务商绑定、没有真实效果回放，不能扩大解释为并发配置已被拒绝。

## 当前代码对实现的约束

核查本地工作副本，开发前 HEAD `5633b64`，基于上游 `6d82afb`：

| 队列 | 当前默认 localConcurrency | 是否属于这次低风险配置候选 |
|---|---:|---|
| content.analyze | 6 | 是，内容分析任务并发 |
| sources.fetch | 8 | 是，信源采集任务并发 |
| content.extract-body | 4 | 是，正文提取任务并发 |
| events.digest | 3 | 是，事件综述任务并发 |
| events.group | 1 | 保持串行，有语义约束 |
| sources.fetch-x / sources.mp | 2 / 2 | 有接口预算 / QPS 考虑，不能盲目作为任意可调项 |

`apps/worker/src/main.ts` 在进程启动时依次调用 `registerContentJobs`、`registerSourceJobs`、`registerEventJobs`。`jobs/queue.ts` 的 `work()` 将参数传入 `boss.work()`，现有代码没有并发设置的变更订阅或重新注册。实现自动生效时应明确：变更生效时间、正在运行任务如何自然完成、降低并发是否只限制后续任务、多 worker 进程的计数边界，以及设置校验/审计。

相关现有后台能力可参考 [settings.ts](https://github.com/KKKKhazix/AIHOT/blob/6d82afb/packages/backend/src/admin/settings.ts)、[models.ts](https://github.com/KKKKhazix/AIHOT/blob/6d82afb/packages/backend/src/admin/models.ts)。这些是已有管理员持久化设置和审计模式，不需要照搬已关闭的 #76。

若只做本用户自建站，可按用户授权实现本地功能；若未来拟提交上游，仓库 [AGENTS.md](https://github.com/KKKKhazix/AIHOT/blob/6d82afb/AGENTS.md)、[CONTRIBUTING.md](https://github.com/KKKKhazix/AIHOT/blob/6d82afb/CONTRIBUTING.md) 要求新增配置入口先开 Issue 说明通用场景。这次调研没有创建 Issue、PR 或发布评论。

## 搜索范围与局限

- 通过 GitHub 官方 REST API 分页读完两个仓库全部公开 Issue / PR（包含 open 与 closed）：上游 220 条，fork 0 条。
- 读完上游公开 Issue / PR 普通评论 236 条、PR 行内评审评论 14 条；补查 #76、#89、#211 的 review 与相关 PR 合并状态。
- 在标题、正文、评论中检索：`concurrency`、`并发`、`rate limit`、`worker`、`任务配置`、`ANALYZE_CONCURRENCY`、`FETCH_CONCURRENCY`、`限流`、`配置入口`、`重启`、`全局`；另核查本地相关代码与 Git 历史。
- 没有查询私有讨论、删除的 Issue、其他 fork 或 GitHub Discussions 全文，因此“不存在直接实现”仅限上述可见范围；没有证据声称维护者已经批准或拒绝本次具体功能。
- 复核入口为上文的 GitHub 官方 API、具体 PR 与评论链接。
