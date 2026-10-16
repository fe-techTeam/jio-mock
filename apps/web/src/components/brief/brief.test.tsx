// @vitest-environment jsdom
import type { BriefResponse, TopicRow } from '@jio/core'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBrief, queryKeys } from '@/lib/api'
import { decodeSlice } from '@/components/evidence/slice'
import {
  makeTestClient,
  nav,
  renderWithClient,
  replacedParams,
  resetNav,
} from '@/components/shell/test-utils'
import { FilterBar } from '@/components/shell/filter-bar'
import { BriefView } from './brief-view'
import { LaneToggle } from './lane-toggle'
import { MarketStrip } from './market-strip'
import { SentimentBar } from './sentiment-bar'
import { Sparkline } from './sparkline'
import { TrendArrow } from './trend-arrow'

vi.mock('next/navigation', () => import('@/components/shell/test-utils'))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getBrief: vi.fn(),
}))

const getBriefMock = vi.mocked(getBrief)

beforeEach(() => {
  resetNav()
  getBriefMock.mockReset()
})
afterEach(() => cleanup())

const topic = (over: Partial<TopicRow>): TopicRow => ({
  slug: 'valuation-and-price-band',
  name: 'Valuation and price band',
  summary2line: 'Retail investors debate whether the price band leaves room for listing gains.',
  summaryAt: '2026-10-16T03:45:00Z',
  items: 41,
  pos: 10,
  neu: 14,
  neg: 17,
  splitShown: true,
  itemsPrev24h: 29,
  uniqueAuthors24h: 30,
  score: 50,
  trend: 'up',
  deltaPct: 41.4,
  lowConfPct: 12.2,
  suspectedCoordinated: 3,
  spark: Array.from({ length: 24 }, (_, i) => i % 5),
  reach: { pos: 30, neu: 30, neg: 40 },
  ...over,
})

const brief = (over: Partial<BriefResponse> = {}): BriefResponse => ({
  asOf: '2026-10-16T04:00:00Z',
  lane: 'all',
  minItemsForSplit: 30,
  activeMinItems: 10,
  kpis: {
    items24h: 120,
    itemsPrev24h: 100,
    pos: 40,
    neu: 50,
    neg: 30,
    splitShown: true,
    lowConfPct: 8.5,
    suspectedCoordinated: 4,
    reach: { pos: 45, neu: 35, neg: 20 },
  },
  topics: [
    topic({}),
    topic({
      slug: 'gmp-and-grey-market',
      name: 'GMP and grey market',
      items: 12,
      pos: 4,
      neu: 4,
      neg: 4,
      splitShown: false,
      trend: 'new',
      deltaPct: null,
      summary2line: null,
      reach: null,
    }),
    topic({ slug: 'ambani-family', name: 'Ambani family, succession and leadership', items: 35 }),
  ],
  emerging: { count: 9, candidates: 2 },
  unclassified: { count: 5 },
  market: {
    items: [
      {
        series: 'gmp_inr',
        value: 42,
        observedAt: '2026-10-16T03:50:00Z',
        sourceKey: 'portal_investorgain',
        sourceUrl: 'https://www.investorgain.com/report/live-ipo-gmp/331/',
        ageMin: 10,
        stale: false,
      },
      {
        series: 'sub_retail_x',
        value: 1.84,
        observedAt: '2026-10-16T01:00:00Z',
        sourceKey: 'portal_chittorgarh',
        sourceUrl: 'https://www.chittorgarh.com/ipo_subscription_status/',
        ageMin: 180,
        stale: true,
      },
    ],
    unofficial: true,
  },
  freshness: [],
  ...over,
})

describe('BriefView', () => {
  it('renders topics in API order', async () => {
    getBriefMock.mockResolvedValue(brief())
    renderWithClient(<BriefView />)
    const table = await screen.findByRole('table')
    const names = within(table)
      .getAllByRole('link')
      .map((a) => a.textContent)
    expect(names).toEqual([
      'Valuation and price band',
      'GMP and grey market',
      'Ambani family, succession and leadership',
    ])
  })

  it('shows Not enough data instead of a split for small topics', async () => {
    getBriefMock.mockResolvedValue(brief())
    renderWithClient(<BriefView />)
    const link = await screen.findByRole('link', { name: 'GMP and grey market' })
    const row = link.closest('tr')!
    expect(within(row).getByText('Not enough data (n=12)')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /^(Positive|Neutral|Negative) / })).toBeNull()
  })

  it('opens evidence for a negative segment', async () => {
    resetNav('lane=social')
    getBriefMock.mockResolvedValue(brief())
    renderWithClient(<BriefView />)
    const link = await screen.findByRole('link', { name: 'Valuation and price band' })
    const row = link.closest('tr')!
    await userEvent.click(
      within(row).getByRole('button', { name: 'Negative: 17 posts (42%), open evidence' }),
    )
    const p = replacedParams()
    expect(p.get('lane')).toBe('social')
    expect(decodeSlice(p.get('evidence'))).toMatchObject({
      topic: 'valuation-and-price-band',
      sentiment: 'negative',
      window: '24h',
    })
  })

  it('keeps entity and lane on topic links', async () => {
    resetNav('entity=isha&lane=media&evidence=window%3D24h')
    getBriefMock.mockResolvedValue(brief())
    renderWithClient(<BriefView />)
    const link = await screen.findByRole('link', { name: 'Valuation and price band' })
    expect(link).toHaveAttribute('href', '/topics/valuation-and-price-band?entity=isha&lane=media')
    expect(getBriefMock).toHaveBeenCalledWith({ entity: 'isha', lane: 'media' })
  })

  it('opens evidence from the KPI row and bucket counts', async () => {
    getBriefMock.mockResolvedValue(brief())
    renderWithClient(<BriefView />)
    await userEvent.click(await screen.findByRole('button', { name: /Items in 24h: 120/ }))
    expect(decodeSlice(replacedParams().get('evidence'))).toEqual({ window: '24h', sort: 'reach' })
    await userEvent.click(screen.getByRole('button', { name: /Low confidence: 8.5%/ }))
    expect(decodeSlice(replacedParams().get('evidence'))).toMatchObject({ confidence: 'low' })
    await userEvent.click(screen.getByRole('button', { name: /Emerging candidates: 9 items/ }))
    expect(decodeSlice(replacedParams().get('evidence'))).toMatchObject({ topic: 'emerging' })
    await userEvent.click(screen.getByRole('button', { name: /Unclassified: 5/ }))
    expect(decodeSlice(replacedParams().get('evidence'))).toMatchObject({ topic: 'unclassified' })
    expect(screen.getByText('Instagram and LinkedIn are sampled, not representative')).toBeVisible()
  })

  it('shows the KPI split as percentages, or Not enough data', async () => {
    getBriefMock.mockResolvedValue(
      brief({
        kpis: {
          ...brief().kpis,
          items24h: 20,
          pos: 5,
          neu: 5,
          neg: 10,
          splitShown: false,
          reach: null,
        },
      }),
    )
    renderWithClient(<BriefView />)
    expect(await screen.findByText('Not enough data (n=20)')).toBeInTheDocument()
  })

  it('shows the collecting state when there is no data yet', async () => {
    getBriefMock.mockResolvedValue(
      brief({
        kpis: { ...brief().kpis, items24h: 0, itemsPrev24h: 0, pos: 0, neu: 0, neg: 0 },
        topics: [],
      }),
    )
    renderWithClient(<BriefView />)
    expect(
      await screen.findByText(
        'Collecting: first numbers appear after the first fetch cycle (about 15 min)',
      ),
    ).toBeInTheDocument()
  })

  it('keeps the last good data under a stale banner when a poll fails', async () => {
    getBriefMock.mockResolvedValueOnce(brief()).mockRejectedValueOnce(new Error('503'))
    const client = makeTestClient()
    renderWithClient(<BriefView />, client)
    await screen.findByRole('link', { name: 'Valuation and price band' })
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKeys.brief({ entity: 'all', lane: 'all' }) })
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Could not refresh, showing data as of 09:30 IST',
    )
    expect(screen.getByRole('link', { name: 'Valuation and price band' })).toBeInTheDocument()
  })

  it('shows an error card with retry when the first load fails', async () => {
    getBriefMock.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(brief())
    renderWithClient(<BriefView />)
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'Valuation and price band' })).toBeVisible()
  })
})

describe('reach-weighted headline and lane toggle', () => {
  it('the KPI headline is the reach-weighted split with the raw split and n beside it', async () => {
    getBriefMock.mockResolvedValue(brief())
    renderWithClient(<BriefView />)
    const kpis = await screen.findByRole('region', { name: 'Key figures' })
    expect(within(kpis).getByText('Reach-weighted')).toBeInTheDocument()
    expect(within(kpis).getByText('Raw 33 / 42 / 25, n = 120')).toBeInTheDocument()
    await userEvent.click(
      within(kpis).getByRole('button', { name: 'Reach-weighted Positive 45%, open evidence' }),
    )
    expect(decodeSlice(replacedParams().get('evidence'))).toMatchObject({ sentiment: 'positive' })
  })

  it('each topic row shows its reach-weighted split, or Not enough data', async () => {
    getBriefMock.mockResolvedValue(brief())
    renderWithClient(<BriefView />)
    const big = (await screen.findByRole('link', { name: 'Valuation and price band' })).closest(
      'tr',
    )!
    expect(within(big).getByText('30 / 30 / 40')).toBeInTheDocument()
    const small = screen.getByRole('link', { name: 'GMP and grey market' }).closest('tr')!
    expect(within(small).queryByText(/ \/ /)).toBeNull()
  })

  it('the filter bar carries the lane toggle and keeps entity and evidence', async () => {
    resetNav('entity=isha&evidence=window%3D24h')
    render(<FilterBar />)
    const lane = screen.getByRole('radiogroup', { name: 'Lane' })
    await userEvent.click(within(lane).getByRole('radio', { name: 'Media and analyst' }))
    const p = replacedParams()
    expect(p.get('lane')).toBe('media')
    expect(p.get('entity')).toBe('isha')
    expect(p.get('evidence')).toBe('window=24h')
  })

  it('LaneToggle reflects the URL and All removes the lane param', async () => {
    resetNav('lane=social&entity=jio', '/topics/gmp')
    render(<LaneToggle />)
    expect(screen.getByRole('radio', { name: 'Social' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('radio', { name: 'All' }))
    expect(nav.replace).toHaveBeenLastCalledWith('/topics/gmp?entity=jio', { scroll: false })
  })
})

describe('brief parts', () => {
  it('SentimentBar labels each non-zero segment', async () => {
    const onOpen = vi.fn()
    render(
      <SentimentBar
        counts={{ items: 40, pos: 0, neu: 20, neg: 20, splitShown: true }}
        onOpen={onOpen}
      />,
    )
    expect(screen.queryByRole('button', { name: /Positive/ })).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'Neutral: 20 posts (50%), open evidence' }),
    )
    expect(onOpen).toHaveBeenCalledWith('neutral')
  })

  it('TrendArrow shows the volume change or New', () => {
    const { rerender } = render(<TrendArrow trend="up" deltaPct={41.4} />)
    expect(screen.getByText('+41%')).toBeInTheDocument()
    rerender(<TrendArrow trend="new" deltaPct={null} />)
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('Sparkline draws one point per hour', () => {
    const { container } = render(<Sparkline values={Array.from({ length: 24 }, (_, i) => i)} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(24)
  })

  it('MarketStrip tags every chip unofficial and shows freshness', () => {
    render(<MarketStrip market={brief().market} />)
    expect(screen.getAllByText('Unofficial')).toHaveLength(2)
    expect(screen.getByText('GMP INR')).toBeInTheDocument()
    expect(screen.getByText('1.84x')).toBeInTheDocument()
    expect(screen.getByText('3 h')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /InvestorGain/ })).toHaveAttribute('target', '_blank')
  })

  it('MarketStrip shows an empty state', () => {
    render(<MarketStrip market={{ items: [], unofficial: true }} />)
    expect(screen.getByText('No market data yet')).toBeInTheDocument()
  })
})
