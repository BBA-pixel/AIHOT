// Ask module persistence: sessions, tasks, events, evidence. Column names must appear in source for architecture unused-column checks.
import { sql, type Db } from "@aihot/backend/db";
import { newUuid } from "@aihot/backend/lib/ids";

export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_degraded"
  | "failed"
  | "cancelled"
  | "limit_reached";

const RETENTION_DAYS = 7;
const PLACEHOLDER = {
  unavailable: true,
  reason: "source_withdrawn",
  message: "相关来源已不可用，原回答不再展示",
} as const;

export async function createSession(clientKey?: string | null): Promise<{ sessionId: string; expiresAt: string }> {
  const id = newUuid();
  const [row] = await sql<{ id: string; expires_at: Date }[]>`
    INSERT INTO ask_sessions (id, expires_at, client_key)
    VALUES (${id}::uuid, now() + (${RETENTION_DAYS} || ' days')::interval, ${clientKey ?? null})
    RETURNING id::text, expires_at`;
  return { sessionId: row!.id, expiresAt: row!.expires_at.toISOString() };
}

export async function getSession(sessionId: string) {
  const [row] = await sql<{ id: string; created_at: Date; expires_at: Date; client_key: string | null }[]>`
    SELECT id::text, created_at, expires_at, client_key FROM ask_sessions
    WHERE id = ${sessionId}::uuid AND expires_at > now()`;
  return row ?? null;
}

export async function findTaskByClientRequest(sessionId: string, clientRequestId: string) {
  const [row] = await sql<TaskRow[]>`
    SELECT ${taskCols} FROM ask_tasks
    WHERE session_id = ${sessionId}::uuid AND client_request_id = ${clientRequestId}`;
  return row ?? null;
}

export async function hasActiveTask(sessionId: string, excludeId?: string): Promise<boolean> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ask_tasks
    WHERE session_id = ${sessionId}::uuid AND status IN ('queued','running')
      AND (${excludeId ?? null}::uuid IS NULL OR id <> ${excludeId ?? null}::uuid)`;
  return (row?.n ?? 0) > 0;
}

const taskCols = sql`
  id::text, session_id::text, client_request_id, status, user_message, draft_answer, final_answer,
  model_calls, tool_calls, started_at, finished_at, cancel_requested, error_code, error_message,
  lease_owner, lease_expires_at, round_index, active_receipt_id, content_invalidated, created_at`;

export interface TaskRow {
  id: string;
  session_id: string;
  client_request_id: string;
  status: TaskStatus;
  user_message: string;
  draft_answer: string | null;
  final_answer: string | null;
  model_calls: number;
  tool_calls: number;
  started_at: Date | null;
  finished_at: Date | null;
  cancel_requested: boolean;
  error_code: string | null;
  error_message: string | null;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  round_index: number;
  active_receipt_id: number | null;
  content_invalidated: boolean;
  created_at: Date;
}

/** Create task + user message + enqueue data in one transaction when tx provided. */
export async function createTask(input: {
  sessionId: string;
  clientRequestId: string;
  message: string;
}, tx: Db = sql): Promise<TaskRow> {
  const id = newUuid();
  const msgId = newUuid();
  const [task] = await tx<TaskRow[]>`
    INSERT INTO ask_tasks (id, session_id, client_request_id, status, user_message)
    VALUES (${id}::uuid, ${input.sessionId}::uuid, ${input.clientRequestId}, 'queued', ${input.message})
    RETURNING ${taskCols}`;
  await tx`
    INSERT INTO ask_messages (id, session_id, role, content, task_id)
    VALUES (${msgId}::uuid, ${input.sessionId}::uuid, 'user', ${input.message}, ${id}::uuid)`;
  return task!;
}

export async function markTaskEnqueueFailed(taskId: string, message: string): Promise<void> {
  await sql`
    UPDATE ask_tasks SET status = 'failed', error_code = 'enqueue_failed', error_message = ${message},
      finished_at = now() WHERE id = ${taskId}::uuid AND status = 'queued'`;
}

export async function getTask(taskId: string): Promise<TaskRow | null> {
  const [row] = await sql<TaskRow[]>`SELECT ${taskCols} FROM ask_tasks WHERE id = ${taskId}::uuid`;
  return row ?? null;
}

export async function claimTask(taskId: string, owner: string, leaseMs = 60_000): Promise<TaskRow | null> {
  const [row] = await sql<TaskRow[]>`
    UPDATE ask_tasks SET status = 'running', lease_owner = ${owner},
      lease_expires_at = now() + (${leaseMs} || ' milliseconds')::interval,
      started_at = coalesce(started_at, now())
    WHERE id = ${taskId}::uuid
      AND (
        status = 'queued'
        OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < now()))
      )
    RETURNING ${taskCols}`;
  return row ?? null;
}

export async function renewLease(taskId: string, owner: string, leaseMs = 60_000): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    UPDATE ask_tasks SET lease_expires_at = now() + (${leaseMs} || ' milliseconds')::interval
    WHERE id = ${taskId}::uuid AND status = 'running' AND lease_owner = ${owner}
    RETURNING id::text`;
  return !!row;
}

export async function requestCancel(taskId: string): Promise<TaskRow | null> {
  const [row] = await sql<TaskRow[]>`
    UPDATE ask_tasks SET cancel_requested = true
    WHERE id = ${taskId}::uuid AND status IN ('queued','running')
    RETURNING ${taskCols}`;
  return row ?? null;
}

export async function appendEvent(taskId: string, type: string, payload: Record<string, unknown>, tx: Db = sql): Promise<number> {
  const [row] = await tx<{ seq: number }[]>`
    INSERT INTO ask_events (task_id, seq, type, payload)
    SELECT ${taskId}::uuid, coalesce(max(seq), 0) + 1, ${type}, ${tx.json(payload as never)}
    FROM ask_events WHERE task_id = ${taskId}::uuid
    RETURNING seq`;
  return row!.seq;
}

export async function maxEventSeq(taskId: string): Promise<number> {
  const [row] = await sql<{ m: number | null }[]>`SELECT max(seq) AS m FROM ask_events WHERE task_id = ${taskId}::uuid`;
  return row?.m ?? 0;
}

export async function listEventsAfter(taskId: string, afterSeq: number, limit = 500) {
  return sql<{ seq: number; type: string; payload: Record<string, unknown>; created_at: Date }[]>`
    SELECT seq, type, payload, created_at FROM ask_events
    WHERE task_id = ${taskId}::uuid AND seq > ${afterSeq}
    ORDER BY seq ASC LIMIT ${limit}`;
}

export async function updateDraft(taskId: string, draft: string): Promise<void> {
  await sql`UPDATE ask_tasks SET draft_answer = ${draft} WHERE id = ${taskId}::uuid AND status = 'running'`;
}

export async function bumpCounters(taskId: string, kind: "model" | "tool"): Promise<void> {
  if (kind === "model") await sql`UPDATE ask_tasks SET model_calls = model_calls + 1, round_index = round_index + 1 WHERE id = ${taskId}::uuid`;
  else await sql`UPDATE ask_tasks SET tool_calls = tool_calls + 1 WHERE id = ${taskId}::uuid`;
}

export async function setActiveReceipt(taskId: string, receiptId: number | null): Promise<void> {
  await sql`UPDATE ask_tasks SET active_receipt_id = ${receiptId} WHERE id = ${taskId}::uuid`;
}

export async function finishTask(
  taskId: string,
  owner: string | null,
  status: TaskStatus,
  fields: {
    finalAnswer?: string | null;
    draftAnswer?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  } = {},
): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    UPDATE ask_tasks SET
      status = ${status},
      final_answer = coalesce(${fields.finalAnswer ?? null}, final_answer),
      draft_answer = coalesce(${fields.draftAnswer ?? null}, draft_answer),
      error_code = ${fields.errorCode ?? null},
      error_message = ${fields.errorMessage ?? null},
      finished_at = now(),
      lease_owner = NULL,
      lease_expires_at = NULL
    WHERE id = ${taskId}::uuid
      AND status IN ('queued','running')
      AND (${owner}::text IS NULL OR lease_owner = ${owner} OR lease_owner IS NULL)
    RETURNING id::text`;
  return !!row;
}

export async function insertEvidence(taskId: string, items: Array<{
  kind: string; objectId: string | null; title: string | null; sourceName: string | null;
  publishedAt: string | null; siteUrl: string | null; originalUrl: string | null;
  toolName: string | null; rawRef: Record<string, unknown> | null; publicOk?: boolean;
}>) {
  const out: number[] = [];
  for (const it of items) {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO ask_evidence (id, task_id, kind, object_id, title, source_name, published_at, site_url, original_url, tool_name, raw_ref, public_ok)
      SELECT coalesce(max(id), 0) + 1, ${taskId}::uuid, ${it.kind}, ${it.objectId}, ${it.title}, ${it.sourceName},
        ${it.publishedAt ? new Date(it.publishedAt) : null}, ${it.siteUrl}, ${it.originalUrl}, ${it.toolName},
        ${it.rawRef ? sql.json(it.rawRef as never) : null}, ${it.publicOk ?? true}
      FROM ask_evidence WHERE task_id = ${taskId}::uuid
      RETURNING id`;
    out.push(row!.id);
  }
  return out;
}

export async function listEvidence(taskId: string) {
  return sql<{
    id: number; kind: string; object_id: string | null; title: string | null; source_name: string | null;
    published_at: Date | null; site_url: string | null; original_url: string | null; tool_name: string | null;
    raw_ref: Record<string, unknown> | null; public_ok: boolean;
  }[]>`
    SELECT id, kind, object_id, title, source_name, published_at, site_url, original_url, tool_name, raw_ref, public_ok
    FROM ask_evidence WHERE task_id = ${taskId}::uuid ORDER BY id`;
}

export async function listMessages(sessionId: string, limit = 40) {
  return sql<{ id: string; role: string; content: string; task_id: string | null; created_at: Date }[]>`
    SELECT id::text, role, content, task_id::text, created_at FROM ask_messages
    WHERE session_id = ${sessionId}::uuid ORDER BY created_at ASC LIMIT ${limit}`;
}

export async function insertAssistantMessage(sessionId: string, taskId: string, content: string): Promise<void> {
  await sql`
    INSERT INTO ask_messages (id, session_id, role, content, task_id)
    VALUES (${newUuid()}::uuid, ${sessionId}::uuid, 'assistant', ${content}, ${taskId}::uuid)`;
}

/** Mark task content invalidated when any evidence object is no longer public. */
export async function markInvalidated(taskId: string): Promise<void> {
  await sql`UPDATE ask_tasks SET content_invalidated = true WHERE id = ${taskId}::uuid`;
  await sql`UPDATE ask_evidence SET public_ok = false, title = NULL, source_name = NULL, site_url = NULL, original_url = NULL, raw_ref = NULL WHERE task_id = ${taskId}::uuid`;
}

export function redactedAnswer(task: TaskRow): { draftAnswer: string | null; finalAnswer: string | null; contentInvalidated: boolean } {
  if (task.content_invalidated) {
    return {
      draftAnswer: JSON.stringify(PLACEHOLDER),
      finalAnswer: JSON.stringify(PLACEHOLDER),
      contentInvalidated: true,
    };
  }
  return { draftAnswer: task.draft_answer, finalAnswer: task.final_answer, contentInvalidated: false };
}

export function redactEventPayload(task: TaskRow, type: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (!task.content_invalidated) return payload;
  if (type === "answer_delta" || type === "answer_done" || type.startsWith("step_")) {
    return { ...PLACEHOLDER, originalType: type };
  }
  if (type === "evidence") return { items: [], ...PLACEHOLDER };
  return payload;
}

export async function retentionCleanup(now = new Date()): Promise<Record<string, unknown>> {
  const deleted = await sql<{ id: string }[]>`
    DELETE FROM ask_sessions WHERE expires_at < ${now} RETURNING id::text`;
  return { ask_sessions_deleted: deleted.length, at: now.toISOString() };
}

export { PLACEHOLDER, RETENTION_DAYS };
