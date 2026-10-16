// @vitest-environment jsdom
import type { EvidenceItem, EvidencePage } from '@jio/core'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEvidence } from '@/lib/api'
import { nav, renderWithClient, replacedParams, resetNav } from '@/components/shell/test-utils'
import { EvidenceCard } from './evidence-card'
import { EvidenceDrawer } from './evidence-drawer'
import {
  decodeSlice,
  describeSlice,
  encodeSlice,
  toEvidenceParams,
  type EvidenceSlice,
} from './slice'
import { SourceBadge } from './source-badge'

vi.mock('next/navigation', () => import('@/components/shell/test-utils'))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getEvidence: vi.fn(),
}))

const getEvidenceMock = vi.mocked(getEvidence)

beforeEach(() => {
  resetNav()
  getEvidenceMock.mockReset()
})
afterEach(() => cleanup())

const item = (over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  postId: 'p1',
  sourceKey: 'reddit',
  lane: 'social',
  url: 'https://reddit.com/r/IndianStockMarket/comments/abc',
  publishedAt: '2026-10-16T04:00:00Z',
  text: 'Jio IPO valuation looks stretched <b>imo</b>',
  glossEn: null,
  lang: 'en',
  reachScore: 42.4,
  reachRaw: { score: 12 },
  sentiment: 'negative',
  topicSlug: 'valuation-and-price-band',
  entities: ['jio'],
  confidence: 'high',
  origin: 'model',
  author: { visible: false, label: 'Reddit user' },
  ...over,
})

const page = (items: EvidenceItem[], nextCursor: string | null, total = items.length) =>
  ({ items, nextCursor, total }) satisfies EvidencePage

describe('slice codec', () => {
  it('round-trips a slice', () => {
    const s: EvidenceSlice = {
      topic: 'valuation-and-price-band',
      topicName: 'Valuation and price band',
      sentiment: 'negative',
      entity: 'isha',
      window: '7d',
      from: '2026-10-16T03:30:00.000Z',
      to: '2026-10-16T04:30:00.000Z',
      source: 'x_api',
      confidence: 'low',
      sort: 'newest',
    }
    expect(decodeSlice(encodeSlice(s))).toEqual(s)
    expect(decodeSlice(encodeSlice({ window: '24h', sort: 'reach' }))).toEqual({
      window: '24h',
      sort: 'reach',
    })
  })

  it('rejects unknown values', () => {
    expect(decodeSlice(null)).toBeNull()
    expect(decodeSlice('')).toBeNull()
    expect(decodeSlice('window=30d')).toBeNull()
    expect(decodeSlice('window=24h&sentiment=angry')).toBeNull()
    expect(decodeSlice('window=24h&entity=anant')).toBeNull()
    expect(decodeSlice('window=24h&topic=Bad%20Slug')).toBeNull()
    expect(decodeSlice('window=24h&source=tiktok')).toBeNull()
    expect(decodeSlice('window=24h&confidence=high')).toBeNull()
    expect(decodeSlice('window=24h&sort=random')).toBeNull()
    expect(decodeSlice('window=24h&from=2026-10-16T03%3A30%3A00Z')).toBeNull()
    expect(decodeSlice('window=24h&from=yesterday&to=today')).toBeNull()
  })

  it('describes a slice, omitting parts that are all', () => {
    const s: EvidenceSlice = {
      topic: 'valuation-and-price-band',
      topicName: 'Valuation and price band',
      sentiment: 'negative',
      window: '24h',
      sort: 'reach',
    }
    expect(describeSlice(s, { entity: 'isha', lane: 'social' })).toBe(
      'Valuation and price band, Negative, Last 24h, Social, Isha',
    )
    expect(describeSlice({ window: '24h', sort: 'reach' }, { entity: 'all', lane: 'all' })).toBe(
      'All topics, Last 24h',
    )
    expect(
      describeSlice(
        {
          topic: 'emerging',
          window: '7d',
          from: '2026-10-16T03:30:00Z',
          to: '2026-10-16T04:30:00Z',
          sort: 'reach',
        },
        { entity: 'all', lane: 'media' },
      ),
    ).toBe('Emerging candidates, 09:00-10:00 16 Oct IST, Media and analyst')
  })

  it('lets the slice entity override the page filter', () => {
    const s: EvidenceSlice = { entity: 'akash', window: '24h', sort: 'reach', confidence: 'low' }
    expect(toEvidenceParams(s, { entity: 'isha', lane: 'social' })).toEqual({
      entity: 'akash',
      lane: 'social',
      window: '24h',
      sort: 'reach',
      confidence: 'low',
    })
    expect(
      toEvidenceParams({ window: '7d', sort: 'newest' }, { entity: 'isha', lane: 'all' }),
    ).toMatchObject({ entity: 'isha', lane: 'all', window: '7d', sort: 'newest' })
  })
})

describe('EvidenceCard', () => {
  it('hides the author handle unless the API marks it visible', () => {
    render(<EvidenceCard item={item()} />)
    expect(screen.getByText('Reddit user')).toBeInTheDocument()
    // Scraped text is rendered as text, never as HTML.
    expect(screen.getByText('Jio IPO valuation looks stretched <b>imo</b>')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Open original/ })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow')
    expect(screen.getByText('Reach 42')).toBeInTheDocument()
    expect(screen.getByText(/09:30 16 Oct/)).toBeInTheDocument()
  })

  it('shows names for visible authors, glosses and low confidence', () => {
    render(
      <EvidenceCard
        item={item({
          sourceKey: 'news_rss',
          lang: 'hi',
          text: 'जियो आईपीओ का मूल्यांकन ज़्यादा है',
          glossEn: 'Jio IPO valuation is too high',
          confidence: 'low',
          reachScore: null,
          author: { visible: true, kind: 'media_outlet', displayName: 'Mint', handle: 'livemint' },
        })}
      />,
    )
    expect(screen.getByText(/Mint/)).toBeInTheDocument()
    expect(screen.getByText('EN: Jio IPO valuation is too high')).toBeInTheDocument()
    expect(screen.getByText('Low confidence')).toBeInTheDocument()
    expect(screen.getByText('Reach -')).toBeInTheDocument()
  })

  it('never links a non-http url', () => {
    render(<EvidenceCard item={item({ url: 'javascript:alert(1)' })} />)
    expect(screen.queryByRole('link', { name: /Open original/ })).toBeNull()
  })

  it('labels sources, marking sampled ones', () => {
    render(<SourceBadge sourceKey="apify_instagram" />)
    expect(screen.getByText('Instagram (sampled)')).toBeInTheDocument()
  })
})

describe('EvidenceDrawer', () => {
  const evidenceQs = (s: EvidenceSlice) =>
    new URLSearchParams({ entity: 'isha', lane: 'social', evidence: encodeSlice(s) }).toString()

  it('stays closed without a valid evidence param', () => {
    resetNav('entity=isha&evidence=window%3D30d')
    renderWithClient(<EvidenceDrawer />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(getEvidenceMock).not.toHaveBeenCalled()
  })

  it('shows the empty state for a slice with no posts', async () => {
    resetNav(evidenceQs({ topic: 'gmp-and-grey-market', window: '24h', sort: 'reach' }))
    getEvidenceMock.mockResolvedValue(page([], null))
    renderWithClient(<EvidenceDrawer />)
    expect(await screen.findByText('No posts match this slice')).toBeInTheDocument()
    expect(getEvidenceMock).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'gmp-and-grey-market', entity: 'isha', lane: 'social' }),
    )
  })

  it('loads the next page with the returned cursor', async () => {
    resetNav(evidenceQs({ sentiment: 'negative', window: '24h', sort: 'reach' }))
    getEvidenceMock
      .mockResolvedValueOnce(page([item({ postId: 'p1' })], 'c1', 2))
      .mockResolvedValueOnce(page([item({ postId: 'p2', text: 'second page post' })], null, 2))
    renderWithClient(<EvidenceDrawer />)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Negative, Last 24h, Social, Isha')).toBeInTheDocument()
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('second page post')).toBeInTheDocument()
    expect(getEvidenceMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }))
    expect(within(dialog).queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('closing removes only the evidence param', async () => {
    resetNav(evidenceQs({ window: '24h', sort: 'reach' }), '/topics/gmp-and-grey-market')
    getEvidenceMock.mockResolvedValue(page([], null))
    renderWithClient(<EvidenceDrawer />)
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    const p = replacedParams()
    expect(p.has('evidence')).toBe(false)
    expect(p.get('entity')).toBe('isha')
    expect(p.get('lane')).toBe('social')
    expect(String(nav.replace.mock.calls.at(-1)![0])).toMatch(/^\/topics\/gmp-and-grey-market\?/)
  })

  it('shows an inline retry when the first page fails', async () => {
    resetNav(evidenceQs({ window: '24h', sort: 'reach' }))
    getEvidenceMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(page([], null))
    renderWithClient(<EvidenceDrawer />)
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No posts match this slice')).toBeInTheDocument()
  })
})
