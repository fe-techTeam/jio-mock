// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
)
const getTopicMeta = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ notFound }))
vi.mock('@/lib/queries/ctx', () => ({ readCtx: () => ({}) }))
vi.mock('@/lib/queries/timeline', () => ({ getTopicMeta }))

import TopicPage from '../../app/(app)/topics/[slug]/page'
import { TopicView } from './topic-view'

beforeEach(() => {
  notFound.mockClear()
  getTopicMeta.mockReset()
})

const run = (slug: string) => TopicPage({ params: Promise.resolve({ slug }) })

describe('/topics/[slug] page', () => {
  it('calls notFound for a malformed slug without querying', async () => {
    await expect(run('BAD_SLUG!')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
    expect(getTopicMeta).not.toHaveBeenCalled()
  })

  it('calls notFound for an unknown slug', async () => {
    getTopicMeta.mockResolvedValue(null)
    await expect(run('not-a-topic')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('renders TopicView for a known slug', async () => {
    getTopicMeta.mockResolvedValue({ slug: 'valuation-price-band', name: 'V' })
    const el = await run('valuation-price-band')
    const child = (el.props as { children: { type: unknown; props: { slug: string } } }).children
    expect(child.type).toBe(TopicView)
    expect(child.props.slug).toBe('valuation-price-band')
  })
})
