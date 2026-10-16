'use client'

// Suspected-coordination counts (06-02). These are heuristics, not findings: every label says
// "suspected", there is never a percentage of "real" voices, and no author is ever named.
import type { TopicRow } from '@jio/core'
import type { EvidenceSliceInput } from '@/components/evidence/slice'
import { formatCount } from '@/components/shell/format'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Default for the top-5 author share badge (the worker's TRUST_DEFAULTS.coordination). */
export const TOP5_BADGE_THRESHOLD = 0.4

export const COORDINATION_HELP =
  'Suspected, not proven. Three heuristics flag posts: 5 or more distinct accounts posting ' +
  'near-identical text within 60 minutes; a 15-minute volume above 4x the median of the prior ' +
  '24h (and at least 10 items); and the 5 most active accounts posting more than 40% of a ' +
  "topic's last 24h (30 or more posts)."

/** '0 suspected', '12 suspected'. A count, never a percentage. */
export function suspectedLabel(n: number): string {
  return `${formatCount(n)} suspected`
}

/** Badges for a topic row: a suspected burst and a high top-5 author share. */
export function coordinationBadges(
  row: Partial<Pick<TopicRow, 'burst24h' | 'top5AuthorShare'>>,
  threshold = TOP5_BADGE_THRESHOLD,
): string[] {
  const out: string[] = []
  if (row.burst24h) out.push('Burst (suspected)')
  const share = row.top5AuthorShare
  if (share != null && share > threshold) {
    out.push(`Top-5 authors ${Math.round(share * 100)}% (suspected)`)
  }
  return out
}

const buttonClass =
  'rounded-sm tabular-nums underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/**
 * The number of suspected coordinated posts in a slice. A button that opens the evidence drawer
 * on `slice` plus `coordinated: true`; muted text when there are none. Clicks never bubble, so a
 * surrounding row or link keeps its own behaviour.
 */
export function CoordinationCount({
  n,
  slice,
  onOpen,
  label,
  className,
}: {
  n: number
  slice: EvidenceSliceInput
  onOpen: (slice: EvidenceSliceInput) => void
  /** Prefix for the accessible name, e.g. the topic name. */
  label?: string
  className?: string
}) {
  const text = suspectedLabel(n)
  if (n <= 0) {
    return (
      <span
        className={`text-muted-foreground tabular-nums ${className ?? ''}`}
        title={COORDINATION_HELP}
      >
        {text}
      </span>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`${buttonClass} ${className ?? ''}`}
          aria-label={`${label ? `${label}: ` : ''}${formatCount(n)} suspected coordinated`}
          onClick={(e) => {
            e.stopPropagation()
            onOpen({ ...slice, coordinated: true })
          }}
        >
          {text}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{COORDINATION_HELP}</TooltipContent>
    </Tooltip>
  )
}

/** Small "suspected" badges for a topic row; nothing when there is nothing to flag. */
export function CoordinationBadges({
  row,
}: {
  row: Partial<Pick<TopicRow, 'burst24h' | 'top5AuthorShare'>>
}) {
  const badges = coordinationBadges(row)
  if (badges.length === 0) return null
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {badges.map((b) => (
        <span
          key={b}
          title={COORDINATION_HELP}
          className="rounded-full border border-violet-500/50 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-violet-800 dark:text-violet-300"
        >
          {b}
        </span>
      ))}
    </span>
  )
}
