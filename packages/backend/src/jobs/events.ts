// Event jobs: serial grouping, debounced digests.
import type { PgBoss } from "pg-boss";
import { groupArticle } from "../events/group.ts";
import { composeStoryDigest } from "../events/digest.ts";
import { groupingPriority, processingInput, settleNonEditorial } from "./content.ts";
import { enqueue, ensureQueue, QUEUES, work } from "./queue.ts";
import { sql } from "../db.ts";
import { isHistorical } from "../content/materials.ts";
import { BudgetExceededError } from "../providers/receipts.ts";

export async function registerEventJobs(boss: PgBoss) {
  // Serial on purpose: two reports of the same new fact must not both create it.
  await work(boss, QUEUES.group, { localConcurrency: 1, pollingIntervalSeconds: 0.5 }, async (data) => {
    const { articleId, signalOnly } = data;
    // A discussion post comes here straight from collection: record it first (settleNonEditorial).
    if (signalOnly && !(await settleNonEditorial(articleId)).group) return { verdict: "skipped" };
    let result;
    try {
      result = await groupArticle(articleId, { signalOnly });
    } catch (error) {
      if (!(error instanceof BudgetExceededError)) throw error;
      // A full budget window is not the article's failure: it stays pending (groupArticle) and the
      // same job waits for the window in its place, instead of failing through queue retries (no
      // sweep queues a discussion post again).
      const a = await processingInput(articleId);
      if (a) {
        const priority = groupingPriority({ signal: a.participation_mode !== "editorial", historical: a.historical });
        await enqueue(QUEUES.group, data, { singletonKey: articleId, priority, startAfter: error.retryAfterSeconds });
      }
      return { verdict: "budget-wait", retryAfterSeconds: error.retryAfterSeconds };
    }
    if (result.storyId && !result.verdict.startsWith("signal")) {
      await enqueue(QUEUES.digest, { storyId: result.storyId }, { singletonKey: `story:${result.storyId}`, startAfter: 60 });
    }
    return result;
  });
  await work(boss, QUEUES.digest, { localConcurrency: 3, pollingIntervalSeconds: 5 }, ({ storyId }) => composeStoryDigest(storyId));
}

/** Missing jobs are repaired; terminal failures need a receipt release or an explicit rerun. */
export async function sweepUngrouped(): Promise<{ enqueued: number }> {
  await ensureQueue(QUEUES.group);
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string; backfill: boolean; published_at: Date | null; discovered_at: Date }[]>`
      SELECT a.id, a.backfill, a.published_at, a.discovered_at FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.grouping_status = 'pending' AND a.created_at < now() - interval '3 minutes'
        AND s.participation_mode = 'editorial' AND a.processing_state = 'analyzed' AND EXISTS (
          SELECT 1 FROM analyses an WHERE an.article_id = a.id AND an.input_revision = a.revision AND an.relevance = 'pass')
        AND NOT EXISTS (SELECT 1 FROM pgboss.job j WHERE j.name = ${QUEUES.group}
          AND j.data->>'articleId' = a.id AND j.state IN ('created', 'active', 'retry'))
      ORDER BY a.created_at LIMIT 100 FOR UPDATE OF a SKIP LOCKED`;
    let enqueued = 0;
    for (const row of rows) {
      const priority = groupingPriority({ signal: false, historical: isHistorical(row) });
      if (await enqueue(QUEUES.group, { articleId: row.id }, { singletonKey: row.id, priority }, tx)) enqueued += 1;
    }
    return { enqueued };
  });
}
