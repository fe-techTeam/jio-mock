import { Suspense } from 'react'
import { BriefSkeleton, BriefView } from '@/components/brief/brief-view'
import { FilterBar } from '@/components/shell/filter-bar'

// useSearchParams (filters live in the URL) needs a Suspense boundary in Next 15.
export default function BriefPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Executive brief</h1>
      <Suspense fallback={null}>
        <FilterBar />
      </Suspense>
      <Suspense fallback={<BriefSkeleton />}>
        <BriefView />
      </Suspense>
    </div>
  )
}
