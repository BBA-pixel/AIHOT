// OpenAI-compatible chat calls, always through receipts. One model is enough: `default` is whatever the
// deployment names in LLM_BASE_URL / LLM_API_KEY / LLM_MODEL, and every capability uses it unless the
// site, an environment variable or the admin's model page picks one of the site's named presets
// (site/models.ts).
import type { z } from "zod";
import { PRESETS } from "@aihot/site/models";
import { config, credential } from "../config.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import { assertAccepted, paidRequest, ProviderRejectedError, rejectReceivedResponse } from "./receipts.ts";

export interface ModelSpec {
  key: string;
  service: string;
  model: string;
  baseUrlEnv: string;
  apiKeyEnv: string;
  /** Extra request fields, e.g. switching reasoning off for short structured tasks. */
  extra?: Record<string, unknown>;
  /** Output tokens added to every call's own limit for a reasoning model, which reasons before it answers. */
  reasoningTokens?: number;
  jsonMode: boolean;
  vision?: boolean;
}

function extraFromEnv(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error("LLM_EXTRA_JSON must be a JSON object, e.g. {\"enable_thinking\": false}");
  }
}

function reasoningTokensFromEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) throw new Error("LLM_REASONING_TOKENS must be a non-negative integer, e.g. 4000");
  return Number(value);
}

export const MODELS: Record<string, ModelSpec> = {
  // Read from the environment at call time.
  default: {
    key: "default", service: "llm", baseUrlEnv: "LLM_BASE_URL", apiKeyEnv: "LLM_API_KEY",
    get model() { return process.env.LLM_MODEL ?? ""; },
    get extra() { return extraFromEnv(process.env.LLM_EXTRA_JSON); },
    get reasoningTokens() { return reasoningTokensFromEnv(process.env.LLM_REASONING_TOKENS); },
    get jsonMode() { return process.env.LLM_JSON_MODE !== "false"; },
    get vision() { return process.env.LLM_VISION === "true"; },
  },
  // The pack's named presets, each with its own address and key.
  ...Object.fromEntries(Object.entries(PRESETS).map(([key, preset]) => [key, { key, ...preset }])),
};

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatJsonOptions<S extends z.ZodType> {
  model: string;
  purpose: string;
  subject: string;
  promptVersion: string;
  system: string;
  user: string | ContentPart[];
  schema: S;
  temperature?: number;
  maxTokens?: number;
  attemptTag?: string;
  timeoutMs?: number;
  /** false: the model answers in its own text format (no JSON mode); `parse` turns it into the schema's input. */
  json?: boolean;
  parse?: (content: string) => unknown;
}

export interface ChatJsonResult<T> {
  data: T;
  receiptId: number;
  reused: boolean;
  model: string;
  usage: Record<string, unknown> | null;
}

export class ModelOutputError extends Error {
  readonly receiptId: number | null;
  constructor(message: string, receiptId: number | null = null) {
    super(message);
    this.receiptId = receiptId;
  }
}

function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1]!;
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new ModelOutputError("No JSON object in model output");
  const body = t.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    return JSON.parse(escapeControlCharsInStrings(body));
  }
}

/** Models sometimes emit raw newlines or tabs inside JSON strings (multi-line posts); escape only those. */
export function escapeControlCharsInStrings(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      else if (ch < " ") {
        out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
        continue;
      }
    } else if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

function isConnectFailure(error: unknown): boolean {
  const code = (error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code;
  return ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED"].includes(code ?? "");
}

export async function chatJson<S extends z.ZodType>(opts: ChatJsonOptions<S>): Promise<ChatJsonResult<z.infer<S>>> {
  const spec = MODELS[opts.model];
  if (!spec) throw new Error(`Unknown model ${opts.model}`);
  if (!config.modelCallsEnabled) throw new Error("Model calls are disabled (MODEL_CALLS_ENABLED=false)");
  const baseUrl = credential("models", spec.baseUrlEnv);
  const apiKey = credential("models", spec.apiKeyEnv);
  if (!baseUrl || !apiKey || !spec.model) throw new Error(`Model ${opts.model} is not configured (${spec.baseUrlEnv}, ${spec.apiKeyEnv}${spec.key === "default" ? ", LLM_MODEL" : ""})`);

  const temperature = opts.temperature ?? 0.2;
  const maxTokens = Math.max(opts.maxTokens ?? 1500, 512) + (spec.reasoningTokens ?? 0);
  const userText = typeof opts.user === "string" ? opts.user : JSON.stringify(opts.user);
  const body: Record<string, unknown> = {
    model: spec.model,
    messages: [
      // A prompt given as one user message (the title/summary prompts) has no system message.
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      // Multimodal parts go through as parts; plain objects are sent as JSON text.
      { role: "user", content: typeof opts.user === "string" || Array.isArray(opts.user) ? opts.user : userText },
    ],
    temperature,
    max_tokens: maxTokens,
    ...(spec.jsonMode && opts.json !== false ? { response_format: { type: "json_object" } } : {}),
    ...(spec.extra ?? {}),
  };

  const receipt = await paidRequest(
    {
      service: spec.service,
      model: spec.model,
      purpose: opts.purpose,
      subject: opts.subject,
      identity: { model: spec.model, promptVersion: opts.promptVersion, system: sha256(opts.system), user: sha256(userText), temperature, maxTokens, extra: spec.extra ?? null },
      requestSummary: { promptVersion: opts.promptVersion, systemHash: sha256(opts.system), userHash: sha256(userText), userChars: userText.length, temperature, maxTokens },
      attemptTag: opts.attemptTag,
    },
    async () => {
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        });
      } catch (error) {
        if (isConnectFailure(error)) throw new ProviderRejectedError(`connect failed: ${String(error)}`, null, true);
        throw error;
      }
      const text = await res.text();
      assertAccepted(spec.service, res.status, text);
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text);
        if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Expected a response object");
      } catch {
        json = { unparsable: text.slice(0, 20000) };
      }
      const usage = (json.usage as Record<string, unknown> | undefined) ?? null;
      return {
        response: { ...json, _latencyMs: Date.now() - started },
        requestId: (json.id as string | undefined) ?? res.headers.get("x-request-id"),
        usage,
        cost: null,
      };
    },
  );

  const response = receipt.response as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: Record<string, unknown> };
  const content = response.choices?.[0]?.message?.content ?? "";
  let parsed: z.infer<S>;
  try {
    parsed = opts.schema.parse(opts.parse ? opts.parse(content) : extractJson(content));
  } catch (error) {
    // Unusable output: record it and let a later attempt pay for a fresh answer. A reasoning model that
    // reasoned up to the output limit leaves an empty or cut-off answer; say so, and where to give it room.
    const detail = response.choices?.[0]?.finish_reason === "length"
      ? `output token limit reached (finish_reason=length): a reasoning model may have spent it reasoning; give it room with ${spec.key === "default" ? "LLM_REASONING_TOKENS" : `reasoningTokens on preset ${spec.key}`}. ${String(error)}`
      : String(error);
    await rejectReceivedResponse(receipt.receiptId, `unusable output: ${detail.slice(0, 500)}`);
    throw new ModelOutputError(`Model ${opts.model} returned unusable output for ${opts.subject}: ${detail.slice(0, 300)}`, receipt.receiptId);
  }
  return { data: parsed, receiptId: receipt.receiptId, reused: receipt.reused, model: spec.key, usage: response.usage ?? null };
}

/** One OpenAI-compatible tool definition passed to chatToolsStream. */
export interface ChatToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatToolsMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
  name?: string;
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatToolsStreamOptions {
  model: string;
  purpose: string;
  subject: string;
  promptVersion: string;
  system: string;
  messages: ChatToolsMessage[];
  tools: ChatToolSpec[];
  /** Bound into receipt identity (ask task × model round). */
  taskId: string;
  roundIndex: number;
  temperature?: number;
  maxTokens?: number;
  attemptTag?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called for each content delta during a live stream (not on receipt reuse). */
  onDelta?: (text: string) => void | Promise<void>;
  /** When false, omit tools from the request (final answer / forced no-tools). Default true when tools.length > 0. */
  enableTools?: boolean;
}

export interface ChatToolsStreamResult {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: string | null;
  receiptId: number;
  reused: boolean;
  model: string;
  usage: Record<string, unknown> | null;
  /** True when the outbound request body did not set response_format json_object. */
  jsonModeForced: false;
}

interface ToolAccum {
  id?: string;
  name?: string;
  arguments: string;
}

function accumulateToolDelta(acc: Map<number, ToolAccum>, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { index?: number; id?: string; function?: { name?: string; arguments?: string } };
    const index = typeof row.index === "number" ? row.index : 0;
    const cur = acc.get(index) ?? { arguments: "" };
    if (typeof row.id === "string" && row.id) cur.id = row.id;
    if (typeof row.function?.name === "string" && row.function.name) cur.name = row.function.name;
    if (typeof row.function?.arguments === "string") cur.arguments += row.function.arguments;
    acc.set(index, cur);
  }
}

function finalizeToolCalls(acc: Map<number, ToolAccum>): ChatToolCall[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, t]) => {
      if (!t.id || !t.name) return [];
      return [{ id: t.id, type: "function" as const, function: { name: t.name, arguments: t.arguments } }];
    });
}

function parseSseChatStream(
  body: ReadableStream<Uint8Array> | null,
  onDelta?: (text: string) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<{ content: string; toolCalls: ChatToolCall[]; finishReason: string | null; usage: Record<string, unknown> | null; id: string | null }> {
  return (async () => {
    if (!body) throw new ProviderRejectedError("empty stream body", null, true);
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let finishReason: string | null = null;
    let usage: Record<string, unknown> | null = null;
    let id: string | null = null;
    const tools = new Map<number, ToolAccum>();
    const pump = async (): Promise<void> => {
      while (true) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const line of parts) {
          const trimmed = line.trimEnd();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let json: Record<string, unknown>;
          try {
            json = JSON.parse(data) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (typeof json.id === "string") id = json.id;
          if (json.usage && typeof json.usage === "object") usage = json.usage as Record<string, unknown>;
          const choices = json.choices as Array<{ delta?: { content?: string | null; tool_calls?: unknown }; finish_reason?: string | null }> | undefined;
          const choice = choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;
          const delta = choice.delta;
          if (!delta) continue;
          if (typeof delta.content === "string" && delta.content) {
            content += delta.content;
            await onDelta?.(delta.content);
          }
          if (delta.tool_calls) accumulateToolDelta(tools, delta.tool_calls);
        }
      }
    };
    try {
      await pump();
    } finally {
      reader.releaseLock();
    }
    return { content, toolCalls: finalizeToolCalls(tools), finishReason, usage, id };
  })();
}

/**
 * Streaming chat with optional tools for the ask agent. Goes through paidRequest like chatJson.
 * Does **not** set response_format json_object (answers are natural language). Identity must include
 * taskId and roundIndex so recovery reuses the same logical key without double billing.
 */
export async function chatToolsStream(opts: ChatToolsStreamOptions): Promise<ChatToolsStreamResult> {
  const spec = MODELS[opts.model];
  if (!spec) throw new Error(`Unknown model ${opts.model}`);
  if (!config.modelCallsEnabled) throw new Error("Model calls are disabled (MODEL_CALLS_ENABLED=false)");
  const baseUrl = credential("models", spec.baseUrlEnv);
  const apiKey = credential("models", spec.apiKeyEnv);
  if (!baseUrl || !apiKey || !spec.model) throw new Error(`Model ${opts.model} is not configured (${spec.baseUrlEnv}, ${spec.apiKeyEnv}${spec.key === "default" ? ", LLM_MODEL" : ""})`);

  const temperature = opts.temperature ?? 0.2;
  const maxTokens = Math.max(opts.maxTokens ?? 2048, 512) + (spec.reasoningTokens ?? 0);
  const enableTools = opts.enableTools !== false && opts.tools.length > 0;
  const messages: ChatToolsMessage[] = [
    ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
    ...opts.messages,
  ];
  const messagesHash = sha256(stableJson(messages));
  const toolsHash = sha256(stableJson(enableTools ? opts.tools : []));
  const systemHash = sha256(opts.system);

  const body: Record<string, unknown> = {
    model: spec.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
    ...(enableTools ? { tools: opts.tools, tool_choice: "auto" } : {}),
    ...(spec.extra ?? {}),
  };
  // Never inherit chatJson's forced JSON mode on the user-facing answer path.
  if ("response_format" in body) delete body.response_format;

  const receipt = await paidRequest(
    {
      service: spec.service,
      model: spec.model,
      purpose: opts.purpose,
      subject: opts.subject,
      identity: {
        model: spec.model,
        promptVersion: opts.promptVersion,
        systemHash,
        messagesHash,
        toolsHash,
        temperature,
        maxTokens,
        extra: spec.extra ?? null,
        stream: true,
        taskId: opts.taskId,
        roundIndex: opts.roundIndex,
      },
      requestSummary: {
        promptVersion: opts.promptVersion,
        systemHash,
        messagesHash,
        toolsHash,
        temperature,
        maxTokens,
        taskId: opts.taskId,
        roundIndex: opts.roundIndex,
        stream: true,
        enableTools,
      },
      attemptTag: opts.attemptTag,
    },
    async () => {
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, accept: "text/event-stream" },
          body: JSON.stringify(body),
          signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (isConnectFailure(error)) throw new ProviderRejectedError(`connect failed: ${String(error)}`, null, true);
        throw error;
      }
      const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!res.ok) {
        const text = await res.text();
        assertAccepted(spec.service, res.status, text);
      }
      // Some stubs / providers may answer with a full JSON object even when stream was requested.
      if (ctype.includes("application/json") && !ctype.includes("event-stream")) {
        const text = await res.text();
        assertAccepted(spec.service, res.status, text);
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new ProviderRejectedError(`unparsable chat response: ${text.slice(0, 200)}`, res.status, true);
        }
        const choice = (json.choices as Array<{ message?: { content?: string | null; tool_calls?: ChatToolCall[] }; finish_reason?: string }> | undefined)?.[0];
        const content = choice?.message?.content ?? "";
        if (content) await opts.onDelta?.(content);
        const toolCalls = Array.isArray(choice?.message?.tool_calls) ? choice!.message!.tool_calls! : [];
        return {
          response: { ...json, _latencyMs: Date.now() - started, _assembled: { content, toolCalls, finishReason: choice?.finish_reason ?? null } },
          requestId: (json.id as string | undefined) ?? res.headers.get("x-request-id"),
          usage: (json.usage as Record<string, unknown> | undefined) ?? null,
          cost: null,
        };
      }
      assertAccepted(spec.service, res.status, "");
      const streamed = await parseSseChatStream(res.body, opts.onDelta, opts.signal);
      return {
        response: {
          id: streamed.id,
          choices: [{
            message: {
              role: "assistant",
              content: streamed.content,
              ...(streamed.toolCalls.length ? { tool_calls: streamed.toolCalls } : {}),
            },
            finish_reason: streamed.finishReason,
          }],
          usage: streamed.usage,
          _latencyMs: Date.now() - started,
          _assembled: { content: streamed.content, toolCalls: streamed.toolCalls, finishReason: streamed.finishReason },
        },
        requestId: streamed.id ?? res.headers.get("x-request-id"),
        usage: streamed.usage,
        cost: null,
      };
    },
  );

  const response = receipt.response as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatToolCall[] }; finish_reason?: string | null }>;
    usage?: Record<string, unknown>;
    _assembled?: { content: string; toolCalls: ChatToolCall[]; finishReason: string | null };
  };
  const assembled = response._assembled;
  const content = assembled?.content ?? response.choices?.[0]?.message?.content ?? "";
  const toolCalls = assembled?.toolCalls ?? response.choices?.[0]?.message?.tool_calls ?? [];
  const finishReason = assembled?.finishReason ?? response.choices?.[0]?.finish_reason ?? null;

  return {
    content,
    toolCalls,
    finishReason,
    receiptId: receipt.receiptId,
    reused: receipt.reused,
    model: spec.key,
    usage: response.usage ?? null,
    jsonModeForced: false,
  };
}

