'use client'

import { useQuery } from '@tanstack/react-query'
import { EvidenceCard } from '@/components/evidence/evidence-card'
import { useOpenEvidence } from '@/components/evidence/use-open-evidence'
import { useFilters } from '@/components/shell/use-filters'
import { Button } from '@/components/ui/button'
import { CardSkeletons, ErrorState } from '@/components/states'
import { getEvidence, queryKeys, type EvidenceQuery } from '@/lib/api'

export function TopPosts({ slug }: { slug: string }) {
  const { filters } = useFilters()
  const open = useOpenEvidence()
  const params: EvidenceQuery = {
    topic: slug,
    ...filters,
    window: '24h',
    sort: 'reach',
    limit: 10,
  }
  const query = useQuery({
    queryKey: queryKeys.evidence(params),
    queryFn: () => getEvidence(params),
    refetchInterval: false,
  })
  const items = query.data?.items ?? []

  return (
    <section aria-labelledby="top-posts-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="top-posts-h" className="text-sm font-semibold">
          Highest-reach posts (24h)
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => open({ topic: slug, window: '24h', sort: 'reach' })}
        >
          Open all in drawer
        </Button>
      </div>
      {!query.data ? (
        query.isError ? (
          <ErrorState message="Could not load posts." onRetry={() => void query.refetch()} />
        ) : (
          <CardSkeletons count={2} />
        )
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No posts in the last 24h</p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.slice(0, 10).map((item) => (
            <EvidenceCard key={item.postId} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}
