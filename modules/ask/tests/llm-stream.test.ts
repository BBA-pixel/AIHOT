import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import http from "node:http";
import { closeDb } from "@aihot/backend/db";
import { chatToolsStream } from "@aihot/backend/providers/llm";
import { newUuid } from "@aihot/backend/lib/ids";

after(closeDb);

test("chatToolsStream request has no response_format json_object even when LLM_JSON_MODE=true", async () => {
  let sawBody: Record<string, unknown> | null = null;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      sawBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-test",
        choices: [{ message: { role: "assistant", content: "自然语言回答" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  const prev = { ...process.env };
  Object.assign(process.env, {
    MODEL_CALLS_ENABLED: "true",
    LLM_BASE_URL: `http://127.0.0.1:${port}/v1`,
    LLM_API_KEY: "test-key",
    LLM_MODEL: "deepseek-flash",
    LLM_JSON_MODE: "true",
  });
  try {
    const result = await chatToolsStream({
      model: "default",
      purpose: "ask.tools_stream",
      subject: `unit:${newUuid()}`,
      promptVersion: "ask-system-v1",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      taskId: newUuid(),
      roundIndex: 1,
      enableTools: false,
    });
    assert.equal(result.jsonModeForced, false);
    assert.ok(sawBody);
    assert.ok(sawBody);
    assert.equal(Object.prototype.hasOwnProperty.call(sawBody, "response_format"), false);
    assert.equal((sawBody as Record<string, unknown>).stream, true);
    assert.ok(result.content.includes("自然语言"));
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
    await new Promise<void>((r) => server.close(() => r()));
  }
});
