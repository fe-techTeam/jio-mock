import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function Busy({
  label = 'Loading',
  className,
  children,
}: {
  label?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className} aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <Busy className={cn('flex flex-col gap-3', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </Busy>
  )
}

export function CardSkeletons({ count = 3 }: { count?: number }) {
  return (
    <Busy className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border p-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </Busy>
  )
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <Busy>
      <Skeleton className={cn('h-[280px]', className)} />
    </Busy>
  )
}

export function TabSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <Busy label={label} className="flex flex-col gap-4">
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </Busy>
  )
}
