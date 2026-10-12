import assert from "node:assert/strict";
import { test } from "node:test";

/** Mirrors apps/web/app/components/shell/nav.ts sidebar() merge for 更多. */
function mergeSidebar(
  sectionsIn: Array<{ title: string; items: Array<{ to: string; label: string }> }>,
  modules: Array<{ section: string; items: Array<{ to: string; label: string }> }>,
) {
  const sections = sectionsIn.map((s) => ({ ...s, items: [...s.items] }));
  const moreIdx = sections.findIndex((s) => s.title === "更多");
  for (const m of modules) {
    const section = sections.find((s) => s.title === m.section);
    if (section) {
      if (section.title === "更多") {
        const agentIdx = section.items.findIndex((i) => i.to === "/agent");
        const at = agentIdx >= 0 ? agentIdx + 1 : section.items.length;
        section.items.splice(at, 0, ...m.items);
      } else section.items.push(...m.items);
    } else {
      sections.splice(moreIdx >= 0 ? moreIdx : sections.length, 0, { title: m.section, items: [...m.items] });
    }
  }
  return sections;
}

test("更多 hook inserts AI 问答 after Agent without touching 内容", () => {
  const sections = mergeSidebar(
    [
      { title: "内容", items: [{ to: "/", label: "资讯" }] },
      { title: "更多", items: [{ to: "/agent", label: "Agent" }, { to: "/about", label: "关于" }] },
    ],
    [{ section: "更多", items: [{ to: "/ask", label: "AI 问答" }] }],
  );
  const more = sections.find((s) => s.title === "更多")!;
  assert.deepEqual(more.items.map((i) => i.to), ["/agent", "/ask", "/about"]);
  assert.ok(!sections.find((s) => s.title === "内容")!.items.some((i) => i.to === "/ask"));
});
