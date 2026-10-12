// Card-shaped placeholders for lists while a page loads: the same rail, source line, title and
// summary rhythm as FeedItem, so nothing jumps when the real cards arrive.
export function FeedSkeleton({ count = 3, rail = true }: { count?: number; rail?: boolean }) {
  return (
    <ol aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={`grid grid-cols-[minmax(0,1fr)] border-b border-line-soft py-3.5 last:border-b-0 lg:border-b-0 lg:py-0 lg:pb-3 ${rail ? "lg:grid-cols-[64px_22px_minmax(0,1fr)]" : ""}`}>
          {rail && <span className="hidden lg:block lg:pt-[19px]"><span className="skeleton-shimmer block h-3 w-10" /></span>}
          {rail && <span className="hidden lg:block" />}
          <div className="lg:card lg:px-[18px] lg:pb-[14px] lg:pt-[15px]">
            <div className="flex items-center gap-2">
              <span className="skeleton-shimmer block size-[18px] !rounded-full" />
              <span className="skeleton-shimmer block h-3 w-24" />
              <span className="skeleton-shimmer ml-auto block h-3 w-10" />
            </div>
            <div className="skeleton-shimmer mt-3 h-[18px] w-[86%]" />
            <div className="skeleton-shimmer mt-2.5 h-3.5 w-full" />
            <div className="skeleton-shimmer mt-2 h-3.5 w-[62%]" />
          </div>
        </li>
      ))}
    </ol>
  );
}
