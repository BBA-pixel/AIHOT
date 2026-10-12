import { ITEM_COPY } from "@aihot/site";
import type { SelectionHint } from "@aihot/contracts/site";

/**
 * The AI score as a small pill, tinted by tier instead of drawn as a bar: strong picks (85+) in a wash of
 * warm red, solid ones (70+) in the accent, the rest as quiet text. The score itself is unchanged.
 */
const TIERS = [
  { min: 85, className: "bg-hot/10 text-hot ring-hot/25" },
  { min: 70, className: "bg-accent-soft text-accent ring-accent/20" },
  { min: 0, className: "text-ink-4 ring-line-soft" },
];

/** The score readers see: none when the site keeps scores from them. */
export function shownScore(score: number | null): number | null {
  return ITEM_COPY.showScore ? score : null;
}

function hintTitle(value: number, hint?: SelectionHint | null): string {
  const parts = [`AI 评分 ${value}/100`];
  if (hint?.threshold != null) parts.push(`门槛 ${hint.threshold}`);
  if (hint?.sourceTierLabel) parts.push(hint.sourceTierLabel);
  return parts.join(" · ");
}

/** "AI 评分 · 88" on desktop cards; `compact` keeps only the number (phones). */
export function ScoreLabel({
  score,
  compact = false,
  hint = null,
}: {
  score: number | null;
  compact?: boolean;
  hint?: SelectionHint | null;
}) {
  const shown = shownScore(score);
  if (shown === null) return null;
  const value = Math.round(shown);
  const tier = TIERS.find((t) => value >= t.min)!;
  const title = hintTitle(value, hint);
  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex h-[20px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 ring-1 ring-inset ${tier.className}`}
    >
      {!compact && (
        <>
          <span className="text-[11px] font-medium leading-none opacity-80">AI 评分</span>
          <span className="h-2.5 w-px bg-current opacity-25" aria-hidden="true" />
        </>
      )}
      <span className="mono text-[12.5px] font-bold leading-none tabular-nums">{value}</span>
    </span>
  );
}
