# Review — Jev 最小接入实现

评审日期：2026-10-16。范围：当前工作区相对 `8130030` 的 Jev 相关改动（包含未跟踪的 `providers/jev.ts`、`tests/jev.test.ts`），对照 [Spec](spec.md) 和 [Plan](plan.md)。不包含其他原有未跟踪文档与原型。

**结论：建议修正以下两项 P2 后再进入启用验收。** 已有测试通过不等于 G1/G2/G3 全部放行。本次仅评审、生成证据和本文，未修改实现、未调用线上模型、未开启生产开关。

## F1 · P2：新增串行判定没有受归组任务的总时限约束

- 位置：`packages/backend/src/events/group.ts:98–105`，`packages/backend/src/providers/jev.ts:104–108`。
- 关联证据：`packages/backend/src/jobs/queue.ts:49` 为归组任务设置 `expireInSeconds: 600`；新 Jev 循环逐候选顺序请求，每个 HTTP 请求各自允许 120 秒。既有队列包装只向业务 handler 传 data，未传 `job.signal`。
- 触发条件：10 个候选各用 61 秒即可使 Jev 阶段达到 610 秒；每次请求均未达到 120 秒超时，但整体已经超过任务的 600 秒上限，且此后还有原归组/复核请求。
- 影响：队列已将该次执行判为超时，原异步 handler 仍可能继续发起后续付费请求、运行写入逻辑；重试/后续任务与未结束 handler 可能交错。这不是“单次请求超时会正常失败”可以覆盖的场景。
- 验证：使用当前安装的 pg-boss `resolveWithinSeconds()` 和 `TestClock`，模拟同样的顺序循环。600 秒时任务超时、已完成 9 个候选；610 秒时原循环仍结束并进入后续阶段。该验证无网络/业务写入，属于超时语义复现，不是线上延迟测量。
- 建议：补充端到端执行时间约束和取消传播；不允许任务失效后继续购买下一次请求或提交结果。结合原归组、复核的剩余开销选择总体 deadline/任务预算，并增加多候选慢响应的队列级测试。不要只增大单次 HTTP timeout。
- 规格影响：原 Spec 的“顺序调用”也未定义总时限，因此这项需要补齐规格及实现，不只是改一个测试断言。

## F2 · P2：概率和恰在舍入容差边界时被浮点误差误拒绝

- 位置：`packages/backend/src/providers/jev.ts:67–68`，容差定义位于同文件第 17 行。
- 复现输入：

```json
{
  "answers": {
    "relation": {
      "type": "choice",
      "choice": "UNRELATED",
      "probabilities": {
        "SAME_OCCURRENCE": 0.1,
        "SAME_STORY": 0.1,
        "UNRELATED": 0.7,
        "ROUNDUP": 0.09
      },
      "confidence": 0.8
    }
  }
}
```

- 数学和为 `0.99`，误差正好是实现声明允许的 `0.01`；JavaScript 计算得到 `0.9899999999999999`，绝对误差为 `0.01000000000000012`，于是 `> 0.01` 判为失败。
- 影响：本应在当前容差内的舍入结果会被 `rejectReceivedResponse()` 标为失败，并中断归组；后续重试还可能重新购买结果。
- 验证：直接调用当前 `parseJevAnswer()` 已复现 `probabilities sum to 0.9899999999999999`，未请求供应商。
- 建议：使用带浮点 epsilon 的边界比较，或有明确精度依据的数值处理；保持对真正越界分布的拒绝。补充概率和在 `0.99`、`1.01` 及容差外侧的测试。现有测试只覆盖误差 `0.0004`，没有命中边界。

## 规格偏差：隐藏新增的 Base URL 配置

`packages/backend/src/providers/jev.ts:83` 实际读取 `OPENROUTER_BASE_URL`，而 Spec S3 要求固定官方 Decisions 端点、仅三项配置。测试也依赖这个额外变量。

这不是已验证的攻击问题，但部署契约不一致：该变量会在生产中改变密钥和请求的目的地；若使用常见聊天 API 的 `https://openrouter.ai/api/v1` 作为 base，当前拼接会得到 `/api/v1/api/alpha/decisions`，不是所需端点。

建议二选一并更新交付：按原 Spec 移除生产覆盖入口，测试层替换 HTTP 传输；或明确批准第四项配置，定义其 URL 语义及生产限制。不能把生产可读取的环境变量只当成测试细节。此外，实际还修改了 `providers/llm.ts` 导出已有连接错误判断函数，应在交接清单说明这一小处扩展。

## 已核实的正确方向

- Jev 默认关闭，接在普通报道候选召回之后；composite、kept、sameUrl 等范围判断仍在。
- 原 `judgeBatch()` 收到完整 cands/reading，没有为否决关系删除精选比较材料。
- 统一后的 verdict map 继续进入事实选择、故事归属与 `firmlyTied()`，没有看到只改一个关系消费者的遗漏。
- 原 batch receipt 保持主回执；新增 Jev 回执在业务成功后完成。
- 使用原 `paidRequest()`；接入路径检查预算行存在，预算额度由已有熔断处理。
- 输出失败没有被伪装成 UNRELATED；收到的响应可复用。

以上为代码检查与已运行测试覆盖范围内的结论，不代表所有特殊分支及线上恢复都已验收。

## 测试证据

使用 Node v24.21.0；独立数据库 `jev_review_20261016_test`，所有供应商请求走本地假服务，不使用会话里的真实密钥。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过，退出码 0 |
| `tests/jev.test.ts` | 通过 |
| `tests/grouping-reliability.test.ts` | 通过 |
| `tests/receipts.test.ts` | 通过 |
| `tests/reading-group-performance.test.ts` | 通过 |
| 上述四文件合计 | **41/41 通过**，退出码 0 |
| `git diff --check` | 通过 |
| F1/F2 离线复现 | 均复现，输出位于 `.data/jev-review/reproduce.log` |

本地证据文件：`.data/jev-review/tests.log`、`typecheck.log`、`reproduce.mjs`、`reproduce.log`、`implementation-hashes.json`。原始证据目录不提交 Git。

未运行全量 `npm test`、web production build、完整 web 测试、站点 smoke 或线上模型回放。本次不是完整发布验收。

## 验收缺口与交接

1. 新增归组测试中的原 batch stub 始终返回 `SAME_OCCURRENCE`、`selection.addsValue=true`，不能证明“原模型 SAME_STORY 被否决”和“原精选判断 false 仍保持”的场景。需补 AC02/AC03 对应测试。
2. 现有 Jev 复用集成测试是“Jev 成功后，原 batch 失败”；还需增加“部分候选已返回，后续 Jev 请求超时/unknown”的队列恢复测试，以及上述整体过期测试。
3. Jev 开启时的 sameUrl、人工纠正、signal 等特殊路径需要明确新增覆盖或指出可复用的已有测试证据，不能仅以 composite/kept 两条测试代替全部 AC07。
4. 完整候选开关对照回放、人工标签复核、质量/费用/时延上线标准仍未在本次评审中获得证据。G2/G3 不放行，默认继续关闭。
5. 修复后重新运行上述测试及边界复现；补全工程验收证据，再进行业务回放。本文没有代替维护者批准启用，也没有直接修复实现。

## Key Learnings:

1. 逐请求超时不能替代整个队列任务的 deadline；任务超时不一定会停止未接收取消信号的业务 handler。
2. 概率容差的边界需要覆盖浮点误差，不能只用远离边界的舍入案例测试。
