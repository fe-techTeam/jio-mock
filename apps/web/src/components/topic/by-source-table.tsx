'use client'

import type { SplitCounts, TimelineResponse } from '@jio/core'
import { SourceBadge } from '@/components/evidence/source-badge'
import { useOpenEvidence } from '@/components/evidence/use-open-evidence'
import { formatCount, pctSplit } from '@/components/shell/format'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const linkButton =
  'rounded-sm tabular-nums underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/** Sentiment split as percentages, or the 30-item rule's "not enough data" text. */
export function SplitCell({ counts }: { counts: SplitCounts }) {
  if (!counts.splitShown) {
    return <span className="text-muted-foreground">Not enough data (n={counts.items})</span>
  }
  const p = pctSplit(counts)
  return <span className="tabular-nums">{`${p.pos}% pos / ${p.neu}% neu / ${p.neg}% neg`}</span>
}

function CoverageBadge({ label }: { label: string }) {
  if (label === 'sampled') {
    return (
      <Badge variant="outline" className="border-amber-500/50 text-amber-800 dark:text-amber-300">
        sampled
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {label === 'full_search' ? 'full search' : label}
    </Badge>
  )
}

export function BySourceTable({
  slug,
  rows,
}: {
  slug: string
  rows: TimelineResponse['bySource']
}) {
  const open = useOpenEvidence()
  const sorted = [...rows].sort((a, b) => b.items - a.items)
  return (
    <section aria-labelledby="by-source-h" className="flex flex-col gap-2">
      <h2 id="by-source-h" className="text-sm font-semibold">
        By source (24h)
      </h2>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items in the last 24h</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead>Sentiment</TableHead>
              <TableHead>Coverage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.sourceKey}>
                <TableCell>
                  <SourceBadge sourceKey={r.sourceKey} />
                </TableCell>
                <TableCell className="text-right">
                  <button
                    type="button"
                    className={`${linkButton} font-semibold`}
                    aria-label={`${r.sourceKey}: ${r.items} items in 24h`}
                    onClick={() =>
                      open({ topic: slug, source: r.sourceKey, window: '24h', sort: 'reach' })
                    }
                  >
                    {formatCount(r.items)}
                  </button>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <SplitCell counts={r} />
                </TableCell>
                <TableCell>
                  <CoverageBadge label={r.coverageLabel} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
