// 精选的门槛。评分标准本身写在 prompts/selection-score.md；这里只决定“多少分算入选”。
// 每篇资料由评分模型独立打两次分（0–100），两次之和 ≥ 2 × 门槛、并确认不是精选里已有新闻的重复报道才进精选
// （见 docs/selection.md），卡片上显示两次的平均分。
// 门槛按信源分级区分：官方一手信源的门槛低一些，媒体和个人的高一些。改了门槛或评分提示词，
// 用 scripts/eval-selection.ts 在你自己标注的样本上重跑一遍，再决定上线（见 docs/selection.md）。

export const SELECTION = {
  /**
   * 信源分级 → 入选门槛（平均分）。分级在后台“信源”里给每个源设置：
   *   T1 官方一手（官网、官方博客、机构）· T1_5 官方账号、准官方创作者 · T2 媒体与个人
   * 分级 EXCLUDE_MP 以及这里没有列出的分级，不参与精选评分（只进“全部动态”）。
   *
   * 游戏向校准（2026-10-10）：T2 开发集扫描建议 uniform-t≈40（见 .data/eval）；
   * T1/T1_5 按「官方更低」保持低于 T2，待 T1 金标扩样后再细调。
   */
  thresholds: { T1: 30, T1_5: 35, T2: 40 } as Record<string, number>,
  /**
   * 没入选、但平均分高于这个数的资料，也用精选的写法（内容理解：标题、摘要、推荐理由）来写，
   * 其余用更便宜的“标题摘要翻译”。须低于最低入选门槛，否则近门槛未入选路径会空转。
   */
  understandFloor: 20,
} as const;

/** 热榜匹配时优先认领的种子主体（与 topics.json / IDENTITY_LEXICON 对齐）。
 * 前四款为 Steam 焦点种子；valorant（无畏契约）为产品点名的非 Steam FPS，一并优先认领。 */
export const HOT_SEED_ENTITY_IDS = [
  "binding-of-isaac-rebirth",
  "slay-the-spire-2",
  "mewgenics",
  "baldurs-gate-3",
  "valorant",
] as const;
