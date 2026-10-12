// Shared explain_hot: MCP + Agent REST + in-site whitelist. Reads only through publication/.
import { resolveStory, loadStoryDetail } from "@aihot/backend/publication/stories";
import { latestHotRanking } from "@aihot/backend/publication/hot";
import { storyUrl, itemUrl } from "@aihot/backend/publication/links";
import type { ExplainResult } from "./explain-selection.ts";

function err(code: string, message: string): ExplainResult {
  return { text: message, structured: { schemaVersion: 1, error: { code, message } }, isError: true };
}

const WINDOW_HOURS = 48;

export async function explainHot(publicIdRaw: string): Promise<ExplainResult> {
  const publicId = (publicIdRaw ?? "").trim();
  if (!publicId || publicId.length > 128) return err("invalid_request", "public_id 必须是 1–128 字符的事件公开 ID。");

  let found = await resolveStory(publicId);
  let mergedFrom: string | null = null;
  if (found.kind === "merged") {
    mergedFrom = publicId;
    found = await resolveStory(found.target);
  }
  if (found.kind === "merged") {
    // One follow only per design; still merged → treat as not_found to avoid endless chase.
    return err("not_found", "事件已合并且无法解析最终目标。请使用热点工具返回的 public_id。");
  }
  if (found.kind !== "found") return err("not_found", "没有这个公开事件。只使用热点／事件工具返回的 public_id，不要猜。");

  const detail = await loadStoryDetail(found.storyId);
  if (!detail) return err("not_public", "该事件当前没有可公开的报道。");

  const ranking = await latestHotRanking();
  const entry = ranking?.entries.find((e) => e.storyId === found.storyId) ?? null;
  const onList = entry !== null;
  const rank = entry?.rank ?? null;
  const rankingComputedAt = ranking?.computedAt ?? null;
  const why = detail.whyHot;
  const statsAsOf = new Date().toISOString();

  const relatedReports = (detail.timeline ?? []).slice(0, 12).map((r) => ({
    id: r.id,
    title: r.title,
    sourceName: r.source.name,
    publishedAt: r.publishedAt ?? null,
    links: { site: itemUrl(r.id), original: null as string | null },
  }));

  const structured = {
    schemaVersion: 1,
    story: {
      publicId: detail.publicId,
      title: detail.title,
      links: { site: storyUrl(detail.publicId) },
      mergedFrom,
    },
    hot: {
      onList,
      rank,
      rankNote: onList ? null : "当前未上榜时 rank=null 且 onList=false；排名来自最新热榜快照而非臆测。",
      rankingComputedAt,
      windowHours: WINDOW_HOURS,
      statsAsOf,
      participants48h: why.participants48h,
      newParticipants6h: why.newParticipants6h,
      recentReports24h: why.recentReports24h,
      reportCount: detail.reportCount,
      independentParticipantNote: "独立参与方按本站通稿合并规则计算，不等于事实已获独立核实。",
      wireDedupeNote: why.wireDedupeNote,
      observationComplete: why.observationComplete,
      relatedReports,
    },
  };

  const lines = [
    `【上榜解释】${detail.title}`,
    onList ? `当前热榜第 ${rank} 名` : "当前未在热榜",
    rankingComputedAt ? `榜单快照时间：${rankingComputedAt}` : "榜单快照时间：未知",
    `统计截止时间：${statsAsOf}（窗口 ${WINDOW_HOURS}h）`,
    `近 48h 参与方：${why.participants48h}；近 6h 新增参与方：${why.newParticipants6h}；近 24h 报道：${why.recentReports24h}；报道篇数：${detail.reportCount}`,
    "参与方数 ≠ 报道篇数；独立参与方 ≠ 事实已核实。",
    why.wireDedupeNote ?? null,
    `站内：${storyUrl(detail.publicId)}`,
  ].filter(Boolean);

  return { text: lines.join("\n"), structured };
}

export async function explainHotMarkdown(publicId: string): Promise<string> {
  const r = await explainHot(publicId);
  if (r.isError) {
    const code = (r.structured.error as { code?: string } | undefined)?.code ?? "error";
    throw Object.assign(new Error(r.text), { code, status: code === "not_found" || code === "not_public" ? 404 : code === "invalid_request" ? 400 : 500 });
  }
  return r.text;
}
