// Worker Agent loop for ask.run. Injectable chat for mock-model tests. No mid-run auto-resume.
import { completeReceipt, BudgetExceededError, ReceiptUnknownError } from "@aihot/backend/providers/receipts";
import {
  chatToolsStream,
  type ChatToolsMessage,
  type ChatToolsStreamOptions,
  type ChatToolsStreamResult,
} from "@aihot/backend/providers/llm";
import { sql } from "@aihot/backend/db";
import {
  appendEvent, bumpCounters, claimTask, finishTask, getTask, insertAssistantMessage, insertEvidence,
  listEvidence, listMessages, renewLease, setActiveReceipt, updateDraft, type TaskRow,
} from "../db/store.ts";
import { ASK_TOOL_LABELS_ZH, askToolSpecs, executeAskTool, friendlyStepSummary, type AskToolName } from "../tools/whitelist.ts";
import { askSystemPrompt, PROMPT_VERSION } from "./prompt.ts";
import { checkCitations } from "./citations.ts";

const MAX_MODEL = 6;
const MAX_TOOL = 8;
const MAX_WALL_MS = 180_000;
const DELTA_FLUSH_CHARS = 40;
const DELTA_FLUSH_MS = 80;

export type ChatFn = (opts: ChatToolsStreamOptions) => Promise<ChatToolsStreamResult>;

export interface LoopOptions {
  taskId: string;
  workerId: string;
  chat?: ChatFn;
  now?: () => number;
}

function degradeSummary(evidence: Array<{ id: number; title: string | null; kind: string }>): string {
  if (!evidence.length) return "已达调用上限，且尚未收集到可用证据。请稍后再试或缩小问题范围。";
  const lines = evidence.slice(0, 8).map((e) => `- [${e.id}] ${e.title ?? e.kind}`);
  return ["已达模型或工具调用上限，以下为已收集到的要点（未再请求模型总结）：", ...lines].join("\n");
}

export async function runAskTask(opts: LoopOptions): Promise<void> {
  const chat = opts.chat ?? chatToolsStream;
  const now = opts.now ?? Date.now;
  const started = now();

  const existing = await getTask(opts.taskId);
  if (!existing) return;
  if (["completed", "completed_degraded", "failed", "cancelled", "limit_reached"].includes(existing.status)) return;

  // Crash recovery: running with successful receipt → finish without new paid call.
  if (existing.status === "running" && existing.active_receipt_id) {
    const [rec] = await sql<{ status: string }[]>`SELECT status FROM receipts WHERE id = ${existing.active_receipt_id}`;
    if (rec?.status === "received" || rec?.status === "completed") {
      await completeReceipt(sql, existing.active_receipt_id);
      const draft = existing.draft_answer ?? existing.final_answer ?? "";
      const evidence = await listEvidence(opts.taskId);
      const check = checkCitations(draft, evidence.map((e) => e.id));
      const status = check.ok ? "completed" : "completed_degraded";
      await appendEvent(opts.taskId, "citation_check", { ok: check.ok, issues: check.issues });
      await appendEvent(opts.taskId, "answer_done", { text: draft, finishReason: "recovery" });
      await appendEvent(opts.taskId, "task_status", { status });
      await finishTask(opts.taskId, null, status, { finalAnswer: draft });
      if (draft) await insertAssistantMessage(existing.session_id, opts.taskId, draft);
      return;
    }
    if (rec?.status === "unknown" || rec?.status === "pending") {
      await appendEvent(opts.taskId, "error", { code: "receipt_unknown", message: "付费回执结果不明，未自动重试。" });
      await appendEvent(opts.taskId, "task_status", { status: "failed", reason: "receipt_unknown" });
      await finishTask(opts.taskId, null, "failed", { errorCode: "receipt_unknown", errorMessage: "回执结果不明" });
      return;
    }
  }

  const task = await claimTask(opts.taskId, opts.workerId);
  if (!task) return;

  await appendEvent(opts.taskId, "task_status", { status: "running" });

  const system = askSystemPrompt();
  const history = await listMessages(task.session_id, 20);
  const messages: ChatToolsMessage[] = [];
  // Prior turns (skip invalidated content — content_invalidated tasks contribute a note only).
  for (const m of history) {
    if (m.task_id === opts.taskId && m.role === "user") {
      messages.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "user") messages.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const prior = m.task_id ? await getTask(m.task_id) : null;
      if (prior?.content_invalidated) {
        messages.push({ role: "assistant", content: "（上轮因来源不可用已失效）" });
      } else {
        messages.push({ role: "assistant", content: m.content });
      }
    }
  }
  if (!messages.some((m) => m.role === "user" && m.content === task.user_message)) {
    messages.push({ role: "user", content: task.user_message });
  }

  const tools = askToolSpecs();
  let draft = "";
  let deltaBuf = "";
  let lastFlush = now();
  const evidenceIds: number[] = [];

  const flushDelta = async (force = false) => {
    if (!deltaBuf) return;
    if (!force && [...deltaBuf].length < DELTA_FLUSH_CHARS && now() - lastFlush < DELTA_FLUSH_MS) return;
    const text = deltaBuf;
    deltaBuf = "";
    lastFlush = now();
    await appendEvent(opts.taskId, "answer_delta", { text });
    await updateDraft(opts.taskId, draft);
  };

  const cancelled = async () => {
    const t = await getTask(opts.taskId);
    return !!t?.cancel_requested;
  };

  const timedOut = () => now() - started > MAX_WALL_MS;

  try {
    while (true) {
      await renewLease(opts.taskId, opts.workerId);
      if (await cancelled()) {
        await flushDelta(true);
        await appendEvent(opts.taskId, "task_status", { status: "cancelled" });
        await finishTask(opts.taskId, opts.workerId, "cancelled", { draftAnswer: draft || null });
        return;
      }
      if (timedOut()) {
        await flushDelta(true);
        const ev = await listEvidence(opts.taskId);
        const text = draft || degradeSummary(ev.map((e) => ({ id: e.id, title: e.title, kind: e.kind })));
        await appendEvent(opts.taskId, "limit", { kind: "time", counts: { model: (await getTask(opts.taskId))!.model_calls, tool: (await getTask(opts.taskId))!.tool_calls } });
        await appendEvent(opts.taskId, "answer_done", { text, finishReason: "time_limit" });
        await appendEvent(opts.taskId, "task_status", { status: "limit_reached" });
        await finishTask(opts.taskId, opts.workerId, "limit_reached", { finalAnswer: text, draftAnswer: text });
        await insertAssistantMessage(task.session_id, opts.taskId, text);
        return;
      }

      const cur = (await getTask(opts.taskId))!;
      if (cur.model_calls >= MAX_MODEL) {
        await flushDelta(true);
        const ev = await listEvidence(opts.taskId);
        const text = draft || degradeSummary(ev.map((e) => ({ id: e.id, title: e.title, kind: e.kind })));
        await appendEvent(opts.taskId, "limit", { kind: "model", counts: { model: cur.model_calls, tool: cur.tool_calls } });
        await appendEvent(opts.taskId, "answer_done", { text, finishReason: "model_limit" });
        await appendEvent(opts.taskId, "task_status", { status: "limit_reached" });
        await finishTask(opts.taskId, opts.workerId, "limit_reached", { finalAnswer: text, draftAnswer: text });
        await insertAssistantMessage(task.session_id, opts.taskId, text);
        return;
      }

      const remaining = MAX_MODEL - cur.model_calls;
      const forceFinal = remaining <= 1;
      const roundIndex = cur.round_index; // bumpCounters increments after call start

      await bumpCounters(opts.taskId, "model");
      const round = (await getTask(opts.taskId))!.round_index;

      let result: ChatToolsStreamResult;
      try {
        result = await chat({
          model: "default",
          purpose: "ask.tools_stream",
          subject: `ask:${opts.taskId}:r${round}`,
          promptVersion: PROMPT_VERSION,
          system,
          messages,
          tools,
          taskId: opts.taskId,
          roundIndex: round,
          enableTools: !forceFinal,
          maxTokens: 2048,
          onDelta: async (text) => {
            draft += text;
            deltaBuf += text;
            await flushDelta(false);
          },
        });
      } catch (e) {
        await flushDelta(true);
        if (e instanceof BudgetExceededError) {
          await appendEvent(opts.taskId, "error", { code: "budget_exhausted", message: "服务预算不足" });
          await appendEvent(opts.taskId, "task_status", { status: "failed", reason: "budget_exhausted" });
          await finishTask(opts.taskId, opts.workerId, "failed", { errorCode: "budget_exhausted", errorMessage: e.message, draftAnswer: draft || null });
          return;
        }
        if (e instanceof ReceiptUnknownError) {
          await setActiveReceipt(opts.taskId, e.receiptId);
          await appendEvent(opts.taskId, "error", { code: "receipt_unknown", message: "付费回执结果不明" });
          await appendEvent(opts.taskId, "task_status", { status: "failed", reason: "receipt_unknown" });
          await finishTask(opts.taskId, opts.workerId, "failed", { errorCode: "receipt_unknown", errorMessage: e.message, draftAnswer: draft || null });
          return;
        }
        await appendEvent(opts.taskId, "error", { code: "internal_error", message: "模型调用失败" });
        await appendEvent(opts.taskId, "task_status", { status: "failed" });
        await finishTask(opts.taskId, opts.workerId, "failed", { errorCode: "internal_error", errorMessage: String(e).slice(0, 500), draftAnswer: draft || null });
        return;
      }

      await setActiveReceipt(opts.taskId, result.receiptId);
      await completeReceipt(sql, result.receiptId);
      await flushDelta(true);

      if (result.content && !draft.includes(result.content) && result.reused) {
        draft = result.content;
        await appendEvent(opts.taskId, "answer_delta", { text: result.content });
        await updateDraft(opts.taskId, draft);
      } else if (result.content && draft !== result.content && !result.content.startsWith(draft.slice(0, 20))) {
        // Prefer assembled content as source of truth after stream.
        if (!draft) {
          draft = result.content;
          await updateDraft(opts.taskId, draft);
        }
      }

      const toolCalls = forceFinal ? [] : result.toolCalls;
      if (toolCalls.length === 0) {
        // Final answer path
        const answer = draft || result.content || "";
        const evidence = await listEvidence(opts.taskId);
        const check = checkCitations(answer, evidence.map((e) => e.id));
        await appendEvent(opts.taskId, "citation_check", { ok: check.ok, issues: check.issues });
        await appendEvent(opts.taskId, "answer_done", { text: answer, finishReason: result.finishReason ?? "stop" });
        const status = check.ok ? "completed" : "completed_degraded";
        // Cancel vs complete CAS: if cancel already requested, prefer cancelled with draft.
        if (await cancelled()) {
          await appendEvent(opts.taskId, "task_status", { status: "cancelled" });
          await finishTask(opts.taskId, opts.workerId, "cancelled", { draftAnswer: answer });
          return;
        }
        await appendEvent(opts.taskId, "task_status", { status });
        await finishTask(opts.taskId, opts.workerId, status, { finalAnswer: answer, draftAnswer: answer });
        await insertAssistantMessage(task.session_id, opts.taskId, answer);
        return;
      }

      // Execute tool calls serially
      messages.push({
        role: "assistant",
        content: result.content || null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        if (await cancelled()) {
          await appendEvent(opts.taskId, "task_status", { status: "cancelled" });
          await finishTask(opts.taskId, opts.workerId, "cancelled", { draftAnswer: draft || null });
          return;
        }
        const cur2 = (await getTask(opts.taskId))!;
        if (cur2.tool_calls >= MAX_TOOL) {
          await appendEvent(opts.taskId, "limit", { kind: "tool", counts: { model: cur2.model_calls, tool: cur2.tool_calls } });
          const ev = await listEvidence(opts.taskId);
          const text = draft || degradeSummary(ev.map((e) => ({ id: e.id, title: e.title, kind: e.kind })));
          await appendEvent(opts.taskId, "answer_done", { text, finishReason: "tool_limit" });
          await appendEvent(opts.taskId, "task_status", { status: "limit_reached" });
          await finishTask(opts.taskId, opts.workerId, "limit_reached", { finalAnswer: text, draftAnswer: text });
          await insertAssistantMessage(task.session_id, opts.taskId, text);
          return;
        }

        const stepId = `s${cur2.tool_calls + 1}`;
        const labelZh = ASK_TOOL_LABELS_ZH[tc.function.name as AskToolName] ?? tc.function.name;
        await appendEvent(opts.taskId, "step_start", {
          stepId, tool: tc.function.name, labelZh, argsSummary: tc.function.arguments.slice(0, 200),
        });
        await bumpCounters(opts.taskId, "tool");

        const exec = await executeAskTool(tc.function.name, tc.function.arguments);
        if (exec.ok) {
          const ids = exec.evidence.length
            ? await insertEvidence(opts.taskId, exec.evidence.map((e) => ({
              kind: e.kind, objectId: e.objectId, title: e.title, sourceName: e.sourceName,
              publishedAt: e.publishedAt, siteUrl: e.siteUrl, originalUrl: e.originalUrl,
              toolName: e.toolName, rawRef: e.rawRef,
            })))
            : [];
          evidenceIds.push(...ids);
          if (ids.length) {
            const withIds = exec.evidence.map((e, i) => ({ ...e, evidenceId: ids[i] }));
            await appendEvent(opts.taskId, "evidence", {
              items: withIds.map((e) => ({
                id: e.evidenceId, kind: e.kind, title: e.title, siteUrl: e.siteUrl, originalUrl: e.originalUrl, sourceName: e.sourceName,
              })),
            });
          }
          await appendEvent(opts.taskId, "step_end", { stepId, ok: true, summary: friendlyStepSummary(exec) });
          // Timeline dumps (e.g. get_latest) may have no citeable ids — tell the model not to invent [n].
          const toolText = ids.length
            ? `证据编号：${ids.map((id) => `[${id}]`).join(" ")}\n${exec.text}`
            : `（本工具结果未登记为可引用证据；回答中不要使用证据编号引用）\n${exec.text}`;
          messages.push({ role: "tool", tool_call_id: tc.id, content: toolText });
        } else {
          await appendEvent(opts.taskId, "step_end", { stepId, ok: false, summary: exec.message, errorCode: exec.errorCode });
          messages.push({ role: "tool", tool_call_id: tc.id, content: `错误 ${exec.errorCode}: ${exec.message}` });
        }
      }
      // Clear draft between tool rounds (answer deltas for final round only).
      draft = "";
      deltaBuf = "";
    }
  } catch (e) {
    await appendEvent(opts.taskId, "error", { code: "internal_error", message: "任务异常结束" });
    await appendEvent(opts.taskId, "task_status", { status: "failed" });
    await finishTask(opts.taskId, opts.workerId, "failed", { errorCode: "internal_error", errorMessage: String(e).slice(0, 500), draftAnswer: draft || null });
  }
}

export const ASK_LIMITS = { MAX_MODEL, MAX_TOOL, MAX_WALL_MS };
