// The Jev veto gate (providers/jev.ts) on a local fake Decisions API: an answer outside the protocol
// fails its receipt and never reads as UNRELATED, a usable one records its cost and is reused through
// the receipt, enabling the gate without its prerequisites fails with a clear error, and the veto
// overrides only UNRELATED. The grouping-level wiring is covered by grouping-reliability.test.ts.
import { Reply, gate, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { ModelOutputError } from "@aihot/backend/providers/llm";
import { JEV_SERVICE, assertJevEnabled, decideRelation, parseJevAnswer, type JevRelationInput } from "@aihot/backend/providers/jev";
import { BudgetExceededError, ProviderRejectedError, ReceiptUnknownError } from "@aihot/backend/providers/receipts";
import {
  JEV_PROMPT_VERSION, JEV_VETO_POLICY_VERSION, RELATIONS, applyJevVeto, jevQuestion, jevState, relationCriteria,
  type CandidateView, type JevVerdict, type ReportView, type Verdict,
} from "@aihot/backend/events/relate";

const T = tag();
let answer: unknown;
let lastBody: Record<string, unknown> | null = null;
const provider = await stub((_hit, request) => {
  lastBody = JSON.parse(request.body);
  return answer;
});
// The endpoint is fixed to the official host; tests point fetch at the local stub instead.
const realFetch = globalThis.fetch;
let jevRoute = provider.url;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  return realFetch(url.startsWith("https://openrouter.ai/") ? jevRoute + url.slice("https://openrouter.ai".length) : input as string, init);
}) as typeof fetch;
process.env.OPENROUTER_API_KEY = "test-key";
// assertJevEnabled requires embeddings; the key is enough, nothing recalls here.
process.env.DASHSCOPE_API_KEY = "test-key";

const decide = (factId = 1, overrides: Partial<JevRelationInput> = {}, timeoutMs?: number) => decideRelation({
  articleId: `article-${T}`, revision: 3, factId,
  state: { query: `【新报道】标题：查询报道 ${T}`, candidate: "【候选报道】标题：候选报道" },
  question: jevQuestion(), promptVersion: JEV_PROMPT_VERSION, policyVersion: JEV_VETO_POLICY_VERSION, ...overrides,
}, timeoutMs);

const probabilities = (winner: string) => Object.fromEntries(RELATIONS.map((r) => [r, r === winner ? 0.7 : 0.1]));
const choiceAnswer = (choice: string, overrides: Record<string, unknown> = {}) => ({
  answers: { relation: { type: "choice", choice, probabilities: probabilities(choice), confidence: 0.9, ...overrides } },
  usage: { input_tokens: 100, output_tokens: 5, cost: 0.000021 },
  id: `gen-dec-${T}`,
});

after(async () => { globalThis.fetch = realFetch; await provider.close(); await closeDb(); });

test("the gate defaults to off and names the Jev model", () => {
  assert.equal(config.groupJevEnabled, false);
  assert.equal(config.groupJevModel, "typesafe/jev-1.13");
});

test("the question carries the four industry definitions and the material-only rule", () => {
  const criteria = relationCriteria();
  assert.deepEqual(Object.keys(criteria).sort(), [...RELATIONS].sort());
  for (const [relation, text] of Object.entries(criteria)) assert.ok(text.startsWith(relation));
  assert.throws(() => relationCriteria("SAME_OCCURRENCE（同一次发生）：一段定义。"), /missing the SAME_STORY definition/);
  const question = jevQuestion();
  assert.equal(question.type, "choice");
  assert.match(question.instructions, /不执行/);
  // The state shows exactly title, summary start, source and time — no evidence text, no frame, no scores.
  const report = (title: string) => ({
    title, source: "某来源", firstParty: true, at: new Date("2026-10-01T08:00:00+08:00"),
    summary: "摘要" + "甲".repeat(400), sourceText: "【原文证据不应出现】", frame: { subject: "主体不应出现" },
  }) as ReportView;
  const cand = { factId: 1, storyId: 1, factTitle: "事实", members: 1, storyRoot: true, score: 0.9, report: report("候选") } as CandidateView;
  const state = jevState(report("查询"), cand);
  assert.deepEqual(Object.keys(state), ["query", "candidate"]);
  assert.match(state.query, /^【新报道】/);
  assert.ok(state.query.includes("某来源"));
  assert.ok(!state.query.includes("不应出现"));
  assert.ok(!state.query.includes("甲".repeat(400)), "the summary is cut to 360 characters");
});

test("the request carries only model, state and the one choice question", async () => {
  answer = choiceAnswer("UNRELATED");
  const result = await decide(2);
  assert.equal(result.relation, "UNRELATED");
  assert.deepEqual(Object.keys(lastBody!), ["model", "state", "questions"]);
  assert.equal(lastBody!.model, config.groupJevModel);
  const questions = lastBody!.questions as Record<string, { type?: string }>;
  assert.deepEqual(Object.keys(questions), ["relation"]);
  assert.equal(questions.relation!.type, "choice");
  assert.deepEqual(Object.keys(lastBody!.state as Record<string, unknown>), ["query", "candidate"]);
});

test("a usable answer records its actual cost and is reused for the same input", async () => {
  answer = choiceAnswer("UNRELATED");
  const first = await decide(3);
  assert.equal(first.relation, "UNRELATED");
  assert.equal(first.confidence, 0.9);
  assert.equal(first.probabilities.SAME_OCCURRENCE, 0.1);
  assert.equal(first.reused, false);
  const [receipt] = await sql`SELECT status, cost, currency, cost_basis, request_id, usage FROM receipts WHERE id=${first.receiptId}`;
  // Completed only after the grouping write; here it stays recoverable.
  assert.equal(receipt!.status, "received");
  assert.equal(receipt!.cost, 0.000021);
  assert.equal(receipt!.currency, "USD");
  assert.equal(receipt!.cost_basis, "actual");
  assert.ok(receipt!.request_id);
  const before = provider.hits();
  const second = await decide(3);
  assert.equal(second.receiptId, first.receiptId);
  assert.equal(second.reused, true);
  assert.equal(provider.hits(), before);
});

test("a different candidate, policy or prompt version is a different request", async () => {
  answer = choiceAnswer("SAME_STORY");
  const base = await decide(4);
  assert.notEqual((await decide(5)).receiptId, base.receiptId);
  assert.notEqual((await decide(4, { policyVersion: "jev-veto-2" })).receiptId, base.receiptId);
  assert.notEqual((await decide(4, { promptVersion: "group-definitions@changed" })).receiptId, base.receiptId);
});

test("provider rounding of the probabilities is tolerated", async () => {
  answer = { answers: { relation: { type: "choice", choice: "UNRELATED", probabilities: { SAME_OCCURRENCE: 0.1, SAME_STORY: 0.0996, UNRELATED: 0.7, ROUNDUP: 0.1 }, confidence: 0.8 } } };
  assert.equal((await decide(6)).relation, "UNRELATED");
});

test("the probability tolerance holds at its boundary despite float rounding", () => {
  // 0.5 + 0.3 + 0.19 + 0 sums to 0.9899999999999999 in float: mathematically 0.99, inside the 0.01 tolerance.
  assert.doesNotThrow(() => parseJevAnswer({ answers: { relation: { type: "choice", choice: "SAME_OCCURRENCE", probabilities: { SAME_OCCURRENCE: 0.5, SAME_STORY: 0.3, UNRELATED: 0.19, ROUNDUP: 0 }, confidence: 1 } } }));
  assert.throws(() => parseJevAnswer({ answers: { relation: { type: "choice", choice: "SAME_OCCURRENCE", probabilities: { SAME_OCCURRENCE: 0.52, SAME_STORY: 0.31, UNRELATED: 0.19, ROUNDUP: 0 }, confidence: 1 } } }), /sum to/);
});

test("an answer outside the protocol is a failed receipt, never an UNRELATED", async () => {
  const good = probabilities("UNRELATED");
  const invalid = [
    "not an answer object",
    {},
    { answers: {} },
    { answers: { relation: null } },
    { answers: { relation: { type: "choice", choice: "SAME_OCCURRENCE", probabilities: { SAME_OCCURRENCE: 1 }, confidence: 1 } } },
    { answers: { relation: { type: "choice", choice: "TYPO", probabilities: good, confidence: 1 } } },
    { answers: { relation: { type: "choice", choice: "UNRELATED", probabilities: { ...good, SAME_STORY: "high" }, confidence: 1 } } },
    { answers: { relation: { type: "choice", choice: "UNRELATED", probabilities: { SAME_OCCURRENCE: 0.4, SAME_STORY: 0.4, UNRELATED: 0.4, ROUNDUP: 0.4 }, confidence: 1 } } },
    { answers: { relation: { type: "choice", choice: "SAME_STORY", probabilities: good, confidence: 1 } } },
    { answers: { relation: { type: "choice", choice: "UNRELATED", probabilities: good, confidence: 1.5 } } },
    { answers: { relation: { type: "choice", choice: "UNRELATED", probabilities: good, confidence: "sure" } } },
  ];
  for (const [index, response] of invalid.entries()) {
    answer = response;
    await assert.rejects(decide(100 + index), ModelOutputError);
  }
  const rows = await sql`SELECT status, response FROM receipts WHERE service=${JEV_SERVICE} AND subject=${`article:article-${T}`} AND (request->>'fact')::int BETWEEN 100 AND 199`;
  assert.equal(rows.length, invalid.length);
  assert.ok(rows.every((row) => row.status === "failed" && row.response !== undefined));
});

test("a refused request fails without an answer", async () => {
  answer = new Reply(503, { error: "busy" });
  await assert.rejects(decide(31), ProviderRejectedError);
  const [row] = await sql`SELECT status FROM receipts WHERE service=${JEV_SERVICE} AND (request->>'fact')::int = 31`;
  assert.equal(row!.status, "failed");
});

test("a request still waiting when its timeout passes is an unknown outcome for recovery", async () => {
  const release = gate();
  const silent = await stub(async () => { await release.promise; return {}; });
  jevRoute = silent.url;
  try {
    await assert.rejects(decide(51, {}, 30), ReceiptUnknownError);
    const [row] = await sql`SELECT status FROM receipts WHERE service=${JEV_SERVICE} AND (request->>'fact')::int = 51`;
    assert.equal(row!.status, "unknown", "the request may have reached the provider; recovery decides");
  } finally {
    release.open();
    jevRoute = provider.url;
    await silent.close();
  }
});

test("enabling the gate without its prerequisites fails with a clear error", async () => {
  const saved = { modelCalls: config.modelCallsEnabled, openrouter: process.env.OPENROUTER_API_KEY, dashscope: process.env.DASHSCOPE_API_KEY };
  try {
    config.modelCallsEnabled = false;
    await assert.rejects(assertJevEnabled(), /MODEL_CALLS_ENABLED/);
    config.modelCallsEnabled = true;
    process.env.OPENROUTER_API_KEY = "";
    await assert.rejects(assertJevEnabled(), /OPENROUTER_API_KEY/);
    process.env.OPENROUTER_API_KEY = saved.openrouter ?? "test-key";
    process.env.DASHSCOPE_API_KEY = "";
    await assert.rejects(assertJevEnabled(), /EMBEDDING_API_KEY or DASHSCOPE_API_KEY/);
    process.env.DASHSCOPE_API_KEY = saved.dashscope ?? "test-key";
    await sql`DELETE FROM budgets WHERE service=${JEV_SERVICE}`;
    await assert.rejects(assertJevEnabled(), /budgets row for openrouter-jev/);
  } finally {
    config.modelCallsEnabled = saved.modelCalls;
    if (saved.openrouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved.openrouter;
    if (saved.dashscope === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = saved.dashscope;
    await sql`INSERT INTO budgets (service, per_minute, per_hour, per_day, note) VALUES (${JEV_SERVICE}, 1000, 10000, 100000, 'test')
              ON CONFLICT (service) DO UPDATE SET per_minute = 1000, per_hour = 10000, per_day = 100000`;
  }
});

test("an exhausted budget stops Jev before any request", async () => {
  await sql`UPDATE budgets SET per_minute = 0 WHERE service=${JEV_SERVICE}`;
  const before = provider.hits();
  await assert.rejects(decide(41), BudgetExceededError);
  assert.equal(provider.hits(), before);
  await sql`UPDATE budgets SET per_minute = 1000 WHERE service=${JEV_SERVICE}`;
});

test("the veto overrides only UNRELATED and carries Jev's confidence", () => {
  const verdicts = new Map<number, Verdict>([
    [1, { relation: "SAME_OCCURRENCE", confidence: 0.9, note: "原判断" }],
    [2, { relation: "SAME_STORY", confidence: 0.8, note: "原判断" }],
  ]);
  const jev = new Map<number, JevVerdict>([
    [1, { relation: "UNRELATED", confidence: 0.75 }],
    [2, { relation: "SAME_STORY", confidence: 0.6 }],
  ]);
  const out = applyJevVeto(verdicts, jev);
  assert.equal(out.get(1)!.relation, "UNRELATED");
  assert.equal(out.get(1)!.confidence, 0.75, "the vetoed entry carries Jev's confidence, not the original model's");
  assert.match(out.get(1)!.note, /Jev/);
  assert.deepEqual(out.get(2), verdicts.get(2), "a Jev answer other than UNRELATED changes nothing");
  const unjudged = applyJevVeto(new Map([[3, { relation: "SAME_OCCURRENCE", confidence: 0.9, note: "原判断" }]]), new Map());
  assert.equal(unjudged.get(3)!.relation, "SAME_OCCURRENCE", "a candidate without a Jev answer keeps its verdict");
});

test("a choice answer that disagrees with its probabilities is rejected", () => {
  assert.throws(() => parseJevAnswer({ answers: { relation: { type: "choice", choice: "SAME_STORY", probabilities: probabilities("UNRELATED"), confidence: 1 } } }), /not the winning probability/);
  assert.throws(() => parseJevAnswer({ answers: { relation: { type: "noul", noul: 0.5 } } }), /not a valid choice/);
});
