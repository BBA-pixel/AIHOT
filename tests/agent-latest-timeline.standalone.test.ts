// latestAnswer must expose 站内时间 (timelineAt) so agents can filter short windows against the feed clock.
import assert from "node:assert/strict";
import { test } from "node:test";
import { latestAnswer, stamp } from "@aihot/backend/publication/agent";
import type { V1ItemPayload } from "@aihot/backend/publication/publish";
import type { V1ItemsResult } from "@aihot/backend/publication/v1";

const item = (over: Partial<V1ItemPayload> & Pick<V1ItemPayload, "id" | "title">): V1ItemPayload => ({
  originalTitle: null,
  summary: null,
  source: { name: "3DM" },
  links: { aihot: "https://example.org/items/x", original: "https://source.example/x" },
  publishedAt: "2026-10-12T12:26:38.000Z", // 20:26 BJ
  discoveredAt: "2026-10-12T12:30:00.000Z",
  timelineAt: "2026-10-12T13:15:34.000Z", // 21:15 BJ — feed rail
  category: "updates",
  score: 60,
  selected: true,
  reason: null,
  attribution: { name: "GAMEHOT", url: "https://example.org/items/x" },
  ...over,
});

test("latestAnswer labels 站内时间 and 原文发布于 when they differ", () => {
  const res: V1ItemsResult = {
    schemaVersion: 1,
    query: { mode: "selected", category: null, window: "24h", q: null, by: "timeline", ordering: "timelineDesc" },
    items: [item({ id: "ff7", title: "最终幻想7" })],
    page: { count: 1, hasMore: false, nextCursor: null },
  };
  const text = latestAnswer(res, { window: "24h", mode: "selected", category: null, limit: 10 });
  assert.match(text, /站内时间轴/);
  assert.match(text, /站内时间 10-12 21:15/);
  assert.match(text, /原文发布于 10-12 20:26/);
  assert.match(text, /最近 N 小时.*站内时间/);
});

test("stamp is Beijing clock", () => {
  assert.equal(stamp("2026-10-12T13:15:34.000Z"), "10-12 21:15");
});
