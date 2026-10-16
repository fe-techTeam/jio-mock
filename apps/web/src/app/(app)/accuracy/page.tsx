import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AccuracySkeleton, AccuracyView } from '@/components/accuracy/accuracy-view'

export const metadata: Metadata = { title: 'Accuracy' }

// useSearchParams (the back link keeps the filters) needs a Suspense boundary in Next 15.
export default function AccuracyPage() {
  return (
    <Suspense fallback={<AccuracySkeleton />}>
      <AccuracyView />
    </Suspense>
  )
}
