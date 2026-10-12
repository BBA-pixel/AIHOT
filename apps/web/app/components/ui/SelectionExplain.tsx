import type { SelectionExplain as SelectionExplainData } from "@aihot/contracts/site";
import { ITEM_COPY } from "@aihot/site";
import { AXIS_LABELS } from "./selection-labels";

const AXIS_ORDER = ["sig", "nov", "cred", "reson", "act"] as const;

/** Compact “为何入选” block for the item rail — not an admin dashboard. */
export function SelectionExplainPanel({ explain }: { explain: SelectionExplainData }) {
  if (!ITEM_COPY.showScore && !explain.metThreshold && !explain.wireDedupe) return null;
  const showScore = ITEM_COPY.showScore && explain.score !== null;

  return (
    <div className="anim-drop-in explain-panel relative space-y-3 rounded-tile border border-line-soft bg-bg-sunk/40 px-3 py-3 text-[12.5px] leading-relaxed text-ink-3">
      <span aria-hidden="true" className="explain-arrow absolute -top-1.5 left-4 size-3 rotate-45 border-l border-t border-line-soft bg-bg-sunk/40" />
      {(showScore || explain.threshold !== null || explain.sourceTierLabel) && (
        <p>
          {showScore && (
            <>
              评分 <b className="num font-semibold text-ink">{explain.score}</b>
            </>
          )}
          {explain.threshold !== null && (
            <>
              {showScore ? " · " : ""}
              门槛 <b className="num font-semibold text-ink">{explain.threshold}</b>
              {explain.metThreshold === true && <span className="text-accent">（已达）</span>}
              {explain.metThreshold === false && <span className="text-ink-4">（未达）</span>}
            </>
          )}
          {explain.sourceTierLabel && (
            <>
              {" · "}
              {explain.sourceTierLabel}
              {explain.sourceTier ? `（${explain.sourceTier.replace("_", ".")}）` : ""}
            </>
          )}
        </p>
      )}
      {explain.contentTypeLabel && (
        <p className="text-[12px] text-ink-4">内容类型：{explain.contentTypeLabel}</p>
      )}
      {explain.axes && (
        <ul className="space-y-1.5">
          {AXIS_ORDER.map((k) => {
            const v = explain.axes![k];
            return (
              <li key={k} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-[11.5px] text-ink-4">{AXIS_LABELS[k]}</span>
                <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-accent/70"
                    style={{ width: `${(v / 10) * 100}%` }}
                  />
                </span>
                <span className="mono w-4 text-right text-[11.5px] tabular-nums text-ink-2">{v}</span>
              </li>
            );
          })}
        </ul>
      )}
      {explain.wireDedupe && (
        <p className="text-[12px] leading-relaxed text-ink-4">{explain.wireDedupe.note}</p>
      )}
    </div>
  );
}
