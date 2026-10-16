'use client'

import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useOpenEvidence } from '@/components/evidence/use-open-evidence'
import { StaleBanner } from '@/components/shell/stale-banner'
import { useFilters } from '@/components/shell/use-filters'
import { getBrief, queryKeys } from '@/lib/api'
import { BriefFooter } from './brief-footer'
import { BucketCounts } from './bucket-counts'
import { KpiRow } from './kpi-row'
import { MarketStrip } from './market-strip'
import { TopicsTable } from './topics-table'

export function BriefSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading brief">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-10" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  )
}

/** The executive brief, polled every 30s (provider default). Last good data survives errors. */
export function BriefView() {
  const { filters } = useFilters()
  const open = useOpenEvidence()
  const query = useQuery({
    queryKey: queryKeys.brief(filters),
    queryFn: () => getBrief(filters),
  })
  const { data } = query

  if (!data) {
    if (query.isError) {
      return (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 text-sm"
        >
          <span>Could not load the brief.</span>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw aria-hidden />
            Retry
          </Button>
        </div>
      )
    }
    return <BriefSkeleton />
  }

  const empty = data.kpis.items24h === 0 && data.topics.length === 0

  return (
    <div className="flex flex-col gap-6">
      {query.isError ? <StaleBanner asOf={data.asOf} onRetry={() => void query.refetch()} /> : null}
      {empty ? (
        <p className="text-muted-foreground">
          Collecting: first numbers appear after the first fetch cycle (about 15 min)
        </p>
      ) : (
        <KpiRow kpis={data.kpis} onOpen={open} />
      )}
      <MarketStrip market={data.market} />
      {empty ? null : (
        <>
          <TopicsTable topics={data.topics} filters={filters} onOpen={open} />
          <BucketCounts emerging={data.emerging} unclassified={data.unclassified} onOpen={open} />
        </>
      )}
      <BriefFooter />
    </div>
  )
}
