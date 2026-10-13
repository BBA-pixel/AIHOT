// Fake-model executor guards (≥15 cases). No paid API. No DATABASE required for pure helpers;
// DB-backed cases use the test database when available via sibling file.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCitations, sanitizeAskMarkdown, isAllowedAskHref } from "../src/agent/citations.ts";
import { ASK_TOOL_NAMES, ASK_TOOL_LABELS_ZH, friendlyStepSummary } from "../src/tools/whitelist.ts";
import { logicalKeyFor } from "@aihot/backend/providers/receipts";
import { sha256, stableJson } from "@aihot/backend/lib/ids";

test("whitelist is exactly seven tools and includes get_daily", () => {
  assert.deepEqual([...ASK_TOOL_NAMES], ["get_latest", "search", "get_hot_topics", "get_story", "explain_selection", "explain_hot", "get_daily"]);
  assert.ok(ASK_TOOL_NAMES.includes("get_daily"));
  assert.equal(Object.keys(ASK_TOOL_LABELS_ZH).length, 7);
});

test("citation check fails on forged numbers", () => {
  const r = checkCitations("参见 [1] 与 [99]", [1, 2]);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes("99")));
});

test("citation check fails on raw URLs", () => {
  const r = checkCitations("见 https://evil.example/x", [1]);
  assert.equal(r.ok, false);
});

test("citation check passes registered only", () => {
  assert.equal(checkCitations("根据 [1] 和 [2]", [1, 2]).ok, true);
});

test("sanitize strips images and iframes", () => {
  const out = sanitizeAskMarkdown("你好 ![x](https://evil/x.png) <iframe src='https://e'></iframe> [ok](/items/a)", new Set(["/items/a"]));
  assert.ok(!out.includes("iframe"));
  assert.ok(!out.includes("evil/x.png"));
  assert.ok(out.includes("[ok](/items/a)"));
});

test("sanitize unlinks unregistered markdown links", () => {
  const out = sanitizeAskMarkdown("[坏链](https://evil.example) 与 [好](/items/1)", new Set(["/items/1"]));
  assert.ok(!out.includes("](https://evil.example)"));
  assert.ok(out.includes("[好](/items/1)"));
});

test("isAllowedAskHref blocks javascript and data", () => {
  assert.equal(isAllowedAskHref("javascript:alert(1)", new Set()), false);
  assert.equal(isAllowedAskHref("data:text/html,x", new Set()), false);
  assert.equal(isAllowedAskHref("/items/1", new Set(["/items/1"])), true);
});

test("receipt identity binds taskId and roundIndex not subject alone", () => {
  const base = {
    service: "llm",
    purpose: "ask.tools_stream",
    model: "m",
    identity: { taskId: "t1", roundIndex: 1, messagesHash: "a", toolsHash: "b", stream: true },
  };
  const k1 = logicalKeyFor(base);
  const k2 = logicalKeyFor({ ...base, subject: "different-subject" });
  assert.equal(k1, k2, "subject must not change logical key");
  const k3 = logicalKeyFor({ ...base, identity: { ...base.identity, roundIndex: 2 } });
  assert.notEqual(k1, k3);
  const k4 = logicalKeyFor({ ...base, identity: { ...base.identity, taskId: "t2" } });
  assert.notEqual(k1, k4);
  const k5 = logicalKeyFor({ ...base, attemptTag: "retry:1" });
  assert.notEqual(k1, k5);
});

test("identity hash includes messages and tools", () => {
  const h1 = sha256(stableJson({ messagesHash: "m1", toolsHash: "t1" }));
  const h2 = sha256(stableJson({ messagesHash: "m2", toolsHash: "t1" }));
  assert.notEqual(h1, h2);
});

test("get_latest step chip is 拉取近期精选/公开动态, not 相关资料", () => {
  const summary = friendlyStepSummary({
    ok: true,
    name: "get_latest",
    text: "近期列表……",
    structured: { count: 30, mode: "selected" },
    evidence: [],
  });
  assert.equal(summary, "拉取近期精选 30 条");
  assert.equal(summary.includes("相关资料"), false);
});

test("search/hot step chip still says 相关资料 when evidence present", () => {
  const summary = friendlyStepSummary({
    ok: true,
    name: "search",
    text: "hit",
    structured: { count: 1 },
    evidence: [
      { kind: "item", objectId: "a", title: "t", sourceName: null, publishedAt: null, siteUrl: "/items/a", originalUrl: null, toolName: "search", rawRef: {} },
    ],
  });
  assert.equal(summary, "找到 1 条相关资料");
});
