'use client'

import type { BriefResponse } from '@jio/core'
import { Button } from '@/components/ui/button'
import type { EvidenceSliceInput } from '@/components/evidence/slice'
import { formatCount } from '@/components/shell/format'

/** Emerging candidates and Unclassified items, each opening its evidence. */
export function BucketCounts({
  emerging,
  unclassified,
  onOpen,
}: {
  emerging: BriefResponse['emerging']
  unclassified: BriefResponse['unclassified']
  onOpen: (slice: EvidenceSliceInput) => void
}) {
  return (
    <section aria-label="Other buckets" className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => onOpen({ topic: 'emerging' })}>
        Emerging candidates: {formatCount(emerging.count)} items ({formatCount(emerging.candidates)}{' '}
        {emerging.candidates === 1 ? 'cluster' : 'clusters'})
      </Button>
      <Button variant="outline" size="sm" onClick={() => onOpen({ topic: 'unclassified' })}>
        Unclassified: {formatCount(unclassified.count)}
      </Button>
    </section>
  )
}
