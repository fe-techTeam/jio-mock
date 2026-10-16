import { Suspense } from 'react'
import { SourcesSkeleton, SourcesView } from '@/components/sources/sources-view'

// useSearchParams (back link keeps filters) needs a Suspense boundary in Next 15.
export default function SourcesPage() {
  return (
    <Suspense fallback={<SourcesSkeleton />}>
      <SourcesView />
    </Suspense>
  )
}
