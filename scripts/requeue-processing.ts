// Enqueue content processing for articles of given sources.
// Default: only articles that lack a publication.
// --force-analyze: re-analyze all articles of those sources (paid rescore when prompt/model changes).
// node --env-file=.env scripts/requeue-processing.ts --sources json-val-news,web-playvalorant-news
// node --env-file=.env scripts/requeue-processing.ts --sources json-vct-news --force-analyze
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { queueProcessing } from "@aihot/backend/jobs/content";

const args = process.argv.slice(2);
const srcArg = args.find((a) => a.startsWith("--sources="))?.slice("--sources=".length)
  ?? (args.includes("--sources") ? args[args.indexOf("--sources") + 1] : null);
const forceAnalyze = args.includes("--force-analyze");
const tagArg = args.find((a) => a.startsWith("--attempt-tag="))?.slice("--attempt-tag=".length)
  ?? (args.includes("--attempt-tag") ? args[args.indexOf("--attempt-tag") + 1] : null);
const sources = (srcArg ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!sources.length) {
  console.error("usage: --sources id1,id2 [--force-analyze] [--attempt-tag tag]");
  process.exit(1);
}
const attemptTag = forceAnalyze ? (tagArg?.trim() || `ops:rescore:${new Date().toISOString().slice(0, 10)}`) : undefined;
const rows = forceAnalyze
  ? await sql<{ id: string }[]>`
      SELECT a.id FROM articles a
      WHERE a.source_id = ANY(${sources}::text[])
      ORDER BY coalesce(a.published_at, a.discovered_at) DESC NULLS LAST`
  : await sql<{ id: string }[]>`
      SELECT a.id FROM articles a
      LEFT JOIN publications p ON p.article_id = a.id
      WHERE a.source_id = ANY(${sources}::text[]) AND p.article_id IS NULL`;
console.log(JSON.stringify({ mode: forceAnalyze ? "force-analyze" : "missing-pubs", count: rows.length, sources, attemptTag: attemptTag ?? null }));
for (const r of rows) {
  await queueProcessing(r.id, forceAnalyze ? { step: "analyze", attemptTag } : {});
  console.log(JSON.stringify({ queued: r.id, attemptTag: attemptTag ?? null }));
}
await stopBoss();
await closeDb();
