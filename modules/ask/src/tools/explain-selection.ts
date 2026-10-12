// Shared explain_selection: MCP + Agent REST + in-site whitelist. Reads only through publication/.
import { SELECTION } from "@aihot/industry/selection";
import { loadItemDetail } from "@aihot/backend/publication/detail";
import { itemUrl } from "@aihot/backend/publication/links";
import { buildSelectionExplain, SOURCE_TIER_LABELS, CONTENT_TYPE_LABELS } from "@aihot/backend/publication/selection-explain";

export type ExplainErrorCode = "invalid_request" | "not_found" | "not_public" | "explain_unavailable" | "internal_error";

export interface ExplainResult {
  text: string;
  structured: Record<string, unknown>;
  isError?: boolean;
}

function err(code: ExplainErrorCode, message: string): ExplainResult {
  return { text: message, structured: { schemaVersion: 1, error: { code, message } }, isError: true };
}

function thresholdSourceOf(recorded: number | null, tier: string | null): "recorded" | "current_config" | "unknown" {
  if (recorded !== null && Number.isFinite(recorded)) return "recorded";
  if (tier && tier in SELECTION.thresholds) return "current_config";
  return "unknown";
}

/** Build explain_selection from a public article id. */
export async function explainSelection(articleId: string): Promise<ExplainResult> {
  const id = (articleId ?? "").trim();
  if (!id || id.length > 128) return err("invalid_request", "article_id 必须是 1–128 字符的公开资讯 ID。");

  let detail;
  try {
    detail = await loadItemDetail(id);
  } catch (e) {
    return err("internal_error", "读取资讯失败。");
  }
  if (detail.kind !== "found") return err("not_found", "没有这个公开资讯。只使用工具返回的 article_id，不要猜。");

  const item = detail.item;
  const row = detail.row;
  const out = (row.analysis_output ?? {}) as Record<string, unknown>;
  const recordedThreshold = typeof out.threshold === "number" ? out.threshold : null;
  const sourceTier = (typeof out.sourceTier === "string" ? out.sourceTier : null) ?? row.source_tier;
  const thrSource = thresholdSourceOf(recordedThreshold, sourceTier);
  const explain = buildSelectionExplain({
    score: row.score === null ? null : Number(row.score),
    selected: row.selected,
    threshold: recordedThreshold,
    sourceTier,
    axes: out.scoreAxes ?? null,
    contentType: typeof out.contentType === "string" ? out.contentType : null,
    wirePeerCount: item.selectionExplain?.wireDedupe?.peerCount ?? 0,
  });
  if (!explain) return err("explain_unavailable", "该资讯没有可用的入选解释（无评分且未精选）。");

  const unknowns: string[] = [];
  if (thrSource !== "recorded") unknowns.push("historical_threshold_snapshot");
  if (!explain.axes) unknowns.push("score_axes");
  unknowns.push("grouping_decision_detail");

  const structured = {
    schemaVersion: 1,
    article: {
      id: item.id,
      title: item.title,
      selected: item.selected,
      links: { site: itemUrl(item.id), original: item.links?.original ?? null },
      publishedAt: item.publishedAt ?? null,
      sourceName: item.source.name,
    },
    explain: {
      score: explain.score,
      threshold: explain.threshold,
      thresholdSource: thrSource,
      metThreshold: explain.metThreshold,
      selected: item.selected,
      selectionNote: "分数达门槛不等于最终精选；精选还可能涉及归组、增量与代表稿等。未知条件见 unknowns。",
      sourceTier: explain.sourceTier,
      sourceTierLabel: explain.sourceTierLabel ?? (explain.sourceTier ? SOURCE_TIER_LABELS[explain.sourceTier] ?? explain.sourceTier : null),
      contentType: explain.contentType,
      contentTypeLabel: explain.contentTypeLabel ?? (explain.contentType ? CONTENT_TYPE_LABELS[explain.contentType] ?? null : null),
      axes: explain.axes,
      wireDedupe: explain.wireDedupe,
      unknowns,
      asOf: new Date().toISOString(),
      ...(thrSource === "current_config"
        ? { thresholdNote: "门槛取自当前配置，非历史决策快照。" }
        : {}),
    },
  };

  const lines = [
    `【入选解释】${item.title}`,
    `是否精选：${item.selected ? "是" : "否"}`,
    explain.score !== null && explain.threshold !== null
      ? `分数 ${explain.score} / 门槛 ${explain.threshold}（${thrSource === "recorded" ? "记录门槛" : thrSource === "current_config" ? "当前配置门槛，非历史快照" : "门槛来源未知"}）${explain.metThreshold === true ? "，已达门槛" : explain.metThreshold === false ? "，未达门槛" : ""}`
      : explain.score !== null
        ? `分数 ${explain.score}（门槛未知）`
        : "分数未知",
    explain.sourceTierLabel ? `信源分级：${explain.sourceTierLabel}` : null,
    explain.contentTypeLabel ? `内容类型：${explain.contentTypeLabel}` : null,
    "注意：达门槛≠完整入选原因；精选还可能涉及归组与代表稿。",
    `站内：${itemUrl(item.id)}`,
  ].filter(Boolean);

  return { text: lines.join("\n"), structured };
}

/** Markdown for Agent REST. */
export async function explainSelectionMarkdown(articleId: string): Promise<string> {
  const r = await explainSelection(articleId);
  if (r.isError) {
    const code = (r.structured.error as { code?: string } | undefined)?.code ?? "error";
    throw Object.assign(new Error(r.text), { code, status: code === "not_found" || code === "not_public" ? 404 : code === "invalid_request" ? 400 : 500 });
  }
  return r.text;
}

