// Enqueue content processing for article ids (or all articles of given sources that lack a publication).
// node --env-file=.env scripts/requeue-processing.ts --sources json-val-news,web-playvalorant-news
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { queueProcessing } from "@aihot/backend/jobs/content";

const args = process.argv.slice(2);
const srcArg = args.find((a) => a.startsWith("--sources="))?.slice("--sources=".length)
  ?? (args.includes("--sources") ? args[args.indexOf("--sources") + 1] : null);
const sources = (srcArg ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!sources.length) {
  console.error("usage: --sources id1,id2");
  process.exit(1);
}
const rows = await sql<{ id: string }[]>`
  SELECT a.id FROM articles a
  LEFT JOIN publications p ON p.article_id = a.id
  WHERE a.source_id = ANY(${sources}::text[]) AND p.article_id IS NULL`;
console.log(JSON.stringify({ missingPubs: rows.length, sources }));
for (const r of rows) {
  await queueProcessing(r.id);
  console.log(JSON.stringify({ queued: r.id }));
}
await stopBoss();
await closeDb();
