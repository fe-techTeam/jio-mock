import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function TabSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={label}>
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  )
}

export function TabError({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>Could not load this tab.</span>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  )
}
