'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ErrorState, SkeletonRows, StaleBanner } from '@/components/states'
import { hrefWith } from '@/components/shell/use-filters'
import { QuotaCard } from './quota-card'
import { SOURCES_KEY, getSources } from './sources-api'
import { SourcesTable } from './sources-table'
import { XConfigCard } from './x-config-card'

export function SourcesSkeleton() {
  return <SkeletonRows rows={11} className="gap-3" />
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
        <ErrorState message="Could not load sources." onRetry={() => void query.refetch()} />
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
