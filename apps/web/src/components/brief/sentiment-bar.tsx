'use client'

import type { Sentiment, SplitCounts } from '@jio/core'
import { pctSplit } from '@/components/shell/format'
import { cn } from '@/lib/utils'

/** Sentiment colours, shared with 04-03's charts. Readable on light and dark backgrounds. */
export const SENTIMENT_STYLE: Record<Sentiment, { label: string; bar: string; text: string }> = {
  positive: {
    label: 'Positive',
    bar: 'bg-emerald-500 dark:bg-emerald-400',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  neutral: {
    label: 'Neutral',
    bar: 'bg-zinc-400 dark:bg-zinc-500',
    text: 'text-zinc-600 dark:text-zinc-300',
  },
  negative: {
    label: 'Negative',
    bar: 'bg-rose-500 dark:bg-rose-400',
    text: 'text-rose-700 dark:text-rose-300',
  },
}

const ORDER = [
  ['positive', 'pos'],
  ['neutral', 'neu'],
  ['negative', 'neg'],
] as const

export function NotEnoughData({ n }: { n: number }) {
  return <span className="text-xs text-muted-foreground">Not enough data (n={n})</span>
}

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
            aria-label={`${style.label} ${pct[key]}% (n=${n})`}
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
