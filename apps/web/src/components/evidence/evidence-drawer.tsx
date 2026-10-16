'use client'

import type { EvidenceSort } from '@jio/core'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Toggle } from '@/components/ui/toggle'
import { formatCount } from '@/components/shell/format'
import { parseFilters } from '@/components/shell/use-filters'
import { getEvidence, queryKeys, type Filters } from '@/lib/api'
import { EvidenceCard } from './evidence-card'
import { describeSlice, toEvidenceParams, type EvidenceSlice } from './slice'
import { useCloseEvidence, useEvidenceSlice, useOpenEvidence } from './use-open-evidence'

/** Mounted once in the (app) layout; opens whenever the URL carries a valid `evidence` param. */
export function EvidenceDrawer() {
  const params = useSearchParams()
  const filters = parseFilters(params)
  const slice = useEvidenceSlice()
  const close = useCloseEvidence()

  return (
    <Sheet
      open={slice !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        {slice ? <EvidencePanel slice={slice} filters={filters} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" aria-hidden>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

function EvidencePanel({ slice, filters }: { slice: EvidenceSlice; filters: Filters }) {
  const open = useOpenEvidence()
  const params = toEvidenceParams(slice, filters)
  const query = useInfiniteQuery({
    queryKey: queryKeys.evidence(params),
    queryFn: ({ pageParam }) => getEvidence({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: false,
    // A different slice must never show the previous slice's posts while it loads.
    placeholderData: undefined,
  })

  const pages = query.data?.pages ?? []
  const items = pages.flatMap((p) => p.items)
  const total = pages[0]?.total

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle>{describeSlice(slice, filters)}</SheetTitle>
        <SheetDescription>
          {total === undefined ? 'Loading posts' : `${formatCount(total)} items`}
        </SheetDescription>
        <div className="flex items-center gap-2 pt-1">
          <span id="evidence-sort-label" className="text-xs text-muted-foreground">
            Sort by
          </span>
          <Select
            value={slice.sort}
            onValueChange={(v) => open({ ...slice, sort: v as EvidenceSort })}
          >
            <SelectTrigger size="sm" aria-labelledby="evidence-sort-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reach">Reach</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
            </SelectContent>
          </Select>
          <Toggle
            variant="outline"
            size="sm"
            pressed={slice.coordinated === true}
            onPressedChange={(on) => {
              const next: EvidenceSlice = { ...slice }
              if (on) next.coordinated = true
              else delete next.coordinated
              open(next)
            }}
            title="Posts flagged by the coordination heuristics. Suspected, not proven."
          >
            Suspected coordinated only
          </Toggle>
        </div>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {query.isPending ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : null}

        {query.isError && !query.isFetchNextPageError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
          >
            <span>Could not load posts.</span>
            <Button variant="outline" size="xs" onClick={() => void query.refetch()}>
              <RefreshCw aria-hidden />
              Retry
            </Button>
          </div>
        ) : null}

        {query.isSuccess && items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No posts match this slice
          </p>
        ) : null}

        {items.map((item) => (
          <EvidenceCard key={item.postId} item={item} />
        ))}

        {query.isFetchNextPageError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load more posts.
          </p>
        ) : null}

        {query.hasNextPage ? (
          <Button
            variant="outline"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Load more
          </Button>
        ) : null}
      </div>
    </>
  )
}
