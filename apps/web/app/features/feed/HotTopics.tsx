import { Link } from "react-router";
import type { HotStripEntry } from "@aihot/contracts/site";
import { IconMinus, IconTrendDown, IconTrendUp } from "../../components/icons";
import { Faces } from "../hot/Faces";

function hrefOf(e: HotStripEntry): string {
  return e.storyPublicId ? `/story/${e.storyPublicId}` : e.itemId ? `/items/${e.itemId}` : "/hot";
}

function rankLabel(rank: number): string {
  return String(rank).padStart(2, "0");
}

/** Where the heat is heading, as a small mark (a "新" stamp for a story new to the ranking). */
function TrendMark({ trend }: { trend: HotStripEntry["trend"] }) {
  if (trend === "up") return <IconTrendUp size={14} strokeWidth={2.2} className="text-accent" aria-label="热度上升" />;
  if (trend === "down") return <IconTrendDown size={14} strokeWidth={2.2} className="text-ink-4" aria-label="热度回落" />;
  if (trend === "new") return <span className="rounded-[2px] bg-accent-muted px-1.5 text-[10.5px] font-semibold leading-4 text-accent">新</span>;
  if (trend === "unknown") return null;
  return <IconMinus size={14} strokeWidth={2.2} className="text-ink-4" aria-label="热度持平" />;
}

/**
 * Top of the hot ranking on the home page: accent numerals 01–05, hairline rows,
 * no flame ping or gradient wash — magazine editorial strip.
 */
export function HotTopics({ entries }: { entries: HotStripEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section
      aria-labelledby="hot-topics"
      className="mb-4 border border-line bg-surface px-3.5 pb-1 pt-2.5 lg:mb-6 lg:px-5 lg:pb-2 lg:pt-3.5"
    >
      <div className="flex items-center justify-between border-b border-line pb-2 lg:mb-1">
        <h2 id="hot-topics" className="text-[13px] font-semibold tracking-[0.06em] text-ink">
          当前热点
        </h2>
        <Link to="/hot" className="group -my-2 -mr-1.5 inline-flex h-10 items-center gap-1 px-1.5 text-[12.5px] text-accent transition-colors hover:text-accent-ink lg:my-0 lg:mr-0 lg:h-auto lg:px-0">
          查看完整榜单 <span aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
        </Link>
      </div>
      <ol>
        {entries.slice(0, 5).map((e, i) => (
          <li key={e.rank} className={`${i > 0 ? "border-t border-line" : ""} ${i >= 3 ? "max-sm:hidden" : ""}`}>
            <Link viewTransition
              to={hrefOf(e)}
              className="group -mx-2 grid min-h-10 sm:min-h-0 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 px-2 py-2.5 transition-colors hover:bg-surface-hover active:bg-surface-hover sm:grid-cols-[28px_minmax(0,1fr)_120px_64px_20px] sm:gap-x-4 sm:py-2.5"
            >
              <span className="num text-center text-[14px] font-semibold leading-none tracking-wide text-accent">
                {rankLabel(e.rank)}
              </span>
              <span className="line-clamp-1 min-w-0 text-[14.5px] font-medium leading-[1.5] text-ink transition-colors group-hover:text-accent lg:text-[14px]">{e.title}</span>
              <span className="hidden justify-end sm:flex">
                <Faces participants={e.participants} total={e.participantCount} size={20} interactive={false} />
              </span>
              <span className="flex items-center justify-end gap-2.5 sm:contents">
                <span className="whitespace-nowrap text-right text-[12.5px] text-ink-4" title="热度指数">
                  <span className="num text-[13.5px] font-semibold text-ink-2">{Math.round(e.heat)}</span> 热度
                </span>
                <span className="flex w-5 justify-center">
                  <TrendMark trend={e.trend} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
