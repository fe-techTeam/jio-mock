'use client'

import { ENTITY_KEYS, type TimelineResponse } from '@jio/core'
import { ENTITY_LABEL } from '@/components/evidence/slice'
import { useOpenEvidence } from '@/components/evidence/use-open-evidence'
import { formatCount } from '@/components/shell/format'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { linkButton, SplitCell } from './by-source-table'

export function EntityBreakdown({
  slug,
  rows,
}: {
  slug: string
  rows: TimelineResponse['byEntity']
}) {
  const open = useOpenEvidence()
  const byKey = new Map(rows.map((r) => [r.entity, r]))
  return (
    <section aria-labelledby="by-entity-h" className="flex flex-col gap-2">
      <h2 id="by-entity-h" className="text-sm font-semibold">
        By mention (24h)
      </h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mentions</TableHead>
            <TableHead className="text-right">Items</TableHead>
            <TableHead>Sentiment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ENTITY_KEYS.map((entity) => {
            const r = byKey.get(entity) ?? {
              entity,
              items: 0,
              pos: 0,
              neu: 0,
              neg: 0,
              splitShown: false,
            }
            return (
              <TableRow key={entity}>
                <TableCell>{ENTITY_LABEL[entity]}</TableCell>
                <TableCell className="text-right">
                  <button
                    type="button"
                    className={`${linkButton} font-semibold`}
                    aria-label={`${ENTITY_LABEL[entity]}: ${r.items} items in 24h`}
                    onClick={() => open({ topic: slug, entity, window: '24h' })}
                  >
                    {formatCount(r.items)}
                  </button>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <SplitCell counts={r} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </section>
  )
}
