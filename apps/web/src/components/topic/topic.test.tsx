// @vitest-environment jsdom
import type { EvidenceItem, TimelineTopic } from '@jio/core'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEvidence } from '@/lib/api'
import { decodeSlice } from '@/components/evidence/slice'
import { renderWithClient, replacedParams, resetNav } from '@/components/shell/test-utils'
import { BySourceTable } from './by-source-table'
import { EntityBreakdown } from './entity-breakdown'
import { makeBarClick } from './timeline-chart'
import { TopicHeader } from './topic-header'
import { TopPosts } from './top-posts'

vi.mock('next/navigation', () => import('@/components/shell/test-utils'))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getEvidence: vi.fn(),
}))
const getEvidenceMock = vi.mocked(getEvidence)

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
beforeEach(() => {
  resetNav()
  getEvidenceMock.mockReset()
})
afterEach(() => cleanup())

const topic = (over: Partial<TopicRow2> = {}): TimelineTopic => ({
  slug: 'valuation-price-band',
  name: 'Valuation and price band',
  kind: 'seed',
  summary2line: 'Investors debate the band.',
  summaryAt: '2026-10-16T03:45:00Z',
  items24h: 40,
  lastItemAt: '2026-10-16T03:00:00Z',
  ...over,
})
type TopicRow2 = TimelineTopic

describe('TopicHeader', () => {
  it('back link keeps entity and lane', () => {
    render(<TopicHeader topic={topic()} filters={{ entity: 'isha', lane: 'social' }} />)
    expect(screen.getByRole('link', { name: /back to brief/i }).getAttribute('href')).toBe(
      '/?entity=isha&lane=social',
    )
  })
  it('shows the summary time in IST', () => {
    render(<TopicHeader topic={topic()} filters={{ entity: 'all', lane: 'all' }} />)
    expect(screen.getByText('Summary generated 09:15 IST')).toBeTruthy()
  })
  it('shows a dormant line when there were no items in 24h', () => {
    render(
      <TopicHeader
        topic={topic({ items24h: 0, lastItemAt: '2026-10-12T08:35:00Z' })}
        filters={{ entity: 'all', lane: 'all' }}
      />,
    )
    expect(screen.getByText('Dormant: last item 14:05 12 Oct')).toBeTruthy()
  })
})

const counts = { pos: 5, neu: 5, neg: 2 }

describe('BySourceTable', () => {
  const rows = [
    {
      sourceKey: 'reddit' as const,
      items: 12,
      ...counts,
      splitShown: false,
      coverageLabel: 'full_search',
    },
    {
      sourceKey: 'youtube' as const,
      items: 40,
      pos: 20,
      neu: 10,
      neg: 10,
      splitShown: true,
      coverageLabel: 'sampled',
    },
  ]
  it('applies the 30-item rule and sorts by items', () => {
    render(<BySourceTable slug="s" rows={rows} />)
    expect(screen.getByText('Not enough data (n=12)')).toBeTruthy()
    expect(screen.getByText('50% pos / 25% neu / 25% neg')).toBeTruthy()
    expect(screen.getByText('sampled')).toBeTruthy()
    const body = screen.getAllByRole('row')
    expect(within(body[1]!).getByText('YouTube')).toBeTruthy()
  })
  it('opens the evidence slice for a source', async () => {
    render(<BySourceTable slug="valuation-price-band" rows={rows} />)
    await userEvent.click(screen.getByRole('button', { name: /reddit: 12 items/i }))
    expect(decodeSlice(replacedParams().get('evidence'))).toMatchObject({
      topic: 'valuation-price-band',
      source: 'reddit',
      window: '24h',
    })
  })
  it('empty state', () => {
    render(<BySourceTable slug="s" rows={[]} />)
    expect(screen.getByText('No items in the last 24h')).toBeTruthy()
  })
})

describe('EntityBreakdown', () => {
  it('shows four rows and opens the entity slice', async () => {
    render(
      <EntityBreakdown
        slug="s1"
        rows={[{ entity: 'akash', items: 31, pos: 10, neu: 10, neg: 11, splitShown: true }]}
      />,
    )
    expect(screen.getAllByRole('row')).toHaveLength(5)
    await userEvent.click(screen.getByRole('button', { name: /akash: 31 items/i }))
    expect(decodeSlice(replacedParams().get('evidence'))).toMatchObject({
      topic: 's1',
      entity: 'akash',
    })
  })
})

const post = (i: number, visible: boolean): EvidenceItem => ({
  postId: `p${i}`,
  sourceKey: 'x_api',
  lane: 'social',
  url: 'https://example.com/' + i,
  publishedAt: '2026-10-16T03:00:00Z',
  text: `post ${i}`,
  glossEn: null,
  lang: 'en',
  reachScore: 50,
  reachRaw: {},
  sentiment: 'neutral',
  topicSlug: 's',
  entities: [],
  confidence: 'high',
  origin: 'model',
  author: visible
    ? { visible: true, kind: 'public_figure', displayName: 'Pub', handle: 'pubfig' }
    : { visible: false, label: 'Individual account' },
})

describe('TopPosts', () => {
  it('renders 10 cards and never a hidden author handle', async () => {
    const items = Array.from({ length: 10 }, (_, i) => post(i, i === 0))
    items[1] = { ...post(1, false), author: { visible: false, label: 'Individual account' } }
    getEvidenceMock.mockResolvedValue({ items, nextCursor: null, total: 10 })
    renderWithClient(<TopPosts slug="s" />)
    expect(await screen.findAllByRole('article')).toHaveLength(10)
    expect(getEvidenceMock).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 's', window: '24h', sort: 'reach', limit: 10 }),
    )
    expect(screen.queryByText(/hiddenhandle/)).toBeNull()
    expect(screen.getByText(/@pubfig/)).toBeTruthy()
  })
  it('empty state', async () => {
    getEvidenceMock.mockResolvedValue({ items: [], nextCursor: null, total: 0 })
    renderWithClient(<TopPosts slug="s" />)
    expect(await screen.findByText('No posts in the last 24h')).toBeTruthy()
  })
})

describe('chart click', () => {
  it('opens the bucket slice from a bar payload', () => {
    const open = vi.fn()
    const row = { hourStart: '2026-10-16T03:30:00.000Z' }
    makeBarClick('s1', open)({ payload: row } as never)
    expect(open).toHaveBeenCalledWith({
      topic: 's1',
      window: '7d',
      from: '2026-10-16T03:30:00.000Z',
      to: '2026-10-16T04:30:00.000Z',
      sort: 'reach',
    })
  })
})
