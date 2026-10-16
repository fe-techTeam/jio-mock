import type { SourceFreshness } from '@jio/core'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export type FreshnessSummary = { text: string; stale: boolean }

/** Age range over enabled sources that have succeeded at least once. */
export function freshnessSummary(freshness: SourceFreshness[] | undefined): FreshnessSummary {
  if (!freshness) return { text: 'Checking data age', stale: false }
  const enabled = freshness.filter((f) => f.enabled)
  const stale = enabled.some((f) => f.status === 'stale')
  const ages = enabled
    .map((f) => f.ageMin)
    .filter((a): a is number => a !== null)
    .map((a) => Math.max(0, Math.round(a)))
  if (ages.length === 0) return { text: 'Waiting for first fetch', stale }
  const min = Math.min(...ages)
  const max = Math.max(...ages)
  return { text: min === max ? `Data ${min} min old` : `Data ${min}-${max} min old`, stale }
}

export function FreshnessPill({ freshness }: { freshness: SourceFreshness[] | undefined }) {
  const { text, stale } = freshnessSummary(freshness)
  return (
    <Link
      href="/sources"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap hover:bg-accent',
        stale
          ? 'border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
          : 'text-muted-foreground',
      )}
      title={stale ? 'One or more sources are stale' : undefined}
    >
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', stale ? 'bg-amber-500' : 'bg-emerald-500')}
      />
      {text}
      {stale ? <span className="sr-only"> (some sources stale)</span> : null}
    </Link>
  )
}
