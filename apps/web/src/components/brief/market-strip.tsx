import type { MarketSeries, MarketStrip as MarketStripData } from '@jio/core'
import { Badge } from '@/components/ui/badge'
import { sourceLabel } from '@/components/evidence/source-badge'
import { formatAge, formatCount, safeExternalUrl } from '@/components/shell/format'
import { cn } from '@/lib/utils'

const SERIES_LABEL: Record<MarketSeries, string> = {
  gmp_inr: 'GMP INR',
  sub_retail_x: 'Retail x',
  sub_nii_x: 'NII x',
  sub_qib_x: 'QIB x',
  sub_total_x: 'Total x',
}

function formatValue(series: MarketSeries, v: number): string {
  return series === 'gmp_inr' ? formatCount(Math.round(v)) : `${v.toFixed(2)}x`
}

/** Latest GMP and subscription figures from IPO portals. Always tagged unofficial. */
export function MarketStrip({ market }: { market: MarketStripData }) {
  if (market.items.length === 0) {
    return (
      <section aria-label="Market context" className="text-sm text-muted-foreground">
        No market data yet
      </section>
    )
  }
  return (
    <section aria-label="Market context" className="flex flex-wrap gap-2">
      {market.items.map((m) => {
        const href = safeExternalUrl(m.sourceUrl)
        const source = sourceLabel(m.sourceKey)
        return (
          <div
            key={m.series}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm"
          >
            <span className="text-muted-foreground">{SERIES_LABEL[m.series]}</span>
            <span className="font-semibold tabular-nums">{formatValue(m.series, m.value)}</span>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {source}
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">{source}</span>
            )}
            <Badge
              variant="outline"
              className={cn(
                'font-normal',
                m.stale && 'border-amber-500/50 text-amber-800 dark:text-amber-300',
              )}
              title={m.stale ? 'Stale' : 'Age of this figure'}
            >
              {formatAge(m.ageMin)}
            </Badge>
            <Badge variant="secondary" className="font-normal">
              Unofficial
            </Badge>
          </div>
        )
      })}
    </section>
  )
}
