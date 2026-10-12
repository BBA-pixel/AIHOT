import type { FastifyReply, FastifyRequest } from "fastify";
import { getTask, listEventsAfter, redactEventPayload, type TaskRow } from "../db/store.ts";

const TERMINAL = new Set(["completed", "completed_degraded", "failed", "cancelled", "limit_reached"]);

export async function attachAskSse(req: FastifyRequest, reply: FastifyReply, task: TaskRow) {
  const q = req.query as { after?: string };
  const lastHeader = req.headers["last-event-id"];
  let cursor = Number(
    (typeof lastHeader === "string" && lastHeader !== "" ? lastHeader : null)
    ?? (typeof q.after === "string" ? q.after : "0"),
  );
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const write = (seq: number, type: string, payload: unknown) => {
    reply.raw.write(`id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({ seq, taskId: task.id, ts: new Date().toISOString(), type, payload })}\n\n`);
  };

  let closed = false;
  req.raw.on("close", () => { closed = true; });

  // Replay then poll for new events. Opening SSE does not call the model or cancel the task.
  while (!closed) {
    const cur = await getTask(task.id);
    if (!cur) break;
    const batch = await listEventsAfter(task.id, cursor, 100);
    for (const ev of batch) {
      if (ev.seq <= cursor) continue;
      write(ev.seq, ev.type, redactEventPayload(cur, ev.type, ev.payload));
      cursor = ev.seq;
    }
    if (TERMINAL.has(cur.status) && batch.length === 0) break;
    await new Promise((r) => setTimeout(r, 400));
    if (!closed) reply.raw.write(`: heartbeat\n\n`);
  }
  reply.raw.end();
}
