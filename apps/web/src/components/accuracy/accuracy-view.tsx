'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import type { AccuracyResponse } from '@/app/api/accuracy/_lib/compute'
import { hrefWith, useFilters } from '@/components/shell/use-filters'
import { ChartSkeleton, ErrorState, SkeletonRows } from '@/components/states'
import { fetchJson } from '@/lib/api'
import { AccuracyHeader } from './accuracy-header'
import { ConfusionMatrix } from './confusion-matrix'
import { GoldQueue } from './gold-queue'
import { LanguageBreakdown } from './language-breakdown'

export function AccuracySkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <SkeletonRows rows={1} />
      <ChartSkeleton />
    </div>
  )
}

export function AccuracyView() {
  const { filters } = useFilters()
  const [scope, setScope] = useState<'default' | 'latest'>('default')
  const accuracy = useQuery({
    queryKey: ['accuracy', scope],
    queryFn: () =>
      fetchJson<AccuracyResponse>('/api/accuracy', {
        promptVersion: scope === 'latest' ? 'latest' : undefined,
      }),
    // The page is a worksheet: refresh on saves, not on a timer.
    refetchInterval: false,
  })

  const back = new URLSearchParams()
  if (filters.entity !== 'all') back.set('entity', filters.entity)
  if (filters.lane !== 'all') back.set('lane', filters.lane)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={hrefWith('/', back)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3" aria-hidden />
          Back to brief
        </Link>
        <h1 className="text-2xl font-semibold">Accuracy</h1>
      </div>

      {accuracy.isPending ? (
        <SkeletonRows rows={2} />
      ) : accuracy.isError ? (
        <ErrorState
          message="Could not load accuracy figures."
          onRetry={() => void accuracy.refetch()}
        />
      ) : (
        <>
          <AccuracyHeader data={accuracy.data} />
          {accuracy.data.measured ? (
            <div className="grid gap-6 md:grid-cols-2">
              <LanguageBreakdown data={accuracy.data} />
              {accuracy.data.confusion ? (
                <ConfusionMatrix matrix={accuracy.data.confusion} />
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <section className="flex flex-col gap-2" aria-label="Gold set labelling">
        <h2 className="text-sm font-medium">Label the gold set</h2>
        <GoldQueue
          accuracy={accuracy.data}
          rescoring={accuracy.isFetching && scope === 'latest'}
          onRescore={() => {
            if (scope === 'latest') void accuracy.refetch()
            else setScope('latest')
          }}
        />
      </section>
    </div>
  )
}
