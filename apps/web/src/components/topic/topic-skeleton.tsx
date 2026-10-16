import { Skeleton } from '@/components/ui/skeleton'

export function TopicSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading topic">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-[280px]" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  )
}
