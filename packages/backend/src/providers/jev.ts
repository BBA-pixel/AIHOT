// Jev through OpenRouter's Decisions API (https://openrouter.ai/api/alpha/decisions): a four-way
// relation judge asked once per recall candidate as a veto gate (events/group.ts wires it, relate.ts
// builds the question). A thin paid provider like the others: every request has a receipt and counts
// against the openrouter-jev budget; no event tables here, and no retry beyond the receipts'.
import { z } from "zod";
import { config, credential } from "../config.ts";
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";
import { embeddingsAvailable } from "./embeddings.ts";
import { isConnectFailure, ModelOutputError } from "./llm.ts";
import { assertAccepted, paidRequest, ProviderRejectedError, rejectReceivedResponse } from "./receipts.ts";
import { RELATIONS, type Relation } from "../events/relate.ts";

export const JEV_SERVICE = "openrouter-jev";
/** The endpoint is fixed to the official host: no production base-URL override exists (tests point fetch at a local stub). */
const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
/** The provider's four probabilities may not sum to exactly 1 (decimal rounding). */
const SUM_TOLERANCE = 0.01;
/** Slack for the sums and comparisons above: float addition of four probabilities lands ~1e-16 off, past the 0.01 boundary. */
const FLOAT_SLACK = 1e-9;
/** How long one request may take on its own; the caller may pass less of its stage budget. */
export const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Turning the gate on has hard prerequisites (no budget row would mean unlimited requests): anything
 * missing fails the grouping task with a clear message instead of falling back to the ungated flow.
 */
export async function assertJevEnabled(): Promise<void> {
  if (!config.modelCallsEnabled) throw new Error("GROUP_JEV_ENABLED=true requires MODEL_CALLS_ENABLED=true");
  if (!credential("models", "OPENROUTER_API_KEY")) throw new Error("GROUP_JEV_ENABLED=true requires OPENROUTER_API_KEY");
  if (!embeddingsAvailable()) throw new Error("GROUP_JEV_ENABLED=true requires embeddings (EMBEDDING_API_KEY or DASHSCOPE_API_KEY): Jev judges embedding recall, not the lexical fallback");
  const [budget] = await sql<{ per_minute: number; per_hour: number; per_day: number }[]>`
    SELECT per_minute, per_hour, per_day FROM budgets WHERE service = ${JEV_SERVICE}`;
  if (!budget) throw new Error(`GROUP_JEV_ENABLED=true requires a budgets row for ${JEV_SERVICE} (configure it through the admin's budgets, a missing row means unlimited)`);
}

export interface JevRelationInput {
  articleId: string;
  revision: number;
  factId: number;
  /** The request's state and question, built by events/relate.ts (report texts, method and criteria). */
  state: Record<string, string>;
  question: { type: "choice"; instructions: string; criteria: Record<Relation, string> };
  promptVersion: string;
  policyVersion: string;
}

export interface JevRelation {
  relation: Relation;
  confidence: number;
  probabilities: Record<Relation, number>;
  receiptId: number;
  reused: boolean;
}

const ChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.enum(RELATIONS),
  probabilities: z.record(z.string(), z.number().finite().min(0).max(1)),
  confidence: z.number().finite().min(0).max(1),
});

/** A usable answer has all four probabilities, a winner they agree on and a confidence in range. */
export function parseJevAnswer(response: unknown): { relation: Relation; confidence: number; probabilities: Record<Relation, number> } {
  const answers = (response as { answers?: unknown } | null)?.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new Error("response has no answers object");
  const parsed = ChoiceAnswer.safeParse((answers as Record<string, unknown>).relation);
  if (!parsed.success) throw new Error(`relation answer is not a valid choice: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  const { choice, probabilities, confidence } = parsed.data;
  const missing = RELATIONS.filter((r) => !(r in probabilities));
  if (missing.length) throw new Error(`probabilities missing for ${missing.join(", ")}`);
  const sum = RELATIONS.reduce((total, r) => total + probabilities[r]!, 0);
  if (Math.abs(sum - 1) > SUM_TOLERANCE + FLOAT_SLACK) throw new Error(`probabilities sum to ${sum}`);
  const best = Math.max(...RELATIONS.map((r) => probabilities[r]!));
  if (probabilities[choice]! < best - FLOAT_SLACK) throw new Error(`choice ${choice} is not the winning probability`);
  return { relation: choice, confidence, probabilities: Object.fromEntries(RELATIONS.map((r) => [r, probabilities[r]!])) as Record<Relation, number> };
}

/**
 * Jev's relation for one candidate: a choice over the four relations with per-option probabilities
 * and an independent confidence. An answer outside the protocol is a failed receipt and an error —
 * never an UNRELATED. `timeoutMs` caps the request; the caller passes what remains of its stage
 * budget, so a timed-out request turns into an unknown receipt for recovery, never an UNRELATED.
 */
export async function decideRelation(input: JevRelationInput, timeoutMs = REQUEST_TIMEOUT_MS): Promise<JevRelation> {
  if (!config.modelCallsEnabled) throw new Error("Model calls are disabled (MODEL_CALLS_ENABLED=false)");
  const apiKey = credential("models", "OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  const model = config.groupJevModel;
  const body = { model, state: input.state, questions: { relation: input.question } };
  const stateJson = JSON.stringify(input.state);
  const questionJson = JSON.stringify(input.question);
  const receipt = await paidRequest(
    {
      service: JEV_SERVICE,
      model,
      purpose: "group_jev",
      subject: `article:${input.articleId}`,
      identity: {
        article: input.articleId, revision: input.revision, fact: input.factId, model, endpoint: ENDPOINT,
        promptVersion: input.promptVersion, policyVersion: input.policyVersion, state: sha256(stateJson), question: sha256(questionJson),
      },
      requestSummary: { fact: input.factId, promptVersion: input.promptVersion, policyVersion: input.policyVersion, stateHash: sha256(stateJson), stateChars: stateJson.length },
    },
    async () => {
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (isConnectFailure(error)) throw new ProviderRejectedError(`connect failed: ${String(error)}`, null, true);
        throw error;
      }
      const text = await res.text();
      assertAccepted(JEV_SERVICE, res.status, text);
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text);
        if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Expected a response object");
      } catch {
        json = { unparsable: text.slice(0, 20000) };
      }
      const usage = (json.usage as Record<string, unknown> | undefined) ?? null;
      const cost = usage && typeof usage.cost === "number" ? { amount: usage.cost, currency: "USD", basis: "actual" as const } : null;
      return {
        response: { ...json, _latencyMs: Date.now() - started },
        requestId: (json.id as string | undefined) ?? res.headers.get("x-request-id"),
        usage,
        cost,
      };
    },
  );
  try {
    return { ...parseJevAnswer(receipt.response), receiptId: receipt.receiptId, reused: receipt.reused };
  } catch (error) {
    await rejectReceivedResponse(receipt.receiptId, `unusable output: ${String(error).slice(0, 500)}`);
    throw new ModelOutputError(`Jev returned an unusable answer for article:${input.articleId}:fact:${input.factId}: ${String(error).slice(0, 300)}`, receipt.receiptId);
  }
}
