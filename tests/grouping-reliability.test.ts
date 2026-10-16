// Failure modes: unavailable identity requests must remain undecided, an incomplete model response
// must not become "unrelated", and releasing an unknown receipt must resume the exact grouping job
// that a native TimeoutError failed. Lost pending jobs must recover without reviving terminal
// failures or buying the same request indefinitely.
import { embeddingsStub, gate, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { groupArticle } from "@aihot/backend/events/group";
import { BatchSchema, PairSchema, verdictsByFact, type CandidateView } from "@aihot/backend/events/relate";
import { detachFromFact, requestRegroup } from "@aihot/backend/events/corrections";
import { sweepUngrouped } from "@aihot/backend/jobs/events";
import { enqueue, getBoss, QUEUES, stopBoss } from "@aihot/backend/jobs/queue";
import { recoverStaleWork, releaseReceipt } from "@aihot/backend/operations/recover";
import { publishArticle } from "@aihot/backend/publication/publish";

const T = tag();
const sourceId = `group-reliability-${T}`;
let response: "complete" | "missing" | "same-story" = "complete";
let addsValue = true;
const chatBodies: string[] = [];
const provider = await stub((_hit, request) => {
  const body = JSON.parse(request.body);
  const text = body.messages[1].content as string;
  chatBodies.push(text);
  if (text.includes("【报道 A】")) return { choices: [{ message: { content: JSON.stringify({ a: "发布", b: "发布", relation: "SAME_OCCURRENCE", difference: "", confidence: 1 }) } }] };
  const ids = [...text.matchAll(/【候选 (C\d+)】/g)].map(m => m[1]);
  const relation = response === "same-story" ? "SAME_STORY" : "SAME_OCCURRENCE";
  return { choices: [{ message: { content: JSON.stringify({ query: "新模型发布", decisions: (response === "missing" ? [] : ids).map(id => ({ id, relation, confidence: 1, note: "" })), selection: { addsValue, reason: "fixture news" } }) } }] };
});
for (const name of ["DEEPSEEK", "XIAOMI_MIMO"]) {
  process.env[`${name}_BASE_URL`] = `${provider.url}/v1`;
  process.env[`${name}_API_KEY`] = "test-key";
}
const embeddings = await embeddingsStub();
// The Jev Decisions API as a local stub; the tests below switch its answer and the gate. The
// endpoint is fixed to the official host, so fetch rewrites it to the stub instead.
let jevAnswer: unknown;
const jevBodies: Array<Record<string, unknown>> = [];
const jev = await stub((_hit, request) => {
  jevBodies.push(JSON.parse(request.body));
  return jevAnswer;
});
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  return realFetch(url.startsWith("https://openrouter.ai/") ? jev.url + url.slice("https://openrouter.ai".length) : input as string, init);
}) as typeof fetch;
process.env.OPENROUTER_API_KEY = "test-key";
await sql`INSERT INTO budgets (service, per_minute, per_hour, per_day, note) VALUES ('openrouter-jev', 1000, 10000, 100000, 'test')
          ON CONFLICT (service) DO UPDATE SET per_minute = 1000, per_hour = 10000, per_day = 100000`;
let factId: number;

async function report(suffix: string, composite = false) {
  const { articleId } = await upsertMaterial({ sourceId, url: `https://example.org/group-${T}/${suffix}`, title: `新模型发布${T}`, bodyText: "今日发布新模型和价格。", bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
  await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected,output)
    VALUES (${articleId},1,'rule','pass','ai-models',${`新模型发布${T} ${suffix}`},${`新模型发布和价格${T} ${suffix}`},80,true,${sql.json({ scope: composite ? "composite" : "single", fact: { title: "新模型发布", subject: "实验室", action: "发布", object: "模型" } })})`;
  await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${articleId}`;
  await publishArticle(articleId);
  return articleId;
}

before(async () => {
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,next_fetch_at) VALUES (${sourceId},'Group reliability','rss','T1','editorial','2100-01-01')`;
  const id = await report("root");
  const [story] = await sql`INSERT INTO stories (public_id,title) VALUES (${randomUUID()},'新模型发布') RETURNING id`;
  const [fact] = await sql`INSERT INTO facts (public_id,story_id,title) VALUES (${`f-${T}`},${story!.id},'新模型发布') RETURNING id`;
  factId = Number(fact!.id);
  await sql`INSERT INTO fact_articles (fact_id,article_id,role) VALUES (${factId},${id},'primary')`;
  await groupArticle(id);
});
after(async () => { globalThis.fetch = realFetch; await provider.close(); await embeddings.close(); await jev.close(); await stopBoss(); await closeDb(); });

test("missing and invalid identity answers cannot silently assert unrelated", () => {
  assert.equal(BatchSchema.safeParse({}).success, false);
  assert.equal(BatchSchema.safeParse({ decisions: [{ id: "C1", relation: "TYPO", confidence: 0.99 }] }).success, false);
  assert.equal(BatchSchema.safeParse({ decisions: [{ relation: "SAME_OCCURRENCE", confidence: 1 }] }).success, false);
  assert.equal(PairSchema.safeParse({}).success, false);
  const cands = [{ factId: 1 }, { factId: 2 }] as CandidateView[];
  assert.throws(() => verdictsByFact([{ id: "C1", relation: "UNRELATED", confidence: 1 }], cands), /candidate|候选/i);
  assert.throws(() => verdictsByFact([{ id: "C1", relation: "UNRELATED", confidence: 1 }, { id: "C1", relation: "UNRELATED", confidence: 1 }], cands), /candidate|候选/i);
});

for (const composite of [false, true]) test(`a ${composite ? "roundup" : "single report"} with an incomplete answer stays unresolved and can recover`, async () => {
  const id = await report(composite ? "roundup" : "incomplete", composite);
  response = "missing";
  await assert.rejects(groupArticle(id), /unusable output/);
  const [failed] = await sql`SELECT grouped_at,grouping_status,grouping_receipt_id FROM articles WHERE id=${id}`;
  assert.equal(failed!.grouped_at, null);
  assert.equal(failed!.grouping_status, "failed");
  assert.ok(failed!.grouping_receipt_id);
  assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id=${id}`).length, 0);
  response = "complete";
  const result = await groupArticle(id);
  assert.equal(result.verdict, composite ? "roundup" : "same-fact");
  const [done] = await sql`SELECT grouped_at,grouping_status,grouping_receipt_id,grouping_error FROM articles WHERE id=${id}`;
  assert.equal(done!.grouping_status, "complete");
  assert.ok(done!.grouped_at);
  assert.equal(done!.grouping_receipt_id, null);
  assert.equal(done!.grouping_error, null);
});

// The grouping decision and the paid result it consumes must commit together. Without this,
// a failed completion can leave an article grouped while its paid response stays "received".
for (const kind of ["report", "roundup", "kept"] as const) test(`receipt completion failure rolls back ${kind} grouping and recovery reuses the response`, async () => {
  const id = await report(`receipt-atomic-${kind}`, kind === "roundup");
  if (kind === "kept") {
    await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${factId}, ${id}, 'report')`;
    await sql`UPDATE articles SET selection_adds_value = NULL WHERE id = ${id}`;
  }
  await sql.unsafe(`CREATE FUNCTION fail_grouping_receipt() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN
    IF NEW.status = 'completed' AND NEW.purpose = 'group_article'
      THEN RAISE EXCEPTION 'grouping receipt commit interrupted';
    END IF;
    RETURN NEW; END $body$`);
  await sql`CREATE TRIGGER fail_grouping_receipt BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION fail_grouping_receipt()`;
  const before = provider.hits();
  try {
    await assert.rejects(groupArticle(id), /grouping receipt commit interrupted/);
  } finally {
    await sql`DROP TRIGGER fail_grouping_receipt ON receipts`;
    await sql`DROP FUNCTION fail_grouping_receipt()`;
  }
  const after = provider.hits();
  assert.ok(after > before, "the model response was received before the injected commit failure");
  assert.equal((await sql`SELECT 1 FROM grouping_decisions WHERE article_id = ${id}`).length, 0, "the decision must roll back");
  assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id = ${id}`).length, kind === "kept" ? 1 : 0,
    "no new membership can commit when receipt completion fails");
  const [failed] = await sql<{ grouping_status: string }[]>`SELECT grouping_status FROM articles WHERE id = ${id}`;
  assert.equal(failed!.grouping_status, "failed");
  const receipts = await sql<{ purpose: string; status: string }[]>`
    SELECT purpose, status FROM receipts WHERE purpose IN ('group_article', 'group_review')
      AND subject LIKE ${`article:${id}%`} ORDER BY id`;
  assert.ok(receipts.some((receipt) => receipt.purpose === "group_article"), "the batch judgement has a receipt");
  assert.ok(receipts.every((receipt) => receipt.status === "received"), "no receipt completes on a rolled-back decision");

  const result = await groupArticle(id);
  assert.equal(result.verdict, kind === "roundup" ? "roundup" : kind === "kept" ? "kept" : "same-fact");
  assert.equal(provider.hits(), after, "recovery must reuse the already paid response");
  const completed = await sql<{ status: string }[]>`
    SELECT status FROM receipts WHERE purpose IN ('group_article', 'group_review')
      AND subject LIKE ${`article:${id}%`}`;
  assert.equal(completed.length, receipts.length);
  assert.ok(completed.every((receipt) => receipt.status === "completed"));
  assert.equal((await sql`SELECT 1 FROM grouping_decisions WHERE article_id = ${id}`).length, 1);
});

test("a native timeout fails its job with the receipt id, and the release wakes that same job", async () => {
  const id = await report("timeout");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(provider.url)) throw new DOMException("request timed out", "TimeoutError");
    return originalFetch(input, init);
  };
  let error: unknown;
  try { await groupArticle(id); } catch (thrown) { error = thrown; } finally { globalThis.fetch = originalFetch; }
  assert.match(String(error), /timed out/);
  const [failed] = await sql`SELECT grouping_status,grouping_receipt_id FROM articles WHERE id=${id}`;
  assert.equal(failed!.grouping_status, "failed");
  assert.ok(failed!.grouping_receipt_id);
  // The job's handler fails with what groupArticle threw: the queue stores that error, receipt id included.
  const boss = await getBoss();
  const data = { articleId: id };
  const jobId = await enqueue(QUEUES.group, data, { retryLimit: 0, singletonKey: id });
  await boss.fetch(QUEUES.group);
  await boss.fail(QUEUES.group, jobId!, error as Error);
  await releaseReceipt(Number(failed!.grouping_receipt_id), { billed: false, note: "local fixture verified" }, "test");
  await recoverStaleWork();
  const jobs = await boss.fetch(QUEUES.group);
  assert.deepEqual(jobs.map((job) => [job.id, job.data]), [[jobId, data]]);
  assert.equal((await groupArticle(id)).verdict, "same-fact");
  await boss.complete(QUEUES.group, jobs[0]!.id);
  await sweepUngrouped();
  assert.equal((await boss.fetch(QUEUES.group)).length, 0, "successful work is not repeatedly queued");
});

test("a spent budget leaves grouping pending and the repair sweep resumes it", async () => {
  const id = await report("budget-wait");
  const budgets = await sql`SELECT service,per_minute,per_hour,per_day FROM budgets`;
  const hits = provider.hits();
  try {
    await sql`UPDATE budgets SET per_minute=0,per_hour=0,per_day=0`;
    await assert.rejects(groupArticle(id), /Budget for .* exhausted/);
    const [row] = await sql`SELECT grouping_status,grouping_receipt_id FROM articles WHERE id=${id}`;
    assert.equal(row!.grouping_status, "pending");
    assert.equal(row!.grouping_receipt_id, null);
    assert.equal(provider.hits(), hits, "no model request is sent while waiting for budget");
  } finally {
    for (const b of budgets) await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;
  }
  await sql`UPDATE articles SET created_at=now()-interval '5 minutes' WHERE id=${id}`;
  assert.equal((await sweepUngrouped()).enqueued, 1);
  assert.equal((await sweepUngrouped()).enqueued, 0);
  const boss = await getBoss();
  const jobs = await boss.fetch(QUEUES.group);
  assert.equal(jobs.length, 1);
  assert.equal((jobs[0]!.data as { articleId: string }).articleId, id);
  await groupArticle(id);
  await boss.complete(QUEUES.group, jobs[0]!.id);
  assert.equal((await sql`SELECT grouping_status FROM articles WHERE id=${id}`)[0]!.grouping_status, "complete");
});

test("a lost pending grouping job is repaired once, but a terminal failure waits for recovery", async () => {
  const pending = await report("lost");
  const failed = await report("terminal");
  await sql`UPDATE articles SET created_at=now()-interval '5 minutes' WHERE id IN (${pending},${failed})`;
  await sql`UPDATE articles SET grouping_status='failed',grouping_error='requires review' WHERE id=${failed}`;
  assert.equal((await sweepUngrouped()).enqueued, 1);
  assert.equal((await sweepUngrouped()).enqueued, 0);
  const boss = await getBoss();
  const jobs = await boss.fetch(QUEUES.group);
  assert.equal(jobs.length, 1);
  assert.equal((jobs[0]!.data as { articleId: string }).articleId, pending);
  await groupArticle(pending);
  await boss.complete(QUEUES.group, jobs[0]!.id);
  await detachFromFact(failed, "verified independent", "test");
  const [manual] = await sql`SELECT grouping_status,grouping_error FROM articles WHERE id=${failed}`;
  assert.deepEqual({ ...manual }, { grouping_status: "complete", grouping_error: null });
});


// Failure modes: a report changes while its old model response is in flight; neither the old answer
// nor a late timeout may complete or fail the replacement revision.
for (const lateFailure of [false, true]) test(`an old grouping ${lateFailure ? "failure" : "answer"} cannot settle a changed material`, async () => {
  const suffix = lateFailure ? "revision-failure" : "revision-answer";
  const id = await report(suffix);
  const asked = gate();
  const release = gate();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(provider.url)) {
      asked.open();
      await release.promise;
      if (lateFailure) throw new DOMException("old request timed out", "TimeoutError");
    }
    return originalFetch(input, init);
  };
  const grouping = groupArticle(id);
  const rejected = assert.rejects(grouping);
  try {
    await asked.promise;
    await upsertMaterial({ sourceId, url: `https://example.org/group-${T}/${suffix}`, title: `Corrected material ${T}`, bodyText: "A different product and corrected report.", bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
    release.open();
    await rejected;
  } finally { release.open(); globalThis.fetch = originalFetch; }
  const [current] = await sql`SELECT revision,grouping_status,grouping_error,grouping_receipt_id,selection_adds_value FROM articles WHERE id=${id}`;
  assert.deepEqual({ ...current }, { revision: 2, grouping_status: "pending", grouping_error: null, grouping_receipt_id: null, selection_adds_value: null });
  assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id=${id}`).length, 0);
});


// Failure mode: a pending decision is recorded but an old public projection still exposes it as selected.
for (const change of ["revision", "regroup"] as const) test(`${change} withdraws the old selected projection in the same transaction`, async () => {
  const suffix = `withdraw-${change}`;
  const id = await report(suffix);
  await groupArticle(id);
  assert.equal((await sql`SELECT selected FROM publications WHERE article_id=${id}`)[0]!.selected, true);
  if (change === "revision") {
    await upsertMaterial({ sourceId, url: `https://example.org/group-${T}/${suffix}`, title: `Changed original ${T}`, bodyText: "New corrected material.", bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
  } else {
    await sql.begin(tx => requestRegroup(id, `request-${T}`, tx));
  }
  const [current] = await sql`SELECT a.grouping_status,p.selected FROM articles a JOIN publications p ON p.article_id=a.id WHERE a.id=${id}`;
  assert.deepEqual({ ...current }, { grouping_status: "pending", selected: false });
});


// The Jev veto gate: on the ordinary identity path only, its UNRELATED answers stop this merge, its
// other answers leave the original models in charge, a failure leaves the report undecided with the
// answers it already paid for reused on the retry, and the special paths never call it.
const jevChoice = (choice: string): unknown => ({
  answers: { relation: { type: "choice", choice, probabilities: Object.fromEntries(["SAME_OCCURRENCE", "SAME_STORY", "UNRELATED", "ROUNDUP"].map((r) => [r, r === choice ? 0.7 : 0.1])), confidence: 0.9 } },
  usage: { input_tokens: 50, output_tokens: 4 },
});

test("with the gate off Jev is never called and grouping is unchanged", async () => {
  const before = jev.hits();
  const id = await report("jev-off");
  assert.equal((await groupArticle(id)).verdict, "same-fact");
  assert.equal(jev.hits(), before);
});

test("with the gate on a Jev UNRELATED stops the merge the batch model proposed", async () => {
  const id = await report("jev-veto");
  jevAnswer = jevChoice("UNRELATED");
  config.groupJevEnabled = true;
  try {
    const result = await groupArticle(id);
    assert.equal(result.verdict, "new-story");
    assert.notEqual(result.factId, factId);
    assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id=${id} AND fact_id=${factId}`).length, 0);
    // The decision records the vetoed relation with Jev's confidence; both receipts completed.
    const [decision] = await sql`SELECT candidates, receipt_id FROM grouping_decisions WHERE article_id=${id} ORDER BY id DESC LIMIT 1`;
    const candidates = decision!.candidates as Array<{ id: number; relation?: string; confidence?: number }>;
    assert.equal(candidates.find((c) => c.id === factId)!.relation, "UNRELATED");
    assert.equal(candidates.find((c) => c.id === factId)!.confidence, 0.9);
    assert.equal((await sql`SELECT status FROM receipts WHERE id=${decision!.receipt_id}`)[0]!.status, "completed");
    const asked = await sql`SELECT status FROM receipts WHERE purpose='group_jev' AND subject=${`article:${id}`}`;
    assert.equal(asked.length, 1);
    assert.equal(asked[0]!.status, "completed");
    // The batch judgement still saw the candidate in full, and the selection value stands.
    const batch = chatBodies.filter((text) => text.includes("【候选 C1】")).at(-1)!;
    assert.ok(batch.includes("事实标题："));
    assert.equal((await sql`SELECT selection_adds_value FROM articles WHERE id=${id}`)[0]!.selection_adds_value, true);
    // The request itself is exactly model, state and the one choice question.
    assert.deepEqual(Object.keys(jevBodies[0]!), ["model", "state", "questions"]);
    assert.deepEqual(Object.keys(jevBodies[0]!.state as Record<string, unknown>), ["query", "candidate"]);
  } finally { config.groupJevEnabled = false; }
});

test("with the gate on a Jev answer other than UNRELATED leaves the original merge standing", async () => {
  const id = await report("jev-keep");
  jevAnswer = jevChoice("SAME_STORY");
  config.groupJevEnabled = true;
  try {
    assert.equal((await groupArticle(id)).verdict, "same-fact");
    assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id=${id}`).length, 1);
    const [decision] = await sql`SELECT fact_id, candidates FROM grouping_decisions WHERE article_id=${id} ORDER BY id DESC LIMIT 1`;
    const candidates = decision!.candidates as Array<{ id: number; relation?: string }>;
    assert.equal(candidates.find((c) => c.id === decision!.fact_id)!.relation, "SAME_OCCURRENCE", "the original relation, not Jev's, is recorded");
  } finally { config.groupJevEnabled = false; }
});

test("a Jev-gated grouping that fails later stays undecided and reuses the paid answers", async () => {
  const id = await report("jev-reuse");
  jevAnswer = jevChoice("UNRELATED");
  config.groupJevEnabled = true;
  try {
    response = "missing";
    await assert.rejects(groupArticle(id), /unusable output/);
    assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id=${id}`).length, 0, "no partial grouping");
    const answered = jev.hits();
    response = "complete";
    const result = await groupArticle(id);
    assert.equal(result.verdict, "new-story");
    assert.equal(jev.hits(), answered, "the retry reuses the received Jev answers");
    const asked = await sql`SELECT status FROM receipts WHERE purpose='group_jev' AND subject=${`article:${id}`}`;
    assert.ok(asked.length >= 1);
    assert.ok(asked.every((row) => row.status === "completed"));
  } finally { config.groupJevEnabled = false; response = "complete"; }
});

test("a composite is grouped without Jev even when the gate is on", async () => {
  const id = await report("jev-composite", true);
  jevAnswer = jevChoice("UNRELATED");
  config.groupJevEnabled = true;
  try {
    const before = jev.hits();
    assert.equal((await groupArticle(id)).verdict, "roundup");
    assert.equal(jev.hits(), before);
    assert.ok((await sql`SELECT 1 FROM fact_articles WHERE article_id=${id} AND role='mention'`).length > 0, "mentions still follow the batch judgement");
  } finally { config.groupJevEnabled = false; }
});

test("a kept membership is rechecked without Jev even when the gate is on", async () => {
  jevAnswer = jevChoice("UNRELATED");
  config.groupJevEnabled = true;
  try {
    const before = jev.hits();
    const { articleId } = await upsertMaterial({ sourceId, url: `https://example.org/group-${T}/jev-keep`, title: `新模型发布${T} jev-keep`, bodyText: "今日发布新模型和价格。", bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
    const [current] = await sql`SELECT revision FROM articles WHERE id=${articleId}`;
    await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected,output)
      VALUES (${articleId},${current!.revision},'rule','pass','ai-models',${`新模型发布${T} jev-keep`},${`新模型发布和价格${T} jev-keep`},80,true,${sql.json({ scope: "single", fact: { title: "新模型发布", subject: "实验室", action: "发布", object: "模型" } })})`;
    assert.equal((await groupArticle(articleId)).verdict, "kept");
    assert.equal(jev.hits(), before);
  } finally { config.groupJevEnabled = false; }
});

test("a report with no recalled candidates buys no judgement at all", async () => {
  const { articleId } = await upsertMaterial({ sourceId, url: `https://example.org/group-${T}/jev-none`, title: `氪骷髅幻影蓝鳞${randomUUID()}`, bodyText: "锌铜镀银鸬鹚刻画的离题内容。", bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
  await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected,output)
    VALUES (${articleId},1,'rule','pass','ai-models',${`氪骷髅幻影蓝鳞 ${T}`},${`锌铜镀银鸬鹚刻画的离题内容 ${T}`},80,true,${sql.json({ scope: "single", fact: { title: "离题内容", subject: "甲", action: "乙", object: "丙" } })})`;
  await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${articleId}`;
  await publishArticle(articleId);
  jevAnswer = jevChoice("UNRELATED");
  config.groupJevEnabled = true;
  try {
    const chatBefore = provider.hits();
    const before = jev.hits();
    assert.equal((await groupArticle(articleId)).verdict, "new-story");
    assert.equal(jev.hits(), before);
    assert.equal(provider.hits(), chatBefore, "no candidates, no batch call either");
  } finally { config.groupJevEnabled = false; }
});

test("an exhausted Jev budget leaves grouping pending with the breaker's error", async () => {
  const id = await report("jev-budget");
  jevAnswer = jevChoice("UNRELATED");
  config.groupJevEnabled = true;
  try {
    await sql`UPDATE budgets SET per_minute = 0 WHERE service = 'openrouter-jev'`;
    await assert.rejects(groupArticle(id), /Budget for openrouter-jev exhausted/);
    const [waiting] = await sql`SELECT grouping_status FROM articles WHERE id=${id}`;
    assert.equal(waiting!.grouping_status, "pending", "budget waits retain the upstream recovery semantics");
    assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id=${id}`).length, 0);
  } finally {
    config.groupJevEnabled = false;
    await sql`UPDATE budgets SET per_minute = 1000 WHERE service = 'openrouter-jev'`;
  }
});

test("with the gate on a Jev UNRELATED also vetoes a SAME_STORY answer", async () => {
  const id = await report("jev-story-veto");
  jevAnswer = jevChoice("UNRELATED");
  response = "same-story";
  config.groupJevEnabled = true;
  try {
    const result = await groupArticle(id);
    // The vetoed candidate cannot anchor the story either: no development of the root story.
    assert.equal(result.verdict, "new-story");
    const [root] = await sql`SELECT story_id FROM facts WHERE id=${factId}`;
    assert.notEqual(result.storyId, root!.story_id);
  } finally { config.groupJevEnabled = false; response = "complete"; }
});

test("with the gate on a false selection value from the batch judgement stands", async () => {
  const id = await report("jev-selection-false");
  jevAnswer = jevChoice("UNRELATED");
  addsValue = false;
  config.groupJevEnabled = true;
  try {
    assert.equal((await groupArticle(id)).verdict, "new-story");
    assert.equal((await sql`SELECT selection_adds_value FROM articles WHERE id=${id}`)[0]!.selection_adds_value, false);
  } finally { config.groupJevEnabled = false; addsValue = true; }
});

test("a Jev request that turns unknown after earlier candidates answered is released and reused", async () => {
  const id = await report("jev-partial");
  jevAnswer = jevChoice("UNRELATED");
  config.groupJevEnabled = true;
  const originalFetch = globalThis.fetch;
  try {
    // The first candidate's answer arrives; the second request dies without an outcome.
    let asked = 0;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://openrouter.ai/") && ++asked === 2) throw new DOMException("request timed out", "TimeoutError");
      return originalFetch(input as string, init);
    };
    await assert.rejects(groupArticle(id), /timed out/);
    const askedReceipts = await sql`SELECT id, status, attempts FROM receipts WHERE purpose='group_jev' AND subject=${`article:${id}`} ORDER BY id`;
    assert.equal(askedReceipts.length, 2);
    assert.deepEqual(askedReceipts.map((r) => r.status), ["received", "unknown"]);
    assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id=${id}`).length, 0, "no partial grouping");
    // Recovery releases the unknown receipt; the retry reuses the received answer and buys only the rest.
    await releaseReceipt(askedReceipts[1]!.id, { billed: false, note: "local fixture verified" }, "test");
    globalThis.fetch = originalFetch;
    const result = await groupArticle(id);
    assert.equal(result.verdict, "new-story");
    const after = await sql`SELECT id, status, attempts FROM receipts WHERE purpose='group_jev' AND subject=${`article:${id}`} ORDER BY id`;
    assert.ok(after.length >= 3, "the remaining candidates were asked fresh");
    assert.ok(after.every((r) => r.status === "completed"));
    assert.equal(after.find((r) => r.id === askedReceipts[0]!.id)!.attempts, 1, "the received answer was reused, not bought again");
    assert.equal(after.find((r) => r.id === askedReceipts[1]!.id)!.attempts, 2, "the released request was asked once more");
  } finally { globalThis.fetch = originalFetch; config.groupJevEnabled = false; }
});

test("with the gate on a manual standalone decision still wins without Jev", async () => {
  const id = await report("jev-manual");
  await groupArticle(id);
  await detachFromFact(id, "verified independent", "test");
  jevAnswer = jevChoice("UNRELATED");
  config.groupJevEnabled = true;
  try {
    const before = jev.hits();
    const result = await groupArticle(id);
    assert.equal(result.verdict, "manual");
    assert.equal(jev.hits(), before);
  } finally { config.groupJevEnabled = false; }
});

test("with the gate on discussion evidence groups without Jev", async () => {
  const signalSource = `signal-src-${T}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${signalSource}, 'Signal fixture', 'x_search', 'T2', 'hot_signal', '2100-01-01')`;
  const { articleId } = await upsertMaterial({ sourceId: signalSource, url: `https://example.org/group-${T}/signal-x`, title: `新模型发布${T} 的讨论帖`, bodyText: "这个发布真有意思。", bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
  await sql`UPDATE articles SET processing_state='skipped' WHERE id=${articleId}`;
  jevAnswer = jevChoice("UNRELATED");
  config.groupJevEnabled = true;
  try {
    const before = jev.hits();
    const result = await groupArticle(articleId, { signalOnly: true });
    assert.equal(["signal", "signal-native", "signal-unmatched"].includes(result.verdict), true);
    assert.equal(jev.hits(), before);
  } finally { config.groupJevEnabled = false; }
});

test("with the gate on a same-URL match still groups without Jev", async () => {
  const [root] = await sql`SELECT article_id FROM fact_articles WHERE fact_id=${factId} AND role='primary'`;
  // A duplicate page of the root report's URL, whose fact is not shown in 精选: recall still offers
  // the fact, so only the same-URL gate keeps Jev out.
  await sql`UPDATE publications SET selected = false WHERE article_id = ${root!.article_id}`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, body_text, body_status, published_at, discovered_at, timeline_at)
            VALUES (${`dup-${T}`}, ${sourceId}, ${`dup-${T}`}, ${`https://example.org/group-${T}/root`}, ${`新模型发布${T} 另一家报道`}, ${"今日发布新模型和价格。"}, 'ok', now(), now(), now())`;
  await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected,output)
    VALUES (${`dup-${T}`},1,'rule','pass','ai-models',${`新模型发布${T} 另一家报道`},${`新模型发布和价格${T} 另一家报道`},80,true,${sql.json({ scope: "single", fact: { title: "新模型发布", subject: "实验室", action: "发布", object: "模型" } })})`;
  await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${`dup-${T}`}`;
  await publishArticle(`dup-${T}`);
  jevAnswer = jevChoice("UNRELATED");
  config.groupJevEnabled = true;
  try {
    const before = jev.hits();
    const result = await groupArticle(`dup-${T}`);
    assert.equal(result.verdict, "same-url");
    assert.equal(result.factId, factId);
    assert.equal(jev.hits(), before);
  } finally { config.groupJevEnabled = false; }
});
