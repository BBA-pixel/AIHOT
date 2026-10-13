// In-site Agent whitelist: seven tools. Adapts publication/agent + explain tools; no HTTP round-trip.
import { z } from "zod";
import { PUBLIC_API_CATEGORY_KEYS } from "@aihot/contracts/taxonomy";
import { mcpToolName } from "@aihot/contracts/mcp";
import {
  latestAnswer, searchAnswer, searchItems, hotAnswer, storyAnswer, dailyAnswer, type AgentWindow,
} from "@aihot/backend/publication/agent";
import { v1Items } from "@aihot/backend/publication/v1";
import { resolveStory, v1HotTopics, v1Story } from "@aihot/backend/publication/stories";
import { dailyWithNotes } from "@aihot/backend/publication/reports";
import { isValidDate } from "@aihot/contracts/time";
import { explainSelection } from "./explain-selection.ts";
import { explainHot } from "./explain-hot.ts";

export const ASK_TOOL_NAMES = [
  "get_latest",
  "search",
  "get_hot_topics",
  "get_story",
  "explain_selection",
  "explain_hot",
  "get_daily",
] as const;

export type AskToolName = (typeof ASK_TOOL_NAMES)[number];

export const ASK_TOOL_LABELS_ZH: Record<AskToolName, string> = {
  get_latest: "查近期资讯",
  search: "站内搜索",
  get_hot_topics: "查热点",
  get_story: "查事件进展",
  explain_selection: "解释入选",
  explain_hot: "解释上榜",
  get_daily: "查日报",
};

const categorySchema = z.enum(PUBLIC_API_CATEGORY_KEYS as unknown as [string, ...string[]]).optional();

const SCHEMAS: Record<AskToolName, z.ZodType> = {
  get_latest: z.object({
    window: z.enum(["24h", "7d"]).optional().describe("时间窗口：24h=过去24小时（默认），7d=最近7天。没有1小时参数；短窗口请取24h结果后按「站内时间」自行过滤。"),
    mode: z.enum(["selected", "all"]).optional().describe("selected=精选（默认，与精选页一致）；all=全部公开动态。问精选时务必用 selected。"),
    category: categorySchema,
    limit: z.number().int().min(1).max(30).optional().describe("最多返回条数，1–30，默认10。查「最近一小时」时可提到30以便过滤。"),
  }).strict(),
  search: z.object({
    q: z.string().min(2).max(200).describe("搜索词，2–200字。"),
    window: z.enum(["24h", "7d"]).optional().describe("搜索窗口，默认7d；只看今天用24h。"),
    category: categorySchema,
    limit: z.number().int().min(1).max(30).optional().describe("最多返回条数，1–30，默认10。"),
  }).strict(),
  get_hot_topics: z.object({
    limit: z.number().int().min(1).max(10).optional().describe("热点条数，1–10，默认10。"),
  }).strict(),
  get_story: z.object({
    public_id: z.string().min(1).max(128).describe("事件公开 ID，须来自 get_hot_topics 返回值，不要猜测。"),
    limit: z.number().int().min(1).max(50).optional().describe("时间线条数，1–50，默认20。"),
  }).strict(),
  explain_selection: z.object({
    article_id: z.string().min(1).max(128).describe("条目 ID（站内 /items/… 路径中的 id）。"),
  }).strict(),
  explain_hot: z.object({
    public_id: z.string().min(1).max(128).describe("事件公开 ID，须来自 get_hot_topics。"),
  }).strict(),
  get_daily: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("可选真实日历日期 YYYY-MM-DD；省略则取最新一期日报。"),
  }).strict(),
};

const ASK_TOOL_DESCRIPTIONS: Record<AskToolName, string> = {
  get_latest: "查近期资讯（精选或全部）。默认 mode=selected、window=24h。无独立1小时窗口：先拉24h精选，再按结果「站内时间」（与精选页一致）过滤；不要只用原文发布时间。列表仅供浏览，不会登记为可引用「来源」。",
  search: "按关键词站内搜索。先查精选，精选无结果时自动扩到全部公开动态。",
  get_hot_topics: "查当前热点榜（多信源同时讨论的事件）。",
  get_story: "查某一热点事件的来龙去脉与报道时间线；public_id 必须来自 get_hot_topics。",
  explain_selection: "解释某条目为何入选精选（评分与门槛说明）。",
  explain_hot: "解释某事件为何上热点榜。",
  get_daily: "查本站编辑过的 AI 日报（固定成品，不是过去24小时滚动列表）。省略 date 取最新一期；指定 date=YYYY-MM-DD 取该日。问「今天日报／某日日报」用本工具，不要用 get_latest 冒充。",
};

/** OpenAI tool specs for the model (short names). */
export function askToolSpecs() {
  return ASK_TOOL_NAMES.map((name) => ({
    type: "function" as const,
    function: {
      name,
      description: ASK_TOOL_DESCRIPTIONS[name],
      parameters: z.toJSONSchema(SCHEMAS[name], { io: "input" }) as Record<string, unknown>,
    },
  }));
}

export interface ToolExecOk {
  ok: true;
  name: AskToolName;
  text: string;
  structured: Record<string, unknown>;
  /** Evidence candidates extracted for the registry. */
  evidence: EvidenceCandidate[];
}

export interface ToolExecFail {
  ok: false;
  name: string;
  errorCode: string;
  message: string;
}

export type ToolExecResult = ToolExecOk | ToolExecFail;

export interface EvidenceCandidate {
  kind: "item" | "story" | "selection_explain" | "hot_explain" | "tool_note";
  objectId: string | null;
  title: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  siteUrl: string | null;
  originalUrl: string | null;
  toolName: string;
  rawRef: Record<string, unknown>;
}

function truncate(text: string, max = 4000): string {
  if ([...text].length <= max) return text;
  return [...text].slice(0, max).join("") + "\n…(已截断)";
}

/** Validate and execute one whitelist tool call. Unknown names / bad JSON / schema fail without side effects. */
export async function executeAskTool(name: string, argsJson: string): Promise<ToolExecResult> {
  if (!(ASK_TOOL_NAMES as readonly string[]).includes(name)) {
    return { ok: false, name, errorCode: "unknown_tool", message: `工具不在白名单：${name}` };
  }
  const tool = name as AskToolName;
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return { ok: false, name, errorCode: "invalid_arguments", message: "工具参数不是完整 JSON，未执行。" };
  }
  const parsed = SCHEMAS[tool].safeParse(args);
  if (!parsed.success) {
    return { ok: false, name, errorCode: "invalid_arguments", message: `参数校验失败：${parsed.error.message}` };
  }

  try {
    switch (tool) {
      case "get_latest": {
        const a = parsed.data as { window?: AgentWindow; mode?: "selected" | "all"; category?: string | null; limit?: number };
        const p = {
          window: (a.window ?? "24h") as AgentWindow,
          mode: (a.mode ?? "selected") as "selected" | "all",
          category: (a.category ?? null) as never,
          limit: a.limit ?? 10,
        };
        const res = await v1Items({ ...p, by: "timeline", q: null, cursor: null });
        const text = truncate(latestAnswer(res, p));
        const count = (res.items ?? []).slice(0, p.limit).length;
        // Timeline / recent-list dumps are browsing context for the model, not query-matched
        // hits. Do not register them as citeable 来源 (avoids empty-search fallbacks showing
        // unrelated DOOM/MTG/etc. items under「来源 N」).
        return { ok: true, name: tool, text, structured: { count, mode: p.mode }, evidence: [] };
      }
      case "search": {
        const a = parsed.data as { q: string; window?: AgentWindow; category?: string | null; limit?: number };
        const window = (a.window ?? "7d") as AgentWindow;
        const category = (a.category ?? null) as never;
        const limit = a.limit ?? 10;
        const found = await searchItems(a.q, window, category, limit);
        const text = truncate(searchAnswer(found, { q: a.q, window, category }));
        const evidence: EvidenceCandidate[] = (found.res.items ?? []).slice(0, limit).map((it: { id: string; title: string; sourceName?: string; source?: { name: string }; publishedAt?: string | null; links?: { original?: string } }) => ({
          kind: "item" as const,
          objectId: it.id,
          title: it.title,
          sourceName: it.sourceName ?? it.source?.name ?? null,
          publishedAt: it.publishedAt ?? null,
          siteUrl: `/items/${it.id}`,
          originalUrl: it.links?.original ?? null,
          toolName: tool,
          rawRef: { id: it.id, q: a.q },
        }));
        return { ok: true, name: tool, text, structured: { expanded: found.expanded, count: evidence.length }, evidence };
      }
      case "get_hot_topics": {
        const a = parsed.data as { limit?: number };
        const limit = a.limit ?? 10;
        const hot = await v1HotTopics();
        const text = truncate(hotAnswer(hot as never, limit, "mcp"));
        const items = (hot.items ?? []).slice(0, limit);
        const evidence: EvidenceCandidate[] = items.map((t: { id: string; title: string; links?: { story?: string } }) => {
          const storyHref = t.links?.story ?? "";
          const publicId = storyHref.split("/story/")[1]?.split(/[?#]/)[0] ?? t.id;
          return {
            kind: "story" as const,
            objectId: publicId,
            title: t.title,
            sourceName: null,
            publishedAt: null,
            siteUrl: `/story/${publicId}`,
            originalUrl: null,
            toolName: tool,
            rawRef: { id: t.id, publicId },
          };
        });
        return { ok: true, name: tool, text, structured: { count: evidence.length }, evidence };
      }
      case "get_story": {
        const a = parsed.data as { public_id: string; limit?: number };
        const limit = a.limit ?? 20;
        let lookup = await resolveStory(a.public_id);
        if (lookup.kind === "merged") lookup = await resolveStory(lookup.target);
        const body = lookup.kind === "found" ? await v1Story(lookup.storyId) : null;
        if (!body) return { ok: false, name: tool, errorCode: "not_found", message: "没有这个公开事件。" };
        const text = truncate(storyAnswer(body.story, limit, "mcp"));
        return {
          ok: true,
          name: tool,
          text,
          structured: { publicId: body.story.publicId },
          evidence: [{
            kind: "story",
            objectId: body.story.publicId as string,
            title: body.story.title as string,
            sourceName: null,
            publishedAt: null,
            siteUrl: `/story/${body.story.publicId}`,
            originalUrl: null,
            toolName: tool,
            rawRef: { publicId: body.story.publicId },
          }],
        };
      }
      case "explain_selection": {
        const a = parsed.data as { article_id: string };
        const r = await explainSelection(a.article_id);
        if (r.isError) {
          const code = (r.structured.error as { code: string }).code;
          return { ok: false, name: tool, errorCode: code, message: r.text };
        }
        const article = r.structured.article as { id: string; title: string; sourceName?: string; publishedAt?: string | null; links?: { site?: string; original?: string | null } };
        return {
          ok: true,
          name: tool,
          text: truncate(r.text),
          structured: r.structured,
          evidence: [{
            kind: "selection_explain",
            objectId: article.id,
            title: article.title,
            sourceName: article.sourceName ?? null,
            publishedAt: article.publishedAt ?? null,
            siteUrl: article.links?.site ?? `/items/${article.id}`,
            originalUrl: article.links?.original ?? null,
            toolName: tool,
            rawRef: { article_id: a.article_id },
          }],
        };
      }
      case "explain_hot": {
        const a = parsed.data as { public_id: string };
        const r = await explainHot(a.public_id);
        if (r.isError) {
          const code = (r.structured.error as { code: string }).code;
          return { ok: false, name: tool, errorCode: code, message: r.text };
        }
        const story = r.structured.story as { publicId: string; title: string; links?: { site?: string } };
        return {
          ok: true,
          name: tool,
          text: truncate(r.text),
          structured: r.structured,
          evidence: [{
            kind: "hot_explain",
            objectId: story.publicId,
            title: story.title,
            sourceName: null,
            publishedAt: null,
            siteUrl: story.links?.site ?? `/story/${story.publicId}`,
            originalUrl: null,
            toolName: tool,
            rawRef: { public_id: a.public_id },
          }],
        };
      }
      case "get_daily": {
        const a = parsed.data as { date?: string };
        if (a.date && !isValidDate(a.date)) {
          return { ok: false, name: tool, errorCode: "invalid_arguments", message: `${a.date} 不是有效日期。` };
        }
        const res = await dailyWithNotes(a.date ?? "latest");
        if (!res) {
          return {
            ok: false,
            name: tool,
            errorCode: "not_found",
            message: a.date ? `没有 ${a.date} 的公开日报。` : "还没有公开日报。",
          };
        }
        const date = res.body.report.date as string;
        const text = truncate(dailyAnswer(res.body.report, "mcp", res.notes));
        return {
          ok: true,
          name: tool,
          text,
          structured: { date, count: 1 },
          evidence: [{
            kind: "tool_note",
            objectId: date,
            title: `日报 · ${date}`,
            sourceName: null,
            publishedAt: (res.body.report.generatedAt as string | null) ?? null,
            siteUrl: `/daily/${date}`,
            originalUrl: null,
            toolName: tool,
            rawRef: { date },
          }],
        };
      }
    }
  } catch (e) {
    return { ok: false, name, errorCode: "internal_error", message: "工具执行失败。" };
  }
}

/** Short user-facing step summary — never the model-facing tool body (preamble / URLs / security fence). */
export function friendlyStepSummary(exec: ToolExecOk): string {
  const count = typeof exec.structured.count === "number" ? exec.structured.count : exec.evidence.length;
  // get_latest is an unfiltered recent dump, not query-matched hits.
  if (exec.name === "get_latest") {
    const scope = exec.structured.mode === "all" ? "公开动态" : "精选";
    return count > 0 ? `拉取近期${scope} ${count} 条` : "暂无结果";
  }
  if (exec.name === "get_daily") {
    const date = typeof exec.structured.date === "string" ? exec.structured.date : "";
    return date ? `已加载 ${date} 日报` : "已加载日报";
  }
  const n = exec.evidence.length;
  if (n > 0) return `找到 ${n} 条相关资料`;
  if (typeof count === "number") return count > 0 ? `找到 ${count} 条相关资料` : "暂无结果";
  return "完成";
}

/** Full MCP tool names for documentation. */
export const ASK_MCP_NAMES = ASK_TOOL_NAMES.map((n) => mcpToolName(n));
