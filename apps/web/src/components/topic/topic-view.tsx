'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { FilterBar } from '@/components/shell/filter-bar'
import { QueryView } from '@/components/states'
import { useFilters } from '@/components/shell/use-filters'
import { ApiError, getTimeline, queryKeys } from '@/lib/api'
import { BySourceTable } from './by-source-table'
import { CoordinationPanel } from './coordination-panel'
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

  if (!query.data && query.error instanceof ApiError && query.error.status === 404) {
    return (
      <div className="flex flex-col items-start gap-3 py-8">
        <h1 className="text-xl font-semibold">Topic not found</h1>
        <Link href="/" className="text-sm font-medium underline underline-offset-4">
          Back to the brief
        </Link>
      </div>
    )
  }

  return (
    <QueryView
      query={query}
      isEmpty={() => false}
      skeleton={<TopicSkeleton />}
      errorMessage="Could not load this topic."
      empty={null}
      asOf={(d) => d.asOf}
    >
      {(data) => (
        <div className="flex flex-col gap-6">
          <TopicHeader topic={data.topic} filters={filters} />
          <FilterBar />
          <TimelineChart slug={slug} data={data} />
          <CoordinationPanel slug={slug} topicName={data.topic.name} data={data.coordination} />
          <div className="grid gap-6 md:grid-cols-2">
            <BySourceTable slug={slug} rows={data.bySource} />
            <EntityBreakdown slug={slug} rows={data.byEntity} />
          </div>
          <TopPosts slug={slug} />
        </div>
      )}
    </QueryView>
  )
}
