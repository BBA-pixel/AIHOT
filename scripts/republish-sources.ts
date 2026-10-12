// Rebuild publication projections for given source ids (no model calls).
// node --env-file=.env scripts/republish-sources.ts json-val-news web-playvalorant-news
import { closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { republishSource } from "@aihot/backend/publication/publish";

for (const id of process.argv.slice(2)) {
  const started = Date.now();
  const r = await republishSource(id);
  console.log(JSON.stringify({ sourceId: id, ...r, ms: Date.now() - started }));
}
await stopBoss();
await closeDb();
