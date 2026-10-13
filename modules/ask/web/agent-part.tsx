import type { AgentPart } from "@aihot/web/modules";
import { MCP_TOOL_NAMES } from "@aihot/contracts/mcp";

const part: AgentPart = {
  tools: [
    { name: MCP_TOOL_NAMES.explainSelection, does: "解释资讯为何入选／达门槛", ask: "这篇为什么进精选？" },
    { name: MCP_TOOL_NAMES.explainHot, does: "解释事件为何上榜及排名快照", ask: "这个热点为什么排第 N？" },
  ],
  api: {
    group: "解释",
    rows: [
      ["/api/v1/agent/explain-selection", "资讯入选解释", "article_id"],
      ["/api/v1/agent/explain-hot", "事件上榜解释", "public_id"],
    ],
  },
  resources: [
    ["AI 问答", "/ask", "站内七工具流式问答"],
  ],
};

export default part;
