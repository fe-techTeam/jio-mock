'use client'

import { useQuery } from '@tanstack/react-query'
import { EmptyState, QueryView, SkeletonRows } from '@/components/states'
import { Skeleton } from '@/components/ui/skeleton'
import { useOpenEvidence } from '@/components/evidence/use-open-evidence'
import { useFilters } from '@/components/shell/use-filters'
import { getBrief, queryKeys } from '@/lib/api'
import { BriefFooter } from './brief-footer'
import { BucketCounts } from './bucket-counts'
import { KpiRow } from './kpi-row'
import { MarketStrip } from './market-strip'
import { TopicsTable } from './topics-table'

export function BriefSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <SkeletonRows rows={7} />
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

  return (
    <QueryView
      query={query}
      // The market strip and footer still render when the board is empty.
      isEmpty={() => false}
      skeleton={<BriefSkeleton />}
      errorMessage="Could not load the brief."
      empty={null}
      asOf={(d) => d.asOf}
    >
      {(data) => {
        const empty = data.kpis.items24h === 0 && data.topics.length === 0
        return (
          <div className="flex flex-col gap-6">
            {empty ? (
              <EmptyState title="Collecting: first numbers appear after the first fetch cycle (about 15 min)" />
            ) : (
              <KpiRow kpis={data.kpis} onOpen={open} />
            )}
            <MarketStrip market={data.market} />
            {empty ? null : (
              <>
                <TopicsTable topics={data.topics} filters={filters} onOpen={open} />
                <BucketCounts
                  emerging={data.emerging}
                  unclassified={data.unclassified}
                  onOpen={open}
                />
              </>
            )}
            <BriefFooter />
          </div>
        )
      }}
    </QueryView>
  )
}
