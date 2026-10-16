import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { TopicSkeleton } from '@/components/topic/topic-skeleton'
import { TopicView } from '@/components/topic/topic-view'
import { readCtx } from '@/lib/queries/ctx'
import { getTopicMeta } from '@/lib/queries/timeline'

export const dynamic = 'force-dynamic'

const SLUG_RE = /^[a-z0-9-]{1,64}$/

type Props = { params: Promise<{ slug: string }> }

async function findTopic(slug: string) {
  if (!SLUG_RE.test(slug)) return null
  return getTopicMeta(readCtx(), slug)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const topic = await findTopic(slug)
  return { title: topic?.name ?? 'Topic not found' }
}

// useSearchParams (filters live in the URL) needs a Suspense boundary in Next 15.
export default async function TopicPage({ params }: Props) {
  const { slug } = await params
  const topic = await findTopic(slug)
  if (!topic) notFound()
  return (
    <Suspense fallback={<TopicSkeleton />}>
      <TopicView slug={slug} />
    </Suspense>
  )
}
