import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { SITE } from "@aihot/site";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import { useChangelogSeen } from "../../lib/local-state";
import { sidebar, sidebarIsActive, type NavItem } from "./nav";
import { ThemeSwitch } from "./ThemeSwitch";
import { IconGithub } from "../icons";

/** True while the changelog has an entry newer than the one this reader last opened. */
export function useChangelogDot(latestVersion: string | null): boolean {
  const seen = useChangelogSeen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !latestVersion) return false;
  return !seen || seen < latestVersion;
}


const NAV_ICO: Record<string, string> = {
  "/": "nav-ico-bolt",
  "/hot": "nav-ico-flame",
  "/daily": "nav-ico-doc",
  "/topics": "nav-ico-grid",
  "/starred": "nav-ico-bookmark",
  "/agent": "nav-ico-plug",
  "/about": "nav-ico-heart",
  "/ask": "nav-ico-ask",
};

function SideLink({ item, dot }: { item: NavItem; dot: boolean }) {
  const { pathname } = useLocation();
  const isActive = sidebarIsActive(item, pathname);
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      prefetch="intent"
      aria-current={isActive ? "page" : undefined}
      className={`group/nav relative flex h-10 items-center gap-2.5 rounded-tile px-3 text-[14px] transition-colors duration-150 press ${
        isActive
          ? "bg-accent-muted font-semibold text-ink"
          : "font-medium text-ink-4 hover:bg-surface-hover hover:text-ink"
      }`}
    >
      <span className={`nav-ico flex w-[20px] shrink-0 justify-center ${NAV_ICO[item.to] ?? ""} ${isActive ? "text-accent" : "text-ink-4"}`}>
        <Icon size={18} />
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
      {dot && item.changelog && <span className="ml-auto size-1.5 shrink-0 rounded-[2px] bg-hot" aria-label="有新的更新" />}
    </Link>
  );
}

/** One copper marker that slides to the active link (replaces a per-link bar; same place and size). */
function useNavIndicator() {
  const nav = useRef<HTMLElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const { pathname } = useLocation();
  const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useIso(() => {
    const n = nav.current;
    const b = bar.current;
    if (!n || !b) return;
    const place = () => {
      const a = n.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!a) {
        b.style.opacity = "0";
        return;
      }
      const top = a.offsetTop + 6;
      const h = a.offsetHeight - 12;
      const first = !b.dataset.placed;
      if (first) b.style.transition = "none";
      b.style.transform = `translateY(${top}px)`;
      b.style.height = `${h}px`;
      b.style.opacity = "1";
      if (first) {
        b.dataset.placed = "1";
        void b.offsetHeight;
        b.style.transition = "";
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [pathname]);
  return { nav, bar };
}

export function Sidebar({ changelogVersion }: { changelogVersion: string | null }) {
  const dot = useChangelogDot(changelogVersion);
  const { nav, bar } = useNavIndicator();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-border-strong bg-sidebar px-4 pb-3.5 pt-6 lg:flex">
      <Link to="/" className="mb-5 flex h-[50px] items-center px-1 text-ink" aria-label={`${SITE.name} 首页`}>
        <Wordmark size={26} />
      </Link>
      <nav ref={nav} className="scrollbar-thin relative -mx-1 flex-1 overflow-y-auto px-1" aria-label="主导航">
        <span ref={bar} aria-hidden="true" className="nav-indicator pointer-events-none absolute left-1 top-0 z-10 w-0.5 bg-accent opacity-0" />
        {sidebar().map((section) => (
          <div key={section.title}>
            <div className="px-3 pb-1 pt-4 text-[11px] uppercase tracking-[0.08em] text-ink-4">{section.title}</div>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <SideLink key={item.to} item={item} dot={dot} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-2 space-y-2.5 px-1 pt-1">
        {SITE.github && (
          <a
            href={SITE.github}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-1 flex h-[34px] items-center justify-center gap-1.5 rounded-full border border-line text-[12.5px] text-ink-4 transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <IconGithub size={14} />
            GitHub 开源
          </a>
        )}
        <ThemeSwitch className="mx-1" />
        {SITE.icp && (
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="block px-2 text-[10px] text-ink-4 hover:text-ink-3">
            {SITE.icp}
          </a>
        )}
      </div>
    </aside>
  );
}
