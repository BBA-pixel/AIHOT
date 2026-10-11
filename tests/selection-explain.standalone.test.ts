import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ScoreSchema, averageScoreAxes } from "@aihot/backend/editorial/analyze";
import {
  buildSelectionExplain,
  buildSelectionHint,
  independentSourceCount,
  wireDedupeNoteForStory,
} from "@aihot/backend/publication/selection-explain";

test("ScoreSchema accepts score-only output", () => {
  const r = ScoreSchema.parse({ attentionScore: 72 });
  assert.equal(r.attentionScore, 72);
  assert.equal(r.axes, undefined);
});

test("ScoreSchema accepts axes and contentType", () => {
  const r = ScoreSchema.parse({
    attentionScore: 80,
    contentType: "game_launch",
    axes: { sig: 8, nov: 7, cred: 6, reson: 8, act: 4 },
  });
  assert.equal(r.contentType, "game_launch");
  assert.equal(r.axes!.sig, 8);
});

test("ScoreSchema drops invalid optional axes without failing", () => {
  const r = ScoreSchema.parse({ attentionScore: 50, axes: { sig: 99 } });
  assert.equal(r.attentionScore, 50);
  assert.equal(r.axes, undefined);
});

test("averageScoreAxes floors the mean of two calls", () => {
  const avg = averageScoreAxes([
    { sig: 8, nov: 7, cred: 6, reson: 8, act: 3 },
    { sig: 7, nov: 6, cred: 5, reson: 7, act: 2 },
  ]);
  assert.deepEqual(avg, { sig: 7, nov: 6, cred: 5, reson: 7, act: 2 });
  assert.equal(averageScoreAxes([]), null);
});

test("buildSelectionExplain shows threshold vs score and tier", () => {
  const e = buildSelectionExplain({
    score: 80,
    selected: true,
    threshold: 76,
    sourceTier: "T2",
    axes: { sig: 8, nov: 7, cred: 6, reson: 8, act: 4 },
    contentType: "game_launch",
    wirePeerCount: 2,
  });
  assert.ok(e);
  assert.equal(e!.metThreshold, true);
  assert.equal(e!.sourceTierLabel, "媒体与个人");
  assert.equal(e!.contentTypeLabel, "定档 / 上线");
  assert.equal(e!.wireDedupe!.peerCount, 2);
  assert.match(e!.wireDedupe!.note, /2 篇/);
});

test("buildSelectionExplain degrades without axes", () => {
  const e = buildSelectionExplain({
    score: 62,
    selected: true,
    threshold: 60,
    sourceTier: "T1",
  });
  assert.ok(e);
  assert.equal(e!.axes, null);
  assert.equal(e!.wireDedupe, null);
  assert.equal(e!.sourceTierLabel, "官方一手");
});

test("buildSelectionHint is compact for cards", () => {
  const h = buildSelectionHint({ score: 80, selected: true, sourceTier: "T2" });
  assert.deepEqual(h, {
    score: 80,
    threshold: 40,
    sourceTier: "T2",
    sourceTierLabel: "媒体与个人",
  });
});

test("independentSourceCount collapses wire copies", () => {
  const c = independentSourceCount([
    { source_id: "a", wire_fingerprint: "fp1" },
    { source_id: "b", wire_fingerprint: "fp1" },
    { source_id: "c", wire_fingerprint: null },
  ]);
  assert.equal(c.sourceCount, 2);
  assert.equal(c.collapsedExtra, 1);
  assert.match(wireDedupeNoteForStory(c.collapsedExtra, c.reportCount, c.sourceCount)!, /3 篇报道计为 2/);
  assert.equal(wireDedupeNoteForStory(0, 2, 2), null);
});
