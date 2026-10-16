'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StaleBanner } from '@/components/shell/stale-banner'
import { hrefWith } from '@/components/shell/use-filters'
import { QuotaCard } from './quota-card'
import { SOURCES_KEY, getSources } from './sources-api'
import { SourcesTable } from './sources-table'
import { XConfigCard } from './x-config-card'

export function SourcesSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading sources">
      {Array.from({ length: 11 }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  )
}

export function SourcesView() {
  const params = useSearchParams()
  const query = useQuery({ queryKey: SOURCES_KEY, queryFn: getSources })
  const { data } = query

  // Back link keeps the entity and lane filters from the URL.
  const back = new URLSearchParams()
  for (const k of ['entity', 'lane']) {
    const v = params.get(k)
    if (v) back.set(k, v)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href={hrefWith('/', back)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to brief
        </Link>
        <h1 className="text-xl font-semibold">Sources</h1>
        {data ? (
          <div className="ml-auto flex flex-wrap gap-x-4 text-sm text-muted-foreground">
            <span>
              {data.oldestSuccessAgeMin == null
                ? 'No successful fetch yet'
                : `Data ${data.oldestSuccessAgeMin} min old`}
            </span>
            <span>Spend today ${data.spendTodayUsd.toFixed(2)}</span>
            <span>7d ${data.spend7dUsd.toFixed(2)}</span>
          </div>
        ) : null}
      </div>

      {!data && query.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-lg border p-4 text-sm"
        >
          <span>Could not load sources.</span>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {!data && !query.isError ? <SourcesSkeleton /> : null}

      {data ? (
        <>
          {query.isError ? (
            <StaleBanner asOf={data.asOf} onRetry={() => void query.refetch()} />
          ) : null}
          <div className="overflow-x-auto">
            <SourcesTable data={data} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <XConfigCard x={data.x} configVersion={data.configVersion} />
            <QuotaCard quota={data.youtubeQuota} />
          </div>
        </>
      ) : null}
    </div>
  )
}
