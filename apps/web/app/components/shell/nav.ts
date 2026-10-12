// Site navigation in one place: the desktop sidebar's sections and the phone tab bar's tabs, the engine's
// and the site's modules'.
import type { ReactNode } from "react";
import { webModules } from "../../site-modules";
import {
  IconBolt, IconBookmark, IconDoc, IconFlame, IconGrid, IconHeart, IconPlug, IconUser,
} from "../icons";

export interface NavItem {
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  /** Match the path exactly (the home page). */
  end?: boolean;
  /** Shows the unread dot while the changelog has news. */
  changelog?: boolean;
}

const SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "内容",
    items: [
      { to: "/", label: "资讯", icon: IconBolt, end: true },
      { to: "/hot", label: "热点", icon: IconFlame },
      { to: "/daily", label: "AI 日报", icon: IconDoc },
      { to: "/topics", label: "主题", icon: IconGrid },
      { to: "/starred", label: "收藏", icon: IconBookmark },
    ],
  },
  {
    title: "更多",
    items: [
      { to: "/agent", label: "Agent", icon: IconPlug },
      { to: "/about", label: "关于", icon: IconHeart },
    ],
  },
];

/**
 * The sidebar: the engine's sections with the modules' between 内容 and 更多; a module naming a section
 * that is already there adds to it (including 更多 — e.g. AI 问答 after Agent).
 */
export function sidebar(): Array<{ title: string; items: NavItem[] }> {
  const sections = SECTIONS.map((s) => ({ ...s, items: [...s.items] }));
  const moreIdx = sections.findIndex((s) => s.title === "更多");
  for (const m of webModules()) {
    if (!m.sidebar) continue;
    const section = sections.find((s) => s.title === m.sidebar!.section);
    if (section) {
      if (section.title === "更多") {
        const agentIdx = section.items.findIndex((i) => i.to === "/agent");
        const at = agentIdx >= 0 ? agentIdx + 1 : section.items.length;
        section.items.splice(at, 0, ...m.sidebar.items);
      } else {
        section.items.push(...m.sidebar.items);
      }
    } else {
      const insertAt = moreIdx >= 0 ? moreIdx : sections.length;
      sections.splice(insertAt, 0, { title: m.sidebar.section, items: [...m.sidebar.items] });
    }
  }
  return sections;
}

/** A sidebar entry is lit on its pages; 日报 also covers weekly and monthly reports, 资讯 also covers 全部 (/all). */
export function sidebarIsActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to || (item.to === "/" && /^\/all(\/|$)/.test(pathname));
  if (item.to === "/daily") return /^\/(daily|weekly|monthly)(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * The phone tab bar: 资讯 (精选, with 全部 beside it as a switch), 热点, 日报 and 主题 are tabs, and "我的"
 * at /more holds 收藏, 外观, the tools and the site's own pages. Which tab a page sits under is declared by the page
 * itself (components/shell/screens.ts).
 */
export type TabKey =
  | "featured"
  | "hot"
  | "daily"
  | "topics"
  | "me"
  // A module's tab.
  | (string & {});

export interface Tab {
  key: TabKey;
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  changelog?: boolean;
}

const ENGINE_TABS: Tab[] = [
  { key: "featured", to: "/", label: "资讯", icon: IconBolt },
  { key: "hot", to: "/hot", label: "热点", icon: IconFlame },
  { key: "daily", to: "/daily", label: "日报", icon: IconDoc },
  { key: "topics", to: "/topics", label: "主题", icon: IconGrid },
  { key: "me", to: "/more", label: "我的", icon: IconUser },
];

/** The tab bar: the engine's, the modules' before 我的. */
export function tabs(): Tab[] {
  return [...ENGINE_TABS.slice(0, -1), ...webModules().flatMap((m) => m.tabs ?? []), ENGINE_TABS.at(-1)!];
}
