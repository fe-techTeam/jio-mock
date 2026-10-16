'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatIst } from './format'

/** Shown above data that is still on screen after a failed poll. */
export function StaleBanner({ asOf, onRetry }: { asOf: string; onRetry: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">
        Could not refresh, showing data as of {formatIst(asOf, 'time')}
      </span>
      <Button variant="outline" size="xs" onClick={onRetry}>
        <RefreshCw aria-hidden />
        Retry
      </Button>
    </div>
  )
}
