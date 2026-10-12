import type { SteamTopicPanel } from "@aihot/contracts/site";
import { IconExternal } from "../../components/icons";
import { Ticker } from "../../components/ui/Ticker";

/** Price label with digit odometer when the store price is numeric (e.g. "¥48.00"). */
function PriceLabel({ label, discountPercent }: { label: string; discountPercent: number }) {
  const m = /^([^\d]*)(\d+)([^\d]*)$/.exec(label.replace(/,/g, ""));
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[12.5px] font-semibold text-accent">
      {m ? (
        <>
          {m[1]}
          <Ticker value={Number(m[2])} />
          {m[3]}
        </>
      ) : (
        label
      )}
      {discountPercent > 0 && (
        <span className="text-[11px] font-medium text-hot">
          -<Ticker value={discountPercent} />%
        </span>
      )}
    </span>
  );
}

/** Compact Steam store card for seed game topic deep pages. */
export function SteamPanel({ steam }: { steam: SteamTopicPanel }) {
  return (
    <section className="mb-8 overflow-hidden rounded-2xl border border-line bg-surface lg:card lg:!p-0">
      <div className="flex flex-col sm:flex-row">
        {steam.headerImage && (
          <a
            href={steam.storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block shrink-0 sm:w-[280px] lg:w-[320px]"
            aria-label={`在 Steam 打开《${steam.name}》`}
          >
            <img
              src={steam.headerImage}
              alt=""
              width={460}
              height={215}
              className="aspect-[460/215] h-auto w-full object-cover"
              loading="lazy"
            />
          </a>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold tracking-[0.06em] text-accent">Steam 商店</p>
              <h2 className="mt-0.5 text-[17px] font-bold leading-snug text-ink">{steam.name}</h2>
            </div>
            {steam.price && <PriceLabel label={steam.price.label} discountPercent={steam.price.discountPercent} />}
          </div>
          {steam.shortDescription && (
            <p className="line-clamp-3 text-[13.5px] leading-relaxed text-ink-3">{steam.shortDescription}</p>
          )}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[12.5px] text-ink-4 sm:grid-cols-2">
            {steam.releaseDate && (
              <div>
                <dt className="inline text-ink-4">发售 · </dt>
                <dd className="inline text-ink-2">
                  {steam.comingSoon ? `即将推出（${steam.releaseDate}）` : steam.releaseDate}
                </dd>
              </div>
            )}
            {steam.developers.length > 0 && (
              <div>
                <dt className="inline text-ink-4">开发 · </dt>
                <dd className="inline text-ink-2">{steam.developers.join("、")}</dd>
              </div>
            )}
            {steam.publishers.length > 0 && (
              <div>
                <dt className="inline text-ink-4">发行 · </dt>
                <dd className="inline text-ink-2">{steam.publishers.join("、")}</dd>
              </div>
            )}
            {steam.genres.length > 0 && (
              <div>
                <dt className="inline text-ink-4">类型 · </dt>
                <dd className="inline text-ink-2">{steam.genres.join("、")}</dd>
              </div>
            )}
            {steam.platforms.length > 0 && (
              <div>
                <dt className="inline text-ink-4">平台 · </dt>
                <dd className="inline text-ink-2">{steam.platforms.join(" / ")}</dd>
              </div>
            )}
            {steam.metacriticScore != null && (
              <div>
                <dt className="inline text-ink-4">Metacritic · </dt>
                <dd className="num inline font-semibold text-ink-2">
                  <Ticker value={steam.metacriticScore} />
                </dd>
              </div>
            )}
          </dl>
          <div className="mt-1">
            <a
              href={steam.storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
            >
              在 Steam 查看 <IconExternal size={13} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
