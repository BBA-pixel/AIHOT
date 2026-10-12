import type { CSSProperties } from "react";
// A number that rolls into place digit by digit (odometer). The server renders the final number, so it
// reads right before hydration and for screen readers; the roll is a CSS animation (off with reduced motion).
export function Ticker({ value, className = "" }: { value: number; className?: string }) {
  const text = String(value);
  return (
    <span className={`ticker ${className}`} aria-label={text} role="img">
      {[...text].map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="ticker-col" aria-hidden="true" style={{ "--tick-delay": `${(text.length - 1 - i) * 60}ms` } as CSSProperties}>
            <span style={{ transform: `translateY(-${Number(ch)}em)` }}>
              {DIGITS.map((d) => <span key={d}>{d}</span>)}
            </span>
          </span>
        ) : (
          <span key={i} aria-hidden="true">{ch}</span>
        ),
      )}
    </span>
  );
}
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
