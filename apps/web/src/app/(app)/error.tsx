'use client'

import { ErrorState } from '@/components/states'

/** Error boundary for every (app) page: shows a retry that re-renders the segment. */
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState message="Something went wrong loading this page." onRetry={reset} />
}
