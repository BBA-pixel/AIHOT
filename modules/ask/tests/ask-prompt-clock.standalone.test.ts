import assert from "node:assert/strict";
import { test } from "node:test";
import { askSystemPrompt } from "../src/agent/prompt.ts";

test("askSystemPrompt injects Beijing now for relative windows", () => {
  // 2026-10-12 21:21 CST = 13:21 UTC
  const text = askSystemPrompt(Date.parse("2026-10-12T13:21:00.000Z"));
  assert.match(text, /现在是北京时间 2026-10-12 21:21/);
  assert.match(text, /站内时间/);
  assert.match(text, /get_latest/);
});
