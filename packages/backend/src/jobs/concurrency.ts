// Operator-controlled task counts. Grouping stays serial; these limits do not cap all model calls.
import { z } from "zod";
import { MAX_WORKER_CONCURRENCY, type AdminWorkerConcurrency, type BeforeJson, type WorkerConcurrency } from "@aihot/contracts/admin";
import { audit } from "../audit.ts";
import { sql, type Db } from "../db.ts";
import type { QueueName } from "./queue.ts";

export const CONCURRENCY_QUEUES = {
  analyze: "content.analyze",
  fetch: "sources.fetch",
  extract: "content.extract-body",
  digest: "events.digest",
} as const satisfies Record<keyof WorkerConcurrency, QueueName>;

const count = z.number().int().min(1).max(MAX_WORKER_CONCURRENCY);
const valuesSchema = z.object({ analyze: count, fetch: count, extract: count, digest: count }).strict();
const updateSchema = z.object({ values: valuesSchema, reason: z.string().trim().min(1).max(500) }).strict();

const DEFAULT_CONCURRENCY: WorkerConcurrency = { analyze: 6, fetch: 8, extract: 4, digest: 3 };

export async function loadWorkerConcurrency(db: Db = sql): Promise<BeforeJson<AdminWorkerConcurrency>> {
  const [row] = await db<{ value: WorkerConcurrency; updated_at: Date }[]>`
    SELECT value, updated_at FROM settings WHERE key = 'worker.concurrency'`;
  return {
    values: row ? valuesSchema.parse(row.value) : { ...DEFAULT_CONCURRENCY },
    configured: !!row,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function updateWorkerConcurrency(input: unknown, actor: string): Promise<BeforeJson<AdminWorkerConcurrency>> {
  const { values, reason } = updateSchema.parse(input);
  return sql.begin(async (tx) => {
    // Serialize the audited before/after pair, including two administrators saving the first value.
    await tx`SELECT pg_advisory_xact_lock(hashtext('worker.concurrency'))`;
    const before = await loadWorkerConcurrency(tx);
    await tx`INSERT INTO settings (key, value, updated_by) VALUES ('worker.concurrency', ${tx.json(values)}, ${actor})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    const after = await loadWorkerConcurrency(tx);
    await audit(actor, "worker.concurrency.update", "settings:worker.concurrency", reason, before.values, after.values, { db: tx });
    return after;
  }) as Promise<BeforeJson<AdminWorkerConcurrency>>;
}
