'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { FilterBar } from '@/components/shell/filter-bar'
import { StaleBanner } from '@/components/shell/stale-banner'
import { useFilters } from '@/components/shell/use-filters'
import { Button } from '@/components/ui/button'
import { ApiError, getTimeline, queryKeys } from '@/lib/api'
import { BySourceTable } from './by-source-table'
import { EntityBreakdown } from './entity-breakdown'
import { TimelineChart } from './timeline-chart'
import { TopicHeader } from './topic-header'
import { TopicSkeleton } from './topic-skeleton'
import { TopPosts } from './top-posts'

export function TopicView({ slug }: { slug: string }) {
  const { filters } = useFilters()
  const query = useQuery({
    queryKey: queryKeys.timeline(slug, filters),
    queryFn: () => getTimeline(slug, filters),
  })
  const { data } = query

  if (!data) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <div className="flex flex-col items-start gap-3 py-8">
          <h1 className="text-xl font-semibold">Topic not found</h1>
          <Link href="/" className="text-sm font-medium underline underline-offset-4">
            Back to the brief
          </Link>
        </div>
      )
    }
    if (query.isError) {
      return (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 text-sm"
        >
          <span>Could not load this topic.</span>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw aria-hidden />
            Retry
          </Button>
        </div>
      )
    }
    return <TopicSkeleton />
  }

  return (
    <div className="flex flex-col gap-6">
      <TopicHeader topic={data.topic} filters={filters} />
      <FilterBar />
      {query.isError ? <StaleBanner asOf={data.asOf} onRetry={() => void query.refetch()} /> : null}
      <TimelineChart slug={slug} data={data} />
      <div className="grid gap-6 md:grid-cols-2">
        <BySourceTable slug={slug} rows={data.bySource} />
        <EntityBreakdown slug={slug} rows={data.byEntity} />
      </div>
      <TopPosts slug={slug} />
    </div>
  )
}
