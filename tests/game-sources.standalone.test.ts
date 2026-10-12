// The game sources seeded from industry/sources.json (信源官 v1 media list and official list): every
// config is one its kind implements, the per-source filters do what was agreed, and each listing's rules
// still parse the page it was written for. Snapshots in tests/fixtures/game-sources are trimmed copies of
// the real pages (2026-10-08); a site redesign shows up here as a parse failure, not as silent empty runs.
import "./setup.ts";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, test } from "node:test";
import { config, REPO_ROOT } from "@aihot/backend/config";
import { sourceIdentity } from "@aihot/backend/admin/sources";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { admitListing, noiseFiltered } from "@aihot/backend/sources/filters";
import { fetchJsonList } from "@aihot/backend/sources/json-list";
import { fetchRss } from "@aihot/backend/sources/rss";
import type { Candidate, SourceRow } from "@aihot/backend/sources/types";
import { fetchDetail, fetchWebList } from "@aihot/backend/sources/web-list";
import { ENTITIES } from "@aihot/industry/taxonomy";

interface SeedSource {
  id: string; name: string; kind: SourceRow["kind"]; config: Record<string, any>; tier: string; owner_entity_id?: string;
  participation_mode: string; interval_minutes: number; site_fulltext: boolean; syndicate_fulltext: boolean; enabled?: boolean;
}
const { sources } = JSON.parse(readFileSync(path.join(REPO_ROOT, "industry/sources.json"), "utf8")) as { sources: SeedSource[] };
const byId = new Map(sources.map((s) => [s.id, s]));

const MEDIA = [
  "rss-gcores", "rss-ign-cn", "rss-gnn", "rss-yystv", "rss-chuapp", "rss-youxichaguan", "rss-hltv",
  "web-gamersky", "web-3dm", "web-a9vg", "web-17173", "web-sina-esports", "web-wanplus", "web-youxituoluo", "web-indienova", "web-nppa-games",
];
const OFFICIAL = [
  // disabled (Steam-focus): mobile/F2P single-game + LoL Esports
  "json-pvp-news", "json-lol-news", "json-miyoushe-ys", "json-miyoushe-sr", "web-yjwujian", "web-gp-qq", "web-lolesports",
  "rss-steam-cs2", "rss-steam-dota2", "rss-ps-blog-zh-hant", "rss-xbox-wire", "rss-nintendo-jp", "web-nintendo-hk", "rss-steam-news", "rss-netease-ir",
  // Steam seed-game news + developer/publisher first-party
  "rss-steam-isaac-rebirth", "rss-steam-sts2", "rss-steam-mewgenics", "rss-steam-bg3",
  "rss-megacrit-news", "web-larian-news",
  // Valorant (non-Steam FPS exception): CN CMC + traditional-Chinese official news
  "json-val-news", "web-playvalorant-news",
];
/** Community hot lists: heat evidence only (Bilibili / Tieba). */
const HOT = ["json-bilibili-hotword", "json-tieba-hottopic"];
/** Disabled mobile/F2P announcement feeds still carry the old shared title rule (kept for re-enable). Steam seed feeds do not. */
const SINGLE_GAME = ["json-pvp-news", "json-lol-news", "json-miyoushe-ys", "json-miyoushe-sr", "web-yjwujian", "web-gp-qq"];
/** Enabled Valorant CN announcements: same keep/drop idea, with Valorant-specific markers. */
const VALORANT_TITLE_RULE = ["json-val-news"];
const DISABLED_OFFICIAL = new Set(["json-pvp-news", "json-lol-news", "json-miyoushe-ys", "json-miyoushe-sr", "web-yjwujian", "web-gp-qq", "web-lolesports"]);
/** Listings that print no absolute date: their detail pages (or a later listing) date them. */
const UNDATED_LISTING = new Set(["web-17173", "web-sina-esports", "web-wanplus", "web-youxituoluo", "web-indienova", "web-gp-qq", "web-playvalorant-news"]);

test("the seed holds the media list and the official list, nothing else", () => {
  assert.deepEqual(sources.map((s) => s.id).sort(), [...MEDIA, ...OFFICIAL, ...HOT].sort());
  assert.equal(new Set(sources.map((s) => s.id)).size, sources.length);
});

test("every game source has a config its kind implements and the agreed defaults", () => {
  const identities = new Set<string>();
  for (const s of sources) {
    assert.deepEqual(unsupportedConfig(s.kind, s.config), [], s.id);
    assert.ok(["rss", "web_list", "json_list"].includes(s.kind), `${s.id}: only the existing collectors`);
    const hot = HOT.includes(s.id);
    assert.equal(s.participation_mode, hot ? "hot_signal" : "editorial", s.id);
    assert.equal(s.site_fulltext, false, s.id);
    assert.equal(s.syndicate_fulltext, false, s.id);
    assert.ok(s.interval_minutes >= 30 && s.interval_minutes <= 1440, s.id);
    assert.deepEqual(
      s.config._aihot,
      hot ? { initialBackfillLimit: 10, initialBackfillMonths: 1 } : { initialBackfillLimit: 8, initialBackfillMonths: 1 },
      s.id,
    );
    if (s.owner_entity_id) assert.ok(s.owner_entity_id in ENTITIES, `${s.id}: owner ${s.owner_entity_id}`);
    const identity = sourceIdentity(s.kind, s.config)!;
    assert.ok(!identities.has(identity), `${s.id}: duplicate address`);
    identities.add(identity);
  }
  // Q2-1 default: media T2, the regulator T1; official sources T1 except the Steam store feed (developers' own posts, T1_5).
  for (const id of MEDIA) assert.equal(byId.get(id)!.tier, id === "web-nppa-games" ? "T1" : "T2", id);
  for (const id of OFFICIAL) assert.equal(byId.get(id)!.tier, id === "rss-steam-news" ? "T1_5" : "T1", id);
  for (const id of DISABLED_OFFICIAL) assert.equal(byId.get(id)!.enabled, false, id);
  for (const id of HOT) {
    assert.notEqual(byId.get(id)!.enabled, false, id);
    assert.equal(byId.get(id)!.tier, "T2", id);
    assert.equal(byId.get(id)!.participation_mode, "hot_signal", id);
    assert.equal(byId.get(id)!.config.ingestNoiseFilter, undefined, id);
  }
  for (const id of ["rss-steam-isaac-rebirth", "rss-steam-sts2", "rss-steam-mewgenics", "rss-steam-bg3"]) {
    assert.notEqual(byId.get(id)!.enabled, false, id);
    assert.equal(byId.get(id)!.config.ingestNoiseFilter, undefined, id);
    const prefixes = byId.get(id)!.config.publisherUrlPrefixes as string[];
    assert.ok(Array.isArray(prefixes) && prefixes.length === 1, id);
    assert.match(prefixes[0]!, /^https:\/\/store\.steampowered\.com\/news\/app\/\d+\/$/, id);
  }
  for (const id of ["rss-megacrit-news", "web-larian-news"]) {
    assert.notEqual(byId.get(id)!.enabled, false, id);
    assert.equal(byId.get(id)!.config.ingestNoiseFilter, undefined, id);
    assert.equal(byId.get(id)!.tier, "T1", id);
  }
  assert.deepEqual(byId.get("rss-megacrit-news")!.config.allowUrlPrefixes, ["https://megacrit.com/news/"]);
  assert.equal(byId.get("rss-megacrit-news")!.owner_entity_id, "mega-crit");
  assert.equal(byId.get("web-larian-news")!.owner_entity_id, "larian");
  for (const id of ["json-val-news", "web-playvalorant-news"]) {
    assert.notEqual(byId.get(id)!.enabled, false, id);
    assert.equal(byId.get(id)!.tier, "T1", id);
    assert.equal(byId.get(id)!.owner_entity_id, "valorant", id);
  }
  assert.ok(byId.get("json-val-news")!.config.ingestNoiseFilter, "json-val-news title rule");
  assert.equal(byId.get("web-playvalorant-news")!.config.ingestNoiseFilter, undefined, "playvalorant uses URL prefixes");
});

test("the title rule sits on the single-game announcement sources only", () => {
  const withRule = sources.filter((s) => s.config.ingestNoiseFilter?.keepIfMatches?.includes("版本更新")).map((s) => s.id);
  assert.deepEqual(withRule.sort(), [...SINGLE_GAME, ...VALORANT_TITLE_RULE].sort());
  const rules = SINGLE_GAME.map((id) => JSON.stringify(byId.get(id)!.config.ingestNoiseFilter));
  assert.equal(new Set(rules).size, 1, "one shared rule");
  const valRule = byId.get("json-val-news")!.config.ingestNoiseFilter;
  assert.ok(valRule.keepIfMatches.includes("版本更新") && valRule.keepIfMatches.includes("无畏契约"), "Valorant keep list");
  assert.ok(valRule.dropMarkersTitleOnly.includes("夜市") && valRule.dropMarkersTitleOnly.includes("商城"), "Valorant drop list");
  for (const id of ["rss-ps-blog-zh-hant", "rss-xbox-wire", "rss-nintendo-jp", "web-nintendo-hk", "rss-steam-news", "rss-steam-cs2", "rss-steam-dota2", "rss-steam-isaac-rebirth", "rss-steam-sts2", "rss-steam-mewgenics", "rss-steam-bg3", "rss-megacrit-news", "web-larian-news", "web-playvalorant-news"]) {
    assert.equal(byId.get(id)!.config.ingestNoiseFilter, undefined, id);
  }
});

test("the title rule keeps version, season and launch news and drops events, skins and bans", () => {
  const source = { id: "json-pvp-news", config: byId.get("json-pvp-news")!.config } as SourceRow;
  const dropped = (title: string) => noiseFiltered({ url: "https://example.org/x", title } as Candidate, source);
  for (const title of [
    "10月8日版本更新公告", "26.19版本更新公告", "「往冥府的安魂歌」7.1版本更新说明", "「霄练赛季」赛季开启公告说明", "SS41赛季开启公告",
    "英雄平衡性调整 | 马超、海月平衡", "《和平精英》×张雪机车联动重磅上线", "新英雄「大司命」定档10月15日", "关于《XX》停服的公告", "端游公测开启", "XX资料片今日上线",
    // a keep word wins over a drop word: a crossover event is news, a season's skin line-up stays too
    "联动活动开启公告",
  ]) assert.equal(dropped(title), false, title);
  for (const title of [
    "【种个苹安果】活动开启公告", "【皮肤许愿镜 送伽罗新皮肤】 活动公告", "9月29日《永劫无间》违规玩家封禁公告", "【2026年9月9日】账号封禁公示",
    "「煦风欢舞时」祈愿：「雪宴之锋·薇斯纳(风)」概率UP！", "4.6版本活动跃迁（其一）", "幸运之门·召唤 限时开启", "10月2日周免英雄更新公告",
    "「奇域秘藏·幻夜游烛」奇偶装扮上架", "【云顶之弈】腥红之月小小烬、屠龙勇士不朽潘森限时销售公告",
  ]) assert.equal(dropped(title), true, title);
  // Neither list: left to the model's prefilter, not dropped at collection.
  assert.equal(dropped("「风仙亦是仙，古剑通幽玄！」世界任务说明"), false);
});

// ---- Snapshots -------------------------------------------------------------------------------------
const FIXTURES = path.join(REPO_ROOT, "tests/fixtures/game-sources");
const server = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? "/").slice(1));
  let body: Buffer;
  try { body = readFileSync(path.join(FIXTURES, path.basename(name))); } catch { res.writeHead(404); res.end(); return; }
  const type = name.endsWith(".json") ? "application/json" : name.endsWith(".xml") ? "application/xml" : "text/html";
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const site = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const fixtureOf = (id: string) => readdirSync(FIXTURES).find((f) => f.replace(/\.(xml|html|json)$/, "") === id);

/** The source read from its snapshot, as a collection run would admit its listing. */
async function readSnapshot(s: SeedSource): Promise<{ raw: Candidate[]; kept: Candidate[] }> {
  const local = `${site}/${fixtureOf(s.id)}`;
  const cfg = s.kind === "rss" ? { ...s.config, feedUrl: local } : { ...s.config, url: local, baseUrl: s.config.baseUrl ?? s.config.url };
  const source = { ...s, config: cfg, enabled: true, cursor: null } as unknown as SourceRow;
  const raw = s.kind === "rss" ? (await fetchRss(source, { force: true })).candidates : s.kind === "web_list" ? await fetchWebList(source) : await fetchJsonList(source);
  return { raw, kept: admitListing(raw, source, Date.parse("2026-10-08T06:00:00Z")) };
}

for (const s of sources) {
  test(`snapshot: ${s.id} (${s.name}) parses into dated articles`, async () => {
    assert.ok(fixtureOf(s.id), `${s.id}: snapshot missing`);
    const { kept } = await readSnapshot(s);
    assert.ok(kept.length >= 3, `${s.id}: only ${kept.length} articles`);
    const allow: string[] = s.config.allowUrlPrefixes ?? [];
    for (const c of kept) {
      assert.ok(c.title.length >= 4 && c.title.length <= 200, `${s.id}: title "${c.title}"`);
      assert.match(c.url, /^https?:\/\//, `${s.id}: ${c.url}`);
      if (allow.length) assert.ok(allow.some((p) => c.url.startsWith(p)), `${s.id}: ${c.url} outside its prefixes`);
    }
    const dated = kept.filter((c) => c.publishedAt && Number.isFinite(c.publishedAt.getTime())).length;
    if (UNDATED_LISTING.has(s.id)) assert.equal(s.config.detail !== undefined || s.enabled === false, true, `${s.id}: undated listing needs detail rules or stays disabled`);
    else assert.ok(dated >= kept.length * 0.9, `${s.id}: ${dated}/${kept.length} dated`);
  });
}

test("机核 drops its radio shows at collection", async () => {
  const { raw, kept } = await readSnapshot(byId.get("rss-gcores")!);
  assert.ok(raw.some((c) => c.url.includes("/radios/")), "snapshot has a radio show");
  assert.ok(!kept.some((c) => c.url.includes("/radios/")));
});

test("巴哈姆特 drops anime, film screenings and light novels at collection", async () => {
  const { raw, kept } = await readSnapshot(byId.get("rss-gnn")!);
  const noise = /【試片】|【試閱】|劇場版|動畫化|改編動畫/;
  assert.ok(raw.some((c) => noise.test(c.title)), "snapshot has anime news");
  assert.ok(!kept.some((c) => noise.test(c.title)));
  assert.ok(kept.some((c) => c.title.includes("《王國之心")), "game news stays");
});

test("17173 keeps news articles only, no gift-pack or game-library pages", async () => {
  const { kept } = await readSnapshot(byId.get("web-17173")!);
  for (const c of kept) assert.ok(c.url.startsWith("https://news.17173.com/content/"), c.url);
});

test("official title rules on real announcement lists", async () => {
  const titles = async (id: string) => (await readSnapshot(byId.get(id)!)).kept.map((c) => c.title);
  const pvp = await titles("json-pvp-news");
  assert.ok(pvp.includes("10月8日版本更新公告"));
  assert.ok(!pvp.some((t) => t.includes("活动") || t.includes("皮肤")), pvp.join(" / "));
  const lol = await titles("json-lol-news");
  assert.ok(lol.includes("26.19版本更新公告"));
  assert.ok(!lol.some((t) => /周免|召唤|皮肤/.test(t)), lol.join(" / "));
  const ys = await titles("json-miyoushe-ys");
  assert.ok(ys.some((t) => t.includes("7.1版本更新说明")));
  assert.ok(!ys.some((t) => t.includes("祈愿")), ys.join(" / "));
  const naraka = await titles("web-yjwujian");
  assert.ok(!naraka.some((t) => t.includes("封禁")), naraka.join(" / "));
  // Platform feeds are not filtered: a PlayStation release-date post passes as it is.
  const { raw, kept } = await readSnapshot(byId.get("rss-ps-blog-zh-hant")!);
  assert.equal(kept.length, raw.length);
});

test("detail pages date the listings that print relative or no dates", async () => {
  const detail = async (id: string, need: { date: boolean; title: boolean }) =>
    fetchDetail(`${site}/detail-${id}.html`, { ...byId.get(id)!, cursor: null } as unknown as SourceRow, { ...need, summary: false });
  assert.equal((await detail("web-sina-esports", { date: true, title: false })).publishedAt?.toISOString(), "2026-10-08T01:34:00.000Z");
  assert.equal((await detail("web-wanplus", { date: true, title: false })).publishedAt?.toISOString(), "2026-09-19T09:06:00.000Z");
  assert.equal((await detail("web-gp-qq", { date: true, title: false })).publishedAt?.toISOString(), "2026-09-28T08:00:00.000Z");
  assert.equal((await detail("web-17173", { date: true, title: false })).publishedAt?.toISOString(), "2026-10-08T05:33:18.000Z");
  // 游戏陀螺: the listing link starts with its column label; the article page has the bare headline.
  assert.equal((await detail("web-youxituoluo", { date: false, title: true })).title, "《英雄不再》开发商草蜢工作室宣布脱离网易游戏，重新独立运营");
});

test("Mega Crit feed keeps /news/ posts and drops policy/twitch pages", async () => {
  const { raw, kept } = await readSnapshot(byId.get("rss-megacrit-news")!);
  assert.ok(raw.some((c) => c.url.includes("/twitch/") || c.url.includes("privacy")), "snapshot has a non-news page");
  assert.ok(kept.length >= 3, `only ${kept.length} news posts`);
  for (const c of kept) assert.ok(c.url.startsWith("https://megacrit.com/news/"), c.url);
  assert.ok(kept.some((c) => /Neowsletter|Slay the Spire/i.test(c.title)), kept.map((c) => c.title).join(" / "));
});

test("Larian news list parses dated posts under /news/", async () => {
  const { kept } = await readSnapshot(byId.get("web-larian-news")!);
  assert.ok(kept.length >= 3, `only ${kept.length} posts`);
  for (const c of kept) {
    assert.ok(c.url.startsWith("https://larian.com/news/"), c.url);
    assert.ok(c.publishedAt && Number.isFinite(c.publishedAt.getTime()), c.title);
  }
  assert.ok(kept.some((c) => /Hotfix #36/i.test(c.title)), kept.map((c) => c.title).join(" / "));
});

test("B站/贴吧热榜解析为带日期的热信号条目", async () => {
  const bili = await readSnapshot(byId.get("json-bilibili-hotword")!);
  assert.ok(bili.kept.length >= 3, `bili ${bili.kept.length}`);
  for (const c of bili.kept) {
    assert.match(c.url, /^https:\/\/search\.bilibili\.com\/all\?keyword=/, c.url);
    assert.ok(c.publishedAt && Number.isFinite(c.publishedAt.getTime()), c.title);
  }
  const tieba = await readSnapshot(byId.get("json-tieba-hottopic")!);
  assert.ok(tieba.kept.length >= 3, `tieba ${tieba.kept.length}`);
  for (const c of tieba.kept) {
    assert.match(c.url, /^https:\/\/tieba\.baidu\.com\/hottopic\/browse\/hottopic\?topic_id=\d+/, c.url);
    assert.ok(c.publishedAt && Number.isFinite(c.publishedAt.getTime()), c.title);
  }
});
