// 游戏资讯的分类体系：类别、标签词表、游戏与厂商（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（教程、观点）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "new-games", label: "新游", feedLabel: "新游", section: "新游与测试", guide: "尚未上线或刚上线的具体游戏：首次曝光、定档、预约、测试招募与开测、正式上线或发售、版号过审。已上线游戏的新版本、新赛季和 DLC 不算新游，归行业。" },
  { key: "esports", label: "电竞", feedLabel: "电竞", section: "电竞赛事", guide: "电竞赛事的赛程与结果、战队与选手动态、转会、联盟与赛事规则。只是在游戏里办的普通玩家活动不算电竞，归行业。" },
  { key: "industry", label: "行业", feedLabel: "行业动态", section: "行业动态", guide: "已上线游戏的重大运营变化（大版本更新、新赛季、资料片与 DLC、新角色与卡池、大型活动与联动、平衡调整、国服停服或回归），厂商经营、发行与代理、财报与市场数据、融资并购、人事、版号与政策监管、诉讼，以及评测、口碑、玩家话题与观点。由当事方发出、带有态度的消息不因此变成观点。" },
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布（游戏行业是新游定档或上线）：日报报头的“N 款新游”、改分类后修订已出的报告都按它数。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = { category: "new-games", tag: "定档/上线", unit: "款新游" };

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["pc", "steam", "dlc", "mmo", "moba", "fps", "rpg", "ps5", "switch", "xbox", "ai", "ceo", "ipo"];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["game_reveal", "game_launch", "version_update", "esports_event", "industry_event", "review_or_data", "opinion_discussion"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "新游曝光", "定档/上线", "测试/预约", "版本更新", "赛季/活动", "DLC/资料片", "电竞赛事", "战队/选手", "厂商动态", "版号/政策", "财报/数据",
  "评测/口碑", "玩家话题", "其他",
] as const;

/** 可选的主题标签（平台与品类）。 */
export const TOPIC_TAGS = [
  "手游", "PC/Steam", "主机", "Switch", "PlayStation", "Xbox", "二次元", "MOBA", "射击", "开放世界", "MMO", "独立游戏", "国产游戏", "出海", "云游戏", "AI与游戏",
] as const;

/** 可选的实体标签（厂商与平台）。 */
export const ENTITY_TAGS = ["Valve", "Larian", "Mega Crit", "Nicalis", "腾讯游戏", "网易游戏", "米哈游", "鹰角网络", "游戏科学", "拳头游戏", "索尼", "任天堂", "微软游戏"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  首曝: "新游曝光", 曝光: "新游曝光", 新游: "新游曝光", 公布: "新游曝光", 预告: "新游曝光",
  定档: "定档/上线", 上线: "定档/上线", 公测: "定档/上线", 发售: "定档/上线", 首发: "定档/上线", 开服: "定档/上线",
  测试: "测试/预约", 内测: "测试/预约", 删档测试: "测试/预约", 预约: "测试/预约", 招募: "测试/预约", 版号: "版号/政策",
  更新: "版本更新", 版本: "版本更新", 补丁: "版本更新", 平衡调整: "版本更新", 停服: "版本更新",
  赛季: "赛季/活动", 活动: "赛季/活动", 卡池: "赛季/活动", 新角色: "赛季/活动", 联动: "赛季/活动",
  dlc: "DLC/资料片", 资料片: "DLC/资料片", 扩展包: "DLC/资料片",
  电竞: "电竞赛事", 赛事: "电竞赛事", 比赛: "电竞赛事", 战队: "战队/选手", 选手: "战队/选手", 转会: "战队/选手",
  厂商: "厂商动态", 公司动态: "厂商动态", 发行: "厂商动态", 代理: "厂商动态", 人事: "厂商动态", 融资: "厂商动态", 收购: "厂商动态", 并购: "厂商动态", 裁员: "厂商动态",
  政策: "版号/政策", 监管: "版号/政策", 防沉迷: "版号/政策", 财报: "财报/数据", 销量: "财报/数据", 流水: "财报/数据", 在线人数: "财报/数据", 数据: "财报/数据",
  评测: "评测/口碑", 测评: "评测/口碑", 口碑: "评测/口碑", 评分: "评测/口碑", 话题: "玩家话题", 观点: "玩家话题", 争议: "玩家话题", 舆论: "玩家话题",
  steam: "PC/Steam", pc: "PC/Steam", 端游: "PC/Steam", 手机游戏: "手游", 移动游戏: "手游", 主机游戏: "主机", ps5: "PlayStation", ns: "Switch", "switch 2": "Switch",
  独游: "独立游戏", 国产: "国产游戏", 国游: "国产游戏", ai: "AI与游戏", 云: "云游戏",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 主体：游戏和厂商。id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * “游戏”组主题（topics.json 里 group 为 company 的主题）用 entityId 指向这里的游戏。
 * aliases 给结构抽取模型看，也用来在标题里认出这个主体，所以不要写太短、容易误认的别名；
 * otherNames 是官方账号名、工作室名等其他称呼，把事实的主体对到发布方时也认它们。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  // Steam 种子游戏（主题页）
  "binding-of-isaac-rebirth": { name: "以撒的结合：重生", displayTag: null, aliases: ["以撒的结合：重生", "以撒的结合", "The Binding of Isaac: Rebirth", "Binding of Isaac", "BoI", "Isaac"], otherNames: ["Afterbirth", "Afterbirth+", "Repentance", "Repentance+"] },
  "slay-the-spire-2": { name: "杀戮尖塔 2", displayTag: null, aliases: ["杀戮尖塔 2", "杀戮尖塔2", "Slay the Spire 2", "StS 2", "STS2"] },
  mewgenics: { name: "喵喵的结合", displayTag: null, aliases: ["喵喵的结合", "Mewgenics"] },
  "baldurs-gate-3": { name: "博德之门 3", displayTag: null, aliases: ["博德之门 3", "博德之门3", "Baldur's Gate 3", "Baldurs Gate 3", "BG3"] },
  // 仍可能出现在媒体报道里的手游/端游（无主题页，仅身份识别）
  "honor-of-kings": { name: "王者荣耀", displayTag: null, aliases: ["王者荣耀", "Honor of Kings"] },
  "genshin-impact": { name: "原神", displayTag: null, aliases: ["原神", "Genshin Impact"] },
  "honkai-star-rail": { name: "崩坏：星穹铁道", displayTag: null, aliases: ["崩坏：星穹铁道", "星穹铁道", "崩铁", "Honkai: Star Rail"] },
  "peacekeeper-elite": { name: "和平精英", displayTag: null, aliases: ["和平精英"] },
  "league-of-legends": { name: "英雄联盟", displayTag: null, aliases: ["英雄联盟", "League of Legends"] },
  valorant: { name: "无畏契约", displayTag: null, aliases: ["无畏契约", "VALORANT", "Valorant", "瓦罗兰特"], otherNames: ["打瓦"] },
  "black-myth-wukong": { name: "黑神话：悟空", displayTag: null, aliases: ["黑神话：悟空", "黑神话", "Black Myth: Wukong"] },
  "naraka-bladepoint": { name: "永劫无间", displayTag: null, aliases: ["永劫无间", "NARAKA: BLADEPOINT"] },
  arknights: { name: "明日方舟", displayTag: null, aliases: ["明日方舟", "Arknights"] },
  // 厂商
  valve: { name: "Valve", displayTag: "Valve", aliases: ["Valve", "V社"] },
  larian: { name: "Larian Studios", displayTag: "Larian", aliases: ["Larian", "Larian Studios", "拉瑞安"] },
  "mega-crit": { name: "Mega Crit", displayTag: "Mega Crit", aliases: ["Mega Crit", "MegaCrit"] },
  nicalis: { name: "Nicalis", displayTag: "Nicalis", aliases: ["Nicalis"] },
  tencent: { name: "腾讯游戏", displayTag: "腾讯游戏", aliases: ["腾讯游戏", "腾讯", "Tencent Games", "Tencent"], otherNames: ["天美工作室群", "光子工作室群", "TiMi Studio Group", "LightSpeed Studios"] },
  netease: { name: "网易游戏", displayTag: "网易游戏", aliases: ["网易游戏", "网易", "NetEase Games", "NetEase"], otherNames: ["雷火"] },
  mihoyo: { name: "米哈游", displayTag: "米哈游", aliases: ["米哈游", "miHoYo", "HoYoverse"] },
  hypergryph: { name: "鹰角网络", displayTag: "鹰角网络", aliases: ["鹰角网络", "鹰角", "Hypergryph"] },
  "game-science": { name: "游戏科学", displayTag: "游戏科学", aliases: ["游戏科学", "Game Science"] },
  riot: { name: "拳头游戏", displayTag: "拳头游戏", aliases: ["拳头游戏", "Riot Games"] },
  sony: { name: "索尼互动娱乐", displayTag: "索尼", aliases: ["索尼", "Sony", "PlayStation"], otherNames: ["Sony Interactive Entertainment"] },
  nintendo: { name: "任天堂", displayTag: "任天堂", aliases: ["任天堂", "Nintendo"] },
  microsoft: { name: "微软游戏", displayTag: "微软游戏", aliases: ["Xbox", "微软", "Microsoft Gaming"] },
};

export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "binding-of-isaac-rebirth", name: "以撒的结合：重生", patterns: [/以撒的结合|binding\s+of\s+isaac|\bboi\b/i] },
  { id: "slay-the-spire-2", name: "杀戮尖塔 2", patterns: [/杀戮尖塔\s*2|slay\s+the\s+spire\s*2|\bsts\s*2\b/i] },
  { id: "mewgenics", name: "喵喵的结合", patterns: [/喵喵的结合|mewgenics/i] },
  { id: "baldurs-gate-3", name: "博德之门 3", patterns: [/博德之门\s*3|baldur'?s?\s+gate\s*3|\bbg3\b/i] },
  { id: "honor-of-kings", name: "王者荣耀", patterns: [/王者荣耀|honor\s+of\s+kings/i] },
  { id: "genshin-impact", name: "原神", patterns: [/原神|genshin/i] },
  { id: "honkai-star-rail", name: "崩坏：星穹铁道", patterns: [/星穹铁道|崩铁|star\s?rail/i] },
  { id: "peacekeeper-elite", name: "和平精英", patterns: [/和平精英/] },
  { id: "league-of-legends", name: "英雄联盟", patterns: [/英雄联盟|league\s+of\s+legends/i] },
  { id: "valorant", name: "无畏契约", patterns: [/无畏契约|valorant|打瓦|瓦罗兰特/i] },
  { id: "black-myth-wukong", name: "黑神话：悟空", patterns: [/黑神话|black\s?myth/i] },
  { id: "naraka-bladepoint", name: "永劫无间", patterns: [/永劫无间|naraka/i] },
  { id: "arknights", name: "明日方舟", patterns: [/明日方舟|arknights/i] },
  { id: "valve", name: "Valve", patterns: [/\bvalve\b|V社/i] },
  { id: "larian", name: "Larian Studios", patterns: [/larian|拉瑞安/i] },
  { id: "mega-crit", name: "Mega Crit", patterns: [/mega\s?crit/i] },
  { id: "nicalis", name: "Nicalis", patterns: [/nicalis/i] },
  { id: "tencent", name: "腾讯游戏", patterns: [/腾讯|tencent/i] },
  { id: "netease", name: "网易游戏", patterns: [/网易|netease/i] },
  { id: "mihoyo", name: "米哈游", patterns: [/米哈游|mihoyo|hoyoverse/i] },
  { id: "hypergryph", name: "鹰角网络", patterns: [/鹰角|hypergryph/i] },
  { id: "game-science", name: "游戏科学", patterns: [/游戏科学|game\s?science/i] },
  { id: "riot", name: "拳头游戏", patterns: [/拳头游戏|riot\s?games/i] },
  { id: "sony", name: "索尼互动娱乐", patterns: [/索尼|\bsony\b|playstation/i] },
  { id: "nintendo", name: "任天堂", patterns: [/任天堂|nintendo/i] },
  { id: "microsoft", name: "微软游戏", patterns: [/微软|microsoft|\bxbox\b/i] },
];

export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "larian", domains: ["larian.com"] },
  { entityId: "mega-crit", domains: ["megacrit.com"] },
  { entityId: "nicalis", domains: ["nicalis.com"] },
  { entityId: "mihoyo", domains: ["mihoyo.com", "hoyoverse.com"] },
  { entityId: "hypergryph", domains: ["hypergryph.com"] },
  { entityId: "riot", domains: ["riotgames.com"] },
  { entityId: "valorant", domains: ["val.qq.com", "playvalorant.com", "vct.qq.com"] },
  { entityId: "sony", domains: ["playstation.com"] },
  { entityId: "nintendo", domains: ["nintendo.com", "nintendo.co.jp"] },
  { entityId: "microsoft", domains: ["xbox.com"] },
  { entityId: "valve", domains: ["valvesoftware.com"] },
];

/** 原文里的这些写法也算提到了对应主体。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
