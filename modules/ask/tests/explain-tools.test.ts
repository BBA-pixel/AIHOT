import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { explainSelection } from "../src/tools/explain-selection.ts";
import { explainHot } from "../src/tools/explain-hot.ts";
import { executeAskTool } from "../src/tools/whitelist.ts";
import { buildSelectionExplain } from "@aihot/backend/publication/selection-explain";

after(closeDb);

test("buildSelectionExplain keeps metThreshold when score clears threshold even if not selected", () => {
  const e = buildSelectionExplain({ score: 80, selected: false, threshold: 76, sourceTier: "T2", axes: { sig: 7, nov: 6, cred: 8, reson: 5, act: 6 } });
  assert.equal(e!.metThreshold, true);
  assert.equal(e!.score, 80);
  assert.equal(e!.threshold, 76);
});

test("explain_selection rejects empty article_id", async () => {
  const r = await explainSelection("");
  assert.equal(r.isError, true);
  assert.equal((r.structured.error as { code: string }).code, "invalid_request");
});

test("explain_selection not_found for unknown id", async () => {
  const r = await explainSelection("does_not_exist_article_xx");
  assert.equal(r.isError, true);
  assert.equal((r.structured.error as { code: string }).code, "not_found");
});

test("explain_hot rejects bad public_id", async () => {
  const r = await explainHot("not-a-uuid");
  assert.equal(r.isError, true);
  assert.ok(["invalid_request", "not_found"].includes((r.structured.error as { code: string }).code));
});

test("whitelist rejects unknown tool", async () => {
  const r = await executeAskTool("not_a_tool", "{}");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errorCode, "unknown_tool");
});

test("whitelist rejects truncated tool arguments JSON", async () => {
  const r = await executeAskTool("explain_selection", '{"article_id":');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errorCode, "invalid_arguments");
});

test("whitelist rejects extra properties", async () => {
  const r = await executeAskTool("explain_selection", JSON.stringify({ article_id: "x", hack: 1 }));
  assert.equal(r.ok, false);
});
