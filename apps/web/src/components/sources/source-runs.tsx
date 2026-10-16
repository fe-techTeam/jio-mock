'use client'

import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatIst } from '@/components/shell/format'
import { getRuns, runsKey } from './sources-api'

export function SourceRuns({ sourceKey }: { sourceKey: string }) {
  const q = useQuery({ queryKey: runsKey(sourceKey), queryFn: () => getRuns(sourceKey) })

  if (q.isPending) return <Skeleton className="h-16" />
  if (q.isError) {
    return (
      <div role="alert" className="flex items-center gap-2 text-sm">
        Could not load runs.
        <Button size="xs" variant="outline" onClick={() => void q.refetch()}>
          Retry
        </Button>
      </div>
    )
  }
  if (q.data.length === 0) return <p className="text-sm text-muted-foreground">No runs yet.</p>

  return (
    <table className="w-full text-xs">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-1 pr-3 font-medium">Time (IST)</th>
          <th className="pr-3 font-medium">Status</th>
          <th className="pr-3 font-medium">Duration</th>
          <th className="pr-3 font-medium">New items</th>
          <th className="pr-3 font-medium">Cost</th>
          <th className="font-medium">Error</th>
        </tr>
      </thead>
      <tbody>
        {q.data.map((r) => (
          <tr key={r.at} className="border-t">
            <td className="py-1 pr-3 whitespace-nowrap">{formatIst(r.at, 'datetime')}</td>
            <td className="pr-3">{r.status ?? '-'}</td>
            <td className="pr-3">
              {r.durationMs == null ? '-' : `${(r.durationMs / 1000).toFixed(1)} s`}
            </td>
            <td className="pr-3">{r.itemsNew ?? '-'}</td>
            <td className="pr-3">{r.costUsd == null ? '-' : `$${r.costUsd.toFixed(3)}`}</td>
            <td className="break-words text-destructive">{r.error ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
