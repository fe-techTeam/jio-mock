import { ChartSkeleton } from '@/components/states'
import { Skeleton } from '@/components/ui/skeleton'

export function TopicSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2" aria-hidden>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <ChartSkeleton />
      <div className="grid gap-4 md:grid-cols-2" aria-hidden>
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  )
}
