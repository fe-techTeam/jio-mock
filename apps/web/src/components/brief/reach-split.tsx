'use client'

import type { ReachSplit, Sentiment } from '@jio/core'
import { formatCount, pctSplit } from '@/components/shell/format'
import { cn } from '@/lib/utils'
import { NotEnoughData, SENTIMENT_STYLE } from './sentiment-bar'

const ORDER = [
  ['positive', 'pos'],
  ['neutral', 'neu'],
  ['negative', 'neg'],
] as const

/** "42 / 31 / 27": pos / neu / neg as whole percents, never decimals. */
export function formatSplit(s: ReachSplit): string {
  return [s.pos, s.neu, s.neg].map((v) => Math.round(v)).join(' / ')
}

/**
 * Reach-weighted sentiment (the headline) as a stacked bar with whole percents, and the raw
 * count split plus n beside it ("Raw 38 / 35 / 27, n = 1,204"). `raw` holds counts and is null
 * when the raw split is hidden; with neither split it shows "Not enough data (n=X)".
 * With `onOpen`, each reach percent opens that sentiment's evidence.
 */
export function ReachSplitView({
  reach,
  raw,
  n,
  onOpen,
  className,
}: {
  reach: ReachSplit | null
  raw: ReachSplit | null
  n: number
  onOpen?: (s: Sentiment) => void
  className?: string
}) {
  if (!reach && !raw) return <NotEnoughData n={n} />
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {reach ? (
        <>
          <span className="text-xs text-muted-foreground">Reach-weighted</span>
          <div aria-hidden className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            {ORDER.map(([s, k]) =>
              reach[k] > 0 ? (
                <span
                  key={s}
                  className={SENTIMENT_STYLE[s].bar}
                  style={{ width: `${Math.round(reach[k])}%` }}
                />
              ) : null,
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {ORDER.map(([s, k]) => {
              const pct = Math.round(reach[k])
              const body = (
                <>
                  {pct}%
                  <span aria-hidden className="ml-0.5 text-xs font-normal text-muted-foreground">
                    {SENTIMENT_STYLE[s].label.slice(0, 3).toLowerCase()}
                  </span>
                </>
              )
              const cls = cn('text-lg font-semibold tabular-nums', SENTIMENT_STYLE[s].text)
              return onOpen ? (
                <button
                  key={s}
                  type="button"
                  aria-label={`Reach-weighted ${SENTIMENT_STYLE[s].label} ${pct}%, open evidence`}
                  onClick={() => onOpen(s)}
                  className={cn(
                    cls,
                    'rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  {body}
                </button>
              ) : (
                <span key={s} className={cls}>
                  {body}
                  <span className="sr-only"> {SENTIMENT_STYLE[s].label}</span>
                </span>
              )
            })}
          </div>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">Reach-weighted split not available</span>
      )}
      {raw ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {`Raw ${formatSplit(pctSplit(raw))}, n = ${formatCount(n)}`}
        </span>
      ) : null}
    </div>
  )
}
