'use client'

import { NotEnoughData } from '@/components/states'
import type { Sentiment, SplitCounts } from '@jio/core'
import { pctSplit } from '@/components/shell/format'
import { cn } from '@/lib/utils'
import { SENTIMENT_CLASSES } from './sentiment-colors'

/** Labels and colours per sentiment, shared with the reach split and the charts. */
export const SENTIMENT_STYLE: Record<Sentiment, { label: string; bar: string; text: string }> = {
  positive: { label: 'Positive', ...SENTIMENT_CLASSES.positive },
  neutral: { label: 'Neutral', ...SENTIMENT_CLASSES.neutral },
  negative: { label: 'Negative', ...SENTIMENT_CLASSES.negative },
}

const ORDER = [
  ['positive', 'pos'],
  ['neutral', 'neu'],
  ['negative', 'neg'],
] as const

/**
 * Stacked pos/neu/neg bar. Each non-zero segment is a button that opens its evidence.
 * Under the split threshold it shows 'Not enough data (n=X)' and no buttons.
 */
export function SentimentBar({
  counts,
  onOpen,
  className,
}: {
  counts: SplitCounts
  onOpen?: (s: Sentiment) => void
  className?: string
}) {
  if (!counts.splitShown) return <NotEnoughData n={counts.items} />
  const pct = pctSplit(counts)
  return (
    <div className={cn('flex h-3 w-40 min-w-28 overflow-hidden rounded-full bg-muted', className)}>
      {ORDER.map(([sentiment, key]) => {
        const n = counts[key]
        if (n <= 0) return null
        const style = SENTIMENT_STYLE[sentiment]
        return (
          <button
            key={sentiment}
            type="button"
            aria-label={`${style.label}: ${n} posts (${pct[key]}%), open evidence`}
            title={`${style.label} ${pct[key]}% (n=${n})`}
            onClick={() => onOpen?.(sentiment)}
            className={cn(
              'h-full min-w-1 outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              style.bar,
            )}
            style={{ width: `${pct[key]}%` }}
          />
        )
      })}
    </div>
  )
}
