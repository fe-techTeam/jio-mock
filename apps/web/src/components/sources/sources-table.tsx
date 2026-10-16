'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import type { SourceRow, SourcesResponse } from '@/app/api/sources/_lib/contract'
import { formatIst } from '@/components/shell/format'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { IntervalEditor } from './interval-editor'
import { SourceRuns } from './source-runs'
import { ModeBadge, StatusBadge } from './status-badge'

/** 'HH:mm, DD Mon' in IST. */
export function whenText(iso: string | null): string {
  if (!iso) return '-'
  return formatIst(iso, 'datetime').replace(' ', ', ')
}

export function coverageText(label: string): string {
  return label === 'sampled' ? 'sampled, not representative' : label
}

export function SourcesTable({ data }: { data: SourcesResponse }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>Source</TableHead>
          <TableHead>Lane</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Last success</TableHead>
          <TableHead>Next run</TableHead>
          <TableHead>Cadence</TableHead>
          <TableHead className="text-right">Items 24h</TableHead>
          <TableHead className="text-right">Spend today</TableHead>
          <TableHead>Coverage</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.sources.map((s: SourceRow) => {
          const expanded = open === s.key
          return (
            <Fragment key={s.key}>
              <TableRow>
                <TableCell>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Hide' : 'Show'} last runs for ${s.name}`}
                    className="rounded p-1 hover:bg-accent"
                    onClick={() => setOpen(expanded ? null : s.key)}
                  >
                    {expanded ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </button>
                </TableCell>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="capitalize">{s.lane}</TableCell>
                <TableCell>
                  <StatusBadge
                    status={s.status}
                    title={s.status === 'circuit_open' ? (s.lastError ?? undefined) : undefined}
                  />
                  {s.status === 'circuit_open' && s.lastError ? (
                    <p
                      className="mt-1 max-w-56 truncate text-xs text-muted-foreground"
                      title={s.lastError}
                    >
                      {s.lastError}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>
                  {s.key === 'x_api' ? (
                    <ModeBadge
                      mode={s.mode}
                      missingCreds={s.missingCreds}
                      label={data.x.modeLabel}
                    />
                  ) : (
                    <ModeBadge mode={s.mode} missingCreds={s.missingCreds} />
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{whenText(s.lastSuccessAt)}</TableCell>
                <TableCell className="whitespace-nowrap">{whenText(s.nextRunAt)}</TableCell>
                <TableCell>
                  <IntervalEditor source={s} configVersion={data.configVersion} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{s.items24h}</TableCell>
                <TableCell className="text-right tabular-nums">
                  ${s.spendTodayUsd.toFixed(2)}
                </TableCell>
                <TableCell>{coverageText(s.coverageLabel)}</TableCell>
              </TableRow>
              {expanded ? (
                <TableRow>
                  <TableCell />
                  <TableCell colSpan={10}>
                    <SourceRuns sourceKey={s.key} />
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}
