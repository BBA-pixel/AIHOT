import { defineServerModule } from "@aihot/backend/modules";
import { z } from "zod";
import { explainSelection, explainSelectionMarkdown } from "./src/tools/explain-selection.ts";
import { explainHot, explainHotMarkdown } from "./src/tools/explain-hot.ts";
import { registerAskRoutes } from "./src/http/routes.ts";
import { retentionCleanup } from "./src/db/store.ts";
import { askRunQueue } from "./server-queue.ts";

export default defineServerModule({
  name: "ask",
  http: (app) => {
    registerAskRoutes(app);
  },
  queues: [askRunQueue],
  retention: async (now) => retentionCleanup(now),
  agent: {
    abilities: [
      {
        path: "/explain-selection",
        title: "入选解释",
        ask: "某篇资讯为何入选／达门槛",
        query: ["article_id"],
        answer: async (args) => explainSelectionMarkdown(args?.article_id ?? ""),
        etagPrefix: "agent-explain-selection",
        cacheControl: "public, max-age=60",
        mcp: {
          tool: "explain_selection",
          use: "to explain why an article was selected or met the score threshold",
          description:
            "Explain why a public GAMEHOT article was selected or met the selection threshold. Use article_id from get_latest/search or a verified /items/ link. Do not guess ids. Distinguishes metThreshold from selected; axes may be null.",
          input: z.object({ article_id: z.string().min(1).max(128) }).strict(),
          run: async (args) => {
            const r = await explainSelection(String(args.article_id ?? ""));
            return { text: r.text, structured: r.structured };
          },
        },
      },
      {
        path: "/explain-hot",
        title: "上榜解释",
        ask: "某事件为何上榜／当前排名",
        query: ["public_id"],
        answer: async (args) => explainHotMarkdown(args?.public_id ?? ""),
        etagPrefix: "agent-explain-hot",
        cacheControl: "public, max-age=60",
        mcp: {
          tool: "explain_hot",
          use: "to explain why a story is on the hot list and its ranking snapshot",
          description:
            "Explain why a public GAMEHOT story is on the hot ranking (or not). Use public_id from get_hot_topics/get_story. Distinguishes ranking snapshot time from stats-as-of; does not return internal heat scores.",
          input: z.object({ public_id: z.string().min(1).max(128) }).strict(),
          run: async (args) => {
            const r = await explainHot(String(args.public_id ?? ""));
            return { text: r.text, structured: r.structured };
          },
        },
      },
    ],
  },
  llms: () => ({
    api: [
      "- GET /api/v1/agent/explain-selection?article_id= — 资讯入选解释（Markdown）",
      "- GET /api/v1/agent/explain-hot?public_id= — 事件上榜解释（Markdown）",
      "- /ask — 站内 AI 问答（七工具白名单）",
    ],
    pages: ["- [AI 问答](/ask)：基于站内只读工具的流式问答"],
    usage: [
      "入选／上榜解释只复述本站已有判断，不重算分数或热度；门槛可能来自当前配置而非历史快照。",
      "站内 /ask 不调用全网搜索；打开或刷新页面不会触发模型调用。",
    ],
  }),
});

