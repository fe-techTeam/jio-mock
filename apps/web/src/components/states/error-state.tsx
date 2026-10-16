'use client'

import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Inline failure with a retry; used where there is no earlier data to keep on screen. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 text-sm"
    >
      <span>{message}</span>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden />
          Retry
        </Button>
      ) : null}
    </div>
  )
}
