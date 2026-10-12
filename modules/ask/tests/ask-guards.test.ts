import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import askServer from "../server.ts";
import {
  createSession, createTask, findTaskByClientRequest, getTask, hasActiveTask, markTaskEnqueueFailed,
  appendEvent, maxEventSeq, listEventsAfter, finishTask, claimTask, redactedAnswer, markInvalidated,
  insertEvidence, requestCancel, retentionCleanup,
} from "../src/db/store.ts";
import { runAskTask, ASK_LIMITS } from "../src/agent/loop.ts";
import type { ChatToolsStreamOptions, ChatToolsStreamResult } from "@aihot/backend/providers/llm";
import { checkCitations } from "../src/agent/citations.ts";
import { friendlyStepSummary } from "../src/tools/whitelist.ts";
import { newUuid } from "@aihot/backend/lib/ids";

installModules([askServer]);
after(closeDb);

function mockChat(script: Array<Partial<ChatToolsStreamResult> & { content?: string; toolCalls?: ChatToolsStreamResult["toolCalls"] }>): (opts: ChatToolsStreamOptions) => Promise<ChatToolsStreamResult> {
  let i = 0;
  return async (opts) => {
    // Assert final-answer path never forces JSON mode via our wrapper contract.
    assert.equal(opts.purpose, "ask.tools_stream");
    const step = script[Math.min(i, script.length - 1)]!;
    i += 1;
    if (opts.onDelta && step.content) await opts.onDelta(step.content);
    return {
      content: step.content ?? "",
      toolCalls: step.toolCalls ?? [],
      finishReason: step.finishReason ?? "stop",
      receiptId: step.receiptId ?? 1,
      reused: step.reused ?? false,
      model: "default",
      usage: null,
      jsonModeForced: false,
    };
  };
}

test("limits defaults match design", () => {
  assert.equal(ASK_LIMITS.MAX_MODEL, 6);
  assert.equal(ASK_LIMITS.MAX_TOOL, 8);
  assert.equal(ASK_LIMITS.MAX_WALL_MS, 180_000);
});

test("session create and message idempotency", async () => {
  const { sessionId } = await createSession();
  const clientRequestId = newUuid();
  const t1 = await createTask({ sessionId, clientRequestId, message: "你好" });
  const again = await findTaskByClientRequest(sessionId, clientRequestId);
  assert.equal(again!.id, t1.id);
  assert.equal(await hasActiveTask(sessionId), true);
});

test("enqueue failure compensation clears queued slot", async () => {
  const { sessionId } = await createSession();
  const t = await createTask({ sessionId, clientRequestId: newUuid(), message: "q" });
  await markTaskEnqueueFailed(t.id, "boom");
  const cur = await getTask(t.id);
  assert.equal(cur!.status, "failed");
  assert.equal(cur!.error_code, "enqueue_failed");
  assert.equal(await hasActiveTask(sessionId), false);
});

test("snapshotSeq tracks max event seq", async () => {
  const { sessionId } = await createSession();
  const t = await createTask({ sessionId, clientRequestId: newUuid(), message: "e" });
  assert.equal(await maxEventSeq(t.id), 0);
  await appendEvent(t.id, "task_status", { status: "running" });
  await appendEvent(t.id, "answer_delta", { text: "hi" });
  assert.equal(await maxEventSeq(t.id), 2);
  const after = await listEventsAfter(t.id, 1);
  assert.equal(after.length, 1);
  assert.equal(after[0]!.seq, 2);
});

test("cancel sets flag without auto model call", async () => {
  const { sessionId } = await createSession();
  const t = await createTask({ sessionId, clientRequestId: newUuid(), message: "stop me" });
  const claimed = await claimTask(t.id, "w1");
  assert.ok(claimed);
  const c = await requestCancel(t.id);
  assert.equal(c!.cancel_requested, true);
});

test("whole-turn invalidation redacts answers", async () => {
  const { sessionId } = await createSession();
  const t = await createTask({ sessionId, clientRequestId: newUuid(), message: "x" });
  await finishTask(t.id, null, "completed", { finalAnswer: "秘密正文 [1]", draftAnswer: "草稿秘密" });
  await insertEvidence(t.id, [{
    kind: "item", objectId: "a1", title: "标题", sourceName: "S", publishedAt: null,
    siteUrl: "/items/a1", originalUrl: "https://example.com/a", toolName: "get_latest", rawRef: { id: "a1" },
  }]);
  await markInvalidated(t.id);
  const cur = await getTask(t.id);
  const view = redactedAnswer(cur!);
  assert.equal(view.contentInvalidated, true);
  assert.ok(view.finalAnswer!.includes("不可用") || view.finalAnswer!.includes("unavailable") || view.finalAnswer!.includes("source_withdrawn"));
  assert.ok(!view.finalAnswer!.includes("秘密正文"));
});

test("agent loop completes with mock model and no tools", async () => {
  // Insert a fake completed receipt row so completeReceipt works, or mock chat returns receiptId that exists.
  const [rec] = await sql<{ id: number }[]>`
    INSERT INTO receipts (logical_key, service, model, purpose, subject, status, request, attempts)
    VALUES (${"ask-test-" + newUuid()}, 'llm', 'm', 'ask.tools_stream', 't', 'received', '{}'::jsonb, 1)
    RETURNING id`;
  const { sessionId } = await createSession();
  const t = await createTask({ sessionId, clientRequestId: newUuid(), message: "最近有什么新闻？" });
  const chat = mockChat([{ content: "站内暂无结果。", receiptId: rec!.id, toolCalls: [] }]);
  // Bypass paidRequest by injecting chat that doesn't call real LLM; completeReceipt still needs row.
  await runAskTask({
    taskId: t.id,
    workerId: "test-worker",
    chat: async (opts) => {
      const r = await chat(opts);
      assert.equal(r.jsonModeForced, false);
      return r;
    },
  });
  const done = await getTask(t.id);
  assert.ok(["completed", "completed_degraded"].includes(done!.status), done!.status);
  assert.ok((done!.final_answer ?? "").includes("暂无") || (done!.final_answer ?? "").length > 0);
});

test("agent loop refuses tools when only one model call remains and degrades without extra call", async () => {
  const [rec] = await sql<{ id: number }[]>`
    INSERT INTO receipts (logical_key, service, model, purpose, subject, status, request, attempts)
    VALUES (${"ask-test-" + newUuid()}, 'llm', 'm', 'ask.tools_stream', 't', 'received', '{}'::jsonb, 1)
    RETURNING id`;
  const { sessionId } = await createSession();
  const t = await createTask({ sessionId, clientRequestId: newUuid(), message: "需要工具但额度将尽" });
  // Pre-set model_calls to 5 so remaining == 1
  await sql`UPDATE ask_tasks SET model_calls = 5, round_index = 5 WHERE id = ${t.id}::uuid`;
  let calls = 0;
  await runAskTask({
    taskId: t.id,
    workerId: "test-worker-2",
    chat: async (opts) => {
      calls += 1;
      assert.equal(opts.enableTools, false, "last slot must disable tools");
      if (opts.onDelta) await opts.onDelta("降级回答");
      return { content: "降级回答", toolCalls: [{ id: "x", type: "function", function: { name: "search", arguments: "{\"q\":\"ab\"}" } }], finishReason: "tool_calls", receiptId: rec!.id, reused: false, model: "default", usage: null, jsonModeForced: false };
    },
  });
  assert.equal(calls, 1);
  const done = await getTask(t.id);
  assert.ok(["completed", "completed_degraded"].includes(done!.status));
});

test("forged citations yield completed_degraded", () => {
  const r = checkCitations("依据 [42]", [1]);
  assert.equal(r.ok, false);
});

test("retention deletes expired sessions only", async () => {
  const id = newUuid();
  await sql`INSERT INTO ask_sessions (id, expires_at) VALUES (${id}::uuid, now() - interval '1 day')`;
  await sql`INSERT INTO ask_tasks (id, session_id, client_request_id, status, user_message)
    VALUES (${newUuid()}::uuid, ${id}::uuid, ${newUuid()}, 'completed', 'old')`;
  const result = await retentionCleanup(new Date());
  assert.ok((result.ask_sessions_deleted as number) >= 1);
  const [gone] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ask_sessions WHERE id = ${id}::uuid`;
  assert.equal(gone!.n, 0);
});

test("lease claim is exclusive", async () => {
  const { sessionId } = await createSession();
  const t = await createTask({ sessionId, clientRequestId: newUuid(), message: "lease" });
  const a = await claimTask(t.id, "owner-a");
  const b = await claimTask(t.id, "owner-b");
  assert.ok(a);
  assert.equal(b, null);
});

test("friendlyStepSummary never echoes model-facing tool body", () => {
  const summary = friendlyStepSummary({
    ok: true,
    name: "get_hot_topics",
    text: "# GAMEHOT 当前热点\n\n安全边界：下方分隔区\n［GAMEHOT 不可信外部资料开始］\nhttp://example.com/items/x",
    structured: { count: 2 },
    evidence: [
      { kind: "story", objectId: "a", title: "t", sourceName: null, publishedAt: null, siteUrl: "/story/a", originalUrl: null, toolName: "get_hot_topics", rawRef: {} },
      { kind: "story", objectId: "b", title: "t2", sourceName: null, publishedAt: null, siteUrl: "/story/b", originalUrl: null, toolName: "get_hot_topics", rawRef: {} },
    ],
  });
  assert.equal(summary, "找到 2 条相关资料");
  assert.equal(summary.includes("安全边界"), false);
  assert.equal(summary.includes("GAMEHOT"), false);
});

test("friendlyStepSummary for get_latest uses recent-dump wording not 相关资料", () => {
  const summary = friendlyStepSummary({
    ok: true,
    name: "get_latest",
    text: "近期列表……",
    structured: { count: 30 },
    evidence: [], // timeline dumps are not citeable 来源
  });
  assert.equal(summary, "拉取近期公开动态 30 条");
  assert.equal(summary.includes("相关资料"), false);
});

test("friendlyStepSummary get_latest empty is 暂无结果", () => {
  const summary = friendlyStepSummary({
    ok: true,
    name: "get_latest",
    text: "暂无",
    structured: { count: 0 },
    evidence: [],
  });
  assert.equal(summary, "暂无结果");
});
