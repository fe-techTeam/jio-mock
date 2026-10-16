'use client'

import type { TopicRow } from '@jio/core'
import Link from 'next/link'
import type { EvidenceSliceInput } from '@/components/evidence/slice'
import { formatCount } from '@/components/shell/format'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Filters } from '@/lib/api'
import { SentimentBar } from './sentiment-bar'
import { Sparkline } from './sparkline'
import { TrendArrow } from './trend-arrow'

function topicHref(slug: string, filters: Filters): string {
  const p = new URLSearchParams()
  if (filters.entity !== 'all') p.set('entity', filters.entity)
  if (filters.lane !== 'all') p.set('lane', filters.lane)
  const q = p.toString()
  return `/topics/${encodeURIComponent(slug)}${q ? `?${q}` : ''}`
}

const linkButton =
  'rounded-sm tabular-nums underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/** Active talking points in API rank order. Scrolls sideways inside its own wrapper on phones. */
export function TopicsTable({
  topics,
  filters,
  onOpen,
}: {
  topics: TopicRow[]
  filters: Filters
  onOpen: (slice: EvidenceSliceInput) => void
}) {
  if (topics.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active talking points in the last 24h for this filter.
      </p>
    )
  }
  return (
    <Table className="min-w-[760px]">
      <TableHeader>
        <TableRow>
          <TableHead>Talking point</TableHead>
          <TableHead className="text-right">Volume 24h</TableHead>
          <TableHead>Sentiment</TableHead>
          <TableHead className="text-right">Low conf.</TableHead>
          <TableHead className="text-right">Suspected coord.</TableHead>
          <TableHead>24h</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {topics.map((t) => {
          const base = { topic: t.slug, topicName: t.name }
          return (
            <TableRow key={t.slug}>
              <TableCell className="max-w-sm align-top whitespace-normal">
                <Link
                  href={topicHref(t.slug, filters)}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {t.name}
                </Link>
                {t.summary2line ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{t.summary2line}</p>
                ) : null}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className={`${linkButton} font-semibold`}
                    aria-label={`${t.name}: ${t.items} items in 24h`}
                    onClick={() => onOpen(base)}
                  >
                    {formatCount(t.items)}
                  </button>
                  <TrendArrow trend={t.trend} deltaPct={t.deltaPct} />
                </div>
              </TableCell>
              <TableCell>
                <SentimentBar counts={t} onOpen={(sentiment) => onOpen({ ...base, sentiment })} />
              </TableCell>
              <TableCell className="text-right">
                <button
                  type="button"
                  className={linkButton}
                  aria-label={`${t.name}: low confidence ${t.lowConfPct}%`}
                  onClick={() => onOpen({ ...base, confidence: 'low' })}
                >
                  {t.lowConfPct}%
                </button>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(t.suspectedCoordinated)}
              </TableCell>
              <TableCell>
                <Sparkline values={t.spark} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
